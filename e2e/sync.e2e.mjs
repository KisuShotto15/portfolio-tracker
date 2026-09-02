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

// Chrome levanta su CDP antes que vite preview termine de escuchar. Sin esperar
// al server, el PRIMER Page.navigate caia en chrome-error://chromewebdata y esa
// pestaña no reintenta sola: el escenario 1 fallaba entero y los siguientes
// pasaban (para entonces el server ya estaba arriba).
try {
  await waitFor(
    async () => (await fetch(URL_BASE)).ok,
    20000, 200,
    `vite preview no respondio en ${URL_BASE}`,
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
// Condicion real de "la app ya arranco": bootAfterAuth llego al final (marca
// __bootDone, que se pone DESPUES de las migraciones y del cierre de mes).
// Antes se esperaba a que subiera pullCount, pero ese contador lo incrementa este
// mock al responder el GET — o sea, antes de que la app termine de procesarlo — y
// un chequeo inmediato tras boot() podia leer el DOM anterior. Reemplaza tambien
// el sleep(2500) fijo que seguia a cada Page.navigate.
const APP_LOADED_EXPR = "typeof window.openTxForm==='function' && (window.__bootDone||0)>0";
let bootN = 0;
async function boot() {
  const pullsBefore = pullCount;
  await send('Page.navigate', { url: `${URL_BASE}?e2e=${++bootN}#access_token=fake&refresh_token=fake` });
  try {
    await waitFor(
      async () => pullCount > pullsBefore && (await ev(APP_LOADED_EXPR)),
      15000, 150,
      'app arranco tras navigate (pull inicial + bootAfterAuth completo)',
    );
  } catch (e) {
    // Red-net: si la navegacion murio en chrome-error (server aun no listo), la
    // pestaña se queda ahi para siempre. Un solo reintento la saca.
    if (String(await ev('location.href') || '').startsWith('chrome-error')) {
      await send('Page.navigate', { url: `${URL_BASE}?e2e=${++bootN}#access_token=fake&refresh_token=fake` });
      try { await waitFor(async () => await ev(APP_LOADED_EXPR), 15000, 150, 'app arranco tras reintento de navigate'); return; }
      catch (e2) { console.warn(`  ! ${e2.message}`); return; }
    }
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
const aTx = "document.body.textContent.includes('E2E Grocery')||(JSON.parse(localStorage.getItem('ft13')||'{}').transactions||[]).some(t=>t.desc==='E2E Grocery')";
await waitFor(async () => await ev(aTx), 5000, 100, 'la tx de A tras el reload').catch((e) => console.warn(`  ! ${e.message}`));
check('tx visible tras reload', await ev(aTx));
await waitFor(async () => (await ev("document.getElementById('pc-sell').value")) === '163.5', 5000, 100,
  'los profit fields tras el reload').catch((e) => console.warn(`  ! ${e.message}`));
check('profit fields restaurados', (await ev("document.getElementById('pc-sell').value")) === '163.5');

// ── escenario 3: dispositivo B virgen no destruye la nube ───────────────────
console.log('E2E sync — dispositivo B virgen');
await ev("localStorage.removeItem('ft13');localStorage.removeItem('ft13_dirty')");
await boot();
const bTx = "JSON.parse(localStorage.getItem('ft13')||'{}').transactions||[]";
await waitFor(async () => await ev(`(${bTx}).some(t=>t.desc==='E2E Grocery')`), 5000, 100,
  'B con la tx de A ya persistida').catch((e) => console.warn(`  ! ${e.message}`));
check('B ve la tx de A', await ev(`(${bTx}).some(t=>t.desc==='E2E Grocery')`));
await waitFor(async () => (await ev("document.getElementById('pc-sell').value")) === '163.5', 5000, 100,
  'B con los profit fields ya renderizados').catch((e) => console.warn(`  ! ${e.message}`));
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
      { id: 33, name: 'Mercantil Panama', trackerOnly: true, balance: 200 },
      { id: 44, name: 'Fam', trackerOnly: true, balance: 80, debt: 'in', cycle: true },
      { id: 11, name: 'Roi', trackerOnly: true, balance: 1700, debt: 'in' },
      { id: 22, name: 'Ana', trackerOnly: true, balance: 300, owed: true } ],
    rolloverCats: { Groceries: false }, rolloverCatsUpdatedAt: Date.now(),
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

// v5: el rollover plano valia para todos los meses. Al migrar queda encendido
// solo en el mes en curso, y respetando la excepcion que estaba en false.
const rollMig = JSON.parse(await ev("JSON.stringify(JSON.parse(localStorage.getItem('ft13')||'{}').rolloverCats||{})"));
const mesHoy = new Date().toISOString().slice(0, 7);
check('migra el rollover plano al mes en curso', rollMig[mesHoy] && rollMig[mesHoy].Home === true, JSON.stringify(rollMig));
check('respeta la excepcion vieja', !(rollMig[mesHoy] || {}).Groceries, JSON.stringify(rollMig));
check('y no enciende meses viejos', Object.keys(rollMig).length === 1, JSON.stringify(rollMig));

const nw0 = await heroTotal();
check('la deuda resta del total de wallets', nw0 === 200 + 80 + 1700 - 300, `total=${nw0} (esperado 1680)`);

// Un tracker sin marcar NO es una deuda: sigue en su grupo y con su etiqueta.
const grupos = await ev("[...document.querySelectorAll('#page-wallets .wm-group')].map(function(g){var t=g.querySelector('.wm-group-title');return (t?t.textContent:'')+':'+[...g.querySelectorAll('.wm-row')].map(function(r){return r.querySelector('.wm-name').textContent+'|'+(r.querySelector('.wm-badge')||{}).textContent}).join(',')}).join(' ~ ')");
check('un tracker comun queda en su grupo', /Trackers:Mercantil Panama\|tracker/.test(grupos), grupos);
// Las 4 columnas en una fila: el layout que se rompia antes de sacar .wm-acts
// del flujo. Se fija el ancho porque abajo de 1280 baja a 2 a proposito.
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(350);
const filas = await ev("(function(){var g=[...document.querySelectorAll('#page-wallets .wm-group')];var tops={};g.forEach(function(e){tops[Math.round(e.getBoundingClientRect().top)]=1});return g.length+'/'+Object.keys(tops).length;})()");
check('los 4 grupos entran en una sola fila', filas === '4/1', `grupos/filas = ${filas}`);
const cortado = await ev("[...document.querySelectorAll('#page-wallets .wm-name')].some(function(e){return e.scrollWidth>e.clientWidth+1})");
check('ningun nombre se desborda a 1600px', cortado === false);
await send('Emulation.clearDeviceMetricsOverride', {});
await sleep(250);

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
check('un tracker comun no ofrece Cobrar/Pagar', (await ev("[...document.querySelectorAll('#page-wallets .wm-row')].filter(function(r){return r.querySelector('.wm-name').textContent==='Mercantil Panama'}).map(function(r){return !!r.querySelector('.wsettle')})[0]")) === false);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  (await import('node:fs')).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
  console.log('  · captura en ' + process.env.SHOT);
}

// ── 11 · rollover de categoria ────────────────────────────────────────────
// El sobrante del mes pasado sube el limite de este; el exceso lo baja. Se prueba
// contra la card real, que es donde el numero importa.
console.log('E2E rollover');
cloudDoc = {};
const hoyR = new Date();
const mesActR = `${hoyR.getFullYear()}-${String(hoyR.getMonth() + 1).padStart(2, '0')}`;
const antesR = new Date(hoyR.getFullYear(), hoyR.getMonth() - 1, 15);
const mesAntR = `${antesR.getFullYear()}-${String(antesR.getMonth() + 1).padStart(2, '0')}`;
const dAntR = `${mesAntR}-15`;
const dosAntes = new Date(hoyR.getFullYear(), hoyR.getMonth() - 2, 28);
const dPrevSnapR = `${dosAntes.getFullYear()}-${String(dosAntes.getMonth() + 1).padStart(2, '0')}-28`;
const dCloseSnapR = `${mesAntR}-28`;
await ev(`localStorage.setItem('ft13', JSON.stringify(Object.assign(
  JSON.parse(localStorage.getItem('ft13')||'{}'),
  { manualWallets: [], rolloverCats: {}, rolloverCatsUpdatedAt: Date.now(),
    budgetTotal: 1000, budgetTotalUpdatedAt: Date.now(), budgetTotalByMonth: {},
    categoryBudgetPcts: { Groceries: 10, Transport: 10 }, categoryBudgetPctsUpdatedAt: Date.now(),
    categoryBudgetPctsByMonth: {},
    transactions: [
      { id: 901, createdAt: 901, seq: 0, date: '${dAntR}', desc: 'prev groceries', wallet: '', type: 'Debit', category: 'Groceries', amountUSD: 60, originalCurrency: 'USD', imported: false, updatedAt: 901 },
      { id: 902, createdAt: 902, seq: 1, date: '${dAntR}', desc: 'prev transport', wallet: '', type: 'Debit', category: 'Transport', amountUSD: 130, originalCurrency: 'USD', imported: false, updatedAt: 902 },
      { id: 903, createdAt: 903, seq: 2, date: '${dAntR}', desc: 'sueldo', wallet: '', type: 'Credit', category: 'Income', amountUSD: 500, originalCurrency: 'USD', imported: false, updatedAt: 903 },
      { id: 904, createdAt: 904, seq: 3, date: '${dAntR}', desc: 'a la novia', wallet: '', type: 'Debit', category: 'Transfer', amountUSD: 200, originalCurrency: 'USD', imported: false, updatedAt: 904 } ],
    // Dos snapshots que abrazan el mes cerrado: sin ellos no hay variacion de
    // patrimonio ni conciliacion que mostrar. 1000 -> 1110 = 500 - 190 - 200 + 0.
    snapshots: [
      { date: '${dPrevSnapR}', total: 1000, derivedIncome: 0 },
      { date: '${dCloseSnapR}', total: 1110, derivedIncome: 0 } ],
    snapshotsUpdatedAt: Date.now(),
    transactionsUpdatedAt: Date.now(), deletedTxIds: [] })))`);
await boot();
await ev(`showPage('budget'); window._budMonthSel && window._budMonthSel('${mesActR}')`); await sleep(600);

// limite y nota al pie de una card, por nombre de categoria
const card = async (cat) => await ev(`(function(){var c=[...document.querySelectorAll('.bdg-cat')].filter(function(e){var t=e.querySelector('.bdg-cat-txt');return t&&t.textContent===${JSON.stringify(cat)}})[0];if(!c)return 'sin card';return (c.querySelector('.bdg-cat-sub')||{}).textContent||'';})()`);

// Arranca apagado: el rollover se enciende mes por mes, no viene puesto.
check('sin encender no hay arrastre', (await card('Groceries')).includes('of $100.00'), await card('Groceries'));

// Cabecera de Categories: titulo, % y chips en UNA linea; la regla debajo.
const head = async () => await ev(`(function(){
  var h=document.querySelector('#page-budget .bdg-cat-head'); if(!h) return '{}';
  var r=h.getBoundingClientRect(), a=h.querySelector('.bdg-alloc'), acts=h.querySelector('.bdg-acts');
  var det=a.querySelector('i'), rule=document.querySelector('#page-budget .bdg-alloc-rule');
  var bs=[].slice.call(acts.querySelectorAll('button'));
  return JSON.stringify({h:Math.round(r.height),
    btnLines:new Set(bs.map(function(b){return Math.round(b.getBoundingClientRect().top)})).size,
    nbtn:bs.length,
    actsRight:Math.round(r.right-acts.getBoundingClientRect().right),
    det:getComputedStyle(det).display, ruleW:Math.round(rule.getBoundingClientRect().width),
    txt:(a.innerText||'').trim()});
})()`);
if (process.env.SHOT4) { await ev("var _m=document.getElementById('month-close');_m&&_m.remove();window.scrollTo(0,document.querySelector('#page-budget .bdg-cat-head').offsetTop-150)"); await send('Emulation.setDeviceMetricsOverride',{width:412,height:900,deviceScaleFactor:2,mobile:true}); await sleep(500); const s4=await send('Page.captureScreenshot',{format:'png'}); (await import('node:fs')).writeFileSync(process.env.SHOT4, Buffer.from(s4.result.data,'base64')); await send('Emulation.clearDeviceMetricsOverride'); await sleep(300); }
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 900, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const HM = JSON.parse(await head());
check('mobile: titulo, % y chips en una sola linea', HM.h <= 34, JSON.stringify(HM));
check('mobile: los chips no se apilan', HM.nbtn >= 1 && HM.btnLines === 1, JSON.stringify(HM));
check('mobile: los chips quedan a la derecha', HM.actsRight <= 1, JSON.stringify(HM));
check('mobile: el detalle del % se calla', HM.det === 'none', JSON.stringify(HM));
check('mobile: y queda solo el numero', /^[0-9.]+%$/.test(HM.txt), JSON.stringify(HM));
check('la regla ocupa todo el ancho', HM.ruleW > 300, JSON.stringify(HM));
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const HW = JSON.parse(await head());
check('web: el detalle del % se muestra', HW.det !== 'none', JSON.stringify(HW));
check('web: dice cuanto falta por asignar', /short|over|✓/.test(HW.txt), JSON.stringify(HW));
await send('Emulation.clearDeviceMetricsOverride'); await sleep(400);

await ev("window._budRolloverUI()"); await sleep(300);
await ev(`toggleRolloverAll('${mesActR}')`); await sleep(400);
// Groceries: limite 100, gasto previo 60 -> sobran 40 -> 140
check('Todas enciende de una', (await card('Groceries')).includes('of $140.00'), await card('Groceries'));
check('la card dice de donde sale', /\+\$40.*del mes pasado/.test(await card('Groceries')), await card('Groceries'));
// Transport: limite 100, gasto previo 130 -> exceso 30 -> 70
check('lo que te pasaste baja el limite', (await card('Transport')).includes('of $70.00'), await card('Transport'));
check('el exceso se muestra en negativo', /-\$30.*del mes pasado/.test(await card('Transport')), await card('Transport'));

// El rollover reparte distinto, no crea presupuesto: el total del mes no se mueve.
const heroTot = await ev("(document.querySelector('.bdg-hero-sub')||{}).textContent||''");
check('el total del mes no se mueve', heroTot.includes('$1,000.00'), heroTot);

// El bug que motivo el cambio: encender un mes NO puede encender los anteriores.
const rollLS = async () => await ev("JSON.stringify(JSON.parse(localStorage.getItem('ft13')||'{}').rolloverCats||{})");
check('queda guardado bajo el mes visible', JSON.parse(await rollLS())[mesActR].Groceries === true, await rollLS());
check('el mes anterior sigue apagado', JSON.parse(await rollLS())[mesAntR] === undefined, await rollLS());

await ev(`toggleRolloverCat('Groceries','${mesActR}')`); await sleep(400);
check('apagar una vuelve al limite asignado', (await card('Groceries')).includes('of $100.00'), await card('Groceries'));
check('y no toca a las demas', (await card('Transport')).includes('of $70.00'), await card('Transport'));
check('sobrevive al reload', await (async () => { await boot(); await ev(`showPage('budget')`); await sleep(500); return (await card('Transport')).includes('of $70.00'); })(), await card('Transport'));

await ev("window._budRolloverUI()"); await sleep(300);
await ev(`toggleRolloverAll('${mesActR}')`); await sleep(400);
check('Todas con una apagada las enciende todas', (await card('Groceries')).includes('of $140.00'), await card('Groceries'));
await ev(`toggleRolloverAll('${mesActR}')`); await sleep(400);
check('Ninguna las apaga todas', (await card('Groceries')).includes('of $100.00') && (await card('Transport')).includes('of $100.00'), await card('Transport'));
check('y borra el mes del mapa', JSON.parse(await rollLS())[mesActR] === undefined, await rollLS());

// ── 12 · cierre de mes ────────────────────────────────────────────────────
// El escenario anterior dejo gasto en el mes pasado y ninguno en este, asi que el
// cierre tiene algo real que contar.
console.log('E2E cierre de mes');
check('el cierre se abre solo con el mes ya cambiado', await ev("!!document.getElementById('month-close')"));
const mcTxt = await ev("(document.getElementById('month-close')||{}).textContent||''");
check('titula el mes cerrado', mcTxt.includes('Cierre de'), mcTxt.slice(0, 80));
// Transport: plan 100, gasto 130 -> se paso por 30. Groceries: plan 100, gasto 60.
check('muestra plan vs real por categoria', /Transport/.test(mcTxt) && /\$130\.00/.test(mcTxt) && /Groceries/.test(mcTxt), mcTxt.slice(0, 400));
check('dice el movimiento mas grande', /Movimiento mas grande/.test(mcTxt) && /prev transport/.test(mcTxt), mcTxt.slice(0, 400));
check('suma el gasto del mes', /\$190\.00/.test(mcTxt), mcTxt.slice(0, 400));
check('cuenta los movimientos', /4 movimientos/.test(mcTxt), mcTxt.slice(0, 400));
check('compara contra el mes anterior', /vs /.test(mcTxt), mcTxt.slice(0, 300));

// Conciliacion: 500 de ingreso - 190 de gasto - 200 que salio en Transfer = +110,
// que es exactamente lo que subio el patrimonio. Sin residuo.
check('concilia la variacion del patrimonio', /Como se movio el patrimonio/.test(mcTxt), mcTxt.slice(0, 200));
check('muestra los flujos externos aparte', /Flujos externos/.test(mcTxt) && /-\$200/.test(mcTxt), mcTxt);
check('la variacion cuadra: +\$110', /\+\$110/.test(mcTxt), mcTxt);
check('sin residuo no hay linea de "sin explicar"', !/Sin explicar/.test(mcTxt), mcTxt);
// Ahorro = 500 - 190 = 310, 62% de los ingresos
check('muestra el ahorro del mes', /\+\$310/.test(mcTxt) && /62% de tus ingresos/.test(mcTxt), mcTxt.slice(0, 400));

// El modal tiene que caber ENTERO dentro del overlay, franjas del sistema
// incluidas. En un telefono con viewport-fit=cover la barra de estado y la de
// gestos se comen alto que 100vh/100dvh igual cuentan, y el titulo y el boton
// Listo terminaban debajo del sistema, sin forma de cerrar el modal. Aca se
// simulan esas franjas como padding del overlay.
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 640, deviceScaleFactor: 2, mobile: true });
await sleep(400);
const safeOk = await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 90, bottom: 40 } })
  .then((r) => !r.error, () => false);
