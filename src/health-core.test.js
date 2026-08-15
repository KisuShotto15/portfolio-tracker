import { describe, it, expect } from 'vitest';
import { healthScoreCore, addDaysISO, netWorthAt } from './health-core.js';

var CATS = ['Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support'];
var MONTHS_IN_WINDOW = 90 / 30.4375;   // 2.9589

function tx(date, type, category, amountUSD){ return { date:date, type:type, category:category, amountUSD:amountUSD }; }
function snap(date, total, id){ return { date:date, total:total, id:id || 1 }; }
function base(over){
  return Object.assign({
    asOf:'2026-12-31', transactions:[], snapshots:[],
    expenseCats:CATS, budgetTotal:600, liveNetWorth:null
  }, over || {});
}
// Gasto total que hace que el promedio mensual de la ventana sea `perMonth`.
function expFor(perMonth){ return perMonth * MONTHS_IN_WINDOW; }
// Net worth final que produce exactamente `pct` % mensual de crecimiento.
function nwForMonthly(start, pct){ return start * Math.pow(1 + pct/100, MONTHS_IN_WINDOW); }
function byKey(r, k){ return r.metrics.find(function(m){ return m.key === k; }); }

// Libro "sano": gasto e income TODOS los dias del rango.
function ledger(fromISO, days, spend, income){
  var txs = [];
  for(var i = 0; i < days; i++){
    var d = addDaysISO(fromISO, i);
    txs.push(tx(d, 'Debit', 'Groceries', spend == null ? 10 : spend));
    txs.push(tx(d, 'Credit', 'Income', income == null ? 15 : income));
  }
  return txs;
}

