// E2E del sync contra un backend simulado con el mergeDocs REAL del servidor.
// Corre: npm run test:e2e (requiere Chrome; override con CHROME_BIN).
//
// Cubre la clase de bug mas destructiva del app: un dispositivo que pisa en la
// nube lo que otro escribio (ej: el wipe del Profit Calc de jul-2026). Escenarios:
//   1. Dispositivo A: agrega una tx y edita el Profit Calc → la nube los tiene.
//   2. Reload de A → todo restaurado desde nube/local.
//   3. Dispositivo B virgen (sin localStorage) → ve los datos de A y su boot
//      NO destruye nada en la nube (pull+push de un dispositivo limpio es inocuo).
//   4. B edita un % de budget → queda como override del mes visible, sobrevive
//      reload y llega a la nube.
//   5. B edita el TOTAL del budget → se guarda como override del mes visible
//      (budgetTotalByMonth), sin tocar el default global.
//   6. Tres txs del mismo dia: la lista respeta el orden de alta y NO se reordena
//      al editar una (el bug de ordenar por updatedAt).
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import { mergeDocs } from '../api/sync.js';

const PORT = 4321;
const CDP_PORT = 9377;
const CHROME = process.env.CHROME_BIN || 'google-chrome-stable';
const URL_BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sondea `fn` hasta que devuelva algo truthy o se agote el timeout. A diferencia
// de un sleep fijo, resuelve apenas la condicion real se cumple (tests mas rapidos
// y estables) y al agotarse tira un error diciendo EXACTAMENTE que no se cumplio.
async function waitFor(fn, timeoutMs, stepMs, label) {
  const start = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - start >= timeoutMs) throw new Error(`timeout (${timeoutMs}ms) esperando: ${label || 'condicion sin nombre'}`);
    await sleep(stepMs);
  }
}

// true si el puerto esta LIBRE (nadie escucha en el).
function isPortFree(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(true));
  });
}

let cloudDoc = {};          // "fila" del usuario en el backend simulado
let pullCount = 0;          // se incrementa en cada GET /api/sync respondido: marca que bootAfterAuth hizo su pull
let failures = [];
function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  → ' + (extra ?? '')));
  if (!ok) failures.push(name);
}

// ── infra: vite preview + chrome headless con CDP ───────────────────────────
if (!(await isPortFree(PORT))) {
  console.error(`ERROR: el puerto ${PORT} (vite preview) ya esta ocupado por otro proceso. Liberalo o corre otra instancia del test.`);
  process.exit(1);
}
if (!(await isPortFree(CDP_PORT))) {
  console.error(`ERROR: el puerto ${CDP_PORT} (CDP de Chrome) ya esta ocupado por otro proceso. Liberalo o corre otra instancia del test.`);
  process.exit(1);
}