if (!safeOk) console.warn('  ! sin Emulation.setSafeAreaInsetsOverride en este Chrome: el chequeo de franjas no prueba nada');
await sleep(300);
const fit = await ev(`(function(){
  var o=document.getElementById('month-close');
  var m=o.querySelector('.mc-modal'), b=o.querySelector('.mc-body');
  var r=m.getBoundingClientRect();
  return JSON.stringify({top:Math.round(r.top),bot:Math.round(r.bottom),vh:innerHeight,
    ok:!!document.getElementById('_mcok'),scroll:b.scrollHeight>b.clientHeight+1});
})()`);
const F = JSON.parse(fit);
check('el modal no se mete bajo la barra de estado', F.top >= 89, fit);
check('ni bajo la barra de gestos', F.bot <= F.vh - 39, fit);
check('el cuerpo scrollea cuando no entra', F.scroll, fit);
if (safeOk) await send('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
await send('Emulation.clearDeviceMetricsOverride'); await sleep(300);

await ev("document.getElementById('_mcok').click()"); await sleep(300);
check('al cerrarlo desaparece', !(await ev("!!document.getElementById('month-close')")));
check('queda marcado como visto', await ev(`JSON.parse(localStorage.getItem('ft13')||'{}').lastCloseSeen==='${mesAntR}'`));
await boot();
check('no vuelve a aparecer en el proximo arranque', !(await ev("!!document.getElementById('month-close')")));
// Pero se puede volver a ver a mano desde Budget.
await ev(`showPage('budget'); showMonthClose('${mesAntR}')`); await sleep(400);
check('se puede reabrir a mano', await ev("!!document.getElementById('month-close')"));

// La linea de "sin explicar" no puede ser decorativa: si el patrimonio se movio
// mas de lo que explican las txs, tiene que aparecer con la diferencia exacta.
// Patrimonio +190 en vez de +110 -> quedan $80 sin explicar.
cloudDoc = {};
await ev(`(function(){var d=JSON.parse(localStorage.getItem('ft13')||'{}');
  d.snapshots[1].total=1190; d.snapshotsUpdatedAt=Date.now(); d.lastCloseSeen=null;
  localStorage.setItem('ft13',JSON.stringify(d));})()`);
await boot();
const mcTxt2 = await ev("(document.getElementById('month-close')||{}).textContent||''");
check('aparece la linea de sin explicar', /Sin explicar/.test(mcTxt2), mcTxt2.slice(0, 300));
check('y dice cuanto falta: $80', /\+\$80/.test(mcTxt2), mcTxt2);

// ── 13 · selector de mes del Dashboard ────────────────────────────────────
// El bug reportado: con la ultima tx en un mes viejo, el Dashboard se quedaba
// trabado ahi y no ofrecia el mes en curso. Pasa cuando alguien no cargo nada
// todavia este mes — o sea, todos los 1ros de mes.
console.log('E2E meses del Dashboard');
cloudDoc = {};
const mesViejo = `${antesR.getFullYear()}-${String(antesR.getMonth() + 1).padStart(2, '0')}`;
await ev(`localStorage.setItem('ft13', JSON.stringify(Object.assign(
  JSON.parse(localStorage.getItem('ft13')||'{}'),
  { snapshots: [], snapshotsUpdatedAt: Date.now(), lastCloseSeen: '${mesViejo}',
    transactions: [ { id: 950, createdAt: 950, seq: 0, date: '${mesViejo}-10',
      desc: 'vieja', wallet: '', type: 'Debit', category: 'Groceries', amountUSD: 20,
      originalCurrency: 'USD', imported: false, updatedAt: 950 } ],
    transactionsUpdatedAt: Date.now(), deletedTxIds: [] })))`);
await boot();
await ev("showPage('summary')"); await sleep(400);
const opts = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('#sum-month option')].map(function(o){return o.value}))"));
check('ofrece el mes en curso aunque no tenga txs', opts.includes(mesActR), `opciones=${JSON.stringify(opts)}`);
check('sigue ofreciendo el mes con txs', opts.includes(mesViejo), `opciones=${JSON.stringify(opts)}`);
check('se puede cambiar de mes', await ev(`(function(){var s=document.getElementById('sum-month');s.value='${mesActR}';s.dispatchEvent(new Event('change'));return s.value==='${mesActR}';})()`));

