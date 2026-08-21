// E2E del sync contra un backend simulado con el mergeDocs REAL del servidor.
// Corre: npm run test:e2e (requiere Chrome; override con CHROME_BIN).
//
// Cubre la clase de bug mas destructiva del app: un dispositivo que pisa en la
// nube lo que otro escribio (ej: el wipe del Profit Calc de jul-2026). Escenarios:
//   1. Dispositivo A: agrega una tx y edita el Profit Calc → la nube los tiene.
//   2. Reload de A → todo restaurado desde nube/local.
//   3. Dispositivo B virgen (sin localStorage) → ve los datos de A y su boot
//      NO destruye nada en la nube (pull+push de un dispositivo limpio es inocuo).
//   4. B edita un % de budget → sobrevive reload y queda en la nube.
//   5. B edita el TOTAL del budget → se guarda como override del mes visible
//      (budgetTotalByMonth), sin tocar el default global.
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
console.log('E2E sync — budget % LWW');
await ev("saveCategoryPct('Groceries','25')");
try {
  await waitFor(
    () => cloudDoc.categoryBudgetPcts && cloudDoc.categoryBudgetPcts.Groceries === 25,
    15000, 150,
    'budget pct de Groceries llegando a la nube (push con debounce de 1.5s)',
  );
} catch (e) { console.warn(`  ! ${e.message}`); }
check('budget pct en la nube', cloudDoc.categoryBudgetPcts && cloudDoc.categoryBudgetPcts.Groceries === 25, JSON.stringify(cloudDoc.categoryBudgetPcts));
await boot();
check('budget pct tras reload', await ev("JSON.parse(localStorage.getItem('ft13')||'{}').categoryBudgetPcts.Groceries===25"));

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

ws.close();
console.log(failures.length ? `\nFAIL: ${failures.length} chequeo(s) fallaron` : '\nPASS: sync E2E completo');
process.exit(failures.length ? 1 : 0);