// detached: true para que cada uno arranque su propio process group. npx
// arranca vite preview como un hijo suyo: matar solo el proceso de npx dejaba
// el server real huerfano ocupando el puerto para la siguiente corrida.
// process.kill(-pid) manda la señal a TODO el grupo (nieto de npx incluido).
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore', detached: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=/tmp/e2e-sync-${Date.now()}`,
  `--remote-debugging-port=${CDP_PORT}`, 'about:blank',
], { stdio: 'ignore', detached: true });
function killGroup(child) { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
process.on('exit', () => { killGroup(preview); killGroup(chrome); });
preview.on('error', (e) => { console.error(`ERROR: no se pudo arrancar vite preview: ${e.message}`); process.exit(1); });
chrome.on('error', (e) => { console.error(`ERROR: no se pudo arrancar Chrome (${CHROME}): ${e.message}. Prueba con CHROME_BIN=/ruta/al/binario`); process.exit(1); });

try {
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).ok,
    15000, 200,
    `CDP de Chrome no respondio en http://127.0.0.1:${CDP_PORT}/json (vite preview o chrome no arrancaron a tiempo)`,
  );
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0; const pending = {};
const send = (method, params) => new Promise((r) => { const i = ++msgId; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; return; }
  if (m.method !== 'Fetch.requestPaused') return;
  const req = m.params.request, rid = m.params.requestId;
  const b64 = (s) => Buffer.from(s).toString('base64');
  const hdr = [
    { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Access-Control-Allow-Headers', value: '*' },
    { name: 'Access-Control-Allow-Methods', value: '*' },
    { name: 'Content-Type', value: 'application/json' },
  ];
  try {
    if (req.url.includes('/api/sync')) {
      if (req.method === 'OPTIONS') await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 204, responseHeaders: hdr, body: '' });
      else if (req.method === 'GET') { pullCount++; await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: hdr, body: b64(JSON.stringify({ data: cloudDoc })) }); }
      else { cloudDoc = mergeDocs(cloudDoc, JSON.parse(req.postData || '{}')); await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: hdr, body: b64(JSON.stringify({ data: cloudDoc })) }); }
    } else if (req.url.includes('/auth/v1/')) {
      await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: hdr, body: b64(JSON.stringify({ access_token: 'fake', refresh_token: 'fake', user: { email: 'e2e@test' } })) });
    } else await send('Fetch.continueRequest', { requestId: rid });
  } catch {}
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/sync*' }, { urlPattern: '*supabase.co/auth/*' }] });

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
// Condicion real de "la app ya arranco": el script principal corrio (openTxForm
// existe, el bundle de vite no deja S como global) Y bootAfterAuth ya hizo su
// pull inicial contra /api/sync (pullCount subio). Reemplaza el sleep(2500) fijo
// que seguia a cada Page.navigate.
const APP_LOADED_EXPR = "typeof window.openTxForm==='function'";
let bootN = 0;
async function boot() {
  const pullsBefore = pullCount;
  await send('Page.navigate', { url: `${URL_BASE}?e2e=${++bootN}#access_token=fake&refresh_token=fake` });
  try {
    await waitFor(
      async () => pullCount > pullsBefore && (await ev(APP_LOADED_EXPR)),
      15000, 150,
      'app arranco tras navigate (bundle cargado + pull inicial a /api/sync)',
    );
  } catch (e) {
    console.warn(`  ! ${e.message}`);
  }
}

// ── escenario 1: dispositivo A escribe ──────────────────────────────────────
console.log('E2E sync — dispositivo A');
await boot();
await ev('openTxForm()'); await sleep(300); // animacion de apertura del form, sin condicion observable
await ev("document.getElementById('tx-desc').value='E2E Grocery';document.getElementById('tx-amount').value='12.5';document.getElementById('tx-cat').value='Groceries';addTxOrUpdate()");
await sleep(300); // animacion de cierre del form
await ev("document.getElementById('pc-sell').value='163.5';document.getElementById('pc-amount').value='1500';document.getElementById('pc-card').value='2.5';calcProfit(true)");
try {
  await waitFor(
    () => (cloudDoc.transactions || []).some((t) => t.desc === 'E2E Grocery') && cloudDoc.profitCalc && cloudDoc.profitCalc.sell === '163.5',
    15000, 150,
    'tx y profitCalc de A llegando a la nube (push con debounce de 1.5s)',
  );
} catch (e) { console.warn(`  ! ${e.message}`); }
check('tx llega a la nube', (cloudDoc.transactions || []).some((t) => t.desc === 'E2E Grocery'));
check('profitCalc llega a la nube', cloudDoc.profitCalc && cloudDoc.profitCalc.sell === '163.5', JSON.stringify(cloudDoc.profitCalc));

// ── escenario 2: reload de A restaura ───────────────────────────────────────
console.log('E2E sync — reload de A');
await boot();
check('tx visible tras reload', await ev("document.body.textContent.includes('E2E Grocery')||JSON.parse(localStorage.getItem('ft13')||'{}').transactions.some(t=>t.desc==='E2E Grocery')"));
check('profit fields restaurados', (await ev("document.getElementById('pc-sell').value")) === '163.5');

// ── escenario 3: dispositivo B virgen no destruye la nube ───────────────────
console.log('E2E sync — dispositivo B virgen');
await ev("localStorage.removeItem('ft13');localStorage.removeItem('ft13_dirty')");
await boot();
check('B ve la tx de A', await ev("JSON.parse(localStorage.getItem('ft13')||'{}').transactions.some(t=>t.desc==='E2E Grocery')"));
check('B restaura profit fields', (await ev("document.getElementById('pc-sell').value")) === '163.5');
try {
  // B no edita nada: solo confirmamos que su boot (pull+push inocuo) no altero la nube.
  await waitFor(
    () => cloudDoc.profitCalc && cloudDoc.profitCalc.sell === '163.5' && (cloudDoc.transactions || []).some((t) => t.desc === 'E2E Grocery'),
    15000, 150,
    'nube estable tras el boot de B (push inocuo de un dispositivo limpio)',
  );
} catch (e) { console.warn(`  ! ${e.message}`); }
check('nube conserva profitCalc tras boot de B', cloudDoc.profitCalc && cloudDoc.profitCalc.sell === '163.5', JSON.stringify(cloudDoc.profitCalc));
check('nube conserva la tx tras boot de B', (cloudDoc.transactions || []).some((t) => t.desc === 'E2E Grocery'));

// ── escenario 4: campo LWW generico (budget %) sobrevive ────────────────────
// El % se guarda como override del mes visible: editarlo planificando un mes no
// puede reescribir los porcentajes de los meses ya cerrados.
console.log('E2E sync — budget % LWW');
const mesBud = await ev("(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})()");
await ev("window.showPage('budget',null)");
await ev("saveCategoryPct('Groceries','25')");
try {
  await waitFor(
    () => cloudDoc.categoryBudgetPctsByMonth && (cloudDoc.categoryBudgetPctsByMonth[mesBud] || {}).Groceries === 25,
    15000, 150,
    'budget pct de Groceries llegando a la nube (push con debounce de 1.5s)',
  );
} catch (e) { console.warn(`  ! ${e.message}`); }
check('budget pct del mes en la nube', cloudDoc.categoryBudgetPctsByMonth && (cloudDoc.categoryBudgetPctsByMonth[mesBud] || {}).Groceries === 25, JSON.stringify(cloudDoc.categoryBudgetPctsByMonth));
check('el % global NO se movio', !(cloudDoc.categoryBudgetPcts || {}).Groceries, JSON.stringify(cloudDoc.categoryBudgetPcts));
await boot();
check('budget pct tras reload', await ev(`JSON.parse(localStorage.getItem('ft13')||'{}').categoryBudgetPctsByMonth['${mesBud}'].Groceries===25`));

// ── escenario 5: el total del budget se guarda POR MES ──────────────────────
// Editarlo desde el hero no puede mover el default global: eso reescribiria el
// "me pase / no me pase" de todos los meses ya cerrados.
console.log('E2E sync — budget total por mes');
const curMonth = await ev("(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})()");
await ev("window.showPage('budget',null)");
await ev("(function(){var i=document.getElementById('bud-total'); if(!i) return 0; i.value='850'; window.saveBudget(); return 1;})()");
try {
  await waitFor(
    () => cloudDoc.budgetTotalByMonth && cloudDoc.budgetTotalByMonth[curMonth] === 850,
    15000, 150,
    'total del mes llegando a la nube (push con debounce de 1.5s)',
  );
} catch (e) { console.warn(`  ! ${e.message}`); }
check('total del mes en la nube', cloudDoc.budgetTotalByMonth && cloudDoc.budgetTotalByMonth[curMonth] === 850, JSON.stringify(cloudDoc.budgetTotalByMonth));
check('el default global NO se movio', cloudDoc.budgetTotal === 600, String(cloudDoc.budgetTotal));
await boot();
check('total del mes tras reload', await ev(`JSON.parse(localStorage.getItem('ft13')||'{}').budgetTotalByMonth['${curMonth}']===850`));

// ── escenario 6: el orden de la lista es por ALTA, no por ultima edicion ────
// Regresion directa: se anotan 3 txs del mismo dia y se edita la primera. Con el
// desempate viejo (updatedAt) esa fila saltaba al tope como si fuera la ultima.
console.log('E2E orden de transacciones');
await ev("localStorage.removeItem('ft13');localStorage.removeItem('ft13_dirty')");
await boot();
const hoy = await ev("(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})()");
for (const desc of ['ORD uno', 'ORD dos', 'ORD tres']) {
  await ev('openTxForm()'); await sleep(250);
  await ev(`document.getElementById('tx-date').value='${hoy}';document.getElementById('tx-desc').value='${desc}';document.getElementById('tx-amount').value='5';document.getElementById('tx-cat').value='Groceries';addTxOrUpdate()`);
  await sleep(250);
}
// La lista es descendente: la ultima anotada arriba.
// Orden visible de las filas ORD, de arriba hacia abajo.
const ORDEN_EXPR = "Array.from(document.querySelectorAll('.tx-row')).map(r=>['uno','dos','tres'].find(w=>r.textContent.includes('ORD '+w))).filter(Boolean)";
const ordenAlta = await ev(ORDEN_EXPR);
check('orden inicial = alta (mas nueva arriba)', JSON.stringify(ordenAlta) === JSON.stringify(['tres', 'dos', 'uno']), JSON.stringify(ordenAlta));

// Editar la MAS VIEJA (equivale a adjuntarle una foto: cambia su updatedAt).
const idUno = await ev("JSON.parse(localStorage.getItem('ft13')||'{}').transactions.find(t=>t.desc==='ORD uno').id");
await ev(`editTx(${idUno})`); await sleep(300);
await ev("document.getElementById('tx-amount').value='7';addTxOrUpdate()");
await sleep(300);
const ordenPostEdit = await ev(ORDEN_EXPR);
check('editar una tx NO la mueve de lugar', JSON.stringify(ordenPostEdit) === JSON.stringify(['tres', 'dos', 'uno']), JSON.stringify(ordenPostEdit));

// Y sobrevive a un reload + pull (el createdAt viaja con la tx en el merge).
await boot();
await ev("window.showPage('transactions',null)");
await waitFor(async () => (await ev(ORDEN_EXPR)).length === 3, 10000, 150, 'las 3 filas ORD renderizadas tras el reload').catch((e) => console.warn(`  ! ${e.message}`));
const ordenPostReload = await ev(ORDEN_EXPR);
check('orden estable tras reload + sync', JSON.stringify(ordenPostReload) === JSON.stringify(['tres', 'dos', 'uno']), JSON.stringify(ordenPostReload));

// ── escenario 5: el dropdown de alertas (mobile) sobrevive al descarte ──────
// Regresion: cada descarte re-renderiza la barra mobile entera (innerHTML), y la
// clase .open vivia en el DOM — el dropdown se cerraba solo y habia que reabrirlo
// para descartar la alerta siguiente.
console.log('E2E alertas mobile');
await ev("localStorage.removeItem('ft13');localStorage.removeItem('ft13_dirty')");
await boot();
// Las alertas descartables salen de recurringLog, y pruneRecurringLog borra las
// entradas cuya tx no existe: por eso las txs se crean por la UI (shape real) y
// recien despues se cuelga el log de sus ids.
for (const desc of ['ALERTA uno', 'ALERTA dos']) {
  await ev('openTxForm()'); await sleep(250);
  await ev(`document.getElementById('tx-date').value='${hoy}';document.getElementById('tx-desc').value='${desc}';document.getElementById('tx-amount').value='5';document.getElementById('tx-cat').value='Groceries';addTxOrUpdate()`);
  await sleep(250);
}
await ev(`(function(){
  var d=JSON.parse(localStorage.getItem('ft13')||'{}');
  var ids=['ALERTA uno','ALERTA dos'].map(function(n){ return d.transactions.find(function(t){ return t.desc===n; }).id; });
  d.recurringLog=ids.map(function(id,i){ return {id:id,label:'ALERTA '+(i?'dos':'uno'),amount:'5',currency:'USD',date:'${hoy}'}; });
  d.recurringLogUpdatedAt=Date.now();
  localStorage.setItem('ft13',JSON.stringify(d));
})()`);
await boot();

const N_ALERTAS = "document.querySelectorAll('#alerts-drop-m .hbm-alert-item').length";
const ABIERTO = "!!document.querySelector('#alerts-drop-m.open')";
await waitFor(async () => (await ev(N_ALERTAS)) === 2, 10000, 150, 'las 2 alertas renderizadas').catch((e) => console.warn(`  ! ${e.message}`));
await ev('toggleAlertsDrop()');
check('el dropdown abre', await ev(ABIERTO));

// Descartar la primera: el bloque se re-renderiza y debe quedar abierto con 1.
await ev("document.querySelector('#alerts-drop-m .hbm-alert-item').click()");
await sleep(200);
check('sigue abierto tras descartar la 1ra', await ev(ABIERTO));
check('queda 1 alerta', (await ev(N_ALERTAS)) === 1, String(await ev(N_ALERTAS)));

// Tap afuera si cierra.
await ev('document.body.click()');
await sleep(100);
check('tap afuera cierra', (await ev(ABIERTO)) === false);

// Descartar la ultima: sin alertas no queda dropdown.
await ev('toggleAlertsDrop()');
await ev("document.querySelector('#alerts-drop-m .hbm-alert-item').click()");
await sleep(200);
check('sin alertas no queda dropdown', (await ev("!document.getElementById('alerts-drop-m')")) === true);

// ── escenario 6: back del sistema en History no cierra la app ───────────────
// Regresion: History es una pagina secundaria (se entra desde un boton en
// Summary, no vive en el bottom-nav) y showPage() nunca apilaba una entrada de
// historial al entrar ahi. El back del sistema (history.back() / gesto en
// mobile) no tenia a donde volver DENTRO de la app y salia de ella entera.
console.log('E2E back en History');
await ev("localStorage.removeItem('ft13');localStorage.removeItem('ft13_dirty')");
await boot();
await ev("window.showPage('summary',null)");
const ACTIVA = "(function(){var p=document.querySelector('.page.active');return p?p.id:null;})()";
check('arranca en Summary', (await ev(ACTIVA)) === 'page-summary', String(await ev(ACTIVA)));

// Delta de history.length, no el valor absoluto: boot() ya corrio varias veces
// antes de este escenario (Page.navigate en CDP tambien apila), asi que el valor
// absoluto no discrimina nada. Lo que SI discrimina el bug es si entrar a History
// suma una entrada nueva (pushState) o pisa la actual (replaceState, el bug viejo:
// history.back() caia a una navegacion anterior de sobra en vez de a Summary).
const lenAntes = await ev('history.length');
await ev("window.showPage('history',null,'snapshots')");
await sleep(100);
check('entra a History', (await ev(ACTIVA)) === 'page-history', String(await ev(ACTIVA)));
check('entrar a History apila una entrada nueva (no pisa la de Summary)', (await ev('history.length')) === lenAntes + 1, `antes=${lenAntes} despues=${await ev('history.length')}`);

await ev('history.back()');
await waitFor(async () => (await ev(ACTIVA)) !== 'page-history', 5000, 100, 'back saca de History').catch((e) => console.warn(`  ! ${e.message}`));
check('back vuelve a Summary (no sale de la app)', (await ev(ACTIVA)) === 'page-summary', String(await ev(ACTIVA)));

// ── escenario 7: la ayuda de categoria dice la verdad ──────────────────────
// El hint se DERIVA de EXPENSE_CATS_DASH / NEUTRAL_CATS / isExtFlow, asi que este
// test es la red que evita que quede mintiendo si alguien mueve una categoria de
// grupo (una lista hardcodeada en el hint no fallaria ningun test).
console.log('E2E hint de categoria');
await boot();
await ev('openTxForm()'); await sleep(300);
const HINT = "(document.getElementById('cat-hint')||{}).textContent||''";
const setCat = async (c) => { await ev(`document.getElementById('tx-cat').value=${JSON.stringify(c)};updateCatHint()`); return await ev(HINT); };

check('sin categoria no hay hint', (await setCat('')) === '');
check('Groceries = Gasto', (await setCat('Groceries')).startsWith('Gasto'), await ev(HINT));
check('Support = Gasto', (await setCat('Support')).startsWith('Gasto'), await ev(HINT));
check('Savings = Neutra', (await setCat('Savings')).startsWith('Neutra'), await ev(HINT));
check('Transfer = Flujo externo', (await setCat('Transfer')).startsWith('Flujo externo'), await ev(HINT));
check('Investments = Flujo externo', (await setCat('Investments')).startsWith('Flujo externo'), await ev(HINT));
check('Income = Income', (await setCat('Income')).startsWith('Income'), await ev(HINT));
// Y que se actualice solo cuando el form se puebla por codigo, no solo al tocarlo.
await ev('closeTxForm()'); await sleep(300);
await ev('openTxForm()'); await sleep(300);
check('al abrir el form vuelve a vacio', (await ev(HINT)) === '');

// ── 10 · deudas: el signo con el que entran al patrimonio ─────────────────
// La propiedad que hace util al modelo: cobrar $150 y pagar $150 con esa misma
// plata deja el patrimonio donde estaba, y en los dos lados el gesto es EL MISMO
// (un Debit). Se maneja por la UI real — el boton y su modal — porque el bundle
// no deja S como global y porque eso es lo que de verdad usa una persona.
console.log('E2E deudas');
// Nube vacia: los escenarios anteriores ya dejaron ahi un schemaVersion al dia, y
// el pull (que corre ANTES de runMigrations) lo traeria de vuelta y saltearia la
// migracion que este escenario quiere probar.
cloudDoc = {};
await ev(`localStorage.setItem('ft13', JSON.stringify(Object.assign(
  JSON.parse(localStorage.getItem('ft13')||'{}'),
  { transactions: [], deletedTxIds: [], schemaVersion: 3, manualWallets: [
      { id: 33, name: 'Emily', trackerOnly: true, balance: 200 },
      { id: 44, name: 'Fam', trackerOnly: true, balance: 80, debt: 'in', cycle: true },
      { id: 11, name: 'Roi', trackerOnly: true, balance: 1700, debt: 'in' },
      { id: 22, name: 'Ana', trackerOnly: true, balance: 300, owed: true } ],
    manualWalletsUpdatedAt: Date.now(), transactionsUpdatedAt: Date.now() })))`);
await boot();
await ev("showPage('wallets')"); await sleep(400);

const heroTotal = async () => Number(
  (await ev("(document.querySelector('.wm-hero-val')||{}).textContent||''")).replace(/[^0-9.-]/g, ''));
const liqSub = async () => await ev(
  "[...document.querySelectorAll('.kpi-card')].filter(c=>c.textContent.includes('Liquid')).map(c=>c.querySelector('.kpi-sub').textContent)[0]||''");

// Ana entra con el owed:true viejo: la migracion v4 tiene que convertirlo.
const anaDebt = await ev("(JSON.parse(localStorage.getItem('ft13')||'{}').manualWallets||[]).filter(function(w){return w.name==='Ana'}).map(function(w){return w.debt+'/'+('owed' in w)})[0]");
check('migra owed:true a debt:out', anaDebt === 'out/false', `Ana=${anaDebt}`);

const nw0 = await heroTotal();
check('la deuda resta del total de wallets', nw0 === 200 + 80 + 1700 - 300, `total=${nw0} (esperado 1680)`);

// Un tracker sin marcar NO es una deuda: sigue en su grupo y con su etiqueta.
const grupos = await ev("[...document.querySelectorAll('#page-wallets .wm-group')].map(function(g){var t=g.querySelector('.wm-group-title');return (t?t.textContent:'')+':'+[...g.querySelectorAll('.wm-row')].map(function(r){return r.querySelector('.wm-name').textContent+'|'+(r.querySelector('.wm-badge')||{}).textContent}).join(',')}).join(' ~ ')");
check('Emily queda como tracker comun', /Trackers:Emily\|tracker/.test(grupos), grupos);
check('las dos direcciones van juntas en Debts', /Debts:Roi\|me deben,Fam\|me deben,Ana\|debo/.test(grupos), grupos);

// El boton de sumar es opt-in por wallet (la casilla "ciclo"), no sale en todas.
const botones = (n) => ev(`[...document.querySelectorAll('#page-wallets .wm-row')].filter(function(r){return r.querySelector('.wm-name').textContent===${JSON.stringify(n)}}).map(function(r){return [...r.querySelectorAll('.wsettle')].map(function(b){return b.textContent}).join('+')})[0]`);
check('la wallet de ciclo ofrece las dos direcciones', (await botones('Fam')) === 'Prestar+Cobrar', await botones('Fam'));
check('una deuda de una sola vez solo ofrece saldar', (await botones('Roi')) === 'Cobrar', await botones('Roi'));
check('una deuda en contra dice Pagar', (await botones('Ana')) === 'Pagar', await botones('Ana'));

// Prestar de nuevo SUBE lo que te deben: es un Credit, la unica tx que no es Debit.
const antesFam = await heroTotal();
await ev('settleTracker(44,1)'); await sleep(350);
await ev("document.getElementById('_ami').value='20';document.getElementById('_amo').click()"); await sleep(400);
check('prestar sube lo que te deben', (await heroTotal()) === antesFam + 20, `antes=${antesFam} despues=${await heroTotal()}`);
const txFam = JSON.parse(await ev("JSON.stringify((JSON.parse(localStorage.getItem('ft13')||'{}').transactions||[]).filter(function(t){return t.wallet==='Fam'}))"));
check('el prestamo se anota como Credit/Savings', txFam.length === 1 && txFam[0].type === 'Credit' && txFam[0].category === 'Savings', JSON.stringify(txFam));

await ev("showPage('summary')"); await sleep(400);
const sub = await liqSub();
check('el KPI Liquid muestra lo que te deben', sub.includes('receivable'), sub);
check('el KPI Liquid muestra lo que debes', sub.includes('owed'), sub);

// Cobrar 150 de Roi y pagar 150 a Ana, por los botones de la fila.
await ev("showPage('wallets')"); await sleep(400);
const base = await heroTotal();
const settle = async (id, monto) => {
  await ev(`settleTracker(${id})`); await sleep(350);
  await ev(`document.getElementById('_ami').value='${monto}';document.getElementById('_amo').click()`);
  await sleep(400);
};
await settle(11, 150);
check('cobrar baja lo que te deben', (await heroTotal()) === base - 150, `total=${await heroTotal()}`);
check('un tracker comun no ofrece Cobrar/Pagar', (await ev("[...document.querySelectorAll('#page-wallets .wm-row')].filter(function(r){return r.querySelector('.wm-name').textContent==='Emily'}).map(function(r){return !!r.querySelector('.wsettle')})[0]")) === false);
await settle(22, 150);
check('pagar con esa plata deja el patrimonio igual', (await heroTotal()) === base, `antes=${base} despues=${await heroTotal()}`);

// Las dos txs salieron iguales: mismo tipo, misma categoria neutra. Se filtran por
// wallet porque el pull inicial trae las txs de los escenarios anteriores.
const txs = JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('ft13')||'{}').transactions||[])"))
  .filter((t) => t.wallet === 'Roi' || t.wallet === 'Ana');
check('escribio una tx por cada lado', txs.length === 2, `txs=${txs.length}`);
check('las dos son Debit (una sola regla que recordar)', txs.every((t) => t.type === 'Debit'), JSON.stringify(txs.map((t) => t.type)));
check('las dos son Savings (no tocan budget ni P&L)', txs.every((t) => t.category === 'Savings'), JSON.stringify(txs.map((t) => t.category)));

// Captura opcional de la pagina de Wallets con una deuda cargada: SHOT=<archivo>.
if (process.env.SHOT) {
  await ev("document.querySelectorAll('[class*=form-panel],[class*=overlay],.action-toast').forEach(function(e){e.style.display='none'});document.documentElement.classList.remove('sheet-open');showPage('wallets')"); await sleep(600);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  (await import('node:fs')).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('  · captura en ' + process.env.SHOT);
}

ws.close();
console.log(failures.length ? `\nFAIL: ${failures.length} chequeo(s) fallaron` : '\nPASS: sync E2E completo');
process.exit(failures.length ? 1 : 0);
