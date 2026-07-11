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
import { spawn, execSync } from 'node:child_process';
import { mergeDocs } from '../api/sync.js';

const PORT = 4321;
const CHROME = process.env.CHROME_BIN || 'google-chrome-stable';
const URL_BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cloudDoc = {};          // "fila" del usuario en el backend simulado
let failures = [];
function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  → ' + (extra ?? '')));
  if (!ok) failures.push(name);
}

// ── infra: vite preview + chrome headless con CDP ───────────────────────────
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=/tmp/e2e-sync-${Date.now()}`,
  '--remote-debugging-port=9377', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => { try { preview.kill(); } catch {} try { chrome.kill(); } catch {} });
await sleep(2500);

const targets = await (await fetch('http://localhost:9377/json')).json();
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
      else if (req.method === 'GET') await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: hdr, body: b64(JSON.stringify({ data: cloudDoc })) });
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
let bootN = 0;
async function boot() { await send('Page.navigate', { url: `${URL_BASE}?e2e=${++bootN}#access_token=fake&refresh_token=fake` }); await sleep(2500); }

// ── escenario 1: dispositivo A escribe ──────────────────────────────────────
console.log('E2E sync — dispositivo A');
await boot();
await ev('openTxForm()'); await sleep(300);
await ev("document.getElementById('tx-desc').value='E2E Grocery';document.getElementById('tx-amount').value='12.5';document.getElementById('tx-cat').value='Groceries';addTxOrUpdate()");
await sleep(300);
await ev("document.getElementById('pc-sell').value='163.5';document.getElementById('pc-amount').value='1500';document.getElementById('pc-card').value='2.5';calcProfit(true)");
await sleep(2500); // debounce del push (1.5s) + red
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
await sleep(2500); // deja que B pushee lo suyo
check('nube conserva profitCalc tras boot de B', cloudDoc.profitCalc && cloudDoc.profitCalc.sell === '163.5', JSON.stringify(cloudDoc.profitCalc));
check('nube conserva la tx tras boot de B', (cloudDoc.transactions || []).some((t) => t.desc === 'E2E Grocery'));

// ── escenario 4: campo LWW generico (budget %) sobrevive ────────────────────
console.log('E2E sync — budget % LWW');
await ev("saveCategoryPct('Groceries','25')");
await sleep(2500);
check('budget pct en la nube', cloudDoc.categoryBudgetPcts && cloudDoc.categoryBudgetPcts.Groceries === 25, JSON.stringify(cloudDoc.categoryBudgetPcts));
await boot();
check('budget pct tras reload', await ev("JSON.parse(localStorage.getItem('ft13')||'{}').categoryBudgetPcts.Groceries===25"));

ws.close();
console.log(failures.length ? `\nFAIL: ${failures.length} chequeo(s) fallaron` : '\nPASS: sync E2E completo');
process.exit(failures.length ? 1 : 0);