describe('addDaysISO', () => {
  it('resta dias cruzando el ano sin depender de la zona horaria', () => {
    expect(addDaysISO('2027-01-01', -89)).toBe('2026-10-04');
    expect(addDaysISO('2026-12-31', -89)).toBe('2026-10-03');
  });
  it('cruza febrero sin asumir meses de 31 dias', () => {
    expect(addDaysISO('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDaysISO('2028-03-01', -1)).toBe('2028-02-29'); // bisiesto
  });
});

// ── LA regresion: el score no puede saltar al cambiar de mes ─────────────────
describe('continuidad entre meses (el bug)', () => {
  // Nada en 2026-10-03 (el dia que la ventana suelta) ni en 2027-01-01 (el que
  // agarra), y ningun snapshot en esos bordes → las dos ventanas ven lo mismo.
  var inp = {
    transactions: ledger('2026-10-04', 88),
    snapshots: [snap('2026-09-15', 900), snap('2026-12-20', 1000)],
  };

  it('31-dic y 1-ene dan el MISMO score', () => {
    var a = healthScoreCore(base(Object.assign({ asOf:'2026-12-31' }, inp)));
    var b = healthScoreCore(base(Object.assign({ asOf:'2027-01-01' }, inp)));
    expect(Math.abs(a.total - b.total)).toBeLessThan(1);
  });

  it('el 1ro sin transacciones NO colapsa el score', () => {
    var b = healthScoreCore(base(Object.assign({ asOf:'2027-01-01' }, inp)));
    expect(b.total).toBeGreaterThan(50);
    expect(b.metrics.every(function(m){ return m.available; })).toBe(true);
  });

  // Barrido dia a dia cruzando el cambio de mes. Snapshots DIARIOS a propósito:
  // con snapshots esporadicos los saltos que aparecen son del dia que se toma el
  // snapshot (el net worth salta de verdad), y eso taparia lo que este test busca,
  // que es un corte por calendario. Con la escalera densa ambos extremos de la
  // ventana se mueven suave y cualquier salto que quede es un cliff de fecha.
  it('barrido de 40 dias cruzando el cambio de mes: ningun salto > 2 pts', () => {
    var snaps = [], txs = [];
    for(var d = 0; d < 160; d++){
      var day = addDaysISO('2026-09-01', d);
      snaps.push(snap(day, 5000 * Math.pow(1.10, d / 30.4375), d + 1)); // 10%/mes parejo
      txs.push(tx(day, 'Debit', 'Groceries', 10));
      txs.push(tx(day, 'Credit', 'Income', 15));
    }
    var prev = null, maxJump = 0;
    for(var i = 0; i < 40; i++){
      var t = healthScoreCore(base({ asOf: addDaysISO('2026-12-10', i), transactions:txs, snapshots:snaps })).total;
      if(prev !== null) maxJump = Math.max(maxJump, Math.abs(t - prev));
      prev = t;
    }
    expect(maxJump).toBeLessThanOrEqual(2);
  });
});

describe('colchon (runway)', () => {
  it('6 meses de gastos = 100 pts', () => {
    var r = healthScoreCore(base({
      transactions:[tx('2026-12-01','Debit','Groceries', expFor(1000))],
      snapshots:[snap('2026-12-30', 6000)]
    }));
    expect(byKey(r,'runway').value).toBeCloseTo(6, 5);
    expect(byKey(r,'runway').score).toBeCloseTo(100, 5);
    expect(byKey(r,'runway').display).toBe('6.0 meses');
  });

  it('3 meses = 50 pts', () => {
    var r = healthScoreCore(base({
      transactions:[tx('2026-12-01','Debit','Groceries', expFor(1000))],
      snapshots:[snap('2026-12-30', 3000)]
    }));
    expect(byKey(r,'runway').score).toBeCloseTo(50, 5);
  });

  it('sin gastos en la ventana queda NO disponible, no 100', () => {
    var r = healthScoreCore(base({ snapshots:[snap('2026-12-30', 5000)] }));
    expect(byKey(r,'runway').available).toBe(false);
    expect(byKey(r,'runway').display).toBe('—');
  });

  it('net worth negativo puntua 0 pero SIGUE disponible (es senal real)', () => {
    var r = healthScoreCore(base({
      transactions:[tx('2026-12-01','Debit','Groceries', expFor(1000))],
      snapshots:[snap('2026-12-30', -500)]
    }));
    expect(byKey(r,'runway').available).toBe(true);
    expect(byKey(r,'runway').score).toBe(0);
  });
});

describe('ahorro', () => {
  it('20% de tasa = 100 pts', () => {
    var r = healthScoreCore(base({ transactions:[
      tx('2026-12-01','Credit','Income',10000), tx('2026-12-02','Debit','Groceries',8000)
    ]}));
    expect(byKey(r,'savings').value).toBeCloseTo(20, 5);
    expect(byKey(r,'savings').score).toBeCloseTo(100, 5);
    expect(byKey(r,'savings').display).toBe('20%');
  });

  it('10% = 50 pts', () => {
    var r = healthScoreCore(base({ transactions:[
      tx('2026-12-01','Credit','Income',10000), tx('2026-12-02','Debit','Groceries',9000)
    ]}));
    expect(byKey(r,'savings').score).toBeCloseTo(50, 5);
  });

  it('gastar mas de lo que entra: 0 pts pero disponible', () => {
    var r = healthScoreCore(base({ transactions:[
      tx('2026-12-01','Credit','Income',1000), tx('2026-12-02','Debit','Groceries',2000)
    ]}));
    expect(byKey(r,'savings').available).toBe(true);
    expect(byKey(r,'savings').score).toBe(0);
  });

  it('sin income no hay tasa: NO disponible (antes esto valia 0 y hundia el score)', () => {
    var r = healthScoreCore(base({ transactions:[tx('2026-12-02','Debit','Groceries',500)] }));
    expect(byKey(r,'savings').available).toBe(false);
  });

  it('un refund reduce el gasto pero no lo vuelve negativo', () => {
    var r = healthScoreCore(base({ transactions:[
      tx('2026-12-01','Credit','Income',1000),
      tx('2026-12-02','Debit','Groceries',100), tx('2026-12-03','Credit','Groceries',300)
    ]}));
    expect(byKey(r,'savings').value).toBeCloseTo(100, 5); // gasto piso 0, no -200
  });
});

describe('presupuesto', () => {
  it('en el limite exacto = 100 pts', () => {
    var r = healthScoreCore(base({
      transactions:[tx('2026-12-01','Debit','Groceries', 600 * MONTHS_IN_WINDOW)]
    }));
    expect(byKey(r,'budget').score).toBe(100);
    expect(byKey(r,'budget').display).toBe('100%');
  });

  it('gastar de menos no da mas de 100 (no se premia dos veces)', () => {
    var r = healthScoreCore(base({ transactions:[tx('2026-12-01','Debit','Groceries', 200)] }));
    expect(byKey(r,'budget').score).toBe(100);
  });

  it('25% de sobregiro = 50 pts, 50% = 0', () => {
    var r1 = healthScoreCore(base({ transactions:[tx('2026-12-01','Debit','Groceries', 600*MONTHS_IN_WINDOW*1.25)] }));
    var r2 = healthScoreCore(base({ transactions:[tx('2026-12-01','Debit','Groceries', 600*MONTHS_IN_WINDOW*1.5)] }));
    expect(byKey(r1,'budget').score).toBeCloseTo(50, 5);
    expect(byKey(r2,'budget').score).toBeCloseTo(0, 5);
  });

  it('sin presupuesto configurado o sin gastos: NO disponible', () => {
    var sinTotal = healthScoreCore(base({ budgetTotal:0, transactions:[tx('2026-12-01','Debit','Groceries',100)] }));
    var sinGasto = healthScoreCore(base({ transactions:[tx('2026-12-01','Credit','Income',100)] }));
    expect(byKey(sinTotal,'budget').available).toBe(false);
    expect(byKey(sinGasto,'budget').available).toBe(false);
  });
});

describe('crecimiento', () => {
  it('10% mensual = 100 pts', () => {
    var r = healthScoreCore(base({ snapshots:[
      snap('2026-10-03', 1000), snap('2026-12-30', nwForMonthly(1000, 10))
    ]}));
    expect(byKey(r,'growth').value).toBeCloseTo(10, 5);
    expect(byKey(r,'growth').score).toBeCloseTo(100, 5);
    expect(byKey(r,'growth').display).toBe('+10.0%/mes');
  });

  it('5% mensual = 50 pts', () => {
    var r = healthScoreCore(base({ snapshots:[
      snap('2026-10-03', 1000), snap('2026-12-30', nwForMonthly(1000, 5))
    ]}));
    expect(byKey(r,'growth').score).toBeCloseTo(50, 5);
  });

  it('un deposito no cuenta como ganancia (se netean flujos externos)', () => {
    var conDeposito = healthScoreCore(base({
      snapshots:[snap('2026-10-03', 1000), snap('2026-12-30', 1500)],
      transactions:[tx('2026-11-01','Credit','Transfer', 500)]   // entro plata de afuera
    }));
    var sinNada = healthScoreCore(base({
      snapshots:[snap('2026-10-03', 1000), snap('2026-12-30', 1000)]
    }));
    expect(byKey(conDeposito,'growth').value).toBeCloseTo(byKey(sinNada,'growth').value, 5);
  });

  it('caida patrimonial puntua 0 pero sigue disponible', () => {
    var r = healthScoreCore(base({ snapshots:[snap('2026-10-03', 1000), snap('2026-12-30', 800)] }));
    expect(byKey(r,'growth').available).toBe(true);
    expect(byKey(r,'growth').score).toBe(0);
  });

  it('sin snapshot al inicio de la ventana: NO disponible', () => {
    var r = healthScoreCore(base({ snapshots:[snap('2026-12-30', 1000)] }));
    expect(byKey(r,'growth').available).toBe(false);
  });
});

describe('renormalizacion de pesos', () => {
  it('los 4 pesos nominales suman 100 y el orden es fijo', () => {
    var r = healthScoreCore(base({}));
    expect(r.metrics.map(function(m){ return m.key; })).toEqual(['runway','savings','budget','growth']);
    expect(r.metrics.reduce(function(s,m){ return s + m.weight; }, 0)).toBe(100);
  });

  it('con una sola metrica disponible, el total ES esa metrica', () => {
    // Solo income ⇒ ahorro disponible; sin gastos mueren colchon y presupuesto;
    // sin snapshots muere crecimiento.
    var r = healthScoreCore(base({ transactions:[tx('2026-12-01','Credit','Income',1000)] }));
    var avail = r.metrics.filter(function(m){ return m.available; });
    expect(avail.map(function(m){ return m.key; })).toEqual(['savings']);
    expect(avail[0].effWeight).toBeCloseTo(100, 5);
    expect(r.total).toBe(Math.round(avail[0].score));
  });

  it('las no disponibles no arrastran el promedio hacia abajo', () => {
    var r = healthScoreCore(base({ transactions:[tx('2026-12-01','Credit','Income',1000)] }));
    expect(r.total).toBe(100);  // 100% de ahorro; no un 25 por dividir entre 4
  });

  it('los effWeight de las disponibles suman 100', () => {
    var r = healthScoreCore(base({
      transactions:[tx('2026-12-01','Credit','Income',10000), tx('2026-12-02','Debit','Groceries',8000)],
      snapshots:[snap('2026-12-30', 5000)]
    }));
    var sum = r.metrics.reduce(function(s,m){ return s + m.effWeight; }, 0);
    expect(sum).toBeCloseTo(100, 5);
  });

  it('sin ningun dato el total es null, NUNCA 0', () => {
    var r = healthScoreCore(base({ budgetTotal:0 }));
    expect(r.total).toBeNull();
    expect(r.total).not.toBe(0);
    expect(r.label).toBe('Sin datos');
    expect(r.metrics.every(function(m){ return !m.available; })).toBe(true);
  });
});

describe('ventana', () => {
  it('from es asOf - 89 dias (90 dias inclusive)', () => {
    var r = healthScoreCore(base({ asOf:'2026-08-15' }));
    expect(r.from).toBe('2026-05-18');
    expect(r.to).toBe('2026-08-15');
  });

  it('incluye los bordes y excluye lo de afuera', () => {
    var dentro = healthScoreCore(base({ transactions:[
      tx('2026-10-03','Credit','Income',500), tx('2026-12-31','Credit','Income',500)
    ]}));
    var fuera = healthScoreCore(base({ transactions:[
      tx('2026-10-02','Credit','Income',500), tx('2027-01-05','Credit','Income',500)
    ]}));
    expect(byKey(dentro,'savings').available).toBe(true);
    expect(byKey(fuera,'savings').available).toBe(false); // nada cae en la ventana
  });
});

describe('net worth', () => {
  it('netWorthAt toma el ultimo snapshot <= fecha e ignora los posteriores', () => {
    var snaps = [snap('2026-01-01', 100), snap('2026-06-01', 200), snap('2027-01-01', 999)];
    expect(netWorthAt(snaps, '2026-12-31')).toBe(200);
    expect(netWorthAt(snaps, '2025-12-31')).toBeNull();
  });

  it('el snapshot gana sobre liveNetWorth (sin esto la serie historica saltaria)', () => {
    var r = healthScoreCore(base({ snapshots:[snap('2026-12-30', 1000)], liveNetWorth: 99999 }));
    expect(r.netWorth).toBe(1000);
  });

  it('liveNetWorth solo se usa si no hay ningun snapshot', () => {
    var r = healthScoreCore(base({ liveNetWorth: 4242 }));
    expect(r.netWorth).toBe(4242);
  });
});