if (process.env.SHOT2) {
  await ev("document.querySelectorAll('#month-close').forEach(function(e){e.remove()})");
  await ev(`showMonthClose('${mesAntR}')`); await sleep(300);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  const s3 = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(process.env.SHOT2.replace('.png', '-cierre.png'), Buffer.from(s3.result.data, 'base64'));
  await ev("document.getElementById('_mcok').click()"); await sleep(200);
  await ev("window._budRolloverUI()"); await sleep(300);
  await ev("document.querySelectorAll('[class*=form-panel],[class*=overlay],.action-toast').forEach(function(e){e.style.display='none'});showPage('budget')"); await sleep(600);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const s2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  (await import('node:fs')).writeFileSync(process.env.SHOT2, Buffer.from(s2.result.data, 'base64'));
  console.log('  · captura en ' + process.env.SHOT2);
}

// ── 14 · sello de build ─────────────────────────────────────────────────────
// Sin esto no hay forma de saber, mirando el telefono, si un deploy llego: el
// numero de Settings tiene que ser el mismo que el que sello el service worker.
console.log('E2E sello de build');
const swBuild = (((await import('node:fs')).readFileSync('dist/sw.js', 'utf8')).match(/const BUILD = '([^']+)'/) || [])[1];
const uiBuild = (await ev("(document.getElementById('build-id')||{}).textContent||''")).replace('Build ', '');
check('Settings muestra el build', /^[a-z0-9]{6,}$/.test(uiBuild), `ui=${uiBuild}`);
check('y coincide con el del service worker', uiBuild === swBuild, `ui=${uiBuild} sw=${swBuild}`);
check('el boton de forzar existe', await ev("typeof window.forceUpdate==='function'"));

ws.close();
console.log(failures.length ? `\nFAIL: ${failures.length} chequeo(s) fallaron` : '\nPASS: sync E2E completo');
process.exit(failures.length ? 1 : 0);
