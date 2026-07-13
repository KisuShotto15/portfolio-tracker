import './style.css';
import { nextStamp, maxObservedStamp, localFieldWins, vesToUsd, mergeTxArrays, mergeTombstones, pruneRevokedTombstones, tombId, dueMonths } from './sync-core.js';
import { localToday, monthKey, prevMonth, parseAmt, fmtUSD, escHtml } from './format.js';
import { initTools, renderToolToggles, renderToolGears, calcProfit, calcSpread, calcBCVEmily, fitAllCalcVals } from './tools.js';
import { monthCatTotalsCore, catNetSpendCore, monthIncomeCore, isExtFlow, investmentFlowCore, holdingsTotalUsdCore, catBudgetPctCore, trackerTxBalancesCore } from './finance-core.js';
import { initAuth, sbGet, sbConsumeHashSession, sbRefresh, syncFetch, MULTIUSER, showAuthOverlay, hideAuthOverlay } from './auth.js';

// BCV oficial via dolarvzla (rates.dolarvzla.com). Devuelve la ultima tasa BCV
// PUBLICADA (el valor anunciado para el proximo dia habil, no el retraso de dolarapi),
// sin geo-bloqueo, sin auth y con CORS abierto. Shape: {current:{date,usd,eur},...}.
var RATE_URL      = 'https://rates.dolarvzla.com/bcv/current.json';
var BINANCE_PROXY = 'https://portfolio-tracker-psi-hazel.vercel.app/api/binance-balance';
var ANKR_PROXY    = 'https://portfolio-tracker-psi-hazel.vercel.app/api/ankr-balance';
// Preview (.vercel.app): mismo-origen /api/sync → ese deployment (con env de
// Supabase) responde multi-usuario, sin CORS. Produccion (portfolio.kisushotto.com
// via Cloudflare): la URL absoluta del proyecto Vercel, como siempre.
var SYNC_PROXY    = location.hostname.endsWith('.vercel.app')
  ? '/api/sync'
  : 'https://portfolio-tracker-psi-hazel.vercel.app/api/sync';
var BYBIT_PROXY   = 'https://portfolio-tracker-psi-hazel.vercel.app/api/bybit-balance';
var OKX_PROXY     = 'https://portfolio-tracker-psi-hazel.vercel.app/api/okx-balance';
var BLOB_PROXY    = 'https://portfolio-tracker-psi-hazel.vercel.app/api/blob-upload';
var PRICE_PROXY   = 'https://portfolio-tracker-psi-hazel.vercel.app/api/prices';
// Tasa USDT/VES del monitor P2P (mediana top-20 merchants BDV, lo fetchea 24/7).
var USDT_RATE_URL = 'https://kisushotto-site.vercel.app/api/usdt-ves';
// Multi-usuario (Supabase): sesion, OTP y syncFetch viven en ./auth.js.
initAuth({ syncProxy:SYNC_PROXY, onLogin:function(){ return bootAfterAuth(true); } });

// Autofill rules: matched against the first word of the note (case-insensitive)
// type: 'Debit'|'Credit', category, currency: 'VES'|'USD', wallet
var AUTOFILL_RULES = [
  { keywords:['income','salario','cobro','pago','freelance','consulting','dividendo','ganancia','utilidad'],                                                                                                       type:'Credit', category:'Income' },
  { keywords:['patodo','madeira','rio','super','chinos','pan','botellon','viveres','abasto','bodega','mercado','automercado','central','polleria','panaderia','carneceria','charcuteria','verduras','frutas','lacteos','huevos','harina','arroz','pasta','embutidos','licoreria'], type:'Debit', category:'Groceries', currency:'VES' },
  { keywords:['remesa','emily'],                                                                                                                                                                             type:'Credit', wallet:'Emily' },
  { keywords:['corpoelec','inter','movistar','digitel','electricidad','cantv','netuno','simpletv','directv','condominio','alquiler','agua','gas','plomero','electricista','pintura','mantenimiento','ferreteria','homemax','reparacion'], type:'Debit', category:'Home', currency:'VES' },
  { keywords:['enviado','transferencia','familia','apoyo','ayuda','envio','giro'],                                                                                                                                 type:'Debit',  category:'Support' },
  { keywords:['uber','taxi','metro','buseta','gasolina','vamos','yummy','ridery','busvero','mototaxi','encomienda','mudanza','estacionamiento','peaje'],                                                            type:'Debit',  category:'Transport', currency:'USD' },
  { keywords:['farmacia','clinica','doctor','medicina','farmatodo','locatel','farmahorro','laboratorio','examen','consulta','dentista','optometro','lentes','analisis','ecografia','rayos','seguro','bioxcell'],    type:'Debit',  category:'Health',    currency:'VES' },
  { keywords:['netflix','spotify','amazon','apple','google','hbo','disney','paramount','youtube','steam','playstation','xbox','ropa','calzado','salon','peluqueria','barbero','regalo','bar','cine','gym','gimnasio'], type:'Debit', category:'Discretionary' },
  { keywords:['yummy','ridery','almuerzo','cena','desayuno','cafe','restaurante','arepera','pizzeria','hamburgesa','sushi','helado','postre'],                                                                      type:'Debit',  category:'Eating Out' },
  { keywords:['bybit','binance','okx','btc','eth','usdt','crypto','bitcoin','trezor','fondos','acciones','circle','crcl','invertido'],                                                                             type:'Debit',  category:'Investments' },
  { keywords:['ahorro','deployed','reserva','guardado','emergencia'],                                                                                                                                             type:'Debit',  category:'Savings' },
  { keywords:['cashea'],                                                                                                                                                                                           type:'Debit',  category:'Home', currency:'VES', wallet:'Binance' },
];

var SUMMARY_CATS = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support','Investments','Savings'];
var CATS         = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support','Investments','Savings'];
// 'Transfer' (deposito/retiro) NO va en SUMMARY_CATS ni CATS: asi queda fuera de
// income/gasto, donut y budget automaticamente. Mueve el balance del wallet pero
// se netea del P&L como Investments (isExtFlow, ahora en finance-core.js).
var CCOLORS      = {Income:'#34D399',Home:'#818CF8',Groceries:'#34D399',Transport:'#60A5FA',Health:'#A78BFA',Business:'#FBBF24',Discretionary:'#38BDF8','Eating Out':'#FB923C',Support:'#F59E0B',Investments:'#C084FC',Savings:'#6EE7B7',
  // legacy — kept so old transactions still render with a color
  Services:'#818CF8','Help others':'#F59E0B',Emergency:'#F87171',Other:'#6B7280'};

var S = {
  rate:null, rateDate:null, rateFetchedAt:null,
  transactions:[], portfolio:[], manualWallets:[],
  budgetTotal:600, budgetTotalUpdatedAt:null,
  binanceKey:'', binanceSecret:'',
  binanceBalance:null, binanceUpdated:null, binanceFetchedAt:null,
  bibiBinanceBalance:null, bibiBinanceUpdated:null, bibiBinanceFetchedAt:null,
  bibiBinanceKey:null, bibiBinanceSecret:null,
  bybitBalance:null,   bybitUpdated:null,
  okxBalance:null,     okxUpdated:null,
  trezorBalance:null,  trezorUpdated:null,
  trezorAddress:'', trezorAddressUpdatedAt:null,
  exchangeWallets:[], exchangeWalletsUpdatedAt:null, // wallets de exchange por usuario
  exchangeMigrated:null, // marca que ya se migro Bibi/Trezor a exchangeWallets
  walletHoldings:[],   walletHoldingsUpdated:null,
  onchainWallets:[],   onchainWalletsUpdatedAt:null,
  // Holdings manuales de cripto: pones la cantidad y el precio se trae de CoinGecko.
  // NO cuentan para el net worth ni el P&L; solo alimentan la linea "+Holdings".
  manualHoldings:[],   manualHoldingsUpdatedAt:null,
  coinPrices:{},       coinPricesUpdatedAt:null, coinPricesFetchedAt:null,
  snapshots:[],
  manualWalletsUpdatedAt:null, portfolioUpdatedAt:null, snapshotsUpdatedAt:null,
  deletedTxIds:[],
  transactionsUpdatedAt:null,
  dashGoal:0, dashGoalUpdatedAt:null,
  categoryBudgets:{}, categoryBudgetsUpdatedAt:null, // legacy USD (migrado a pcts)
  // Ultimos valores escritos del Profit Calculator (sell/amount/fee; buy se
  // autollena con la tasa). Sync LWW normal via UpdatedAt.
  profitCalc:{}, profitCalcUpdatedAt:null,
  p2pCalc:{}, p2pCalcUpdatedAt:null,     // P2P Spread: sell/buy/fee
  bcvCalc:{}, bcvCalcUpdatedAt:null,     // BCV->Emily: usd/usdt
  // Limites por categoria como % del Monthly Total (fuente de verdad). El USD se
  // deriva: pct/100 * budgetTotal, asi cambiar el total rescala todo.
  categoryBudgetPcts:{}, categoryBudgetPctsUpdatedAt:null,
  // Overrides por mes: {'2026-07':{Groceries:30,...}}. Un mes sin override hereda
  // el default; asi un mes con mas Discretionary/Health se ajusta puntualmente.
  categoryBudgetPctsByMonth:{}, categoryBudgetPctsByMonthUpdatedAt:null,
  rateUpdatedAt:null,
  presets:[], presetsUpdatedAt:null, // legacy (plantillas eliminadas; docs viejos lo traen)
  notePins:[], notePinsUpdatedAt:null, // notas fijadas con estrella: siempre primero en sugerencias
  bdvLimits:[], bdvLimitsUpdatedAt:null,
  recurring:[], recurringUpdatedAt:null,
  recurringLog:[], recurringLogUpdatedAt:null,
  toolFees:{bpay:4.1, wally:3.745, zinli:3.75, emily:10}, toolFeesUpdatedAt:null
};
var mChart=null, cChart=null, eChart=null, undoStack=[], redoStack=[];

// Lazy-load Chart.js (205KB) only when a chart actually needs to render.
var _chartPromise=null;
function ensureChart(){
  if(window.Chart) return Promise.resolve();
  if(!_chartPromise){
    _chartPromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');
      s.src='/chart.umd.js?v=4.4.1';
      s.onload=function(){ resolve(); };
      s.onerror=function(){ _chartPromise=null; reject(new Error('Chart.js load failed')); };
      document.head.appendChild(s);
    });
  }
  return _chartPromise;
}
var _mChartSig=null, _eChartSig=null;           // chart data signatures → skip recreate when unchanged
var _healthSig=null, _healthMSig=null, _goalSig=null, _walletsSig=null, _kpiSig=null; // rendered-HTML signatures → skip re-render (avoids re-animating/flicker on tab return)
var _txLimit=60, _txBase=60, _txFilterSig=''; // tx list pagination state
var _txData=null, _txDayTotals=null; // cache del ultimo filtrado para append incremental
var _budMonth=null, _budLimitsOpen=false, _budSig=null;
var GROUP_ESSENTIAL=['Home','Groceries','Transport','Health'];
var GROUP_BUSINESS=['Business'];
var GROUP_LIFESTYLE=['Discretionary','Eating Out','Support'];
var GROUP_FINANCIAL=['Investments','Savings'];
var syncTimer=null, _srchTimer=null, syncFailed=false, _whCollapsed={}, _rateTimer=null;
var _dirty=false, _saveSeq=0, _pullTimer=null, _pullInFlight=false, _ts=0, _pullChanged=false;

// Monotonic logical clock for last-writer-wins. Using a plain Date.now() lets a
// device with a skewed clock silently lose its newer edit; stamp() only ever moves
// forward relative to everything this device has observed (local + cloud), so edit
// ordering is preserved regardless of wall-clock drift.
function stamp(){ _ts=nextStamp(_ts, Date.now()); return _ts; }
// Convencion: cualquier campo con un hermano "<campo>UpdatedAt" participa del
// last-writer-wins automaticamente, sin lista hardcodeada que pueda desincronizarse
// del server (api/sync.js usa la misma convencion). Para agregar un campo nuevo al
// sync basta declararlo en los defaults de S con su sibling UpdatedAt.
function tsFields(){ return Object.keys(S).filter(function(k){ return /UpdatedAt$/.test(k); }); }
// [dataField, timestampField] pares para LWW en pull (transactions va aparte via per-tx merge).
function lwwPairs(){ return tsFields().filter(function(k){ return k!=='transactionsUpdatedAt'; }).map(function(ts){ return [ts.slice(0,-9), ts]; }); }
// Firma barata del estado para detectar si un pull cambio algo (reemplaza el
// doble JSON.stringify(S) de cada 25s). Todo cambio sincronizado viene con un
// timestamp (*UpdatedAt/*Updated/*FetchedAt) — invariante del sync — y las tx
// se cubren con length + suma de updatedAt (un merge por-tx puede no mover
// transactionsUpdatedAt).
function stateSig(){
  var a=S.transactions||[], sum=0;
  for(var i=0;i<a.length;i++) sum+=(a[i].updatedAt||0);
  var sig='t'+a.length+':'+sum;
  for(var k in S){ if(/(?:UpdatedAt|Updated|FetchedAt)$/.test(k)) sig+=';'+k+'='+S[k]; }
  return sig;
}
function seedClock(o){
  if(!o) return;
  var m=maxObservedStamp(o,tsFields()); if(m>_ts) _ts=m;
}

function setSyncStatus(state, msg){
  var dot=document.getElementById('sync-dot');
  var lbl=document.getElementById('sync-label');
  var colors={synced:'#5DCAA5', syncing:'#EF9F27', offline:'#888', error:'#E24B4A'};
  if(dot){ dot.style.background=colors[state]||'#888'; dot.classList.toggle('is-syncing',state==='syncing'); }
  if(lbl) lbl.textContent=msg||state;
  var sw=document.querySelector('.sb-sync'); if(sw) sw.title=msg||state;
}

var TOMBSTONE_TTL=90*24*60*60*1000; // 90d: by then every device has applied the deletion
// Drop tombstones older than the TTL so the sync payload doesn't grow without
// bound. Nuevos: por fecha de borrado (ts). Legacy: por fecha de creacion (id).
function pruneTombstones(){
  if(!Array.isArray(S.deletedTxIds)||!S.deletedTxIds.length) return;
  var cut=Date.now()-TOMBSTONE_TTL;
  S.deletedTxIds=S.deletedTxIds.filter(function(e){ var t=(e&&typeof e==='object')?e.ts:e; return (parseInt(t,10)||0)>cut; });
}
// Persistencia diferida: serializar S completo a localStorage en cada edicion
// competia con las animaciones. La escritura corre en idle; flush al ocultar la
// pagina (asi es como muere una PWA en movil). El push a la nube lee S en
// memoria, no localStorage — el sync no depende de esto.
var _slHandle=null,_slIdle=false,_slDisabled=false;
function _saveLocalNow(){ pruneTombstones(); try{ localStorage.setItem('ft13',JSON.stringify(S)); }catch(e){} }
function saveLocal(){
  if(_slDisabled||_slHandle!=null) return;
  var run=function(){ _slHandle=null; _saveLocalNow(); };
  if(typeof requestIdleCallback==='function'){ _slIdle=true; _slHandle=requestIdleCallback(run,{timeout:800}); }
  else { _slIdle=false; _slHandle=setTimeout(run,150); }
}
function flushSaveLocal(){
  if(_slHandle==null) return;
  if(_slIdle){ try{ cancelIdleCallback(_slHandle); }catch(e){} } else clearTimeout(_slHandle);
  _slHandle=null;
  if(!_slDisabled) _saveLocalNow();
}
window.addEventListener('pagehide',flushSaveLocal);
document.addEventListener('visibilitychange',function(){ if(document.hidden) flushSaveLocal(); });
function loadLocal(){ try{ var s=localStorage.getItem('ft13'); if(s) S=Object.assign({},S,JSON.parse(s)); }catch(e){} seedClock(S); }

// mergeTxArrays / dueMonths / vesToUsd / localFieldWins / maxObservedStamp / nextStamp
// live in ./sync-core.js (pure, unit-tested).

async function pushToCloud(){
  var _pushSeq=_saveSeq;
  try{
    setSyncStatus('syncing','Syncing...');
    // The server performs the authoritative read-merge-write and returns the
    // merged document. This makes a stale device structurally unable to clobber
    // fresher edits made elsewhere, regardless of this device's network state.
    var r=await syncFetch({'Content-Type':'application/json'},{
      method:'POST',
      body:JSON.stringify(S)
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var res=await r.json().catch(function(){ return null; });
    // Adopt the server's merged doc ONLY if no edit landed while the push was in
    // flight. Otherwise this stale response would clobber the newer local edit
    // (e.g. typing 1->2->3 fast, or deleting a wallet, reverts on slow networks).
    if(res&&res.data&&_saveSeq===_pushSeq){
      var before=JSON.stringify(S);
      S=Object.assign({},S,res.data);
      if(JSON.stringify(S)!==before){
        saveLocal(); renderTx(); renderSummary(); renderWallets(); populateWalletSelects(); renderBdvLimits();
      }
    }
    syncFailed=false; _pushFailCount=0; showSyncBanner(false);
    if(_saveSeq===_pushSeq){ _dirty=false; try{ localStorage.removeItem('ft13_dirty'); }catch(e){} } // no edit landed during the push
    if(typeof _retryTimer!=='undefined') clearTimeout(_retryTimer);
    setSyncStatus('synced','Synced');
    var cs=document.getElementById('cloud-status');
    if(cs) cs.textContent='Last synced: '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  }catch(e){
    syncFailed=true; _pushFailCount++;
    if(e.message==='HTTP 401'){ if(MULTIUSER){ setSyncStatus('error','Sesion expirada'); showAuthOverlay(); } else setSyncStatus('error','Secret invalido'); console.warn('push failed:',e.message); return; } // reintentar con el mismo secret/token no sirve
    setSyncStatus('offline','⚠ Unsynced changes');
    if(_pushFailCount>=2&&navigator.onLine) showSyncBanner(true); // offline real ya tiene su propio aviso
    console.warn('push failed:',e.message);
    scheduleRetry();
  }
}

async function pullFromCloud(quiet){
  try{
    if(!quiet) setSyncStatus('syncing','Loading...');
    var r=await syncFetch(null,{});
    if(!r.ok) throw new Error('HTTP '+r.status);
    var res=await r.json();
    if(res.data){
      var cloud=res.data;
      seedClock(cloud); // advance our logical clock past anything the cloud has seen
      var before=stateSig(); // detectar si el merge realmente cambia algo → evita re-render inutil cada 25s
      // Transactions: per-tx last-writer-wins merge
      if(cloud.transactions){
        var tombs=mergeTombstones(S.deletedTxIds,cloud.deletedTxIds);
        S.transactions=mergeTxArrays(S.transactions,cloud.transactions,tombs);
        S.deletedTxIds=pruneRevokedTombstones(tombs,S.transactions);
        S.transactionsUpdatedAt=Math.max(S.transactionsUpdatedAt||0,cloud.transactionsUpdatedAt||0)||null;
      }
      // Replace all other fields normally
      var rest=Object.assign({},cloud);
      delete rest.transactions;
      delete rest.deletedTxIds;
      // For every timestamped field, keep local when it is strictly newer than
      // cloud — never clobber an edit this device made but hasn't pushed yet.
      lwwPairs().forEach(function(p){
        if(localFieldWins(cloud[p[1]], S[p[1]])){ delete rest[p[0]]; delete rest[p[1]]; }
      });
      S=Object.assign({},S,rest);
      _pullChanged=(stateSig()!==before);
      if(_pullChanged) saveLocal();
      if(!quiet) setSyncStatus('synced','Synced');
      return true;
    }
    if(!quiet) setSyncStatus('synced','Synced (no cloud data yet)');
    return false;
  }catch(e){
    if(e.message==='HTTP 401'){ if(MULTIUSER){ setSyncStatus('error','Sesion expirada'); showAuthOverlay(); } else setSyncStatus('error','Secret invalido'); }
    else setSyncStatus('offline','Offline (local only)');
    console.warn('pull failed:',e.message);
    return false;
  }
}

// Vuelca S.profitCalc a los inputs del Profit Calculator. No pisa el campo que
// el usuario esta editando (activeElement), igual que el autofill de pc-buy.
function restoreProfitCalc(){
  var sets=[
    [S.profitCalc||{}, [['pc-sell','sell'],['pc-amount','amount'],['pc-card','fee']], true],
    [S.p2pCalc||{},    [['p2p-sell','sell'],['p2p-buy','buy'],['p2p-comm','fee']],    false],
    [S.bcvCalc||{},    [['be-usd','usd'],['be-usdt','usdt']],                          false],
  ];
  sets.forEach(function(cfg){
    var st=cfg[0], clearMissing=cfg[2];
    cfg[1].forEach(function(p){
      var el=document.getElementById(p[0]); if(!el||el===document.activeElement) return;
      // clearMissing=false: sin valor guardado se respeta el default del HTML
      // (ej: p2p-comm arranca en 3.6), no se borra.
      if(st[p[1]]==null&&!clearMissing) return;
      var v=st[p[1]]!=null?String(st[p[1]]):'';
      if(el.value!==v) el.value=v;
    });
  });
}

// Re-render the surfaces that a fresh cloud pull can change.
function _activePageId(){
  var p=document.querySelector('.page.active'); return p?p.id.replace(/^page-/,''):'';
}
// Re-render solo la tab activa tras un pull. showPage ya re-renderiza al entrar
// a cualquier tab, asi que reconstruir las inactivas es trabajo DOM/charts para
// nada. updateRateUI y populateWalletSelects son globales (barra de rate + selects
// del form) y baratos, asi que se corren siempre.
function afterPull(){
  populateWalletSelects(); updateRateUI();
  switch(_activePageId()){
    case 'transactions': renderTx(); break;
    case 'summary': renderSummary(); break;
    case 'budget': renderBudget(); break;
    case 'wallets': renderWallets(); break;
    case 'holdings': renderOnchainWallets(); renderWalletHoldings(); break;
    case 'tools': renderBdvLimits(); restoreProfitCalc(); calcProfit(); calcSpread(); calcBCVEmily(); break;
    case 'history': renderHistory(window._historyView||'snapshots'); break;
  }
}

// Background pull so an open, focused tab reflects edits from other devices
// without needing a reload or tab switch. Skipped while there are unsynced
// local edits (would clobber them) or while offline/in-flight.
async function autoPull(){
  if(_pullInFlight||_dirty||syncFailed||document.hidden||!navigator.onLine) return;
  _pullInFlight=true;
  try{ await pullFromCloud(true); if(_pullChanged) afterPull(); } // solo re-render si la nube trajo algo nuevo
  finally{ _pullInFlight=false; }
}

window.addEventListener('online', function(){
  setSyncStatus('syncing','Reconnecting...');
  syncFailed=false;
  pullFromCloud().then(function(){ pushToCloud(); });
});
window.addEventListener('offline', function(){
  setSyncStatus('offline','Offline');
});

var _retryTimer=null, _pushFailCount=0;
// Banner visible cuando el sync falla repetido (el dot del sidebar es facil de no ver).
function showSyncBanner(show){
  var b=document.getElementById('sync-banner');
  if(!b&&show){
    b=document.createElement('div'); b.id='sync-banner'; b.className='sync-banner';
    b.innerHTML='<span>⚠ No se pudo sincronizar. Tus cambios estan guardados solo en este dispositivo.</span><button onclick="window.retrySyncNow()">Reintentar</button>';
    document.body.appendChild(b);
  }
  if(b) b.classList.toggle('show', !!show);
}
window.retrySyncNow=function(){ _pushFailCount=0; showSyncBanner(false); setSyncStatus('syncing','Syncing...'); pushToCloud(); };
function scheduleRetry(){
  clearTimeout(_retryTimer);
  // backoff exponencial: 15s, 30s, 60s, 120s (tope)
  var delay=Math.min(15000*Math.pow(2,Math.max(0,_pushFailCount-1)), 120000);
  _retryTimer=setTimeout(function(){ if(syncFailed) pushToCloud(); }, delay);
}

function save(){
  _saveSeq++; _dirty=true;
  try{ localStorage.setItem('ft13_dirty','1'); }catch(e){} // marca que hay cambios sin pushear (sobrevive reload)
  saveLocal();
  clearTimeout(syncTimer);
  syncTimer=setTimeout(pushToCloud, 1500);
}

async function forcePull(){
  var cs=document.getElementById('cloud-status');
  if(cs) cs.textContent='Pulling...';
  var ok=await pullFromCloud();
  if(ok){
    afterPull();
    if(cs) cs.textContent='Pulled from cloud at '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  } else {
    if(cs) cs.textContent='No cloud data found.';
  }
}
async function forcePush(){
  var cs=document.getElementById('cloud-status');
  if(cs) cs.textContent='Pushing...';
  await pushToCloud();
}

// structuredClone captura el snapshot mas rapido que stringify+parse (sigue siendo
// sincrono: debe copiar ANTES de la mutacion). Cada entrada del stack se usa una vez.
var _cloneTxs=(typeof structuredClone==='function')?structuredClone:function(a){ return JSON.parse(JSON.stringify(a)); };
function snapshot(){ undoStack.push(_cloneTxs(S.transactions)); if(undoStack.length>50) undoStack.shift(); redoStack=[]; updateUndoBtns(); }
// Marca con updatedAt fresco solo las tx que el undo/redo realmente cambio, para que
// gane el merge last-writer-wins contra la nube (si no, la nube revierte el undo).
function _bumpChangedUpdatedAt(prevTxs,newTxs){
  var now=stamp(), prevById={};
  prevTxs.forEach(function(t){ prevById[t.id]=t; });
  newTxs.forEach(function(t){
    var p=prevById[t.id];
    if(!p||JSON.stringify(p)!==JSON.stringify(t)) t.updatedAt=now;
  });
}
// Cualquier tx que vuelve a existir tras un undo/redo NO debe seguir tombstoneada,
// si no el merge (cliente/servidor) la filtra y el undo de un borrado se revierte solo.
function _untombstoneExisting(){ if(!S.deletedTxIds||!S.deletedTxIds.length) return; S.deletedTxIds=pruneRevokedTombstones(S.deletedTxIds,S.transactions); }
// Toda tx que desaparecio en un undo/redo necesita tombstone fresco (ej. redo de un
// borrado); sin el, la nube la trae de vuelta en el proximo pull.
function _tombstoneMissing(prevTxs,newTxs){
  var ids={}; newTxs.forEach(function(t){ ids[t.id]=1; });
  if(!S.deletedTxIds) S.deletedTxIds=[];
  prevTxs.forEach(function(t){ if(!ids[t.id]) S.deletedTxIds.push({id:t.id,ts:stamp()}); });
}
function doUndo(){ if(!undoStack.length) return; var prev=S.transactions; redoStack.push(_cloneTxs(S.transactions)); S.transactions=undoStack.pop(); _bumpChangedUpdatedAt(prev,S.transactions); _tombstoneMissing(prev,S.transactions); _untombstoneExisting(); S.transactionsUpdatedAt=stamp(); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function doRedo(){ if(!redoStack.length) return; var prev=S.transactions; undoStack.push(_cloneTxs(S.transactions)); S.transactions=redoStack.pop(); _bumpChangedUpdatedAt(prev,S.transactions); _tombstoneMissing(prev,S.transactions); _untombstoneExisting(); S.transactionsUpdatedAt=stamp(); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function updateUndoBtns(){ var u=document.getElementById('btn-undo'),r=document.getElementById('btn-redo'); if(u) u.disabled=!undoStack.length; if(r) r.disabled=!redoStack.length; }
function clearAllTx(){ if(!confirm('Delete ALL transactions? Can be undone with Undo.')) return; snapshot(); if(!S.deletedTxIds) S.deletedTxIds=[]; var _dt=stamp(); S.transactions.forEach(function(t){ S.deletedTxIds.push({id:t.id,ts:_dt}); }); S.transactions=[]; S.transactionsUpdatedAt=stamp(); save(); renderTx(); renderSummary(); }

function isTracker(name,tx){ if(!name) return false; if(tx&&tx.imported) return false; var w=S.manualWallets.find(function(x){ return x.name===name; }); return w?w.trackerOnly===true:false; }
function inSummary(t){ return SUMMARY_CATS.indexOf(t.category)>=0; }

async function fetchRate(force){
  var stale=S.rateFetchedAt&&(Date.now()-S.rateFetchedAt>60*60*1000);
  if(!force&&S.rate&&S.rateDate&&!stale){ updateRateUI(); return; }
  document.getElementById('rate-display').textContent='...';
  try{ var r=await fetch(RATE_URL); var d=await r.json(); var v=parseFloat(d.current&&d.current.usd); if(v>10){ S.rate=parseFloat(v.toFixed(2)); S.rateDate='BCV'+(d.current.date?' ('+d.current.date+')':''); S.rateFetchedAt=Date.now(); S.rateUpdatedAt=stamp(); save(); updateRateUI(); return; } }catch(e){ console.warn('rate:',e.message); }
  if(!S.rate) showManualRate(); else updateRateUI();
}
// El BCV publica ~1 vez al dia, dias habiles por la tarde (hora Venezuela).
// Refresco adaptativo: chequea seguido SOLO en esa ventana (agarra el ajuste, y
// un raro segundo ajuste el mismo dia, pronto); el resto del tiempo espacia mucho
// para gastar menos requests. Venezuela = UTC-4 fijo (sin DST), calculado desde UTC
// para no depender de la zona horaria del dispositivo (el usuario puede estar fuera).
function rateRefreshDelay(){
  var vet=new Date(Date.now()-4*3600*1000);
  var d=vet.getUTCDay(), h=vet.getUTCHours();
  var hot=(d>=1&&d<=5)&&h>=14&&h<20; // L-V, 2pm-8pm VET (ventana de publicacion)
  return hot?30*60*1000:6*60*60*1000; // 30 min en ventana, 6 h fuera
}
function scheduleRateRefresh(){
  clearTimeout(_rateTimer);
  _rateTimer=setTimeout(function(){ fetchRate(true).finally(scheduleRateRefresh); }, rateRefreshDelay());
}
function showManualRate(){
  var bar=document.querySelector('.rbar'); if(bar.querySelector('#mr')) return;
  var inp=document.createElement('input'); inp.id='mr'; inp.type='number'; inp.placeholder='Manual rate'; inp.step='0.01';
  inp.style='padding:5px 8px;border:0.5px solid var(--color-border-secondary);border-radius:6px;background:#1e1e1e;color:#fff;font-size:13px;width:120px';
  var b=document.createElement('button'); b.className='btn btns'; b.textContent='OK';
  b.onclick=function(){ var v=parseFloat(inp.value); if(v>0){ S.rate=v; S.rateDate='manual'; S.rateUpdatedAt=stamp(); save(); updateRateUI(); inp.remove(); b.remove(); } };
  bar.appendChild(inp); bar.appendChild(b);
}
function updateRateUI(){
  if(!S.rate) return;
  var v=S.rate.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('rate-display').textContent=v+' Bs/USD';
  var iv=Math.ceil(S.rate*1.005*100)/100; // Intervencion = BCV +0.5%, redondeado hacia arriba
  var ivs=iv.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
  var ie=document.getElementById('rate-interv'); if(ie) ie.textContent=ivs+' Bs/USD';
  var m=document.getElementById('rate-display-m'); if(m) m.textContent=v;
  var iem=document.getElementById('rate-interv-m'); if(iem) iem.textContent=ivs;
  // Profit Calc: el campo Buy sigue a la tasa Intervencion automaticamente
  // (no pisar mientras el usuario lo esta editando).
  var pb=document.getElementById('pc-buy');
  if(pb&&pb!==document.activeElement&&parseFloat(pb.value)!==iv){ pb.value=iv; calcProfit(); }
}

// ── Tasa USDT/VES (monitor P2P) ─────────────────────────────────────────────
// Solo display en el header de Transactions, junto a BCV/Intervencion. No se usa
// (aun) para convertir txs. Cache en memoria; refetch cada 5 min.
var _usdtRate=null,_usdtAt=0,_usdtShown=null,_usdtFlashT=null;
function renderUsdtRate(){
  var txt='-',title='';
  if(_usdtRate){
    txt=_usdtRate.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
    var age=Math.round((Date.now()-_usdtAt)/60000);
    title='Mediana top-10 merchants BDV · hace '+age+' min';
    if(age>30) txt+=' ⚠'; // dato viejo: el monitor no esta refrescando
  }
  // Pulso al cambiar: flecha + color 1.6s para que el movimiento de la tasa se note.
  var dir=(_usdtShown!=null&&_usdtRate!=null&&_usdtRate!==_usdtShown)?(_usdtRate>_usdtShown?'up':'down'):null;
  if(_usdtRate!=null) _usdtShown=_usdtRate;
  var els=[document.getElementById('rate-usdt'),document.getElementById('rate-usdt-m')];
  els.forEach(function(el,i){
    if(!el) return;
    el.textContent=(txt==='-')?'-':(i===0?txt+' Bs/USDT':txt)+(dir?(dir==='up'?' ↑':' ↓'):'');
    el.title=title;
    el.classList.remove('rate-up','rate-down');
    if(dir) el.classList.add('rate-'+dir);
  });
  if(dir){
    clearTimeout(_usdtFlashT);
    _usdtFlashT=setTimeout(function(){
      els.forEach(function(el,i){ if(!el) return; el.classList.remove('rate-up','rate-down'); el.textContent=(txt==='-')?'-':(i===0?txt+' Bs/USDT':txt); });
    },1600);
  }
}
async function fetchUsdtRate(){
  try{
    var r=await fetch(USDT_RATE_URL);
    if(!r.ok) return;
    var j=await r.json();
    if(j&&j.rate>0){
      _usdtRate=j.rate; _usdtAt=Date.parse(j.updatedAt)||Date.now();
      try{ localStorage.setItem('ft13_usdt',JSON.stringify({rate:_usdtRate,at:_usdtAt})); }catch(e){}
      renderUsdtRate();
      // Los wallets VES se valoran con esta tasa: refrescar si la pagina esta visible.
      if(_activePageId()==='wallets') renderWallets();
    }
  }catch(e){}
}
// Cache por-dispositivo: las recurrentes corren al boot antes de que el fetch resuelva.
try{ var _uc=JSON.parse(localStorage.getItem('ft13_usdt')||'null'); if(_uc&&_uc.rate>0){ _usdtRate=_uc.rate; _usdtAt=_uc.at||0; } }catch(e){}
// Tasa efectiva para convertir VES→USD al anotar una tx: la USDT del monitor P2P
// (refleja el USDT real gastado) si esta fresca (<24h); si no, cae al BCV.
// Aritmetica simple en campos de monto ("1000+2500*2"). Solo digitos y
// + - * / ( ) . , — cualquier otra cosa da NaN. Coma = decimal (teclado VE).
function evalMath(str){
  var x=String(str==null?'':str).replace(/,/g,'.').replace(/\s+/g,'');
  if(!x||!/^[0-9+\-*/().]+$/.test(x)) return NaN;
  try{ var v=Function('"use strict";return('+x+')')(); return (typeof v==='number'&&isFinite(v))?v:NaN; }catch(e){ return NaN; }
}
function vesTxRate(){
  return (_usdtRate&&(Date.now()-_usdtAt)<24*60*60*1000)?_usdtRate:S.rate;
}
// Fuente de la tasa que devolveria vesTxRate() ahora mismo ('p2p' | 'bcv').
// Se guarda en cada tx (rateSrc) para poder auditar con que tasa se convirtio.
function vesTxRateSrc(){
  return (_usdtRate&&(Date.now()-_usdtAt)<24*60*60*1000)?'p2p':'bcv';
}
// Popup de tasas en el header mobile: USDT fija, tap muestra BCV + Intervencion.
window.toggleRatesPopup=function(e){
  e.stopPropagation();
  var p=document.getElementById('tx-rates-popup'); if(p) p.classList.toggle('open');
};
document.addEventListener('click',function(e){
  var p=document.getElementById('tx-rates-popup');
  if(p&&p.classList.contains('open')&&!(e.target.closest&&e.target.closest('#tx-rates-wrap'))) p.classList.remove('open');
});

// Exchanges: ya no hay cuentas fijas del dueno. Todo se agrega como wallet de
// exchange (ver exchangeWallets + fetchExchangeWallet mas abajo).
var BINANCE_AUTO_MS=5*60*60*1000; // 5 hours
var BSC_RPC        = 'https://bsc-dataseed.binance.org/';
var BSC_USDT       = '0x55d398326f99059fF775485246999027B3197955';

// Monedas soportadas para holdings manuales: simbolo → id de CoinGecko + nombre.
// El label del holding es libre; la moneda se elige de aca para que el precio resuelva.
var COIN_LIST=[
  {sym:'BTC', id:'bitcoin', name:'Bitcoin'},
  {sym:'ETH', id:'ethereum', name:'Ethereum'},
  {sym:'AVAX', id:'avalanche-2', name:'Avalanche'},
  {sym:'UNI', id:'uniswap', name:'Uniswap'},
  {sym:'AAVE', id:'aave', name:'Aave'},
  {sym:'SOL', id:'solana', name:'Solana'},
  {sym:'BNB', id:'binancecoin', name:'BNB'},
  {sym:'MATIC', id:'matic-network', name:'Polygon'},
  {sym:'ARB', id:'arbitrum', name:'Arbitrum'},
  {sym:'OP', id:'optimism', name:'Optimism'},
  {sym:'LINK', id:'chainlink', name:'Chainlink'},
  {sym:'DOT', id:'polkadot', name:'Polkadot'},
  {sym:'ADA', id:'cardano', name:'Cardano'},
  {sym:'XRP', id:'ripple', name:'XRP'},
  {sym:'DOGE', id:'dogecoin', name:'Dogecoin'},
  {sym:'LTC', id:'litecoin', name:'Litecoin'},
  {sym:'ATOM', id:'cosmos', name:'Cosmos'},
  {sym:'NEAR', id:'near', name:'NEAR'},
  {sym:'APT', id:'aptos', name:'Aptos'},
  {sym:'SUI', id:'sui', name:'Sui'},
  {sym:'INJ', id:'injective-protocol', name:'Injective'},
  {sym:'RNDR', id:'render-token', name:'Render'},
  {sym:'FTM', id:'fantom', name:'Fantom'},
  {sym:'USDC', id:'usd-coin', name:'USD Coin'},
  {sym:'USDT', id:'tether', name:'Tether'},
  {sym:'DAI', id:'dai', name:'Dai'},
];
function coinIdBySym(sym){ for(var i=0;i<COIN_LIST.length;i++){ if(COIN_LIST[i].sym===sym) return COIN_LIST[i].id; } return null; }
function coinNameBySym(sym){ for(var i=0;i<COIN_LIST.length;i++){ if(COIN_LIST[i].sym===sym) return COIN_LIST[i].name; } return null; }
var COINPRICE_AUTO_MS=6*60*60*1000; // 6 horas
// Trae precios spot (CoinGecko via proxy) para las monedas de los holdings manuales.
// Un solo request batcheado; gateado por edad salvo force. Cache en S.coinPrices.
async function fetchCoinPrices(force){
  if(!canFetchExchanges()) return;
  var coins={}; (S.manualHoldings||[]).forEach(function(h){ if(h.coin) coins[h.coin]=1; });
  var syms=Object.keys(coins); if(!syms.length) return;
  if(!force){ var age=S.coinPricesFetchedAt?Date.now()-S.coinPricesFetchedAt:Infinity; if(age<COINPRICE_AUTO_MS) return; }
  var ids=syms.map(coinIdBySym).filter(Boolean);
  if(!ids.length) return;
  var r=await fetch(PRICE_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({ids:ids})});
  if(!r.ok) throw new Error('Price '+r.status);
  var j=await r.json(); if(j.error) throw new Error(j.error);
  var prices=S.coinPrices||{};
  syms.forEach(function(sym){ var id=coinIdBySym(sym); if(id&&j[id]&&typeof j[id].usd==='number') prices[sym]=j[id].usd; });
  S.coinPrices=prices; S.coinPricesUpdatedAt=stamp(); S.coinPricesFetchedAt=Date.now(); save();
  return prices;
}
// Valor total del tab Holdings: on-chain (Ankr) + manuales (cantidad x precio).
// Alimenta la linea "+Holdings" del equity y se congela en cada snapshot.
function holdingsTotalUsd(){ return holdingsTotalUsdCore(S.walletHoldings, S.manualHoldings, S.coinPrices); }
async function fetchWalletHoldings(){ if(!canFetchExchanges()) return;
  var wallets = S.onchainWallets||[];
  if(!wallets.length){ S.walletHoldings=[]; S.walletHoldingsUpdated=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); save(); return []; }
  var r=await fetch(ANKR_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({wallets:wallets})});
  if(!r.ok){ var e=await r.json().catch(function(){return{};}); throw new Error(e.error||'Proxy error '+r.status); }
  var data=await r.json();
  if(data.error) throw new Error(data.error);
  S.walletHoldings=Array.isArray(data)?data:[];
  S.walletHoldingsUpdated=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  save(); return S.walletHoldings;
}
function renderWalletHoldings(){
  var wrap=document.getElementById('wh-wrap');
  var upd=document.getElementById('wh-updated');
  populateCoinSelect();
  renderOnchainWallets();
  renderManualHoldings();
  if(!wrap) return;
  if(upd&&S.walletHoldingsUpdated) upd.textContent=S.walletHoldingsUpdated;
  var MIN_USD=1;
  var prices=S.coinPrices||{};
  var data=(S.walletHoldings||[]).filter(function(h){ return h.balanceUsd>=MIN_USD; });
  // Holdings manuales como pseudo-holdings (network 'manual') para fusionarlos en el
  // total, donut y lista junto con los on-chain.
  var manualH=(S.manualHoldings||[]).map(function(h){ var p=prices[h.coin]||0; return {symbol:h.coin,balance:h.qty||0,balanceUsd:(h.qty||0)*p,network:'manual',walletLabel:h.label}; }).filter(function(h){ return h.balanceUsd>=MIN_USD; });
  data=data.concat(manualH);
  var wallets=S.onchainWallets||[];
  if(!wallets.length&&!(S.manualHoldings||[]).length){ wrap.innerHTML=''; return; }
  if(!data.length){ wrap.innerHTML=emptyState('No holdings found','Agrega un holding manual o una wallet, luego Refresh'); return; }
  var netLabel={'eth':'Ethereum','arbitrum':'Arbitrum','base':'Base','bsc':'BNB Chain','bitcoin':'Bitcoin','manual':'Manual'};
  var netColor={'eth':'#378ADD','arbitrum':'#7F77DD','base':'#5BA4F5','bsc':'#EF9F27','bitcoin':'#F7931A','manual':'#9B70F0'};
  var TOKEN_COLOR={BTC:'#F7931A',ETH:'#627EEA',WETH:'#627EEA',USDC:'#2775CA',USDT:'#26A17B',DAI:'#F5AC37',ARB:'#9CA3AF',BNB:'#F0B90B',MATIC:'#8247E5',OP:'#FF0420',SOL:'#14F195'};
  var TOKEN_NAME={BTC:'Bitcoin',ETH:'Ethereum',WETH:'Wrapped Ether',USDC:'USD Coin',USDT:'Tether',DAI:'Dai',ARB:'Arbitrum',BNB:'BNB',MATIC:'Polygon',OP:'Optimism',SOL:'Solana'};
  var STABLE={USDC:1,USDT:1,DAI:1,BUSD:1,TUSD:1,USDP:1,FRAX:1,'USDC.e':1};
  function tokenColor(sym){ return TOKEN_COLOR[sym]||('hsl('+(Math.abs(hldHash(sym))%360)+' 42% 62%)'); }

  // aggregate by symbol across wallets
  var bySym={};
  data.forEach(function(h){
    var k=h.symbol;
    if(!bySym[k]) bySym[k]={symbol:k,balance:0,balanceUsd:0,nets:{}};
    bySym[k].balance+=h.balance; bySym[k].balanceUsd+=h.balanceUsd; bySym[k].nets[h.network]=1;
  });
  var assets=Object.keys(bySym).map(function(k){ return bySym[k]; }).sort(function(a,b){ return b.balanceUsd-a.balanceUsd; });
  var grand=assets.reduce(function(s,a){ return s+a.balanceUsd; },0);
  var largest=assets[0];
  var stableUsd=assets.filter(function(a){ return STABLE[a.symbol]; }).reduce(function(s,a){ return s+a.balanceUsd; },0);
  var allNets={}; data.forEach(function(h){ allNets[h.network]=1; });
  var netCount=Object.keys(allNets).length;

  var html='';
  // ── top band: total hero + allocation donut ──
  html+='<div class="hld-top">'
    +'<div class="hld-hero">'
      +'<div class="hld-hero-lbl">Total Value</div>'
      +'<div class="hld-hero-val">'+fmtUSD(grand)+'</div>'
      +'<div class="hld-hero-meta">'+assets.length+' assets · '+wallets.length+' wallets · '+netCount+' networks</div>'
      +'<div class="hld-stats">'
        +'<div class="hld-stat"><span class="hld-stat-l">Largest</span><span class="hld-stat-v">'+largest.symbol+' <span class="hld-stat-x">'+(grand>0?Math.round(largest.balanceUsd/grand*100):0)+'%</span></span></div>'
        +'<div class="hld-stat"><span class="hld-stat-l">Stablecoins</span><span class="hld-stat-v">'+fmtShortUSD(stableUsd)+' <span class="hld-stat-x">'+(grand>0?Math.round(stableUsd/grand*100):0)+'%</span></span></div>'
        +'<div class="hld-stat"><span class="hld-stat-l">Networks</span><span class="hld-stat-v">'+netCount+'</span></div>'
      +'</div>'
    +'</div>'
    +'<div class="hld-donut-card">'
      +'<span class="cleg" style="margin:0">Allocation by asset</span>'
      +'<div class="hld-donut-wrap">'
        +'<div class="hld-donut"><canvas id="hld-donut"></canvas><div class="hld-donut-center"><b>'+assets.length+'</b><span>assets</span></div></div>'
        +'<div class="hld-legend">'+assets.slice(0,6).map(function(a){ return '<div class="hld-leg-item"><i style="background:'+tokenColor(a.symbol)+'"></i><span class="hld-leg-name">'+(TOKEN_NAME[a.symbol]||a.symbol)+'</span><span class="hld-leg-val">'+(grand>0?(a.balanceUsd/grand*100).toFixed(1):0)+'%</span></div>'; }).join('')+'</div>'
      +'</div>'
    +'</div>'
  +'</div>';

  // ── assets list (clean rows, aggregated) ──
  html+='<div class="hld-list-head"><span class="cleg" style="margin:0">Assets</span><span class="hld-list-meta">Aggregated across wallets</span></div>';
  html+='<div class="hld-list">';
  assets.forEach(function(a){
    var col=tokenColor(a.symbol);
    var pct=grand>0?(a.balanceUsd/grand*100):0;
    var chains=Object.keys(a.nets).map(function(nk){ return '<span class="hld-net" style="--nc:'+(netColor[nk]||'#888')+'">'+(netLabel[nk]||nk)+'</span>'; }).join('');
    var chipFont=a.symbol.length>3?';font-size:11px':'';
    html+='<div class="hld-row">'
      +'<div class="hld-rmain">'
        +'<span class="hld-chip" style="--tc:'+col+chipFont+'">'+escHtml(a.symbol.slice(0,4))+'</span>'
        +'<div class="hld-id"><span class="hld-sym">'+escHtml(TOKEN_NAME[a.symbol]||a.symbol)+'</span><div class="hld-chains">'+chains+'</div></div>'
        +'<div class="hld-fig"><span class="hld-usd">'+fmtUSD(a.balanceUsd)+'</span><span class="hld-sub">'+fmtBal(a.balance)+' '+escHtml(a.symbol)+' · '+pct.toFixed(1)+'%</span></div>'
      +'</div>'
      +'<div class="hld-bar"><i style="width:'+pct.toFixed(1)+'%;background:'+col+'"></i></div>'
    +'</div>';
  });
  html+='</div>';

  wrap.innerHTML=html;
  drawHoldingsDonut(assets, tokenColor);
}
var whDonutChart=null;
function drawHoldingsDonut(assets, tokenColor){
  var el=document.getElementById('hld-donut'); if(!el||el.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(function(){ drawHoldingsDonut(assets,tokenColor); }).catch(function(){}); return; }
  if(whDonutChart){ whDonutChart.destroy(); whDonutChart=null; }
  whDonutChart=new Chart(el,{type:'doughnut',data:{labels:assets.map(function(a){ return a.symbol; }),datasets:[{data:assets.map(function(a){ return parseFloat(a.balanceUsd.toFixed(2)); }),backgroundColor:assets.map(function(a){ return tokenColor(a.symbol); }),borderWidth:0,spacing:2}]},options:{cutout:'72%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.label+': '+fmtUSD(ctx.raw); }}}},animation:{animateRotate:true,duration:600},responsive:true,maintainAspectRatio:false}});
}
function hldHash(s){ var h=0; s=String(s); for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return h; }
function fmtShortUSD(v){ return '$'+Math.round(v).toLocaleString('en-US'); }
function fmtBal(b){ return b.toLocaleString('en-US',{maximumFractionDigits:6}); }
function toggleWhCard(){}
window.toggleWhCard=toggleWhCard;
function toggleOwCard(){
  var card=document.getElementById('hld-wallets'); if(card) card.classList.toggle('open');
}
window.toggleOwCard=toggleOwCard;
function toggleMhCard(){
  var card=document.getElementById('hld-manual'); if(card) card.classList.toggle('open');
}
window.toggleMhCard=toggleMhCard;

function renderOnchainWallets(){
  var wrap=document.getElementById('ow-list');
  var cnt=document.getElementById('ow-count');
  var wallets=S.onchainWallets||[];
  if(cnt) cnt.textContent='Wallets · '+wallets.length;
  if(!wrap) return;
  if(!wallets.length){ wrap.innerHTML='<p style="font-size:13px;color:var(--txt3);padding:6px 2px">No wallets added yet.</p>'; return; }
  var chainColor={'evm':'#378ADD','btc':'#F7931A'};
  var chainLabel={'evm':'EVM','btc':'BTC'};
  var totals={}; (S.walletHoldings||[]).forEach(function(h){ totals[h.walletLabel]=(totals[h.walletLabel]||0)+h.balanceUsd; });
  wrap.innerHTML=wallets.map(function(w){
    var c=w.chain||'evm'; var cc=chainColor[c]||'#888'; var cl=chainLabel[c]||c.toUpperCase();
    var addr=w.address.length>20?w.address.slice(0,8)+'…'+w.address.slice(-5):w.address;
    var tot=totals[w.label]||0;
    return '<div class="hld-wrow">'
      +'<span class="hld-wbadge" style="--nc:'+cc+'">'+cl+'</span>'
      +'<span class="hld-wlabel">'+escHtml(w.label)+'</span>'
      +'<span class="hld-waddr">'+addr+'</span>'
      +(tot>0?'<span class="hld-wval">'+fmtUSD(tot)+'</span>':'')
      +'<button class="hld-wbtn" onclick="copyAddr(\''+w.address+'\')" title="Copy address">⎘</button>'
      +'<button class="hld-wbtn del" onclick="deleteOnchainWallet('+w.id+')" title="Remove">✕</button>'
      +'</div>';
  }).join('');
}
function saveOnchainWallet(){
  var label=document.getElementById('ow-label').value.trim();
  var chain=document.getElementById('ow-chain').value;
  var addr=document.getElementById('ow-addr').value.trim();
  if(!label||!addr) return;
  if(chain==='evm'&&!/^0x[0-9a-fA-F]{40}$/.test(addr)){ alert('Invalid EVM address (must be 0x + 40 hex chars)'); return; }
  if(chain==='btc'&&!/^([xyz]pub[A-Za-z0-9]{100,}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,87})$/.test(addr)){ alert('Invalid Bitcoin address or xpub/zpub/ypub'); return; }
  S.onchainWallets=(S.onchainWallets||[]).concat([{id:Date.now(),label:label,chain:chain,address:addr}]);
  S.onchainWalletsUpdatedAt=stamp();
  document.getElementById('ow-label').value='';
  document.getElementById('ow-addr').value='';
  save(); renderOnchainWallets();
}
function deleteOnchainWallet(id){
  S.onchainWallets=(S.onchainWallets||[]).filter(function(w){ return w.id!==id; });
  S.onchainWalletsUpdatedAt=stamp();
  save(); renderOnchainWallets();
}
function copyAddr(a){
  navigator.clipboard.writeText(a).then(function(){
    var el=event&&event.target; if(!el) return;
    var prev=el.textContent; el.textContent='✓'; el.style.opacity='1';
    setTimeout(function(){ el.textContent=prev; el.style.opacity='0.55'; },1500);
  });
}
async function refreshWalletHoldings(){
  var btn=document.querySelector('[onclick="refreshWalletHoldings()"]');
  var wrap=document.getElementById('wh-wrap');
  if(btn){ btn.disabled=true; btn.textContent='Loading...'; }
  if(wrap) wrap.innerHTML='<div class="empty"><span class="spin"></span>Loading…</div>';
  try{ await Promise.allSettled([fetchWalletHoldings(),fetchCoinPrices(true)]); renderWalletHoldings(); }
  catch(e){ console.error('fetchWalletHoldings:',e); if(wrap) wrap.innerHTML='<div class="empty" style="color:#E24B4A">Error: '+(e.message||e.toString())+'</div>'; }
  finally{ if(btn){ btn.disabled=false; btn.textContent='↺ Refresh'; } }
}
// ── Holdings manuales ──────────────────────────────────────────────────────
function populateCoinSelect(){
  var sel=document.getElementById('mh-coin'); if(!sel||sel._filled) return;
  sel.innerHTML=COIN_LIST.map(function(c){ return '<option value="'+c.sym+'">'+c.sym+' · '+c.name+'</option>'; }).join('');
  sel._filled=1;
}
function renderManualHoldings(){
  var wrap=document.getElementById('mh-list'); var cnt=document.getElementById('mh-count');
  var list=S.manualHoldings||[];
  if(cnt) cnt.textContent='Manual · '+list.length;
  if(!wrap) return;
  if(!list.length){ wrap.innerHTML='<p style="font-size:13px;color:var(--txt3);padding:6px 2px">No manual holdings yet.</p>'; return; }
  var prices=S.coinPrices||{};
  wrap.innerHTML=list.map(function(h){
    var p=prices[h.coin]||0; var val=(h.qty||0)*p;
    return '<div class="hld-wrow">'
      +'<span class="hld-wbadge" style="--nc:#9B70F0">'+escHtml(h.coin)+'</span>'
      +'<span class="hld-wlabel">'+escHtml(h.label)+'</span>'
      +'<span class="hld-waddr">'+fmtBal(h.qty||0)+' '+escHtml(h.coin)+'</span>'
      +(p>0?'<span class="hld-wval">'+fmtUSD(val)+'</span>':'<span class="hld-waddr">sin precio</span>')
      +'<button class="hld-wbtn del" onclick="removeManualHolding('+h.id+')" title="Remove">✕</button>'
      +'</div>';
  }).join('');
}
window.addManualHolding=function(){
  var label=(document.getElementById('mh-label').value||'').trim();
  var coin=document.getElementById('mh-coin').value;
  var qty=parseFloat(document.getElementById('mh-qty').value);
  if(!coin||isNaN(qty)||qty<=0) return;
  if(!label) label=coinNameBySym(coin)||coin;
  if(!S.manualHoldings) S.manualHoldings=[];
  S.manualHoldings.push({id:Date.now(),label:label,coin:coin,qty:qty});
  S.manualHoldingsUpdatedAt=stamp(); save();
  ['mh-label','mh-qty'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  renderManualHoldings(); renderWalletHoldings();
  fetchCoinPrices(true).then(function(){ renderManualHoldings(); renderWalletHoldings(); }).catch(function(){});
};
window.removeManualHolding=function(id){
  S.manualHoldings=(S.manualHoldings||[]).filter(function(h){ return h.id!==id; });
  S.manualHoldingsUpdatedAt=stamp(); save(); renderManualHoldings(); renderWalletHoldings();
};

function toggleVesHint(){ var on=document.getElementById('tx-cur').value==='VES'; document.getElementById('ves-hint').style.display=on?'inline':'none'; if(on) updateVesPreview(); }

function autofillFromNote(){
  if(editingTxId) return; // never autofill while editing an existing tx
  var note=document.getElementById('tx-desc').value.trim();
  if(!note) return;
  // Split note into individual words and check each against keywords
  var words=note.toLowerCase().split(/[\s,:]+/);
  for(var i=0;i<AUTOFILL_RULES.length;i++){
    var rule=AUTOFILL_RULES[i];
    var matched=words.some(function(w){ return rule.keywords.indexOf(w)>=0; });
    if(!matched) continue;
    // Apply only fields defined in the rule
    if(rule.type)     document.getElementById('tx-type').value=rule.type;
    if(rule.category) document.getElementById('tx-cat').value=rule.category;
    if(rule.currency){ document.getElementById('tx-cur').value=rule.currency; toggleVesHint(); }
    if(rule.wallet){
      var ws=document.getElementById('tx-wallet');
      for(var j=0;j<ws.options.length;j++){ if(ws.options[j].value===rule.wallet){ ws.value=rule.wallet; break; } }
    }
    // Show subtle autofill hint
    var hint=document.getElementById('autofill-hint');
    if(hint){ hint.style.opacity='1'; clearTimeout(window._afTimer); window._afTimer=setTimeout(function(){hint.style.opacity='0';},2000); }
    return;
  }
}
function updateVesPreview(){ var a=evalMath(document.getElementById('tx-amount').value)||0; var vr=vesTxRate(); document.getElementById('usd-preview').textContent=(vr&&a>0)?(a/vr).toFixed(2):'-'; }

var pendingReceiptUrl = null;
var receiptUploading = false;
function toggleReceiptMenu(e){
  if(e) e.stopPropagation();
  var m=document.getElementById('receipt-menu'); if(!m) return;
  var open=m.classList.toggle('open');
  if(open){
    setTimeout(function(){
      document.addEventListener('click',function close(ev){
        if(!ev.target.closest('.receipt-attach')){ m.classList.remove('open'); document.removeEventListener('click',close); }
      });
    },0);
  }
}
function pickReceipt(id){
  var m=document.getElementById('receipt-menu'); if(m) m.classList.remove('open');
  document.getElementById(id).click();
}
function renderReceiptPreview(){
  var prev=document.getElementById('tx-receipt-preview');
  var img=document.getElementById('tx-receipt-img');
  if(pendingReceiptUrl){ img.src=pendingReceiptUrl; prev.style.display='flex'; }
  else{ img.src=''; prev.style.display='none'; }
}
var _receiptFile=null;
function removeReceipt(){
  pendingReceiptUrl=null; _receiptFile=null;
  document.getElementById('tx-receipt').value='';
  document.getElementById('tx-receipt-status').textContent='';
  renderReceiptPreview();
}
function compressImage(file){
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.onload=function(){
      var max=1200, w=img.width, h=img.height;
      if(w>h&&w>max){ h=Math.round(h*max/w); w=max; }
      else if(h>=w&&h>max){ w=Math.round(w*max/h); h=max; }
      var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      resolve(cv.toDataURL('image/jpeg',0.8));
    };
    img.onerror=reject;
    var fr=new FileReader();
    fr.onload=function(){ img.src=fr.result; };
    fr.onerror=reject;
    fr.readAsDataURL(file);
  });
}
async function onReceiptPick(input){
  var file=input.files&&input.files[0]; if(!file) return;
  _receiptFile=file;
  await _uploadReceipt();
}
// Retains the picked file so a failed upload can be retried instead of lost.
async function _uploadReceipt(){
  var file=_receiptFile; if(!file) return;
  var status=document.getElementById('tx-receipt-status');
  if(status) status.innerHTML='<span class="spin"></span> Uploading…';
  receiptUploading=true;
  try{
    var dataUrl=await compressImage(file);
    var dataB64=dataUrl.split(',')[1];
    var r=await fetch(BLOB_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({filename:'receipt.jpg',dataB64:dataB64,contentType:'image/jpeg'})});
    if(!r.ok) throw new Error('upload failed');
    var j=await r.json();
    pendingReceiptUrl=j.url;
    if(status) status.textContent='';
    renderReceiptPreview();
  }catch(e){
    if(status) status.innerHTML='<span style="color:#E24B4A">Upload failed.</span> <button type="button" class="btn btns" onclick="retryReceipt()">Retry</button>';
  }finally{
    receiptUploading=false;
  }
}
window.retryReceipt=function(){ _uploadReceipt(); };

function addTx(){
  var date=document.getElementById('tx-date').value;
  var desc=document.getElementById('tx-desc').value.trim();
  var wallet=document.getElementById('tx-wallet').value;
  var type=document.getElementById('tx-type').value;
  var cat=document.getElementById('tx-cat').value;
  var cur=document.getElementById('tx-cur').value;
  var amt=evalMath(document.getElementById('tx-amount').value);
  if(!date||!desc||isNaN(amt)||amt<=0){ txMsg('Date, note and amount are required'); return; }
  var amtUSD=amt, amtVES=null;
  var _vr=vesTxRate();
  if(cur==='VES'){ if(!_vr){ txMsg('Exchange rate not available'); return; } amtVES=amt; amtUSD=vesToUsd(amt,_vr); }
  snapshot();
  var _now=Date.now(), _ut=stamp();
  S.transactions.push({id:_now,seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:cur==='VES'?_vr:null,rateSrc:cur==='VES'?vesTxRateSrc():null,imported:false,receiptUrl:pendingReceiptUrl,updatedAt:_ut});
  S.transactionsUpdatedAt=_ut;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  save(); renderTx(); renderSummary();
  closeTxForm();
  showTxToast();
}
// Toast post-agregado con deshacer inmediato (el snapshot() de addTx ya dejo
// el estado previo en el undo stack).
var _txToastT=null;
function showTxToast(){
  var t=document.getElementById('tx-toast');
  if(!t){
    t=document.createElement('div'); t.id='tx-toast'; t.className='action-toast';
    t.innerHTML='<span>Transaccion agregada</span><button onclick="doUndo();hideTxToast()">Deshacer</button>';
    document.body.appendChild(t);
  }
  t.classList.add('show');
  clearTimeout(_txToastT); _txToastT=setTimeout(hideTxToast,4000);
}
function hideTxToast(){ var t=document.getElementById('tx-toast'); if(t) t.classList.remove('show'); }
window.hideTxToast=hideTxToast;

async function deleteTx(id){
  var t=S.transactions.find(function(x){ return x.id===id; }); if(!t) return;
  var amt=(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD);
  var ok=await appConfirm('Delete transaction?',escHtml(t.desc)+' <span style="color:'+(t.type==='Credit'?'#5DCAA5':'#E24B4A')+'">'+amt+'</span>','Delete');
  if(!ok) return;
  snapshot(); // despues del confirm: cancelar no debe ensuciar el undo stack
  if(!S.deletedTxIds) S.deletedTxIds=[];
  S.deletedTxIds.push({id:id,ts:stamp()});
  S.transactions=S.transactions.filter(function(x){ return x.id!==id; }); // por id: un sync durante el await no invalida el filtro
  S.transactionsUpdatedAt=stamp(); save(); renderTx(); renderSummary();
}

var editingTxId = null;
function editTx(id){
  var t=S.transactions.find(function(x){ return x.id===id; }); if(!t) return;
  editingTxId=id;
  var rr=document.getElementById('tx-rec-row'); if(rr) rr.style.display='none'; // recurrente no aplica al editar una tx
  document.getElementById('tx-date').value=t.date;
  document.getElementById('tx-desc').value=t.desc;
  document.getElementById('tx-wallet').value=t.wallet||'';
  document.getElementById('tx-type').value=t.type;
  document.getElementById('tx-cat').value=t.category;
  document.getElementById('tx-cur').value=t.originalCurrency||'USD';
  document.getElementById('tx-amount').value=t.originalCurrency==='VES'&&t.amountVES?t.amountVES:t.amountUSD;
  pendingReceiptUrl=t.receiptUrl||null; renderReceiptPreview();
  toggleVesHint();
  var btn=document.querySelector('.btn-add');
  btn.textContent='Confirm';
  var cancelBtn=document.getElementById('btn-cancel-edit'); if(cancelBtn) cancelBtn.style.display='';
  openTxForm();
}
function cancelEditTx(){
  // Cancel de una edicion de regla recurrente: vuelve a modo crear sin cerrar el sheet.
  if(_editingRecId){ cancelEditRecurring(); return; }
  closeTxForm();
}
function setDefaultWallet(){
  var ws=document.getElementById('tx-wallet'); if(!ws) return;
  for(var i=0;i<ws.options.length;i++){ if(ws.options[i].value==='Binance'){ ws.value='Binance'; return; } }
  ws.value='';
}
// Web: en Chromium desktop, clickear el texto de un input[type=date] solo enfoca un
// segmento — el picker nativo solo abre sobre el icono (borde derecho). showPicker()
// abre el calendario desde cualquier punto del recuadro. En movil el tap ya funciona.
window.openTxDatePicker=function(){
  if(!window.matchMedia('(min-width:721px)').matches) return;
  var i=document.getElementById('tx-date'); if(!i) return;
  try{ i.showPicker(); }catch(e){ i.focus(); }
};
function updateDateDisplay(){
  var i=document.getElementById('tx-date'), d=document.getElementById('tx-date-display'); if(!i||!d) return;
  var v=i.value; if(!v){ d.textContent=''; return; }
  var p=v.split('-'); d.textContent=p[2]+'/'+p[1]+'/'+p[0];
}
// ── Bottom-sheet history coordination (back button closes the sheet) ──
function _sheetPush(name){ window._activeSheet=name; try{ history.pushState({sheet:name},''); }catch(e){} }
function _sheetPop(){ if(window._activeSheet){ window._activeSheet=null; if(history.state&&history.state.sheet){ try{ history.back(); }catch(e){} } } }
function txMsg(text,ok){ var el=document.getElementById('tx-form-msg'); if(el){ el.textContent=text||''; el.style.color=ok?'#5DCAA5':'#E24B4A'; } }
// Sugerencias de notas: tus descripciones mas frecuentes (ultimas ~400 txs).
// datalist nativo (al teclear) + boton ▾ con dropdown propio (en mobile el
// datalist no tiene flecha ni se abre sin escribir).
var _noteSuggestions=[];
function populateNoteSuggestions(){
  var freq={},order=[];
  for(var i=S.transactions.length-1;i>=0&&order.length<400;i--){
    var d=(S.transactions[i].desc||'').trim(); if(!d) continue;
    var k=d.toLowerCase();
    if(!freq[k]){ freq[k]={c:0,d:d}; order.push(k); }
    freq[k].c++;
  }
  var freqList=order.map(function(k){ return freq[k]; }).sort(function(a,b){ return b.c-a.c; }).slice(0,30).map(function(t){ return t.d; });
  // Fijadas primero (en su orden estable de fijado), luego las frecuentes.
  var pins=S.notePins||[];
  var pinsLow=pins.map(function(d){ return d.toLowerCase(); });
  _noteSuggestions=pins.concat(freqList.filter(function(d){ return pinsLow.indexOf(d.toLowerCase())<0; }));
}
function _noteRow(d){
  var pinned=(S.notePins||[]).some(function(x){ return x.toLowerCase()===d.toLowerCase(); });
  return '<div class="note-sug-row'+(pinned?' pinned':'')+'">'
    +'<button type="button" class="note-sug-txt" onclick="pickNoteSuggest(this.textContent)">'+escHtml(d)+'</button>'
    +'<button type="button" class="note-sug-star'+(pinned?' on':'')+'" onclick="toggleNotePin(this)" data-d="'+escHtml(d)+'" aria-label="Fijar">'
    +'<svg width="14" height="14" viewBox="0 0 24 24" fill="'+(pinned?'currentColor':'none')+'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
    +'</button></div>';
}
window.toggleNotePin=function(btn){
  var d=btn.getAttribute('data-d'); if(!d) return;
  if(!S.notePins) S.notePins=[];
  var i=S.notePins.findIndex(function(x){ return x.toLowerCase()===d.toLowerCase(); });
  if(i>=0) S.notePins.splice(i,1); else S.notePins.push(d);
  S.notePinsUpdatedAt=stamp(); save();
  populateNoteSuggestions();
  // re-render manteniendo el popup abierto (respetando el filtro actual si hay texto)
  var inp=document.getElementById('tx-desc');
  if(inp&&inp.value.trim()) updateNoteSuggest(); else _renderNoteSuggest(_noteSuggestions.slice(0,12));
};
function _setNotePop(open){
  var pop=document.getElementById('note-suggest-pop');
  var btn=document.querySelector('.note-dd-btn');
  if(pop) pop.classList.toggle('open',open);
  if(btn) btn.classList.toggle('open',open); // chevron rota 180 como el ::picker-icon de los selects
}
function _renderNoteSuggest(list){
  var pop=document.getElementById('note-suggest-pop'); if(!pop) return;
  pop.innerHTML=list.map(_noteRow).join('')||'<span style="padding:8px 12px;font-size:12px;color:var(--txt3)">Sin historial aun</span>';
  _setNotePop(true);
}
// Autocompletado mientras escribes, en el popup propio (el datalist nativo no
// se puede estilar y desentonaba con la pagina).
window.updateNoteSuggest=function(){
  var pop=document.getElementById('note-suggest-pop'), inp=document.getElementById('tx-desc');
  if(!pop||!inp) return;
  var q=(inp.value||'').trim().toLowerCase();
  if(!q){ _setNotePop(false); return; }
  var m=_noteSuggestions.filter(function(d){ var l=d.toLowerCase(); return l.indexOf(q)>=0&&l!==q; }).slice(0,8);
  if(!m.length){ _setNotePop(false); return; }
  _renderNoteSuggest(m);
};
window.toggleNoteSuggest=function(e){
  e.stopPropagation(); e.preventDefault();
  var pop=document.getElementById('note-suggest-pop'); if(!pop) return;
  if(pop.classList.contains('open')){ _setNotePop(false); return; }
  _renderNoteSuggest(_noteSuggestions.slice(0,12));
};
window.pickNoteSuggest=function(d){
  var inp=document.getElementById('tx-desc'); if(inp){ inp.value=d; autofillFromNote(); }
  _setNotePop(false);
};
document.addEventListener('click',function(e){
  var pop=document.getElementById('note-suggest-pop');
  if(pop&&pop.classList.contains('open')&&!(e.target.closest&&e.target.closest('.note-field-wrap'))) _setNotePop(false);
});
function _lockScroll(on){ document.documentElement.classList.toggle('sheet-open',!!on); }
function openTxForm(){
  _lockScroll(true);
  populateNoteSuggestions();
  txMsg('');
  // Si el reset diferido del cierre anterior sigue pendiente, ejecutarlo ya
  // (evita que borre lo que editTx/addTx acaban de poner en los campos).
  if(_txResetTimer){ clearTimeout(_txResetTimer); _txResetTimer=null; if(!editingTxId) _resetTxFields(); }
  if(!editingTxId){ document.getElementById('tx-date').value=localToday(); setDefaultWallet(); }
  updateDateDisplay();
  document.getElementById('fab-add').style.display='none';
  var panel=document.getElementById('tx-form-panel'), ov=document.getElementById('tx-overlay');
  // Flush layout now (commits the value/innerHTML writes above with the closed transform),
  // then start the slide on the same tick — no deferred frames, so no perceived open delay.
  void panel.offsetHeight;
  panel.classList.add('open'); ov.classList.add('open');
  // Web: enfoca la descripcion para escribir de una vez. En movil NO: abriria el
  // teclado y taparia el form apenas se abre.
  if(!editingTxId && window.matchMedia('(min-width:721px)').matches){
    var _d=document.getElementById('tx-desc'); if(_d) _d.focus();
  }
  _sheetPush('tx');
}
var _txResetTimer=null;
function _resetTxFields(){
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent='Add';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='none';
  document.getElementById('tx-date').value=localToday();
  document.getElementById('tx-desc').value='';
  setDefaultWallet();
  document.getElementById('tx-type').value='Debit';
  document.getElementById('tx-cat').value='';
  document.getElementById('tx-amount').value='';
  document.getElementById('tx-cur').value='USD';
  removeReceipt();
  toggleVesHint();
  updateDateDisplay();
  // reset del modo recurrente
  _editingRecId=null; _txRecListOpen=false;
  var rc=document.getElementById('tx-recurring'); if(rc) rc.checked=false;
  var rr=document.getElementById('tx-rec-row'); if(rr) rr.style.display='';
  var rd=document.getElementById('tx-rec-day'); if(rd) rd.value='';
  var rdf=document.getElementById('tx-rec-day-field'); if(rdf) rdf.style.display='none';
  var df=document.getElementById('tx-date-field'); if(df) df.style.display='';
  var tg=document.getElementById('tx-rec-toggle'); if(tg) tg.style.display='none';
  var rl=document.getElementById('tx-rec-list'); if(rl) rl.style.display='none';
  var ra=document.querySelector('.receipt-attach'); if(ra) ra.style.display='';
  _setNotePop(false);
}
function closeTxForm(fromPop){
  _lockScroll(false);
  editingTxId=null;
  // Arrancar el slide-out en el mismo tick del tap; el reset de campos (10+ escrituras
  // DOM + recalc) se difiere a cuando el panel ya salio de pantalla.
  var _txp=document.getElementById('tx-form-panel');
  _txp.classList.remove('open'); _txp.style.bottom=''; _txp.style.maxHeight='';
  document.getElementById('tx-overlay').classList.remove('open');
  document.getElementById('fab-add').style.display='flex';
  clearTimeout(_txResetTimer);
  _txResetTimer=setTimeout(function(){ _txResetTimer=null; _resetTxFields(); },280);
  if(fromPop!==true) _sheetPop();
}
function openWalletForm(type){
  _lockScroll(true);
  if(type){ document.getElementById('wm-type').value=type; toggleWmBalField(); }
  var panel=document.getElementById('wv-form-panel'), ov=document.getElementById('wv-overlay');
  void panel.offsetHeight;
  panel.classList.add('open'); ov.classList.add('open');
  _sheetPush('wallet');
}
function closeWalletForm(fromPop){
  _lockScroll(false);
  var _wvp=document.getElementById('wv-form-panel');
  _wvp.classList.remove('open'); _wvp.style.bottom=''; _wvp.style.maxHeight='';
  document.getElementById('wv-overlay').classList.remove('open');
  document.getElementById('wm-name').value='';
  document.getElementById('wm-bal').value='';
  document.getElementById('wm-type').value='tracker';
  var _wc=document.getElementById('wm-cur'); if(_wc) _wc.value='USD';
  toggleWmBalField();
  if(fromPop!==true) _sheetPop();
}
function toggleWmBalField(){
  var isNormal=document.getElementById('wm-type').value==='normal';
  var f=document.getElementById('wm-bal-field');
  if(f) f.style.display=isNormal?'flex':'none';
  // Moneda solo aplica a wallets manuales (los trackers suman txs en USD).
  var cf=document.getElementById('wm-cur-field');
  if(cf) cf.style.display=isNormal?'flex':'none';
  var lbl=document.getElementById('wm-bal-lbl'), cur=document.getElementById('wm-cur');
  if(lbl&&cur) lbl.textContent=cur.value==='VES'?'Balance en Bs':'Balance USD';
}
function openExchangeForm(){
  _lockScroll(true);
  var panel=document.getElementById('xw-form-panel'), ov=document.getElementById('xw-overlay');
  if(!panel) return;
  toggleXwFields();
  var st=document.getElementById('xw-status'); if(st) st.textContent='';
  void panel.offsetHeight;
  panel.classList.add('open'); ov.classList.add('open');
  _sheetPush('exchange');
}
function closeExchangeForm(fromPop){
  _lockScroll(false);
  var p=document.getElementById('xw-form-panel'); if(!p) return;
  p.classList.remove('open'); p.style.bottom=''; p.style.maxHeight='';
  document.getElementById('xw-overlay').classList.remove('open');
  ['xw-name','xw-key','xw-secret','xw-pass','xw-address'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  if(fromPop!==true) _sheetPop();
}
window.openExchangeForm=openExchangeForm;
window.closeExchangeForm=closeExchangeForm;
function addTxOrUpdate(){
  if(receiptUploading){ txMsg('Wait for the receipt to finish uploading'); return; }
  var rec=document.getElementById('tx-recurring');
  if(rec&&rec.checked){ addRecurringRule(); return; }
  if(editingTxId) updateTx(); else addTx();
}
function updateTx(){
  var date=document.getElementById('tx-date').value;
  var desc=document.getElementById('tx-desc').value.trim();
  var wallet=document.getElementById('tx-wallet').value;
  var type=document.getElementById('tx-type').value;
  var cat=document.getElementById('tx-cat').value;
  var cur=document.getElementById('tx-cur').value;
  var amt=evalMath(document.getElementById('tx-amount').value);
  if(!date||!desc||isNaN(amt)||amt<=0){ txMsg('Date, note and amount are required'); return; }
  var t=S.transactions.find(function(x){ return x.id===editingTxId; });
  var amtUSD=amt, amtVES=null, rateUsed=null;
  if(cur==='VES'){
    amtVES=amt;
    if(t&&t.originalCurrency==='VES'&&t.amountVES===amt){
      // Monto en Bs sin cambios: conserva el USD/tasa originales, no recalcules con la tasa de hoy
      amtUSD=t.amountUSD; rateUsed=t.rateUsed; var rateSrc=t.rateSrc||null;
    }else{
      var _vr=vesTxRate();
      if(!_vr){ txMsg('Exchange rate not available'); return; }
      amtUSD=vesToUsd(amt,_vr); rateUsed=_vr; rateSrc=vesTxRateSrc();
    }
  }
  snapshot();
  var _now=stamp();
  if(t){ t.date=date; t.desc=desc; t.wallet=wallet; t.type=type; t.category=cat; t.originalCurrency=cur; t.amountUSD=amtUSD; t.amountVES=amtVES; t.rateUsed=rateUsed; t.rateSrc=cur==='VES'?(typeof rateSrc!=='undefined'?rateSrc:null):null; t.receiptUrl=pendingReceiptUrl; t.updatedAt=_now; }
  S.transactionsUpdatedAt=_now;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  cancelEditTx(); save(); renderTx(); renderSummary();
}
async function deleteManualWallet(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var ok=await appConfirm('Delete wallet?',escHtml(w.name),'Delete'); if(!ok) return; S.manualWallets=S.manualWallets.filter(function(x){ return x.id!==id; }); S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); populateWalletSelects(); }
async function renameManualWallet(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var r=await appPrompt('Rename wallet',escHtml(w.name),w.name,{inputType:'text'}); if(!r||!r.value||!r.value.trim()||r.value.trim()===w.name) return; w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */ w.name=r.value.trim(); S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); populateWalletSelects(); }
window.renameManualWallet=renameManualWallet;
async function editManualWalletBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var isVes=w.currency==='VES'; var r=await appPrompt(isVes?'Balance en Bs':'New balance',escHtml(w.name)+(isVes?' · se convierte solo a $ con la tasa USDT':'')+' · acepta sumas (1000+2500)',w.balance,{inputType:'text'}); if(!r) return; var v=evalMath(r.value); if(isNaN(v)) return; w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */ w.balance=parseFloat(v.toFixed(2)); S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); renderSummary(); }
// Fijar el balance de una wallet tracker SIN congelarlo: se guarda la base
// equivalente (rebase) y las txs futuras siguen moviendo el balance solas.
// (El viejo balanceOverride congelaba el valor y las txs nuevas no lo movian.)
async function editTrackerBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var cur=w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name); var r=await appPrompt('Set balance',escHtml(w.name)+' · acepta sumas (1000+2500)',cur,{inputType:'text'}); if(!r) return; var v=evalMath(r.value); if(isNaN(v)) return; w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */ var txBal=calcTrackerBal(w.name)-(w.balance||0); w.balance=parseFloat((v-txBal).toFixed(2)); w.balanceOverride=null; S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); renderSummary(); }
window.editTrackerBal=editTrackerBal;
window.editManualWalletBal=editManualWalletBal;

function emptyState(title, sub){
  return '<div class="es"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:.25;margin-bottom:.75rem"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="12" y2="15"/></svg><div class="es-title">'+title+'</div><div class="es-sub">'+sub+'</div></div>';
}
// localToday / parseAmt / fmtUSD / escHtml viven en ./format.js (puros).
// Pill hue mirrors the category icon background (CAT_META[cat].bg) so both stay consistent.
function tagCat(cat){ var m={Income:'tG',Home:'tB',Groceries:'tG',Transport:'tB',Health:'tP',Business:'tT',Discretionary:'tP','Eating Out':'tA',Support:'tR',Investments:'tA',Savings:'tB',
  Services:'tP','Help others':'tA',Emergency:'tR',Other:'tX'}; return m[cat]||'tX'; }
function sortTx(data){ return data.slice().sort(function(a,b){ if(b.date!==a.date) return b.date.localeCompare(a.date); return b.id - a.id; }); }

var CAT_META={
  'Income':       {bg:'#0f4d35', svg:'<polyline points="2 11 6 7 9 9.5 14 4"/><polyline points="10 4 14 4 14 8"/>'},
  'Groceries':    {bg:'#0f3d2a', svg:'<path d="M1 2h2l3 8.5h7.5l2-5.5H5.5"/><circle cx="8" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="13.5" r="1.3" fill="currentColor" stroke="none"/>'},
  'Transport':    {bg:'#0f2a5a', svg:'<rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/><line x1="1.5" y1="7.5" x2="14.5" y2="7.5"/><rect x="3" y="5" width="2.5" height="2" rx="0.5"/><rect x="10.5" y="5" width="2.5" height="2" rx="0.5"/><circle cx="5" cy="12.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="12.5" r="1.2" fill="currentColor" stroke="none"/>'},
  'Health':       {bg:'#4a1060', svg:'<path d="M6 2h4v4h4v4h-4v4h-4v-4h-4v-4h4z"/>'},
  'Discretionary':{bg:'#3a0f70', svg:'<path d="M2 9L8 3h5v5L7 14z"/><circle cx="11" cy="5.5" r="1.3" fill="currentColor" stroke="none"/>'},
  'Investments':  {bg:'#6b3000', svg:'<rect x="1" y="10" width="4" height="5" rx="0.5"/><rect x="6" y="6" width="4" height="9" rx="0.5"/><rect x="11" y="2" width="4" height="13" rx="0.5"/>'},
  'Eating Out':   {bg:'#7a2800', svg:'<path d="M5 2v5a2 2 0 0 0 4 0V2"/><line x1="7" y1="7" x2="7" y2="14"/><line x1="12" y1="2" x2="12" y2="14"/>'},
  'Home':         {bg:'#0f254a', svg:'<path d="M2 8l6-6 6 6"/><path d="M4.5 7.5v6h3v-3h1v3h3v-6"/>'},
  'Business':     {bg:'#0f4a4a', svg:'<rect x="1.5" y="6" width="13" height="8" rx="1.5"/><path d="M5 6V4.5A1.5 1.5 0 0 1 6.5 3h3A1.5 1.5 0 0 1 11 4.5V6"/><line x1="1.5" y1="10" x2="14.5" y2="10"/>'},
  'Support':      {bg:'#5a1515', svg:'<path d="M8 12.5C6 11 2 8.5 2 5.5A3 3 0 0 1 8 4 3 3 0 0 1 14 5.5C14 8.5 10 11 8 12.5z"/>'},
  'Savings':      {bg:'#0f3060', svg:'<rect x="1.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="7" cy="8" r="2.5"/><line x1="7" y1="8" x2="8.8" y2="6.5"/><line x1="12.5" y1="5.5" x2="14.5" y2="5.5"/><line x1="12.5" y1="10.5" x2="14.5" y2="10.5"/>'},
  'Transfer':     {bg:'#334155', svg:'<polyline points="4 3 1 6 4 9"/><line x1="1" y1="6" x2="11" y2="6"/><polyline points="12 7 15 10 12 13"/><line x1="15" y1="10" x2="5" y2="10"/>'},
};
// Iconos personalizados por palabra clave de la nota (misma mecanica que el
// autofill: se matchea contra las palabras de la nota). Pisan al icono de la
// categoria en la lista de transacciones.
// zoom: factor de escala del asset (1 = llena el marco tal cual; >1 recorta el
// margen de logos con mucho aire alrededor, como el pato).
var NOTE_ICONS=[
  { keywords:['patodo'],  src:'/icon-patodo.png?v=1',  zoom:1.7 },
  { keywords:['inter'],   src:'/icon-inter.png?v=1',   zoom:1 },
  { keywords:['netflix'], src:'/icon-netflix.png?v=1', zoom:1 },
  { keywords:['cashea'],   src:'/icon-cashea.png?v=1',   zoom:1 },
  { keywords:['movistar'], src:'/icon-movistar.png?v=1', zoom:1 },
  { keywords:['digitel'],  src:'/icon-digitel.png?v=1',  zoom:1 },
  { phrase:'mi super',     src:'/icon-misuper.png?v=1',  zoom:1.15 },
  { keywords:['botellon'], src:'/icon-botellon.png?v=2', zoom:1.02 },
  { keywords:['rio'],      src:'/icon-rio.png?v=1',      zoom:1 },
  { keywords:['epa'],      src:'/icon-epa.png?v=1',      zoom:1.5 },
  { keywords:['vamos'],    src:'/icon-vamos.png?v=1',    zoom:1 },
  { keywords:['yummy'],    src:'/icon-yummy.png?v=1',    zoom:1 },
  { keywords:['emily','remesa','zelle'], src:'/logo-zelle.png?v=1', zoom:1 },
  { keywords:['claude'],   src:'/icon-claude.png?v=1',   zoom:1 },
  { keywords:['pan'],      src:'/icon-pan.png?v=1',      zoom:1.1 },
  { keywords:['gatarina','mimosa','kittens','gatos','gato'], src:'/icon-mimosa.png?v=2', zoom:1 },
];
// Matchea por palabra (keywords) o por frase/substring (phrase, para marcas de
// varias palabras como "Mi Super").
function noteIcon(desc){
  if(!desc) return null;
  var low=desc.toLowerCase(), words=low.split(/[\s,:]+/);
  for(var i=0;i<NOTE_ICONS.length;i++){
    var ni=NOTE_ICONS[i];
    if(ni.phrase&&low.indexOf(ni.phrase)>=0) return ni;
    if(ni.keywords&&words.some(function(w){ return ni.keywords.indexOf(w)>=0; })) return ni;
  }
  return null;
}
function txIcon(t){
  var ni=noteIcon(t.desc);
  if(!ni) return catIcon(t.category);
  var sz=Math.round(36*(ni.zoom||1)), m=(36-sz)/2;
  return '<span class="cat-ico" style="background:transparent;border-radius:10px;overflow:hidden"><img src="'+ni.src+'" width="'+sz+'" height="'+sz+'" loading="lazy" decoding="async" style="width:'+sz+'px;height:'+sz+'px;margin:'+m+'px;object-fit:cover"></span>';
}
function catIcon(cat){
  var m=CAT_META[cat]||{bg:'#252535',svg:''};
  var inner=m.logo?'<img src="'+m.logo+'" width="36" height="36" loading="lazy" decoding="async" style="width:36px;height:36px;border-radius:10px;object-fit:cover">':'<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+m.svg+'</svg>';
  return '<span class="cat-ico" style="background:'+(m.logo?'transparent':m.bg)+'">'+inner+'</span>';
}

function fmtDateHdr(d){
  var today=localToday();
  var yd=new Date(); yd.setDate(yd.getDate()-1);
  var yest=yd.getFullYear()+'-'+String(yd.getMonth()+1).padStart(2,'0')+'-'+String(yd.getDate()).padStart(2,'0');
  return d===today?'Today':d===yest?'Yesterday':new Date(d+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
function txSepHtml(date){
  var dayTotal=(_txDayTotals&&_txDayTotals[date])||0;
  return '<tr class="date-sep"><td colspan="7"><div class="dsep-inner"><span class="dsep-lbl">'+fmtDateHdr(date)+'</span>'+(dayTotal>0?'<span class="dsep-sep">·</span><span class="dsep-total">-'+fmtUSD(dayTotal)+'</span>':'')+'</div></td></tr>';
}
function txRowHtml(t){
  var rateTip=t.rateUsed?('Tasa '+(t.rateSrc==='p2p'?'USDT P2P':t.rateSrc==='bcv'?'BCV':'')+' '+t.rateUsed):'';
  var orig=t.originalCurrency==='VES'&&t.amountVES?'<span title="'+rateTip+'">Bs '+t.amountVES.toLocaleString('es-VE')+'</span>':'';
  var isTrk=isTracker(t.wallet,t);
  var trk=isTrk?'<span class="badge-t">tracker</span>':'';
  var wTag=t.wallet==='Binance'?'tBinance':'tX';
  var txType=isTrk?'tx-tracker':(t.type==='Debit'?'tx-debit':'tx-credit');
  var sub=escHtml(t.wallet||'')+(t.category?' · '+escHtml(t.category):'');
  var origM=orig?'<span class="td-orig-m">'+orig+'</span>':'';
  var mCol=isTrk?'var(--accent)':(t.type==='Credit'?'#5DCAA5':'var(--txt)');
  return '<tr class="tx-row '+txType+'" onclick="selectTxRow(this)">'
    +'<td class="td-icon">'+txIcon(t)+'</td>'
    +'<td class="td-desc" title="'+escHtml(t.desc)+'">'
    +  '<span class="td-desc-txt">'+escHtml(t.desc)+'</span>'
    +  '<span class="td-sub">'+sub+'</span>'
    +'</td>'
    +'<td class="td-wallet"><span class="tag '+wTag+'">'+escHtml(t.wallet||'-')+'</span>'+trk+'</td>'
    +'<td class="td-cat">'+(t.category?'<span class="tag '+tagCat(t.category)+'">'+escHtml(t.category)+'</span>':'<span style="color:var(--color-text-secondary);font-size:12px">—</span>')+'</td>'
    +'<td class="td-orig">'+orig+'</td>'
    +'<td class="td-amt">'
    +  '<span class="td-amt-val td-amt-mob" style="color:'+mCol+'">'+(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD)+'</span>'
    +  '<span class="td-amt-val td-amt-desk" style="color:'+mCol+'">'+(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD)+'</span>'
    +  origM
    +'</td>'
    +'<td class="td-act">'+(t.receiptUrl?'<img class="tx-receipt-thumb" src="'+escHtml(t.receiptUrl)+'" width="28" height="28" loading="lazy" decoding="async" title="Factura" onclick="event.stopPropagation();openReceipt(this.src)">':'')+'<button class="btn-edit-tx" title="Edit" onclick="event.stopPropagation();editTx('+t.id+')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg></button><button class="btn-edit-tx btn-del-tx" title="Delete" onclick="event.stopPropagation();deleteTx('+t.id+')"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg></button></td>'
  +'</tr>';
}
// prevDate: fecha de la ultima fila ya en el DOM — evita duplicar el separador cuando un dia cruza el limite de pagina
function buildTxRows(list,prevDate){
  var out='';
  for(var i=0;i<list.length;i++){
    var t=list[i];
    if(t.date!==prevDate){ out+=txSepHtml(t.date); prevDate=t.date; }
    out+=txRowHtml(t);
  }
  return out;
}
function txMoreHtml(){
  var remaining=_txData.length-Math.min(_txLimit,_txData.length);
  return remaining>0?'<button class="btn btns" onclick="loadMoreTx()">Mostrar '+Math.min(_txBase,remaining)+' mas · '+remaining+' restantes</button>':'';
}
function txRSig(fSig){ return fSig+'|'+_txLimit+'|'+(S.transactionsUpdatedAt||0)+'|'+S.transactions.length+'|'+(S.manualWalletsUpdatedAt||0)+'|'+localToday(); }
// Autocarga: cuando el boton "Mostrar mas" se acerca al viewport, carga la siguiente pagina solo.
var _txMoreObs=null;
function watchTxMore(){
  if(!('IntersectionObserver' in window)) return;
  if(!_txMoreObs) _txMoreObs=new IntersectionObserver(function(es){ for(var i=0;i<es.length;i++){ if(es[i].isIntersecting){ loadMoreTx(); break; } } },{rootMargin:'700px'});
  _txMoreObs.disconnect();
  var el=document.getElementById('tx-more');
  if(el) _txMoreObs.observe(el);
}
// Append incremental: agrega solo las filas nuevas al tbody en vez de reconstruir todo el innerHTML
// (reconstruir 200+ filas en pleno scroll era el jank principal en movil).
function loadMoreTx(){
  var tbody=document.querySelector('#tx-wrap .tx-table tbody');
  if(!tbody||!_txData){ _txLimit+=_txBase; renderTx(); return; }
  var prev=Math.min(_txLimit,_txData.length);
  if(prev>=_txData.length) return;
  _txLimit+=_txBase;
  var chunk=_txData.slice(prev,_txLimit);
  tbody.insertAdjacentHTML('beforeend',buildTxRows(chunk,prev>0?_txData[prev-1].date:''));
  var more=document.getElementById('tx-more');
  if(more){
    var h=txMoreHtml();
    if(h){ more.innerHTML=h; } else { if(_txMoreObs) _txMoreObs.disconnect(); more.remove(); }
  }
  _txRenderSig=txRSig(_txFilterSig);
  watchTxMore();
}
window.loadMoreTx=loadMoreTx;
var _txRenderSig='';
function renderTx(){
  var wrap=document.getElementById('tx-wrap');
  var tF=document.getElementById('tf-type').value, cF=document.getElementById('tf-cat').value, wF=document.getElementById('tf-wallet').value, mF=document.getElementById('tf-month').value, sF=(document.getElementById('tf-search').value||'').toLowerCase().trim();
  // Reset pagination whenever the filter set changes (loadMoreTx keeps the same filters → no reset).
  var fSig=tF+'|'+cF+'|'+wF+'|'+mF+'|'+sF;
  if(fSig!==_txFilterSig){ _txLimit=_txBase; _txFilterSig=fSig; }
  // Skip completo si nada que afecte la lista cambio: ordenar 2000 txs y re-parsear
  // filas de innerHTML costaba ~90ms por CADA vuelta a la tab en un telefono medio.
  var rSig=txRSig(fSig);
  if(rSig===_txRenderSig) return;
  _txRenderSig=rSig;
  populateTxMonth();
  // Single pass: sort once, then one combined filter instead of 5 chained passes.
  var data=sortTx(S.transactions);
  if(tF||cF||wF||mF||sF){
    data=data.filter(function(t){
      if(tF&&t.type!==tF) return false;
      if(cF&&t.category!==cF) return false;
      if(wF&&t.wallet!==wF) return false;
      if(mF&&!t.date.startsWith(mF)) return false;
      if(sF&&!((t.desc||'').toLowerCase().indexOf(sF)>=0||(t.wallet||'').toLowerCase().indexOf(sF)>=0||(t.category||'').toLowerCase().indexOf(sF)>=0||(t.date||'').indexOf(sF)>=0||String(t.amountUSD).indexOf(sF)>=0||(t.amountVES!=null&&String(t.amountVES).indexOf(sF)>=0))) return false;
      return true;
    });
  }
  if(!data.length){ _txData=null; wrap.innerHTML=emptyState('No transactions yet','Use the + button to add your first transaction'); return; }
  // Totales por dia sobre TODO el filtrado (no solo lo visible): el header de un dia
  // que cruza el limite de pagina muestra el total completo desde el principio.
  var dayTotals={}, totalDebits=0;
  data.forEach(function(t){
    if(t.type==='Debit'&&inSummary(t)){ totalDebits+=t.amountUSD; dayTotals[t.date]=(dayTotals[t.date]||0)+t.amountUSD; }
  });
  _txData=data; _txDayTotals=dayTotals;
  // Only build DOM for the first _txLimit rows; the rest auto-load on scroll (keeps innerHTML small).
  var shown=data.length>_txLimit?data.slice(0,_txLimit):data;
  var rows=buildTxRows(shown,'');
  var moreBtn=txMoreHtml();
  wrap.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.875rem">'+data.length+' records &middot; Total debits: <strong style="color:#E24B4A">'+fmtUSD(totalDebits)+'</strong></div>'
    +'<table class="tx-table"><thead><tr><th></th><th>Note</th><th>Wallet</th><th>Category</th><th>Original</th><th>USD</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
    +(moreBtn?'<div id="tx-more" style="text-align:center;margin-top:18px">'+moreBtn+'</div>':'');
  watchTxMore();
}

function getMonths(){ var seen={}; S.transactions.forEach(function(t){ seen[t.date.slice(0,7)]=1; }); var u=Object.keys(seen).sort().reverse(); if(!u.length) u.push(monthKey(new Date())); return u; }
function fmtMonthLabel(m){ var p=String(m).split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'}).replace(' ',', '); }
function populateSumMonth(){ var sel=document.getElementById('sum-month'); var cur=sel.value; var months=getMonths(); sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+fmtMonthLabel(m)+'</option>'; }).join(''); if(cur&&months.indexOf(cur)>=0) sel.value=cur; }
function populateTxMonth(){
  var sel=document.getElementById('tf-month'); if(!sel) return;
  var cur=sel.value;
  var months=getMonths().slice();
  var nowM=monthKey(new Date());
  if(months.indexOf(nowM)<0) months.unshift(nowM); // current month always selectable
  // Labels cortos ("Jul 2026") para que el filtro quepa en la fila compacta movil.
  var shortM=function(m){ var p=m.split('-'); return new Date(+p[0],+p[1]-1,1).toLocaleDateString('en-US',{month:'short',year:'numeric'}); };
  sel.innerHTML='<option value="">Month</option>'+months.map(function(m){ return '<option value="'+m+'">'+shortM(m)+'</option>'; }).join('');
  sel.value=cur; // preserve selection ("" → all months)
}

// ── Dashboard helpers ──────────────────────────────────────────────────────
var EXPENSE_CATS_DASH=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);

// Totales debit/credit por 'YYYY-MM|categoria' en UNA pasada, cacheados.
// KPIs, alertas, insights y mes-vs-mes hacian decenas de recorridos completos
// de S.transactions por render; con el indice cada consulta es O(1).
// Invalida cuando cambia la referencia del array o transactionsUpdatedAt
// (toda mutacion de tx reasigna el array o bumpea el timestamp).
var _mctRef=null, _mctTs=null, _mctMap=null;
function monthCatTotals(){
  if(_mctMap&&_mctRef===S.transactions&&_mctTs===S.transactionsUpdatedAt) return _mctMap;
  _mctRef=S.transactions; _mctTs=S.transactionsUpdatedAt; _mctMap=monthCatTotalsCore(S.transactions);
  return _mctMap;
}
// Net spending for a category in a month: debits - credits (refunds reduce spend)
function catNetSpend(month, cats){ return catNetSpendCore(monthCatTotals(), month, cats); }
// Income del mes = creditos de la categoria Income.
function monthIncome(month){ return monthIncomeCore(monthCatTotals(), month); }

function getAvgMonthlyOutflows(){
  // 3 meses previos completos (excluye el mes actual, que suele estar a medias).
  var now=new Date(); var months=[];
  for(var i=1;i<=3;i++){ months.push(monthKey(new Date(now.getFullYear(),now.getMonth()-i,1))); }
  var totals=months.map(function(m){ return catNetSpend(m, EXPENSE_CATS_DASH); });
  var nz=totals.filter(function(v){ return v>0; });
  return nz.length>0?nz.reduce(function(s,v){ return s+v; },0)/nz.length:0;
}

function getAvgMonthlyContribution(){
  // 3 meses previos completos (excluye el mes actual, que suele estar a medias).
  var now=new Date(); var months=[];
  for(var i=1;i<=3;i++){ months.push(monthKey(new Date(now.getFullYear(),now.getMonth()-i,1))); }
  var nets=months.map(function(m){ return monthIncome(m)-catNetSpend(m, EXPENSE_CATS_DASH); });
  var nz=nets.filter(function(v){ return v>0; });
  return nz.length>0?nz.reduce(function(s,v){ return s+v; },0)/nz.length:0;
}

// Flujos que mueven el total pero NO son ganancia (Investments + Transfer),
// atribuidos al periodo (prevSnap, curSnap]. Se netean del P&L para que deployar
// capital o un deposito/retiro no cuente como profit/perdida.
// Only counts txs created at/before curSnap was recorded (by timestamp id), so an
// investment added *after* the snapshot — even same day — isn't wrongly counted,
// since curSnap's total doesn't reflect it yet (it belongs to the next period).
function investmentFlow(prevSnap, curSnap){ return investmentFlowCore(S.transactions, prevSnap, curSnap); }
// Memo: se llama ~5 veces por render del dashboard (KPIs actual+previo, health,
// panel P&L) y cada computo es O(snapshots x txs). Invalida por timestamps+longitudes.
var _pnlKey=null,_pnlVal=null;
function getSnapshotPnL(){
  var k=(S.transactionsUpdatedAt||0)+'|'+(S.snapshotsUpdatedAt||0)+'|'+S.transactions.length+'|'+(S.snapshots||[]).length;
  if(_pnlVal&&_pnlKey===k) return _pnlVal;
  _pnlKey=k; _pnlVal=_computeSnapshotPnL();
  return _pnlVal;
}
function _computeSnapshotPnL(){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(snaps.length<2) return [];
  var txById={}; (S.transactions||[]).forEach(function(t){ txById[t.id]=t; });
  var results=[];
  for(var i=1;i<snaps.length;i++){
    var s1=snaps[i-1],s2=snaps[i];
    var f=investmentFlow(s1,s2);
    var computed=(s2.total-s1.total)+f.invOut-f.invIn;
    // Si el periodo se "cerro" con su tx de profit, esa tx es la ganancia realizada
    // (congelada al tomar el snapshot). Usarla evita que mover flujos de Investments
    // ese mismo dia DESPUES del snapshot desincronice Monthly Return del Income registrado.
    var linked=s2.txId!=null?txById[s2.txId]:null;
    var profit=linked&&typeof linked.amountUSD==='number'?linked.amountUSD:computed;
    results.push({ from:s1.date,to:s2.date,snap1:s1.total,snap2:s2.total,invOut:f.invOut,invIn:f.invIn,profit:profit });
  }
  return results;
}

// ── Dashboard render sections ──────────────────────────────────────────────
// prevMonth / monthKey viven en ./format.js (puros, testeados).

function getMonthlyKPIs(month){
  // Net Worth = last snapshot of (or before) the month's end
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var monthEnd=month+'-31';
  var snapsBefore=snaps.filter(function(s){ return s.date<=monthEnd; });
  var netWorth=snapsBefore.length>0?snapsBefore[snapsBefore.length-1].total:null;
  var expenses=catNetSpend(month, EXPENSE_CATS_DASH);
  // Monthly Return: snapshot periods ending in month
  var pnls=getSnapshotPnL();
  var monthPnls=pnls.filter(function(p){ return p.to.startsWith(month); });
  var monthlyReturn=monthPnls.length>0?monthPnls.reduce(function(s,p){ return s+p.profit; },0):null;
  var lastPnl=monthPnls.length>0?monthPnls[monthPnls.length-1]:null;
  var monthlyReturnPct=lastPnl&&lastPnl.snap1>0?(monthlyReturn/lastPnl.snap1)*100:null;
  // Savings Rate: growth / (growth + expenses)
  var savBase=monthlyReturn!==null&&monthlyReturn>0?monthlyReturn:0;
  var savRate=savBase+expenses>0?Math.round((savBase/(savBase+expenses))*100):null;
  // Emergency Fund: netWorth / avg monthly outflows
  var avgExp=getAvgMonthlyOutflows();
  var emgMo=netWorth!==null&&avgExp>0?netWorth/avgExp:null;
  // Goal Progress
  var goalPct=(S.dashGoal>0&&netWorth!==null)?Math.min(100,(netWorth/S.dashGoal)*100):null;
  return {netWorth:netWorth,expenses:expenses,monthlyReturn:monthlyReturn,monthlyReturnPct:monthlyReturnPct,lastPnl:lastPnl,savRate:savRate,emgMo:emgMo,goalPct:goalPct,avgExp:avgExp};
}

function fmtDelta(cur,prev,opts){
  opts=opts||{};
  if(cur===null||cur===undefined||prev===null||prev===undefined) return '';
  if(opts.abs){
    var diff=cur-prev;
    if(Math.abs(diff)<0.5) return '';
    var sign=diff>0?'↑':'↓';
    var cls=opts.invert?(diff>0?'down':'up'):(diff>0?'up':'down');
    return '<span class="kpi-delta '+cls+'">'+sign+fmtUSD(Math.abs(diff))+'</span>';
  }
  if(prev===0||prev===null) return '';
  var pct=((cur-prev)/Math.abs(prev))*100;
  if(Math.abs(pct)<0.5) return '';
  var s=pct>0?'↑':'↓';
  var c=opts.invert?(pct>0?'down':'up'):(pct>0?'up':'down');
  return '<span class="kpi-delta '+c+'">'+s+Math.abs(pct).toFixed(1)+'%</span>';
}

function renderKPIStrip(month){
  var cur=getMonthlyKPIs(month);
  var prev=getMonthlyKPIs(prevMonth(month));
  var snapsDesc=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  // Display net worth: prefer monthly snapshot, fallback to latest snapshot, fallback to live
  var nwDisplay=cur.netWorth!==null?cur.netWorth:(snapsDesc.length>0?snapsDesc[0].total:getTotalBalance());
  function kpi(label,val,sub,color,delta){
    return '<div class="kpi-card"><div class="kpi-lbl">'+label+'</div><div class="kpi-val" style="color:'+color+'">'+val+'</div><div class="kpi-sub">'+sub+(delta?' '+delta:'')+'</div></div>';
  }
  var emgColor=cur.emgMo===null?'#888':cur.emgMo>=6?'#1D9E75':cur.emgMo>=3?'#EF9F27':'#E24B4A';
  var emgVal=cur.emgMo!==null?cur.emgMo.toFixed(1)+' mo':'—';
  var emgSub=cur.avgExp>0?'÷ '+fmtUSD(cur.avgExp)+'/mo':'no expense data';
  var retColor=cur.monthlyReturn===null?'#888':cur.monthlyReturn>0?'#1D9E75':'#E24B4A';
  var retVal=cur.monthlyReturn!==null?(cur.monthlyReturn>=0?'+':'')+fmtUSD(cur.monthlyReturn):'—';
  var retSub=cur.lastPnl!==null?(cur.monthlyReturnPct!==null?(cur.monthlyReturnPct>=0?'+':'')+cur.monthlyReturnPct.toFixed(2)+'%':''):'no snapshots for '+month;
  var savColor=cur.savRate===null?'#888':cur.savRate>=30?'#1D9E75':cur.savRate>=15?'#EF9F27':'#E24B4A';
  var kHtml='<div class="kpi-strip">'
    +kpi('Net Worth',fmtUSD(nwDisplay),snapsDesc.length>0?'as of '+snapsDesc[0].date:'live estimate','#fff',fmtDelta(cur.netWorth,prev.netWorth))
    +kpi('Monthly Return',retVal,retSub,retColor,fmtDelta(cur.monthlyReturn,prev.monthlyReturn,{abs:true}))
    // "Profit Retention" (return retenido vs gastos), NO el savings rate clasico
    // sobre income que muestra Budget — eran dos metricas distintas con el mismo nombre.
    +kpi('Profit Retention',cur.savRate!==null?cur.savRate+'%':'—','return vs spending',savColor,fmtDelta(cur.savRate,prev.savRate))
    +kpi('Emergency Fund',emgVal,emgSub,emgColor,fmtDelta(cur.emgMo,prev.emgMo))
    +kpi('Goal Progress',cur.goalPct!==null?cur.goalPct.toFixed(1)+'%':'—',S.dashGoal>0?'of '+fmtUSD(S.dashGoal):'set a goal below','#9B70F0',fmtDelta(cur.goalPct,prev.goalPct))
    +'</div>';
  // Solo tocar el DOM cuando cambio → la animacion de entrada no se repite en cada sync/tab return.
  if(kHtml!==_kpiSig){ document.getElementById('kpi-strip').innerHTML=kHtml; _kpiSig=kHtml; }
}

// ── Health Score ───────────────────────────────────────────────────────────
function getWalletShares(){
  var shares={};
  (S.exchangeWallets||[]).forEach(function(w){ shares[w.name]=w.balance||0; });
  S.manualWallets.forEach(function(w){
    var bal=w.trackerOnly?(w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name)):w.balance;
    shares[w.name]=bal;
  });
  return shares;
}

function renderHealthScore(){
  var el=document.getElementById('health-wrap'); if(!el) return;
  var pnls=getSnapshotPnL();
  var lastPnl=pnls.length>0?pnls[pnls.length-1]:null;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var netWorth=snaps.length>0?snaps[0].total:getTotalBalance();

  // Growth (0-25): monthly return % from last snapshot period
  var growthPct=lastPnl&&lastPnl.snap1>0?(lastPnl.profit/lastPnl.snap1)*100:0;
  var growthPts=Math.max(0,Math.min(25,Math.round(growthPct*10)));

  // Diversification (0-25): 1 - top wallet share (only positive shares)
  var shares=getWalletShares();
  var positiveShares=Object.keys(shares).map(function(k){ return shares[k]; }).filter(function(v){ return v>0; });
  var totalPos=positiveShares.reduce(function(s,v){ return s+v; },0);
  var topShare=positiveShares.length>0&&totalPos>0?Math.max.apply(null,positiveShares)/totalPos:1;
  var divPts=positiveShares.length<=1?0:Math.round((1-topShare)*25/0.7);
  divPts=Math.max(0,Math.min(25,divPts));

  // Savings rate (0-25): use current month
  var nowMonth=monthKey(new Date());
  var kpis=getMonthlyKPIs(nowMonth);
  var savPts=kpis.savRate!==null?Math.max(0,Math.min(25,Math.round(kpis.savRate/2))):0;

  // Emergency Fund (0-25): months / 6 * 25, capped
  var emgPts=kpis.emgMo!==null?Math.max(0,Math.min(25,Math.round(kpis.emgMo/6*25))):0;

  var total=growthPts+divPts+savPts+emgPts;
  var color=total>=80?'#1D9E75':total>=60?'#A3CB48':total>=40?'#EF9F27':'#E24B4A';
  var label=total>=80?'Excelente':total>=60?'Bien':total>=40?'Mejorable':'Atención';

  function item(name,pts){
    var pct=pts/25;
    return '<div class="hb-item"><div class="hb-name">'+name+'</div><div class="hb-bar"><div class="hb-fill" style="width:'+(pct*100)+'%"></div></div></div>';
  }
  var RR=42, CIRC=2*Math.PI*RR, dash=(total/100)*CIRC;
  var hHtml='<div class="cleg">Salud Financiera</div>'
    +'<div class="health-ring-wrap">'
      +'<div class="health-ring"><svg width="100%" height="100%" viewBox="0 0 100 100">'
        +'<circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"></circle>'
        +'<circle cx="50" cy="50" r="42" fill="none" stroke="'+color+'" stroke-width="7" stroke-linecap="round" stroke-dasharray="'+dash+' '+CIRC+'" transform="rotate(-90 50 50)"></circle>'
        +'</svg><div class="health-ring-val"><b style="color:'+color+'">'+total+'</b><span>'+label+'</span></div></div>'
      +'<div class="health-breakdown">'
        +item('Growth',growthPts)+item('Diversif.',divPts)+item('Retention',savPts)+item('Emergency',emgPts)
      +'</div>'
    +'</div>';
  // Only touch the DOM when output actually changed → no node recreation, no re-animation on tab return.
  if(hHtml!==_healthSig){ el.innerHTML=hHtml; _healthSig=hHtml; }

  // mobile compact bar
  var barEl=document.getElementById('health-bar-m');
  if(barEl){
    var aAlerts=getActiveAlerts();
    var aDot=aAlerts.length===0?'#1D9E75':'#EF9F27';
    var aTxt=aAlerts.length===0?'Todo en orden':aAlerts.length+' alerta'+(aAlerts.length>1?'s':'');
    var chevSvg='<svg class="hbm-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 6 8 10 4"/></svg>';
    var healthDrop='<div id="health-drop-m" class="hbm-drop">'
      +'<div class="hbm-drop-inner">'
        +'<div class="hbm-drop-score" style="color:'+color+'">'+total+'<span class="hbm-drop-lbl">'+label+'</span></div>'
        +'<div class="hbm-items">'
          +item('Growth',growthPts)+item('Diversif.',divPts)+item('Retention',savPts)+item('Emergency',emgPts)
        +'</div>'
      +'</div>'
    +'</div>';
    var alertItems=aAlerts.map(function(a){
      var dot=a.sev==='crit'?'#E24B4A':a.sev==='info'?'#5DCAA5':'#EF9F27';
      var clickAttr=a.onClick?' onclick="'+a.onClick+'"':'';
      return '<div class="hbm-alert-item"'+clickAttr+'>'
        +'<span class="hbm-dot" style="background:'+dot+';margin-top:3px;flex-shrink:0"></span>'
        +'<div><div class="hbm-alert-msg">'+a.msg+'</div><div class="hbm-alert-action">'+a.action+'</div></div>'
      +'</div>';
    }).join('');
    var alertDrop=aAlerts.length>0?'<div id="alerts-drop-m" class="hbm-drop"><div class="hbm-alerts-list">'+alertItems+'</div></div>':'';
    var alertPill=aAlerts.length>0
      ?'<button class="hbm-pill" onclick="toggleAlertsDrop()">'
          +'<span class="hbm-dot" style="background:'+aDot+'"></span>'
          +'<span class="hbm-txt">'+aTxt+'</span>'
          +chevSvg
        +'</button>'
      :'<span class="hbm-status"><span class="hbm-dot" style="background:'+aDot+'"></span>'+aTxt+'</span>';
    var mHtml='<div class="hbm-row">'
      +'<button class="hbm-pill" onclick="toggleHealthDrop()">'
        +'<span class="hbm-dot" style="background:'+color+'"></span>'
        +'<span class="hbm-txt">Salud: <b style="color:'+color+'">'+total+'</b></span>'
        +chevSvg
      +'</button>'
      +alertPill
    +'</div>'
    +healthDrop+alertDrop;
    if(mHtml!==_healthMSig){ barEl.innerHTML=mHtml; _healthMSig=mHtml; }
  }
}

function _closeHbmDrop(id,chevIdx){
  var d=document.getElementById(id);
  if(d&&d.classList.contains('open')){
    d.classList.remove('open');
    var chevs=document.querySelectorAll('#health-bar-m .hbm-chev');
    if(chevs[chevIdx]) chevs[chevIdx].style.transform='';
  }
}
window.toggleHealthDrop=function(){
  _closeHbmDrop('alerts-drop-m',1);
  var d=document.getElementById('health-drop-m');
  if(!d) return;
  var open=d.classList.toggle('open');
  var chev=document.querySelectorAll('#health-bar-m .hbm-chev')[0];
  if(chev) chev.style.transform=open?'rotate(180deg)':'';
};
window.toggleAlertsDrop=function(){
  _closeHbmDrop('health-drop-m',0);
  var d=document.getElementById('alerts-drop-m');
  if(!d) return;
  var open=d.classList.toggle('open');
  var chev=document.querySelectorAll('#health-bar-m .hbm-chev')[1];
  if(chev) chev.style.transform=open?'rotate(180deg)':'';
};

// ── Alerts ─────────────────────────────────────────────────────────────────
function getActiveAlerts(){
  var alerts=[];
  var now=new Date();
  var curMonth=monthKey(now);

  // 1. Overspend per category (current month vs 3-month avg excluding current)
  EXPENSE_CATS_DASH.forEach(function(cat){
    var curSpend=catNetSpend(curMonth, [cat]);
    if(curSpend<50) return;
    var prior=[];
    for(var i=1;i<=3;i++){
      var m=monthKey(new Date(now.getFullYear(),now.getMonth()-i,1));
      var spend=catNetSpend(m, [cat]);
      if(spend>0) prior.push(spend);
    }
    if(prior.length===0) return;
    var avg=prior.reduce(function(s,v){ return s+v; },0)/prior.length;
    if(avg<=0) return;
    var pct=((curSpend-avg)/avg)*100;
    if(pct>=40){
      alerts.push({
        sev:pct>=80?'crit':'warn',
        msg:'Gasto en '+cat+': '+fmtUSD(curSpend)+' (↑'+pct.toFixed(0)+'% vs promedio)',
        action:'Revisa transacciones de este mes en '+cat
      });
    }
  });

  // 2. Snapshot pendiente
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  if(snaps.length>0){
    var last=new Date(snaps[0].date+'T00:00:00');
    var daysSince=Math.floor((now-last)/(1000*60*60*24));
    if(daysSince>30){
      alerts.push({
        sev:daysSince>45?'crit':'warn',
        msg:'Último snapshot hace '+daysSince+' días',
        action:'Registra snapshot ahora',
        onClick:'recordSnapshot()'
      });
    }
  }

  // 3. Goal progress lento
  if(S.dashGoal>0){
    var nw=snaps.length>0?snaps[0].total:getTotalBalance();
    var contrib=getAvgMonthlyContribution();
    if(nw<S.dashGoal&&contrib>0){
      var months=Math.ceil((S.dashGoal-nw)/contrib);
      if(months>60){
        alerts.push({
          sev:'warn',
          msg:'Al ritmo actual: '+months+' meses para la meta',
          action:'Aumenta contribución mensual o ajusta la meta'
        });
      }
    } else if(nw<S.dashGoal&&contrib<=0){
      alerts.push({
        sev:'warn',
        msg:'Sin contribución mensual neta positiva',
        action:'Necesitas income > gastos para avanzar hacia la meta'
      });
    }
  }

  // 4. Transacciones recurrentes auto-agregadas (info, descartable)
  (S.recurringLog||[]).forEach(function(a){
    if(a.seen) return;
    var amtTxt=a.currency==='VES'?('Bs '+a.amount):('$'+a.amount);
    alerts.unshift({
      sev:'info',
      msg:'Auto-agregado: '+a.label+' · '+amtTxt,
      action:'Tocar para descartar · '+a.date,
      onClick:'dismissRecurringAlert('+a.id+')'
    });
  });

  return alerts;
}

function renderAlerts(){
  var el=document.getElementById('alerts-wrap'); if(!el) return;
  var alerts=getActiveAlerts();
  var hdr='<div class="cleg" style="margin-bottom:.5rem">Alertas</div>';
  if(alerts.length===0){
    el.innerHTML=hdr+'<div class="alerts-empty">✓ Todo en orden</div>';
    return;
  }
  var items=alerts.map(function(a){
    var icon=a.sev==='crit'?'⚠':a.sev==='info'?'↻':'!';
    var clickAttr=a.onClick?' onclick="'+a.onClick+'" style="cursor:pointer"':'';
    return '<div class="alert-item alert-'+a.sev+'"'+clickAttr+'><div class="alert-icon">'+icon+'</div><div class="alert-body"><div class="alert-msg">'+a.msg+'</div><div class="alert-action">'+a.action+'</div></div></div>';
  }).join('');
  var hasCrit=alerts.some(function(a){ return a.sev==='crit'; });
  var label=alerts.length===1?'1 alerta':alerts.length+' alertas';
  el.innerHTML=hdr+'<div class="alerts-pop-wrap">'
    +'<button class="alerts-trigger '+(hasCrit?'crit':'warn')+'" onclick="toggleAlertsPopup(event)">'
      +'<span class="alerts-dot"></span>'+label
      +'<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l5 5 5-5"/></svg>'
    +'</button>'
    +'<div class="alerts-popup" id="alerts-popup"><div class="alert-list">'+items+'</div></div>'
  +'</div>';
}
function toggleAlertsPopup(e){
  if(e) e.stopPropagation();
  var p=document.getElementById('alerts-popup'); if(!p) return;
  var open=p.classList.toggle('open');
  if(open){
    setTimeout(function(){
      document.addEventListener('click',function close(ev){
        if(!ev.target.closest('.alerts-pop-wrap')){ p.classList.remove('open'); document.removeEventListener('click',close); }
      });
    },0);
  }
}
window.toggleAlertsPopup=toggleAlertsPopup;

// ── Recurring transactions ───────────────────────────────────────────────
// Reglas que generan una transaccion identica cada mes, el dia indicado.
// El id de la tx es deterministico (fecha + ruleId) para que si dos dispositivos
// la generan antes de sincronizar, el merge por id las deduplique.
// dueMonths() vive en ./sync-core.js (puro, testeado).
// Elimina entradas del log cuya transaccion ya no existe (regla borrada, tx borrada
// por el usuario, o entradas huerfanas viejas sin tx asociada).
function pruneRecurringLog(){
  if(!Array.isArray(S.recurringLog)||!S.recurringLog.length) return;
  var txIds={}; S.transactions.forEach(function(t){ txIds[t.id]=1; });
  var before=S.recurringLog.length;
  S.recurringLog=S.recurringLog.filter(function(e){ return txIds[e.id]; });
  if(S.recurringLog.length!==before){ S.recurringLogUpdatedAt=stamp(); save(); }
}
function applyRecurring(){
  pruneRecurringLog();
  if(!Array.isArray(S.recurring)||!S.recurring.length) return;
  var now=new Date(), added=[], deleted=new Set((S.deletedTxIds||[]).map(tombId));
  S.recurring.forEach(function(r){
    if(!r.amount||r.amount<=0||!r.dayOfMonth) return;
    dueMonths(r, now).forEach(function(d){
      var cur=r.currency||'USD', amtUSD=r.amount, amtVES=null, rateUsed=null;
      if(cur==='VES'){ var _vr=vesTxRate(); if(!_vr) return; amtVES=r.amount; amtUSD=vesToUsd(r.amount,_vr); rateUsed=_vr; var _rs=vesTxRateSrc(); } else { var _rs=null; }
      var dateStr=d.y+'-'+String(d.m+1).padStart(2,'0')+'-'+String(d.dom).padStart(2,'0');
      var txId=Date.parse(dateStr+'T12:00:00')+(r.id%100000);
      if(deleted.has(txId)){ r.lastRun=d.ym; return; }                       // borrada por el usuario: no resucitar
      if(S.transactions.some(function(t){ return t.id===txId; })){ r.lastRun=d.ym; return; }
      S.transactions.push({id:txId,seq:S.transactions.length,date:dateStr,desc:r.label,wallet:r.wallet||'',type:r.type||'Debit',category:r.category||'',amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:rateUsed,rateSrc:_rs,imported:false,receiptUrl:null,updatedAt:stamp(),auto:true,recurringId:r.id});
      r.lastRun=d.ym;
      added.push({id:txId,rid:r.id,label:r.label,date:dateStr,amountUSD:amtUSD,currency:cur,amount:r.amount,seen:false});
    });
  });
  if(added.length){
    var ut=stamp();
    S.transactionsUpdatedAt=ut; S.recurringUpdatedAt=ut;
    if(!Array.isArray(S.recurringLog)) S.recurringLog=[];
    added.forEach(function(a){ S.recurringLog.unshift(a); });
    S.recurringLog=S.recurringLog.slice(0,30);
    S.recurringLogUpdatedAt=ut;
    // renderWallets: la tx nueva mueve el balance de los trackers — sin esto,
    // parado en la tab Wallets el monto queda viejo hasta cambiar de tab.
    save(); renderTx(); renderSummary(); renderAlerts(); renderWallets();
  }
}
window.dismissRecurringAlert=function(id){
  var e=(S.recurringLog||[]).find(function(x){ return x.id===id; });
  if(!e||e.seen) return;
  e.seen=true; S.recurringLogUpdatedAt=stamp(); save(); renderAlerts(); renderSummary();
};

// ── Recurrentes: viven dentro del sheet de nueva transaccion ────────────────
// El checkbox "Recurrente" voltea el form: oculta la fecha, muestra "dia del
// mes" y la lista de reglas (editar/eliminar). Reusa los campos tx-* (nota,
// monto, moneda, wallet, categoria, tipo); solo agrega el dia.
var _editingRecId=null;
var _txRecListOpen=false; // lista colapsada por defecto: no roba espacio al sheet
function toggleTxRecurring(){
  var on=document.getElementById('tx-recurring').checked;
  // el "Dia del mes" ocupa el mismo slot que Date en el grid (swap 1:1)
  var df=document.getElementById('tx-date-field'); if(df) df.style.display=on?'none':'';
  var dayF=document.getElementById('tx-rec-day-field'); if(dayF) dayF.style.display=on?'':'none';
  // en modo recurrente sobra la factura
  var ra=document.querySelector('.receipt-attach'); if(ra) ra.style.display=on?'none':'';
  var list=document.getElementById('tx-rec-list'); if(list) list.style.display=on&&_txRecListOpen?'':'none';
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent=on?(_editingRecId?'Guardar regla':'Add regla'):'Add';
  txMsg('');
  if(on) renderTxRecList(); else if(_editingRecId) cancelEditRecurring();
}
window.toggleTxRecurring=toggleTxRecurring;
window.toggleTxRecList=function(){
  _txRecListOpen=!_txRecListOpen;
  var l=document.getElementById('tx-rec-list'); if(l) l.style.display=_txRecListOpen?'':'none';
  renderTxRecList();
};
function renderTxRecList(){
  var n=(S.recurring||[]).length;
  var on=!!(document.getElementById('tx-recurring')&&document.getElementById('tx-recurring').checked);
  var tg=document.getElementById('tx-rec-toggle');
  if(tg){
    tg.innerHTML=n+' <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    tg.classList.toggle('open',_txRecListOpen);
    tg.title='Reglas guardadas'; tg.style.display=on&&n?'':'none';
  }
  var wrap=document.getElementById('tx-rec-list'); if(!wrap) return;
  if(!n){ _txRecListOpen=false; wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.innerHTML=S.recurring.slice().sort(function(a,b){ return (a.dayOfMonth||0)-(b.dayOfMonth||0); }).map(function(r){
    var amt=(r.currency==='VES'?'Bs ':'$')+r.amount;
    return '<div class="rec-lrow'+(_editingRecId===r.id?' editing':'')+'">'
      +'<span class="rec-lname">'+escHtml(r.label)+'</span>'
      +'<span class="rec-lmeta">Dia '+r.dayOfMonth+' · '+amt+(r.category?' · '+escHtml(r.category):'')+'</span>'
      +'<span class="rec-lacts"><button class="wico" onclick="editRecurringRule('+r.id+')" title="Editar">✎</button><button class="wico del" onclick="deleteRecurringRule('+r.id+')">✕</button></span>'
      +'</div>';
  }).join('');
}
window.editRecurringRule=function(id){
  var r=(S.recurring||[]).find(function(x){ return x.id===id; }); if(!r) return;
  _editingRecId=id;
  document.getElementById('tx-desc').value=r.label||'';
  if(r.wallet) document.getElementById('tx-wallet').value=r.wallet;
  document.getElementById('tx-type').value=r.type||'Debit';
  document.getElementById('tx-cat').value=r.category||'';
  document.getElementById('tx-cur').value=r.currency||'USD';
  document.getElementById('tx-amount').value=r.amount||'';
  document.getElementById('tx-rec-day').value=r.dayOfMonth||'';
  toggleVesHint();
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent='Guardar regla';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='';
  renderTxRecList();
};
function cancelEditRecurring(){
  _editingRecId=null;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value=''; document.getElementById('tx-rec-day').value='';
  var on=document.getElementById('tx-recurring')&&document.getElementById('tx-recurring').checked;
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent=on?'Add regla':'Add';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='none';
  renderTxRecList();
}
window.cancelEditRecurring=cancelEditRecurring;
window.addRecurringRule=function(){
  var label=document.getElementById('tx-desc').value.trim();
  var day=parseInt(document.getElementById('tx-rec-day').value,10);
  var amount=parseFloat(document.getElementById('tx-amount').value);
  if(!label||isNaN(day)||day<1||day>31||isNaN(amount)||amount<=0){ txMsg('Nota, dia (1-31) y monto son obligatorios'); return; }
  if(!S.recurring) S.recurring=[];
  var fields={label:label,dayOfMonth:day,
    wallet:document.getElementById('tx-wallet').value,
    type:document.getElementById('tx-type').value,
    category:document.getElementById('tx-cat').value,
    currency:document.getElementById('tx-cur').value,
    amount:amount};
  if(_editingRecId){
    var r=S.recurring.find(function(x){ return x.id===_editingRecId; });
    if(r) Object.assign(r,fields); // conserva id, lastRun -> no re-agrega tx ya creadas
    cancelEditRecurring();
    txMsg('Regla actualizada ✓',true);
  }else{
    S.recurring.push(Object.assign({id:Date.now(),lastRun:null},fields));
    document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value=''; document.getElementById('tx-rec-day').value='';
    txMsg('Regla creada ✓',true);
  }
  S.recurringUpdatedAt=stamp(); save();
  renderTxRecList();
  applyRecurring(); // si ya paso el dia este mes, se agrega de una
};
window.deleteRecurringRule=function(id){
  S.recurring=(S.recurring||[]).filter(function(x){ return x.id!==id; }); S.recurringUpdatedAt=stamp();
  // limpia las entradas del log que pertenecen a esta regla (por rid)
  if(Array.isArray(S.recurringLog)){
    var before=S.recurringLog.length;
    S.recurringLog=S.recurringLog.filter(function(e){ return e.rid!==id; });
    if(S.recurringLog.length!==before) S.recurringLogUpdatedAt=stamp();
  }
  if(_editingRecId===id) cancelEditRecurring();
  save(); renderTxRecList(); renderSummary();
};

function renderGoal(){
  var el=document.getElementById('goal-wrap'); if(!el) return;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var current=snaps.length>0?snaps[0].total:getTotalBalance();
  var goal=S.dashGoal||0;
  var pct=goal>0?Math.min(100,(current/goal)*100):0;
  var contrib=getAvgMonthlyContribution();
  var remaining=goal>0?Math.max(0,goal-current):0;
  var months=contrib>0?Math.ceil(remaining/contrib):null;
  var PENCIL='<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg>';
  var inputRow='<div id="goal-input-row" style="display:'+(goal>0?'none':'flex')+';gap:8px;align-items:center;margin-top:.5rem">'
    +'<input type="number" id="goal-input" value="'+(goal||'')+'" placeholder="e.g. 100000" style="flex:1;background:var(--color-background-secondary);border:0.5px solid var(--color-border-secondary);border-radius:8px;padding:6px 10px;color:#fff;font-size:14px"/>'
    +'<button class="btn btns" onclick="saveGoal()" style="padding:6px 14px">Set</button>'
    +'</div>';
  var gHtml;
  if(goal>0){
    gHtml='<div class="goal-head">'
      +'<span class="cleg" style="margin:0">Goal · '+fmtUSD(goal)+'</span>'
      +'<span class="goal-pct">'+pct.toFixed(1)+'%</span>'
      +'<button class="goal-edit-btn" title="Edit goal" onclick="document.getElementById(\'goal-input-row\').style.display=document.getElementById(\'goal-input-row\').style.display===\'none\'?\'flex\':\'none\'">'+PENCIL+'</button>'
      +'</div>'
      +inputRow
      +'<div class="goal-bar"><i style="width:'+pct.toFixed(1)+'%"></i></div>'
      +'<div class="goal-meta"><span>'+fmtUSD(current)+'</span><span>'+(months?'~'+months+' mo · '+fmtUSD(contrib)+'/mo':'')+'</span></div>';
  } else {
    gHtml='<div class="cleg">Financial Goal</div>'+inputRow;
  }
  // Skip re-render when unchanged → bar keeps its state instead of re-animating on tab return.
  if(gHtml!==_goalSig){ el.innerHTML=gHtml; _goalSig=gHtml; }
}

function saveGoal(){ var v=parseFloat(document.getElementById('goal-input').value); if(v>0){ S.dashGoal=v; S.dashGoalUpdatedAt=stamp(); save(); renderSummary(); } }

function renderSummary(){
  populateSumMonth();
  var month=document.getElementById('sum-month').value;
  renderKPIStrip(month);
  renderHealthScore();
  renderAlerts();
  renderGoal();
  renderEquityChart(); renderMonthlyChart();
}

function renderInsights(month){
  var el=document.getElementById('insights-wrap'); if(!el) return;
  var spent=catNetSpend(month, EXPENSE_CATS_DASH);
  var prev=prevMonth(month);
  // MoM per category — biggest movers
  var movers=EXPENSE_CATS_DASH.map(function(c){
    var cur=catNetSpend(month,[c]), pre=catNetSpend(prev,[c]);
    return {cat:c, cur:cur, delta:cur-pre};
  }).filter(function(m){ return m.cur>0||m.delta!==0; })
    .sort(function(a,b){ return Math.abs(b.delta)-Math.abs(a.delta); })
    .slice(0,4);
  var isCurrent=month===localToday().slice(0,7);
  var prevSpent=catNetSpend(prev, EXPENSE_CATS_DASH);
  var prevLabel=new Date(prev+'-01T00:00:00').toLocaleDateString('en-US',{month:'short'});
  function tile(lbl,val,col,sub){ return '<div class="ins-stat"><span class="ins-stat-lbl">'+lbl+'</span><span class="ins-stat-val"'+(col?' style="color:'+col+'"':'')+'>'+val+'</span><span class="ins-stat-sub">'+sub+'</span></div>'; }
  // vs last month total
  var vsCol=prevSpent<=0?'var(--txt3)':(spent>prevSpent?'#E24B4A':'#5DCAA5');
  var vsVal=prevSpent<=0?(spent>0?'New':'—'):(spent>=prevSpent?'+':'')+Math.round((spent-prevSpent)/prevSpent*100)+'%';
  var vsTile=tile('vs '+prevLabel, vsVal, vsCol, 'spent '+fmtUSD(prevSpent)+' last mo');
  var blocks='';
  if(isCurrent){
    var now=new Date();
    var daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    var dayOfMonth=now.getDate();
    var daysLeft=Math.max(1,daysInMonth-dayOfMonth+1);
    var budget=S.budgetTotal||600;
    var remaining=budget-spent;
    var perDay=remaining>0?remaining/daysLeft:0;
    var projected=dayOfMonth>0?spent/dayOfMonth*daysInMonth:0;
    var overBudget=projected>budget;
    var dailyAvg=dayOfMonth>0?spent/dayOfMonth:0;
    blocks=''
      +tile('Daily average', fmtUSD(dailyAvg), '', 'over '+dayOfMonth+(dayOfMonth===1?' day':' days'))
      +tile('Left per day', remaining>0?fmtUSD(perDay):'—', remaining>0?'#5DCAA5':'#E24B4A', daysLeft+' days left · '+fmtUSD(Math.max(0,remaining))+' left')
      +tile('Projected spend', fmtUSD(projected), overBudget?'#E24B4A':'#5DCAA5', overBudget?'over by '+fmtUSD(projected-budget):'under by '+fmtUSD(budget-projected))
      +vsTile;
  }else{
    blocks=tile('Spent', fmtUSD(spent), '', 'in '+new Date(month+'-01T00:00:00').toLocaleDateString('en-US',{month:'long'}))+vsTile;
  }
  var moverRows=movers.length?movers.map(function(m){
    var up=m.delta>0;
    var arrow=m.delta===0?'·':(up?'▲':'▼');
    var col=m.delta===0?'var(--txt3)':(up?'#E24B4A':'#5DCAA5');
    var deltaTxt=m.delta===0?'no change':(up?'+':'-')+fmtUSD(Math.abs(m.delta));
    return '<div class="ins-row"><span class="ins-cat"><span class="tag '+tagCat(m.cat)+'">'+escHtml(m.cat)+'</span></span>'
      +'<span class="ins-cur">'+fmtUSD(m.cur)+'</span>'
      +'<span class="ins-delta" style="color:'+col+'">'+arrow+' '+deltaTxt+'</span></div>';
  }).join(''):'<div style="font-size:13px;color:var(--txt3);padding:6px 2px">No expenses this month.</div>';
  el.innerHTML='<div class="ins-head"><span class="cleg" style="margin:0">Insights</span><span class="ins-head-sub">vs '+new Date(prev+'-01T00:00:00').toLocaleDateString('en-US',{month:'short'})+'</span></div>'
    +(blocks?'<div class="ins-stats">'+blocks+'</div>':'')
    +'<div class="ins-list">'+moverRows+'</div>';
}

function getLast6(){ var m=[]; var now=new Date(); for(var i=5;i>=0;i--){ m.push(monthKey(new Date(now.getFullYear(),now.getMonth()-i,1))); } return m; }
function getLast12(){ var m=[]; var now=new Date(); for(var i=11;i>=0;i--){ m.push(monthKey(new Date(now.getFullYear(),now.getMonth()-i,1))); } return m; }

function renderMonthlyChart(){
  var cv=document.getElementById('chart-monthly'); if(!cv||cv.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(renderMonthlyChart).catch(function(){}); return; }
  // Web (>=721px) ocupa el ancho completo → 12 meses para que no se vea vacio.
  // Mobile mantiene 6 meses (columna angosta).
  var isWeb=window.matchMedia('(min-width:721px)').matches;
  var months=isWeb?getLast12():getLast6();
  var mlbl=document.getElementById('mc-months-lbl'); if(mlbl) mlbl.textContent=(isWeb?'12':'6')+' Months';
  var SPEND_CATS=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);
  var map=monthCatTotals();
  var cD=months.map(function(m){ return parseFloat(SPEND_CATS.reduce(function(s,c){ var e=map[m+'|'+c]; return s+(e?e.d:0); },0).toFixed(2)); });
  var crD=months.map(function(m){ return parseFloat(monthIncome(m).toFixed(2)); });
  var labels=months.map(function(m){ var p=m.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1).toLocaleString('en',{month:'short',year:'2-digit'}); });
  // Skip rebuild when the underlying data is identical (re-navigation, visibilitychange, sync with no change).
  var sig=JSON.stringify([labels,cD,crD]);
  if(sig===_mChartSig&&mChart) return;
  _mChartSig=sig;
  document.getElementById('mc-leg').innerHTML='<span style="display:flex;align-items:center;gap:14px"><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#209473;display:inline-block"></span>Income</span><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#721414;display:inline-block"></span>Outflows</span></span>';
  if(mChart){ mChart.destroy(); mChart=null; }
  mChart=new Chart(document.getElementById('chart-monthly'),{type:'bar',data:{labels:labels,datasets:[{label:'Income',data:crD,backgroundColor:'#209473',borderRadius:3,maxBarThickness:18},{label:'Outflows',data:cD,backgroundColor:'#721414',borderRadius:3,maxBarThickness:18}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{grid:{display:false},ticks:{color:'#555',autoSkip:false,font:{size:15}}},y:{display:false}}}});
}

var _cChartSig=null;
function renderCatChart(month){
  var cv=document.getElementById('chart-cat'); if(!cv||cv.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(function(){ renderCatChart(month); }).catch(function(){}); return; }
  var map={};
  var DONUT_CATS=CATS.filter(function(c){ return c!=='Savings'&&c!=='Investments'; });
  S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&DONUT_CATS.indexOf(t.category)>=0; }).forEach(function(t){ map[t.category]=(map[t.category]||0)+t.amountUSD; });
  var cats=Object.keys(map).sort(function(a,b){ return map[b]-map[a]; }); var vals=cats.map(function(c){ return parseFloat(map[c].toFixed(2)); }); var total=vals.reduce(function(s,v){ return s+v; },0);
  var colors=cats.map(function(c){ return CCOLORS[c]||'#888'; });
  var leg=document.getElementById('cat-leg');
  if(!cats.length){
    if(cChart){ cChart.destroy(); cChart=null; }
    _cChartSig=null;
    if(leg) leg.innerHTML='<span style="color:var(--color-text-secondary)">No expenses this month</span>';
    return;
  }
  if(leg) leg.innerHTML=cats.map(function(c,i){ return '<div class="bdg-leg-item"><i style="background:'+colors[i]+'"></i><span class="bdg-leg-name">'+c+'</span><span class="bdg-leg-val">$'+Math.round(vals[i]).toLocaleString('en-US')+'</span></div>'; }).join('');
  // renderBudget reconstruye su innerHTML (canvas nuevo), pero si el canvas sigue
  // vivo y los datos no cambiaron, no destruyas/recrees el chart (~20ms por visita).
  var sig=month+'|'+JSON.stringify(vals)+'|'+cats.join(',');
  if(sig===_cChartSig&&cChart&&cChart.canvas===cv) return;
  _cChartSig=sig;
  if(cChart){ cChart.destroy(); cChart=null; }
  cChart=new Chart(document.getElementById('chart-cat'),{type:'doughnut',data:{labels:cats,datasets:[{data:vals,backgroundColor:colors,borderWidth:0,spacing:2,hoverOffset:3}]},options:{responsive:true,maintainAspectRatio:false,transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.label+': '+fmtUSD(ctx.raw); }}}},cutout:'72%'}});
}

function renderEquityChart(){
  var el=document.getElementById('chart-equity'); if(!el||el.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(renderEquityChart).catch(function(){}); return; }
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var wrap=document.getElementById('equity-wrap');
  if(!snaps.length){
    if(eChart){ eChart.destroy(); eChart=null; }
    if(wrap) wrap.innerHTML='<div style="color:var(--color-text-secondary);font-size:13px;padding:1rem 0">No snapshots yet. Record your first one to start the equity curve.</div>';
    return;
  }
  var labels=snaps.map(function(s){ return s.date; });
  var vals=snaps.map(function(s){ return s.total; });
  // Linea "+Holdings" = net worth + valor del tab Holdings congelado en cada snapshot.
  // Los Holdings NO cuentan para el net worth ni el P&L; son un overlay del patrimonio
  // total. holdingsValue se captura al hacer el snapshot (ver recordSnapshot); los
  // snapshots viejos sin el campo caen a 0 (la linea coincide con Tracked hasta que
  // empieces a capturarlo).
  var adjVals=snaps.map(function(s){ return parseFloat((s.total+(s.holdingsValue||0)).toFixed(2)); });
  // Skip rebuild when snapshots + holdings values are unchanged (adjVals folds in both).
  var sig=JSON.stringify([labels,vals,adjVals]);
  if(sig===_eChartSig&&eChart) return;
  _eChartSig=sig;
  var snapsSorted=snaps.slice().reverse();
  function makeSnapRow(s){ return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary)"><span style="color:var(--color-text-secondary)">'+s.date+'</span><span style="font-weight:500">'+fmtUSD(s.total)+'</span><div style="display:flex;gap:4px"><button class="btn btns" onclick="editSnapshot('+s.id+')" style="font-size:11px;padding:2px 7px;opacity:1">edit</button><button class="btn btnd" onclick="deleteSnapshot('+s.id+')" style="font-size:11px;padding:2px 7px;opacity:1">×</button></div></div>'; }
  var latestSnap=makeSnapRow(snapsSorted[0]);
  var olderAllSnaps=snapsSorted.slice(1);
  var olderSnapsPopup=olderAllSnaps.slice(0,3).map(makeSnapRow).join('');
  var HIST_ICON2='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 14"/></svg>';
  var eHist=document.getElementById('equity-hist');
  if(eHist) eHist.innerHTML=olderAllSnaps.length>0?'<div class="hist-wrap"><button class="hist-btn" onclick="showPage(\'history\',null,\'snapshots\')" title="Snapshot history">'+HIST_ICON2+'</button><div class="hist-popup"><div style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem">Last '+Math.min(3,olderAllSnaps.length)+' snapshots</div><div style="font-size:13px">'+olderSnapsPopup+'</div>'+(olderAllSnaps.length>3?'<div style="text-align:center;margin-top:.5rem;font-size:11px;color:#9B70F0">View all '+olderAllSnaps.length+' →</div>':'')+'</div></div>':'';
  if(wrap) wrap.innerHTML='<div style="display:flex;gap:12px;font-size:12px;color:var(--color-text-secondary);margin-bottom:.5rem">'
    +'<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#5DCAA5;display:inline-block"></span>Tracked</span>'
    +'<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#9B70F0;display:inline-block"></span>+ Holdings</span>'
    +'</div>'
    +'<div style="font-size:13px">'+latestSnap+'</div>';
  if(eChart){ eChart.destroy(); eChart=null; }
  eChart=new Chart(el,{type:'line',data:{labels:labels,datasets:[
    {label:'Tracked',data:vals,borderColor:'#4ED9A4',backgroundColor:function(ctx){var c=ctx.chart,a=c.chartArea;if(!a)return 'rgba(78,217,164,0.2)';var g=c.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,'rgba(78,217,164,0.4)');g.addColorStop(1,'rgba(78,217,164,0)');return g;},borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHitRadius:20,pointBackgroundColor:'#4ED9A4',tension:0.3,fill:true},
    {label:'+ Holdings',data:adjVals,borderColor:'#9B70F0',backgroundColor:'transparent',borderWidth:1.5,pointRadius:0,pointHoverRadius:3,pointHitRadius:15,pointBackgroundColor:'#9B70F0',tension:0.3,fill:false,borderDash:[5,4]}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},layout:{padding:0},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{display:false},y:{display:false}}}});}

function getTotalBalance(){
  var api=(S.exchangeWallets||[]).reduce(function(s,w){ return s+(w.balance||0); },0);
  var trackerBal=S.manualWallets.filter(function(w){ return w.trackerOnly; }).reduce(function(s,w){ return s+(w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name)); },0);
  var manualBal=manualNormalTotal();
  return parseFloat((api+trackerBal+manualBal).toFixed(2));
}

function appPrompt(title,infoHtml,defaultVal,opts){
  return new Promise(function(resolve){
    var ov=document.createElement('div');
    ov.className='app-modal-overlay open';
    var cbHtml=opts&&opts.checkboxLabel
      ?'<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:rgba(255,255,255,0.65);cursor:pointer"><input type="checkbox" id="_amcb"'+(opts.checkboxChecked===false?'':' checked')+' style="accent-color:#9B70F0;width:15px;height:15px;flex-shrink:0">'+opts.checkboxLabel+'</label>'
      :'';
    ov.innerHTML='<div class="app-modal">'
      +'<h3>'+title+'</h3>'
      +'<div class="modal-info">'+infoHtml+'</div>'
      +'<div class="field" style="margin-bottom:0"><input id="_ami" class="modal-inp" type="'+(opts&&opts.inputType||'number')+'" step="0.01" value="'+escHtml(String(defaultVal))+'"/></div>'
      +cbHtml
      +'<div class="modal-actions">'
      +'<button class="btn" id="_amc">Cancel</button>'
      +'<button class="btn btn-add" id="_amo">Save</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    var inp=ov.querySelector('#_ami'); inp.focus(); inp.select();
    function done(v){
      var cb=ov.querySelector('#_amcb');
      document.body.removeChild(ov);
      resolve(v===null?null:{value:v,checked:cb?cb.checked:false});
    }
    ov.querySelector('#_amc').onclick=function(){done(null);};
    ov.querySelector('#_amo').onclick=function(){done(inp.value);};
    inp.onkeydown=function(e){if(e.key==='Enter')done(inp.value);if(e.key==='Escape')done(null);};
  });
}
function appConfirm(title,bodyHtml,okLabel){
  return new Promise(function(resolve){
    var ov=document.createElement('div');
    ov.className='app-modal-overlay open';
    ov.innerHTML='<div class="app-modal">'
      +'<h3>'+title+'</h3>'
      +'<div class="modal-info">'+bodyHtml+'</div>'
      +'<div class="modal-actions">'
      +'<button class="btn" id="_amc">Cancel</button>'
      +'<button class="btn btn-add" id="_amo">'+(okLabel||'Confirm')+'</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#_amo').focus();
    function done(v){document.body.removeChild(ov);resolve(v);}
    ov.querySelector('#_amc').onclick=function(){done(false);};
    ov.querySelector('#_amo').onclick=function(){done(true);};
    function onKey(e){
      if(e.key==='Escape'){document.removeEventListener('keydown',onKey);done(false);}
      else if(e.key==='Enter'){document.removeEventListener('keydown',onKey);done(true);}
    }
    document.addEventListener('keydown',onKey);
  });
}
async function recordSnapshot(){
  var auto=getTotalBalance();
  var hasPrev=S.snapshots&&S.snapshots.length>0;
  var res=await appPrompt(
    'Record portfolio snapshot',
    'Auto-sum from wallets: <b style="color:#fff">$'+auto.toFixed(2)+'</b>',
    auto.toFixed(2),
    hasPrev?{checkboxLabel:'Add income transaction',checkboxChecked:true}:null
  );
  if(res===null) return;
  var val=parseFloat(res.value);
  if(isNaN(val)||val<0) return;
  if(!S.snapshots) S.snapshots=[];
  var today=localToday();
  var existing=S.snapshots.findIndex(function(s){ return s.date===today; });
  if(existing>=0){
    var ok=await appConfirm(
      'Replace snapshot?',
      'A snapshot for today already exists (<b style="color:#fff">$'+S.snapshots[existing].total+'</b>). Replace it?',
      'Replace'
    );
    if(!ok) return;
    S.snapshots.splice(existing,1);
  }
  S.snapshots.push({id:Date.now(),date:today,total:val,holdingsValue:holdingsTotalUsd()});
  S.snapshotsUpdatedAt=stamp();
  var sorted=S.snapshots.slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(sorted.length>=2){
    var prev=sorted[sorted.length-2];
    var cur=S.snapshots[S.snapshots.length-1];
    var f=investmentFlow(prev,cur);
    var profit=Math.round(((val-prev.total)+f.invOut-f.invIn)*100)/100;
    var fmtD=function(s){var p=s.split('-');return +p[2]+'/'+p[1].replace(/^0/,'')+'/'+p[0];};
    if(res.checked){
      var txId=Date.now()+1;
      S.transactions.push({id:txId,date:today,desc:'Profit '+fmtD(prev.date)+' → '+fmtD(today),type:'Credit',wallet:'Binance',category:'Income',amountUSD:profit,originalCurrency:'USD',updatedAt:stamp()});
      S.transactionsUpdatedAt=stamp();
      S.snapshots[S.snapshots.length-1].txId=txId;
    }
  }
  save(); renderEquityChart();
}

function toggleHistPopup(btn){ var p=btn.parentNode.querySelector('.hist-popup'); if(!p) return; p.classList.toggle('open'); }
window.toggleHistPopup=toggleHistPopup;
async function deleteSnapshot(id){
  var ok=await appConfirm('Delete snapshot?','This action cannot be undone.','Delete');
  if(!ok) return;
  var snap=S.snapshots.find(function(s){ return s.id===id; });
  S.snapshots=S.snapshots.filter(function(s){ return s.id!==id; });
  S.snapshotsUpdatedAt=stamp();
  if(snap&&snap.txId){
    var linked=S.transactions.find(function(t){ return t.id===snap.txId; });
    var delLinked=linked&&await appConfirm('Delete linked transaction?',escHtml(linked.desc)+' <span style="color:#5DCAA5">'+fmtUSD(linked.amountUSD)+'</span>','Delete');
    if(delLinked){
      if(!S.deletedTxIds) S.deletedTxIds=[];
      S.deletedTxIds.push({id:snap.txId,ts:stamp()});
      S.transactions=S.transactions.filter(function(t){ return t.id!==snap.txId; });
      S.transactionsUpdatedAt=stamp();
    }
  }
  save(); renderEquityChart();
}
async function editSnapshot(id){ var snap=S.snapshots.find(function(s){ return s.id===id; }); if(!snap) return; var r=await appPrompt('Edit snapshot','Value for '+snap.date,snap.total); if(!r) return; var val=parseFloat(r.value); if(isNaN(val)||val<0) return; snap.total=val; S.snapshotsUpdatedAt=stamp(); save(); if(document.getElementById('page-history').classList.contains('active')) renderHistory(window._historyView||'snapshots'); else { renderEquityChart(); } }
window.editSnapshot=editSnapshot;

function saveBudget(){ var v=parseFloat(document.getElementById('bud-total').value); if(v>0){ S.budgetTotal=v; S.budgetTotalUpdatedAt=stamp(); save(); renderBudget(); } }
var BUDGET_CATS=['Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support'];
// % efectivo de una categoria para un mes: override del mes > default global.
function catBudgetPct(cat,month){ return catBudgetPctCore(S.categoryBudgetPcts, S.categoryBudgetPctsByMonth, cat, month); }
function catBudgetUsd(cat,month){ return catBudgetPct(cat,month)/100*(S.budgetTotal||0); }
// Scope de edicion: 'default' escribe el % global, 'month' escribe el override
// del mes visible. Solo afecta la edicion; la vista siempre muestra el efectivo.
var _budEditScope='default';
window._budScope=function(s){ _budEditScope=s; renderBudget(); };
window._budResetMonth=function(){
  if(S.categoryBudgetPctsByMonth&&S.categoryBudgetPctsByMonth[_budMonth]){
    delete S.categoryBudgetPctsByMonth[_budMonth];
    S.categoryBudgetPctsByMonthUpdatedAt=stamp(); save();
  }
  renderBudget();
};
window.saveCategoryPct=function(cat,val){
  var v=parseFloat(val);
  if(_budEditScope==='month'&&_budMonth){
    if(!S.categoryBudgetPctsByMonth) S.categoryBudgetPctsByMonth={};
    var o=S.categoryBudgetPctsByMonth[_budMonth]||(S.categoryBudgetPctsByMonth[_budMonth]={});
    if(v>0) o[cat]=v; else delete o[cat];
    if(!Object.keys(o).length) delete S.categoryBudgetPctsByMonth[_budMonth];
    S.categoryBudgetPctsByMonthUpdatedAt=stamp();
  } else {
    if(!S.categoryBudgetPcts) S.categoryBudgetPcts={};
    if(v>0) S.categoryBudgetPcts[cat]=v; else delete S.categoryBudgetPcts[cat];
    S.categoryBudgetPctsUpdatedAt=stamp();
  }
  save(); renderBudget();
};
// Promedio de gasto por categoria en los 3 meses previos completos (meses sin
// gasto no bajan el promedio).
function _budHistAvg(){
  var now=new Date(), months=[];
  for(var i=1;i<=3;i++){ months.push(monthKey(new Date(now.getFullYear(),now.getMonth()-i,1))); }
  var avg={};
  BUDGET_CATS.forEach(function(c){
    var vals=months.map(function(m){ return catNetSpend(m,[c]); }).filter(function(v){ return v>0; });
    avg[c]=vals.length?vals.reduce(function(s,v){ return s+v; },0)/vals.length:0;
  });
  return avg;
}
// Recomendaciones: 'hist' = % segun tu gasto promedio real; '503020' = 50%
// esenciales / 30% estilo de vida / 10% business (10% libre como colchon),
// repartido dentro de cada grupo proporcional al historial (equitativo sin datos).
window.applyBudgetRec=function(kind){
  var avg=_budHistAvg(), pcts={};
  if(kind==='hist'){
    var tot=S.budgetTotal||0; if(tot<=0) return;
    BUDGET_CATS.forEach(function(c){ if(avg[c]>0) pcts[c]=parseFloat((avg[c]/tot*100).toFixed(1)); });
  } else {
    [[GROUP_ESSENTIAL,50],[GROUP_LIFESTYLE,30],[GROUP_BUSINESS,10]].forEach(function(g){
      var cats=g[0], share=g[1];
      var sum=cats.reduce(function(s,c){ return s+avg[c]; },0);
      cats.forEach(function(c){
        var w=sum>0?avg[c]/sum:1/cats.length;
        var p=parseFloat((share*w).toFixed(1));
        if(p>0) pcts[c]=p;
      });
    });
  }
  if(!Object.keys(pcts).length) return;
  if(_budEditScope==='month'&&_budMonth){
    if(!S.categoryBudgetPctsByMonth) S.categoryBudgetPctsByMonth={};
    S.categoryBudgetPctsByMonth[_budMonth]=pcts;
    S.categoryBudgetPctsByMonthUpdatedAt=stamp();
  } else {
    S.categoryBudgetPcts=pcts;
    S.categoryBudgetPctsUpdatedAt=stamp();
  }
  save(); renderBudget();
};
window._budMonthSel=function(v){ _budMonth=v; renderBudget(); };
window._budLimitsToggle=function(){ _budLimitsOpen=!_budLimitsOpen; renderBudget(); };
function renderBudget(){
  var months=getMonths();
  if(!_budMonth||months.indexOf(_budMonth)<0) _budMonth=months[0]||'';
  var month=_budMonth;
  var income=monthIncome(month);
  var spent=catNetSpend(month, BUDGET_CATS);
  var net=income-spent;
  var savRate=income>0?Math.round((net/income)*100):0;
  var remaining=S.budgetTotal-spent;
  var pct=Math.min(100,S.budgetTotal>0?Math.round(spent/S.budgetTotal*100):0);
  var bc=pct>90?'#E24B4A':pct>70?'#EF9F27':'#1D9E75';
  // Ritmo: proyeccion lineal a fin de mes (solo mes actual, desde el dia 3 para
  // no proyectar ruido de los primeros dias).
  var todayStr=localToday(), isCurMonth=month===todayStr.slice(0,7);
  var dayNum=+todayStr.slice(8,10);
  var dimP=month?(function(){ var p=month.split('-'); return new Date(+p[0],+p[1],0).getDate(); })():30;
  var canPace=isCurMonth&&dayNum>=3;
  var projTotal=canPace&&spent>0?spent/dayNum*dimP:null;

  var monthLabel=month?new Date(month+'-01T00:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}):'';
  var remColor=remaining>=0?'#4ED9A4':'#E24B4A';
  function bstat(l,v,col){ return '<div class="bdg-stat"><span class="bdg-stat-l">'+l+'</span><span class="bdg-stat-v"'+(col?' style="color:'+col+'"':'')+'>'+v+'</span></div>'; }

  var html='';

  // Header
  html+='<div class="dash-head">'
    +'<span class="dash-eyebrow">Budget</span>'
    +'<select onchange="window._budMonthSel(this.value)">'
    +months.map(function(m){ return '<option value="'+m+'"'+(m===month?' selected':'')+'>'+fmtMonthLabel(m)+'</option>'; }).join('')
    +'</select>'
    +'</div>';

  // Top band — hero + donut
  html+='<div class="bdg-top">'
    +'<div class="bdg-hero">'
      +'<div class="bdg-hero-lbl">Remaining'+(monthLabel?' · '+monthLabel:'')+'</div>'
      +'<div class="bdg-hero-val" style="color:'+remColor+'">'+fmtUSD(Math.abs(remaining))+(remaining<0?' over':'')+'</div>'
      +'<div class="bdg-pb"><div class="bdg-pf" style="width:'+pct+'%;background:'+bc+'"></div></div>'
      +'<div class="bdg-hero-sub"><span>'+fmtUSD(spent)+' spent of '+fmtUSD(S.budgetTotal)+'</span><span class="bdg-pct">'+pct+'%</span></div>'
      +'<div class="bdg-stats">'
        +bstat('Income',fmtUSD(income),'#5DCAA5')
        +bstat('Spent',fmtUSD(spent),'')
        +bstat('Savings rate',savRate+'%','#9B70F0')
        +(projTotal!=null?bstat('Proyeccion',fmtUSD(projTotal),projTotal>S.budgetTotal?'#E24B4A':'#4ED9A4'):'')
      +'</div>'
    +'</div>'
    +'<div class="bdg-donut-card">'
      +'<span class="cleg" style="margin:0">Spending by category</span>'
      +'<div class="bdg-donut-wrap">'
        +'<div class="bdg-donut"><canvas id="chart-cat"></canvas><div class="bdg-donut-center"><b>$'+Math.round(spent).toLocaleString('en-US')+'</b><span>spent</span></div></div>'
        +'<div class="bdg-legend" id="cat-leg"></div>'
      +'</div>'
    +'</div>'
  +'</div>';

  // Monthly insights
  html+='<div class="cw bdg-insights" id="insights-wrap"></div>';

  // Categories grid — header con scope de edicion (default vs solo este mes)
  var mShort=month?new Date(month+'-01T00:00:00').toLocaleDateString('en-US',{month:'short'}):'';
  var monthOvr=(S.categoryBudgetPctsByMonth||{})[month]||null;
  var hasOvr=!!(monthOvr&&Object.keys(monthOvr).length);
  // Medidor de asignacion total: cuanto % del presupuesto esta repartido entre
  // las categorias (con overrides del mes visible) y cuanto falta/sobra para 100%.
  var sumPctHead=BUDGET_CATS.reduce(function(s,c){ return s+catBudgetPct(c,month); },0);
  var allocDiff=Math.round((100-sumPctHead)*10)/10;
  var allocCol=Math.abs(allocDiff)<0.5?'#1D9E75':allocDiff>0?'#EF9F27':'#E24B4A';
  var allocTxt=Math.abs(allocDiff)<0.5?sumPctHead.toFixed(1)+'% ✓'
    :allocDiff>0?sumPctHead.toFixed(1)+'% · faltan '+allocDiff+'%'
    :sumPctHead.toFixed(1)+'% · sobran '+Math.abs(allocDiff)+'%';
  html+='<div class="bdg-cat-head"><span class="cleg" style="margin:0">Categories</span>'
    +'<span class="bdg-alloc-chip" style="--ac:'+allocCol+'" title="Suma de los % asignados (meta: 100%)">'
    +'<i class="bdg-alloc-mini"><i style="width:'+Math.min(100,sumPctHead)+'%"></i></i>'+allocTxt+'</span>'
    +'<span class="bdg-scope">'
    +'<button class="bdg-scope-btn'+(_budEditScope!=='month'?' on':'')+'" onclick="window._budScope(\'default\')">Default</button>'
    +'<button class="bdg-scope-btn'+(_budEditScope==='month'?' on':'')+'" onclick="window._budScope(\'month\')">Solo '+mShort+'</button>'
    +(hasOvr?'<button class="bdg-scope-btn reset" onclick="window._budResetMonth()">Reset '+mShort+'</button>':'')
    +'</span></div>';
  html+='<div class="bdg-cats">';
  var insMonth=prevMonth(month);
  // Pasada 1: datos por categoria (para el margen libre del rebalanceo).
  var catInfo=BUDGET_CATS.map(function(cat){
    var s=catNetSpend(month,[cat]);
    var pcta=catBudgetPct(cat,month);
    var lim=pcta>0?parseFloat((pcta/100*S.budgetTotal).toFixed(2)):0;
    return {cat:cat,s:s,pct:pcta,lim:lim,ovr:!!(monthOvr&&monthOvr[cat]!=null)};
  });
  var freeOthers=catInfo.reduce(function(t,ci){ return t+(ci.lim>0&&ci.s<ci.lim?ci.lim-ci.s:0); },0);
  // Pasada 2: tarjetas.
  catInfo.forEach(function(ci){
    var cat=ci.cat, s=ci.s, catLim=ci.lim;
    var limBase=catLim>0?catLim:S.budgetTotal;
    var cp=limBase>0?Math.min(100,Math.round(s/limBase*100)):0;
    var cc=CCOLORS[cat]||'#9B70F0';
    var barC=cp>90?'#E24B4A':cp>70?'#EF9F27':cc;
    // Change vs last month (shown inside the card on desktop)
    var dPrev=catNetSpend(insMonth, [cat]); var dD=s-dPrev; var dShow=s>0||dPrev>0;
    var dCol=dD===0?'var(--txt3)':(dD>0?'#E24B4A':'#5DCAA5');
    var dTxt=!dShow?'':(dD===0?'· no change':(dD>0?'▲ +':'▼ -')+fmtUSD(Math.abs(dD)));
    // Ritmo (#4): proyeccion a fin de mes si excede el limite. Rebalanceo (#5):
    // si ya se paso, cuanto margen libre queda en las demas categorias.
    var note='';
    if(catLim>0&&s>catLim){
      note='<div class="bdg-pace" style="color:#E24B4A">-'+fmtUSD(s-catLim)+' over'+(freeOthers>0?' · '+fmtUSD(freeOthers)+' libres en otras':'')+'</div>';
    } else if(canPace&&catLim>0&&s>0){
      var proj=s/dayNum*dimP;
      if(proj>catLim) note='<div class="bdg-pace" style="color:#EF9F27">ritmo: ~'+fmtUSD(proj)+' a fin de mes</div>';
    }
    html+='<div class="bdg-cat">'
      +'<div class="bdg-cat-top"><span class="bdg-cat-name"><i class="bdg-dot" style="background:'+cc+'"></i>'+cat+'</span><span class="bdg-cat-pct">'+cp+'%</span></div>'
      +'<div class="bdg-cat-amt">'+fmtUSD(s)+'</div>'
      +'<div class="bdg-pb sm"><div class="bdg-pf" style="width:'+cp+'%;background:'+barC+'"></div></div>'
      +'<div class="bdg-cat-lim"><span class="bdg-lim-wrap"><input type="number" class="bdg-lim-inp" value="'+(ci.pct>0?ci.pct:'')+'" placeholder="—" step="0.5" min="0" inputmode="decimal" onchange="saveCategoryPct(\''+cat+'\',this.value)">%'+(catLim>0?' · '+fmtUSD(catLim):'')+(ci.ovr?' <i class="bdg-ovr-dot" title="Override solo de '+mShort+'"></i>':'')+'</span>'+(dTxt?'<span class="bdg-cat-delta" style="color:'+dCol+'">'+dTxt+'</span>':'')+'</div>'
      +note
      +'</div>';
  });
  html+='</div>';

  // Month-vs-month comparison card (siempre desplegada, todas las categorias)
  (function(){
    var m1=prevMonth(month), m2=prevMonth(m1);          // m2=mas viejo, month=mas nuevo
    var lbl=function(m){ return new Date(m+'-01T00:00:00').toLocaleDateString('en-US',{month:'short'}); };
    var rows='', t2=0, t1=0, t0=0;
    BUDGET_CATS.forEach(function(cat){
      var v2=catNetSpend(m2,[cat]), v1=catNetSpend(m1,[cat]), v0=catNetSpend(month,[cat]);
      t2+=v2; t1+=v1; t0+=v0;
      if(v2===0&&v1===0&&v0===0) return;
      var d=v0-v1, col=d===0?'var(--txt3)':(d>0?'#E24B4A':'#5DCAA5'), arr=d===0?'·':(d>0?'▲':'▼');
      rows+='<div class="mvm-row"><span class="mvm-cat"><i class="bdg-dot" style="background:'+(CCOLORS[cat]||'#9B70F0')+'"></i>'+cat+'</span>'
        +'<span class="mvm-num mvm-pre">'+fmtUSD(v2)+'</span><span class="mvm-num mvm-pre">'+fmtUSD(v1)+'</span><span class="mvm-num">'+fmtUSD(v0)+'</span>'
        +'<span class="mvm-num mvm-delta" style="color:'+col+'">'+arr+' '+(d===0?'—':fmtUSD(Math.abs(d)))+'</span></div>';
    });
    var dT=t0-t1, colT=dT===0?'var(--txt3)':(dT>0?'#E24B4A':'#5DCAA5'), arrT=dT===0?'·':(dT>0?'▲':'▼');
    html+='<div class="mvm-card">'
      +'<span class="cleg" style="margin-bottom:20px">Mes vs mes</span>'
      +'<div class="mvm-row mvm-head"><span class="mvm-cat">Categoria</span><span class="mvm-num">'+lbl(m2)+'</span><span class="mvm-num">'+lbl(m1)+'</span><span class="mvm-num">'+lbl(month)+'</span><span class="mvm-num">Δ</span></div>'
      +(rows||'<div style="font-size:14px;color:var(--txt3);padding:10px 2px">Sin gastos en estos meses.</div>')
      +'<div class="mvm-row mvm-total"><span class="mvm-cat">Total</span><span class="mvm-num mvm-pre">'+fmtUSD(t2)+'</span><span class="mvm-num mvm-pre">'+fmtUSD(t1)+'</span><span class="mvm-num">'+fmtUSD(t0)+'</span><span class="mvm-num mvm-delta" style="color:'+colT+'">'+arrT+' '+(dT===0?'—':fmtUSD(Math.abs(dT)))+'</span></div>'
      +'</div>';
  })();

  // Configure limits accordion
  html+='<div class="bdg-limits'+(_budLimitsOpen?' open':'')+'">'
    +'<button class="bdg-limits-head" onclick="window._budLimitsToggle()">'
    +'<span class="cleg" style="margin:0">Configure limits</span>'
    +'<svg class="bdg-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    +'</button>';
  if(_budLimitsOpen){
    html+='<div class="bdg-limits-body">'
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Monthly Total</div>'
      +'<div class="fr" style="max-width:280px;margin-bottom:1.25rem">'
      +'<input type="number" id="bud-total" value="'+S.budgetTotal+'" placeholder="Total USD" step="1"/>'
      +'<button class="btn btnp" onclick="saveBudget()">Save</button>'
      +'</div>'
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Asignacion por categoria</div>'
      +(function(){
        var sumPct=BUDGET_CATS.reduce(function(s,c){ return s+catBudgetPct(c,month); },0);
        var usd=sumPct/100*S.budgetTotal;
        var col=Math.abs(sumPct-100)<0.5?'#1D9E75':sumPct>100?'#E24B4A':'#EF9F27';
        return '<div id="bud-alloc-bar" style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;font-size:12px">'
          +'<span style="color:var(--color-text-secondary)">Asignado:</span>'
          +'<span style="color:'+col+';font-weight:600">'+sumPct.toFixed(1)+'%</span>'
          +'<span style="color:var(--color-text-secondary)">de 100% · '+fmtUSD(usd)+' de '+fmtUSD(S.budgetTotal)+'</span>'
          +'<span style="flex:1;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;max-width:140px"><span style="display:block;height:100%;width:'+Math.min(100,sumPct)+'%;background:'+col+';border-radius:3px;transition:width .2s"></span></span>'
          +'</div>';
      })()
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Recomendaciones</div>'
      +'<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px">'
      +'<button class="btn btns" onclick="applyBudgetRec(\'hist\')">Segun tu historial (3m)</button>'
      +'<button class="btn btns" onclick="applyBudgetRec(\'503020\')">50 / 30 / 20</button>'
      +'</div>'
      +'<p style="font-size:12px;color:var(--txt3);margin:0 0 4px">Las recomendaciones y la edicion aplican al scope activo (Default o Solo mes). Edita el % de cada categoria tocando el numero en su tarjeta; el monto USD se deriva del Monthly Total.</p>'
      +'</div>';
  }
  html+='</div>';

  // Solo tocar el DOM si el HTML cambio: preserva el canvas del donut (su chart
  // se salta el recreate via _cChartSig) y evita re-parsear la pagina entera.
  if(html!==_budSig){ document.getElementById('bud-wrap').innerHTML=html; _budSig=html; }
  renderInsights(month);
  renderCatChart(month);
}

function saveManualWallet(){
  var name=document.getElementById('wm-name').value.trim(); var bal=parseFloat(document.getElementById('wm-bal').value)||0; var type=document.getElementById('wm-type').value;
  if(!name){ return; }
  var idx=S.manualWallets.findIndex(function(w){ return w.name.toLowerCase()===name.toLowerCase(); });
  var curSel=document.getElementById('wm-cur');
  var obj={id:Date.now(),name:name,balance:bal,trackerOnly:type==='tracker',currency:(type==='normal'&&curSel&&curSel.value==='VES')?'VES':'USD'};
  // Conversion Manual → Tracker (re-agregar con el mismo nombre): conservar el
  // balance mostrado. El tracker suma sus txs, asi que la base se rebasa
  // restando las txs existentes del wallet; sin esto arrancaria desde 0.
  if(idx>=0&&type==='tracker'&&S.manualWallets[idx].trackerOnly!==true){
    var _old=S.manualWallets[idx];
    var txSum=S.transactions.reduce(function(s,t){ return (t.imported||t.wallet!==_old.name)?s:s+(t.type==='Credit'?1:-1)*t.amountUSD; },0);
    obj.balance=parseFloat(((_old.balance||0)-txSum).toFixed(2));
    obj.name=_old.name; // conservar el casing original: las txs matchean por nombre exacto
  }
  if(idx>=0) S.manualWallets[idx]=Object.assign(S.manualWallets[idx],obj); else S.manualWallets.push(obj);
  S.manualWalletsUpdatedAt=stamp();
  closeWalletForm();
  save(); renderWallets(); populateWalletSelects();
}

// Balances de TODOS los trackers en una pasada, cacheados: antes cada
// calcTrackerBal escaneaba las 2000 txs (con un find de wallet por tx) y se
// llamaba por-wallet en health score, wallets y total.
var _trkKey=null,_trkMap=null;
function trackerTxBalances(){
  var k=(S.transactionsUpdatedAt||0)+'|'+(S.manualWalletsUpdatedAt||0)+'|'+S.transactions.length;
  if(_trkMap&&_trkKey===k) return _trkMap;
  _trkKey=k; _trkMap=trackerTxBalancesCore(S.manualWallets, S.transactions);
  return _trkMap;
}
function calcTrackerBal(name){
  // Preferir la entrada tracker si hay duplicados con el mismo nombre.
  var mw=S.manualWallets.find(function(w){ return w.name===name&&w.trackerOnly===true; })
       ||S.manualWallets.find(function(w){ return w.name===name; });
  return (mw?mw.balance:0)+(trackerTxBalances()[name]||0);
}
// Valor USD de un wallet manual. Los wallets en VES guardan el balance en Bs
// (el numero que ves en el banco) y se valoran EN VIVO con la tasa USDT del
// monitor (fallback BCV): el net worth refleja la tasa del momento sin tocar nada.
function manualWalletUsd(w){
  if(w.currency!=='VES') return w.balance||0;
  var r=vesTxRate();
  return r>0?parseFloat(((w.balance||0)/r).toFixed(2)):0;
}
function manualNormalTotal(){
  return S.manualWallets.filter(function(w){ return !w.trackerOnly; }).reduce(function(s,w){ return s+manualWalletUsd(w); },0);
}

window.refreshAllWallets=async function(){
  var btn=document.getElementById('refresh-all-btn');
  if(btn){ btn.disabled=true; btn.textContent='Refreshing...'; }
  document.querySelectorAll('#page-wallets .wm-bal').forEach(function(b){ b.classList.add('skeleton'); });
  var fns=(S.exchangeWallets||[]).map(function(w){ return fetchExchangeWallet(w).catch(function(){}); });
  await Promise.allSettled(fns);
  save(); renderWallets(); renderSummary();
  if(btn){ btn.disabled=false; btn.textContent='↻ Refresh all'; }
};

var WALLET_LOGOS={'Emily':'/logo-zelle.png?v=1','Zinli':'/logo-zinli.png?v=1','Provincial':'/logo-provincial.png?v=1','Roi':'/logo-roi.png?v=1','BDV':'/logo-bdv.png?v=1','Mercantil Panama':'/icon-merpa.png?v=2'};
// Match insensible a mayusculas y acentos ("Mercantil Panamá" → "mercantil panama"):
// el logo no debe depender de como se tipeo el nombre del wallet.
var _WLOGOS_NORM={};
Object.keys(WALLET_LOGOS).forEach(function(k){ _WLOGOS_NORM[_wnorm(k)]=WALLET_LOGOS[k]; });
function _wnorm(s){ return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function walletLogo(name){ return _WLOGOS_NORM[_wnorm(name)]||null; }

// ── Wallets de exchange personalizados (por usuario) ────────────────────────
// Cada usuario agrega los suyos con nombre propio + credenciales, desde la app.
// Los METADATOS (nombre, tipo, balance) van en S y se sincronizan; las API
// keys/secrets viven SOLO en este dispositivo (localStorage ft13_xk) — no viajan
// en el doc ni quedan en la nube. Otro dispositivo ve el balance sincronizado
// pero para refrescarlo debe re-ingresar las keys (boton llave en la fila).
var XK_LS='ft13_xk';
function xkAll(){ try{ return JSON.parse(localStorage.getItem(XK_LS)||'{}'); }catch(e){ return {}; } }
function xkGet(id){ return xkAll()[id]||null; }
function xkSet(id,obj){ try{ var a=xkAll(); a[id]=obj; localStorage.setItem(XK_LS,JSON.stringify(a)); }catch(e){} }
function xkDel(id){ try{ var a=xkAll(); delete a[id]; localStorage.setItem(XK_LS,JSON.stringify(a)); }catch(e){} }
// Migracion: docs viejos traen key/secret/passphrase dentro del wallet. Se mueven
// al almacen local de este dispositivo y se borran del doc (el proximo push
// limpia la nube). Corre en cada boot; sin secretos en el doc es un no-op.
function stripExchangeSecrets(){
  var dirty=false;
  (S.exchangeWallets||[]).forEach(function(w){
    if(w.key||w.secret||w.passphrase){
      xkSet(w.id,{key:w.key||'',secret:w.secret||'',passphrase:w.passphrase||''});
      delete w.key; delete w.secret; delete w.passphrase;
      dirty=true;
    }
  });
  if(dirty){ S.exchangeWalletsUpdatedAt=stamp(); save(); }
}
function canFetchExchanges(){ return !!sbGet('sb_at'); }
function exchangeProxyHeaders(){
  return {'Content-Type':'application/json','Authorization':'Bearer '+sbGet('sb_at')};
}
async function fetchExchangeWallet(w){
  if(w.type==='bsc'){
    var addr=(w.address||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    var padded='000000000000000000000000'+addr.slice(2).toLowerCase();
    var res=await fetch(BSC_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'eth_call',params:[{to:BSC_USDT,data:'0x70a08231'+padded},'latest'],id:1})});
    var j=await res.json(); if(j.error) throw new Error(j.error.message);
    w.balance=parseFloat((parseInt(j.result,16)/1e18).toFixed(2));
  } else {
    var xk=xkGet(w.id);
    if(!xk||!xk.key||!xk.secret) return; // keys no estan en este dispositivo
    if(!canFetchExchanges()) throw new Error('Sin sesion');
    if(w.type==='bybit'){
      var rb=await fetch(BYBIT_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({key:xk.key,secret:xk.secret})});
      if(!rb.ok) throw new Error('Bybit '+rb.status);
      var db=await rb.json(); if(db.error) throw new Error(db.error);
      var lst=(db.result&&db.result.list)||[]; var tot=0;
      lst.forEach(function(acc){ var u=acc.coin&&acc.coin.find(function(c){ return c.coin==='USDT'; }); if(u) tot+=parseFloat(u.walletBalance||0); });
      w.balance=parseFloat(tot.toFixed(2));
    } else if(w.type==='okx'){
      var ro=await fetch(OKX_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({key:xk.key,secret:xk.secret,passphrase:xk.passphrase})});
      if(!ro.ok) throw new Error('OKX '+ro.status);
      var doo=await ro.json(); if(doo.error) throw new Error(doo.error);
      var det=(doo.data&&doo.data[0]&&doo.data[0].details)||[];
      var uo=det.find(function(c){ return c.ccy==='USDT'; });
      w.balance=parseFloat(parseFloat((uo&&uo.cashBal)||0).toFixed(2));
    } else {
      var r=await fetch(BINANCE_PROXY,{method:'POST',headers:exchangeProxyHeaders(),body:JSON.stringify({key:xk.key,secret:xk.secret})});
      if(!r.ok) throw new Error('Binance '+r.status);
      var d=await r.json(); var usdt=Array.isArray(d)?d.find(function(a){return a.asset==='USDT';}):null;
      w.balance=parseFloat((usdt?parseFloat(usdt.free||0)+parseFloat(usdt.locked||0)+parseFloat(usdt.freeze||0)+parseFloat(usdt.withdrawing||0):0).toFixed(2));
    }
  }
  w.updated=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); w.fetchedAt=Date.now();
  S.exchangeWalletsUpdatedAt=stamp(); save();
  return w.balance;
}
// Logo automatico por nombre: si el nombre contiene binance/bybit/okx/trezor/etc,
// usa ese logo. Devuelve null si no matchea (se cae al monograma).
var EXCHANGE_LOGOS=[
  {kw:'binance',src:'/logo-binance.png?v=3'},
  {kw:'bybit',  src:'/logo-bybit.png?v=2'},
  {kw:'okx',    src:'/logo-okx.png?v=2'},
  {kw:'trezor', src:'/logo-trezor.png?v=1'},
  {kw:'zinli',  src:'/logo-zinli.png?v=1'},
  {kw:'bdv',    src:'/logo-bdv.png?v=1'},
];
function exchangeLogoByName(name){
  var n=(name||'').toLowerCase();
  for(var i=0;i<EXCHANGE_LOGOS.length;i++){ if(n.indexOf(EXCHANGE_LOGOS[i].kw)>=0) return EXCHANGE_LOGOS[i].src; }
  return null;
}
async function autoFetchExchangeWallets(){
  var list=S.exchangeWallets||[];
  for(var i=0;i<list.length;i++){
    var w=list[i];
    if(w.type==='binance'&&!canFetchExchanges()) continue;
    var age=w.fetchedAt?Date.now()-w.fetchedAt:Infinity;
    if(w.balance!=null&&age<BINANCE_AUTO_MS) continue;
    try{ await fetchExchangeWallet(w); }catch(e){}
  }
  renderWallets(); renderSummary();
}
// Una vez: pasa Bibi (env del dueno) y Trezor (direccion) a exchangeWallets.
function migrateExchangeWallets(){
  if(S.exchangeMigrated) return;
  if(!S.exchangeWallets) S.exchangeWallets=[];
  var has=function(n){ return S.exchangeWallets.some(function(w){ return w.name===n; }); };
  if(S.trezorAddress&&/^0x[0-9a-fA-F]{40}$/.test(S.trezorAddress.trim())&&!has('Trezor')){
    S.exchangeWallets.push({id:Date.now(),name:'Trezor',type:'bsc',address:S.trezorAddress.trim(),balance:S.trezorBalance,updated:S.trezorUpdated,fetchedAt:null});
  }
  if((S.bibiBinanceKey&&S.bibiBinanceSecret)&&!has('Bibi')){
    S.exchangeWallets.push({id:Date.now()+1,name:'Bibi',type:'binance',key:S.bibiBinanceKey,secret:S.bibiBinanceSecret,balance:S.bibiBinanceBalance,updated:S.bibiBinanceUpdated,fetchedAt:null});
  }
  S.exchangeMigrated=1; S.exchangeWalletsUpdatedAt=stamp(); save();
}
function renderExchangeWallets(){
  var wrap=document.getElementById('xw-list'); if(!wrap) return;
  var list=S.exchangeWallets||[];
  var TYPE_LBL={binance:'Binance',bybit:'Bybit',okx:'OKX',bsc:'BSC'};
  wrap.innerHTML=list.length?list.map(function(w){
    var meta=w.type==='bsc'?('BSC '+(w.address||'').slice(0,10)+'…'):(TYPE_LBL[w.type]||w.type);
    var bal=w.balance!=null?('$'+w.balance):'—';
    return '<div class="xw-item"><span class="xw-nm">'+escHtml(w.name)+'</span><span class="xw-meta">'+meta+'</span><span class="xw-bal">'+bal+'</span><button class="btn btns" style="color:#E24B4A" onclick="removeExchangeWallet('+w.id+')">Eliminar</button></div>';
  }).join(''):'<p class="hint">Aun no agregaste wallets de exchange.</p>';
}
window.toggleXwFields=function(){
  var type=document.getElementById('xw-type').value;
  var b=document.getElementById('xw-binance-fields'), s=document.getElementById('xw-bsc-fields'), p=document.getElementById('xw-pass');
  // Binance/Bybit/OKX comparten los campos key/secret; solo BSC usa direccion.
  if(b) b.style.display=type==='bsc'?'none':'';
  if(s) s.style.display=type==='bsc'?'':'none';
  if(p) p.style.display=type==='okx'?'':'none';
};
window.addExchangeWallet=async function(){
  var st=document.getElementById('xw-status');
  var name=(document.getElementById('xw-name').value||'').trim();
  var type=document.getElementById('xw-type').value;
  if(!name){ if(st) st.textContent='Pon un nombre'; return; }
  var w={id:Date.now(),name:name,type:type,balance:null,updated:null,fetchedAt:null};
  if(type==='bsc'){
    var addr=(document.getElementById('xw-address').value||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(addr)){ if(st) st.textContent='Direccion 0x invalida'; return; }
    w.address=addr;
  } else {
    // Las credenciales van SOLO al almacen local del dispositivo, nunca a S.
    var _k=(document.getElementById('xw-key').value||'').trim();
    var _s=(document.getElementById('xw-secret').value||'').trim();
    if(!_k||!_s){ if(st) st.textContent='Faltan key/secret'; return; }
    var _p='';
    if(type==='okx'){
      _p=(document.getElementById('xw-pass').value||'').trim();
      if(!_p){ if(st) st.textContent='OKX necesita passphrase'; return; }
    }
    xkSet(w.id,{key:_k,secret:_s,passphrase:_p});
  }
  if(!S.exchangeWallets) S.exchangeWallets=[];
  S.exchangeWallets.push(w); S.exchangeWalletsUpdatedAt=stamp(); save();
  renderExchangeWallets(); renderWallets(); renderSummary();
  closeExchangeForm(); // cierre rapido; el balance aparece en la fila al resolver el fetch
  try{ await fetchExchangeWallet(w); }catch(e){ /* balance queda en — hasta el proximo refresh */ }
  renderExchangeWallets(); renderWallets(); renderSummary();
};
window.removeExchangeWallet=function(id){
  if(!confirm('Eliminar este wallet de exchange?')) return;
  S.exchangeWallets=(S.exchangeWallets||[]).filter(function(w){ return w.id!==id; });
  xkDel(id);
  S.exchangeWalletsUpdatedAt=stamp(); save();
  renderExchangeWallets(); renderWallets(); renderSummary();
};
// (Re)ingresar las keys en ESTE dispositivo para un wallet ya sincronizado
// (las keys no viajan en el doc; cada dispositivo que quiera refrescar las pide).
window.setExchangeKeys=async function(id){
  var w=(S.exchangeWallets||[]).find(function(x){ return x.id===id; });
  if(!w||w.type==='bsc') return;
  var rk=await appPrompt('API Key',escHtml(w.name),''); if(!rk||!rk.value.trim()) return;
  var rs=await appPrompt('API Secret',escHtml(w.name),''); if(!rs||!rs.value.trim()) return;
  var rp={value:''};
  if(w.type==='okx'){ rp=await appPrompt('Passphrase',escHtml(w.name),''); if(!rp||!rp.value.trim()) return; }
  xkSet(id,{key:rk.value.trim(),secret:rs.value.trim(),passphrase:(rp.value||'').trim()});
  try{ await fetchExchangeWallet(w); }catch(e){}
  renderWallets(); renderSummary();
};

function renderWallets(){
  var grid=document.getElementById('w-grid'); var cards=[];
  // Exchanges siempre visibles: no hay build-in, todo se agrega manualmente en Wallets.
  var showEx=true;
  var xwList=showEx?(S.exchangeWallets||[]):[];
  var xwTotal=xwList.reduce(function(s,w){ return s+(w.balance||0); },0);
  var apiTotal=showEx?xwTotal:0;
  var trackerNames=[];
  S.manualWallets.filter(function(w){ return w.trackerOnly; }).forEach(function(w){ if(trackerNames.indexOf(w.name)<0) trackerNames.push(w.name); });
  // Orden por balance, de mayor a menor.
  var _trkVal=function(n){ var mw=S.manualWallets.find(function(w){return w.name===n;}); return mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(n); };
  trackerNames.sort(function(a,b){ return _trkVal(b)-_trkVal(a); });
  var trackerTotal=trackerNames.reduce(function(s,n){ var mw=S.manualWallets.find(function(w){return w.name===n;}); return s+(mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(n)); },0);
  var manualNormal=manualNormalTotal();
  var grand=apiTotal+trackerTotal+manualNormal;
  // ── allocation bar data ──────────────────────────────────────────────
  // Each tracker wallet gets its own segment (palette avoids the exchange hues).
  var TRK_COLORS=['#A78BFA','#2DD4BF','#F472B6','#22D3EE','#84CC16','#F59E0B','#EC4899','#14B8A6'];
  var trkEntries=trackerNames.map(function(n,i){
    var mw=S.manualWallets.find(function(w){return w.name===n;});
    var v=mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(n);
    return {nm:n,v:v,col:TRK_COLORS[i%TRK_COLORS.length]};
  });
  var XW_COLS=['#FB923C','#60A5FA','#F472B6','#22D3EE','#A78BFA','#FBBF24'];
  var xwEntries=xwList.map(function(w,i){ return {nm:w.name,v:w.balance||0,col:XW_COLS[i%XW_COLS.length]}; });
  var wvA=xwEntries.concat(trkEntries).concat([
    {nm:'Cash',v:manualNormal,col:'#6B7280'}
  ]).filter(function(a){return a.v>0;}).sort(function(a,b){return b.v-a.v;});
  var wvBar=grand>0?wvA.map(function(a){return '<i style="width:'+(a.v/grand*100).toFixed(2)+'%;background:'+a.col+'"></i>';}).join(''):'';
  var wvLeg=wvA.map(function(a){return '<span class="wm-key"><i style="background:'+a.col+'"></i><span class="wm-key-nm">'+a.nm+'</span><b>'+(grand>0?(a.v/grand*100).toFixed(1):'0')+'%</b></span>';}).join('');

  // ── icon helpers ─────────────────────────────────────────────────────
  var icP='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var icX='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  function balHtml(v){ return '<span class="wm-bal">'+fmtUSD(v)+'</span>'; }
  function wmRow(color,mono,statusClass,name,meta,right,acts,logo){
    var st=statusClass?'<i class="wm-status '+statusClass+'"></i>':'';
    var chipInner=logo?'<img class="wm-logo" src="'+logo+'" alt="">':mono;
    var sel=acts?' onclick="selectWmRow(this)"':'';
    return '<div class="wm-row'+(acts?' has-acts':'')+'"'+sel+'><span class="wm-chip'+(logo?' has-logo':'')+'" style="--c:'+color+'">'+chipInner+st+'</span>'
      +'<div class="wm-rid"><span class="wm-name">'+name+'</span>'+(meta?'<span class="wm-meta">'+meta+'</span>':'')+'</div>'
      +right+'<span class="wm-acts" onclick="event.stopPropagation()">'+(acts||'')+'</span>'+'</div>';
  }
  function apiRow(color,mono,name,connected,balv,upd,metaExtra,logo){
    if(connected){
      var meta=(metaExtra?metaExtra:'')+(metaExtra&&upd?' · ':'')+(upd?'Updated '+upd:'');
      return wmRow(color,mono,balv!==null?'on':'off',name,meta||'Connected',balv!==null?balHtml(balv):'<span class="wm-bal" style="color:var(--txt3)">—</span>','',logo);
    }
    return wmRow(color,mono,'off',name,'Not connected','<button class="btn btns btnp wm-connect" onclick="showPage(\'settings\',null)">Connect</button>','',logo);
  }

  // ── Exchanges ─────────────────────────────────────────────────────────
  // Built-in (dueno) solo si estan conectados; + los wallets custom de cada usuario.
  function xwRow(w){
    var logo=exchangeLogoByName(w.name)||(w.type==='bsc'?null:'/logo-binance.png?v=3');
    var noKeys=w.type!=='bsc'&&!xkGet(w.id);
    var metaExtra=w.type==='bsc'?'BSC USDT':(noKeys?'Keys no estan en este dispositivo':'');
    var meta=metaExtra+(metaExtra&&w.updated?' · ':'')+(w.updated?'Updated '+w.updated:'');
    var right=w.balance!=null?balHtml(w.balance):'<span class="wm-bal" style="color:var(--txt3)">—</span>';
    var icK='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
    var acts=(noKeys?'<button class="wico" title="Ingresar API keys en este dispositivo" onclick="setExchangeKeys('+w.id+')">'+icK+'</button>':'')
      +'<button class="wico del" onclick="removeExchangeWallet('+w.id+')">'+icX+'</button>';
    return wmRow('#9B70F0',escHtml(w.name).slice(0,1).toUpperCase(),w.balance!=null?'on':'off',escHtml(w.name),meta||'Connected',right,acts,logo);
  }
  var exRows=!showEx?'':(xwList.map(xwRow).join('')
    ||'<p class="hint" style="padding:8px 4px">Aun no agregaste exchanges.</p>');

  // ── Trackers + Manual ─────────────────────────────────────────────────
  var trRows=trackerNames.map(function(name){
    var mw=S.manualWallets.find(function(w){return w.name===name;});
    var total=mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(name);
    var meta='<span class="wm-badge">tracker</span>';
    var right=balHtml(total);
    var acts='';
    if(mw){
      acts+='<button class="wico" onclick="editTrackerBal('+mw.id+')">'+icP+'</button>';
      acts+='<button class="wico del" onclick="deleteManualWallet('+mw.id+')">'+icX+'</button>';
    }
    var tlogo=walletLogo(name);
    return wmRow('#A78BFA',escHtml(name).slice(0,1).toUpperCase(),'',escHtml(name),meta,right,acts,tlogo);
  }).join('');
  // Orden por balance (en USD), de mayor a menor.
  var mnList=S.manualWallets.filter(function(w){return !w.trackerOnly;})
    .slice().sort(function(a,b){ return manualWalletUsd(b)-manualWalletUsd(a); });
  var mnRows=mnList.map(function(w){
    var acts='<button class="wico" onclick="editManualWalletBal('+w.id+')">'+icP+'</button><button class="wico del" onclick="deleteManualWallet('+w.id+')">'+icX+'</button>';
    var isVes=w.currency==='VES';
    var meta=isVes?('Bs '+(w.balance||0).toLocaleString('es-VE')+' · tasa '+(vesTxRateSrc()==='p2p'?'USDT':'BCV')):'Manual balance';
    return wmRow('#6B7280',escHtml(w.name).slice(0,1).toUpperCase(),'',escHtml(w.name),meta,balHtml(manualWalletUsd(w)),acts,walletLogo(w.name));
  }).join('');

  var manualNormalCount=S.manualWallets.filter(function(w){return !w.trackerOnly;}).length;
  var exCount=showEx?xwList.length:0;
  var walletCount=exCount+trackerNames.length+manualNormalCount;
  var notConn=0;

  function htile(lbl,val,col){
    var pct=grand>0?(val/grand*100).toFixed(1):'0';
    return '<div class="whtile"><span class="whtile-lbl"><i style="background:'+col+'"></i>'+lbl+'</span><span class="whtile-val">'+fmtUSD(val)+'</span><span class="whtile-sub">'+pct+'% of total</span></div>';
  }
  var wHtml=
    '<div class="wm-hero">'
      +'<div class="wm-hero-top">'
        +'<div class="wm-hero-id">'
          +'<div class="wm-hero-lbl">Total · All Wallets</div>'
          +'<div class="wm-hero-val">'+fmtUSD(grand)+'</div>'
          +'<div class="wm-hero-meta">'+walletCount+' wallets'+(notConn>0?' · '+notConn+' not connected':'')+'</div>'
        +'</div>'
        +'<div class="wm-hero-tiles">'
          +(showEx?htile('Exchanges',apiTotal,'#9B70F0'):'')
          +htile('Trackers',trackerTotal,'#2DD4BF')
          +htile('Manual',manualNormal,'#6B7280')
        +'</div>'
      +'</div>'
      +'<div class="wm-alloc">'+wvBar+'</div>'
      +'<div class="wm-viz">'
        +'<div class="wm-donut-wrap"><canvas id="wm-donut"></canvas></div>'
        +'<div class="wm-legend">'+wvLeg+'</div>'
      +'</div>'
    +'</div>'
    +'<div class="wm-cols '+(showEx?'wm-cols-3':'wm-cols-2')+'">'
      +(showEx?'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Exchanges</span><span class="wm-group-sum">'+fmtUSD(apiTotal)+'</span></div><div class="wm-rows">'+exRows+'</div><button class="wm-add" onclick="openExchangeForm()">+ Add exchange</button></div>':'')
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Trackers</span><span class="wm-group-sum">'+fmtUSD(trackerTotal)+'</span></div><div class="wm-rows">'+trRows+'</div><button class="wm-add" onclick="openWalletForm(\'tracker\')">+ Add wallet</button></div>'
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Manual</span><span class="wm-group-sum">'+fmtUSD(manualNormal)+'</span></div><div class="wm-rows">'+mnRows+'</div><button class="wm-add" onclick="openWalletForm(\'normal\')">+ Add wallet</button></div>'
    +'</div>';
  // Skip re-render when unchanged → no flicker / re-animation on tab return.
  if(wHtml!==_walletsSig){ grid.innerHTML=wHtml; _walletsSig=wHtml; }
  // Draw outside the signature guard: the first render happens while the page is
  // hidden (offsetParent null), so the donut must be (re)attempted on every visible render.
  drawWalletDonut(wvA, grand);
}
function drawWalletDonut(data, grand){
  var el=document.getElementById('wm-donut'); if(!el||el.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(function(){ drawWalletDonut(data,grand); }).catch(function(){}); return; }
  if(window.Chart.getChart(el)) return; // already drawn for this canvas (data unchanged)
  new Chart(el,{type:'doughnut',data:{labels:data.map(function(a){return a.nm;}),datasets:[{data:data.map(function(a){return parseFloat(a.v.toFixed(2));}),backgroundColor:data.map(function(a){return a.col;}),borderWidth:0,spacing:2}]},options:{cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return ctx.label+': '+fmtUSD(ctx.raw)+' ('+(grand>0?(ctx.raw/grand*100).toFixed(1):0)+'%)';}}}},animation:{animateRotate:true,duration:600},responsive:true,maintainAspectRatio:false}});
}


function populateWalletSelects(){
  var names=['Binance','Cash'];
  S.manualWallets.forEach(function(w){ if(names.indexOf(w.name)<0) names.push(w.name); });
  ['tx-wallet','tf-wallet'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    var cur=el.value; var isF=id.startsWith('tf');
    el.innerHTML=(isF?'<option value="">Wallet</option>':'')+names.map(function(n){ return '<option>'+n+'</option>'; }).join('');
    if(cur) el.value=cur;
  });
}

function parseDate(raw){ if(!raw) return null; var s=raw.trim(); var d=new Date(s); if(!isNaN(d.getTime())) return d.toISOString().slice(0,10); var m=s.match(/(\w+)\s+(\d+),?\s+(\d{4})/); if(m){ d=new Date(m[1]+' '+m[2]+' '+m[3]); if(!isNaN(d.getTime())) return d.toISOString().slice(0,10); } return null; }
function normCat(raw){ var c=(raw||'').toLowerCase();
  if(c==='income') return 'Income'; if(c==='home') return 'Home'; if(c==='groceries') return 'Groceries';
  if(c==='transport') return 'Transport'; if(c==='health') return 'Health'; if(c==='business') return 'Business';
  if(c==='discretionary') return 'Discretionary'; if(c==='support'||c.indexOf('help')>=0) return 'Support';
  if(c==='investments') return 'Investments'; if(c==='savings'||c.indexOf('emergency')>=0) return 'Savings';
  // legacy mappings for old imports
  if(c.indexOf('services')>=0) return 'Services'; if(c.indexOf('other')>=0) return 'Other';
  return raw||''; }

function loadPapa(){
  if(window.Papa) return Promise.resolve();
  if(window._papaPromise) return window._papaPromise;
  window._papaPromise=new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
    s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
  return window._papaPromise;
}
function handleCSV(file){
  if(!file) return;
  var result=document.getElementById('import-result');
  if(result) result.innerHTML='<div class="empty"><span class="spin"></span>Loading…</div>';
  loadPapa().then(function(){ _parseCSV(file); }).catch(function(){ if(result) result.innerHTML='<div class="empty" style="color:#E24B4A">Failed to load CSV parser</div>'; });
}
function _parseCSV(file){
  Papa.parse(file,{header:true,skipEmptyLines:true,dynamicTyping:false,complete:function(res){
    var rows=res.data; var result=document.getElementById('import-result');
    if(!rows.length){ result.innerHTML='<div class="empty">Empty CSV</div>'; return; }
    snapshot(); var added=0,skipped=0; var keys={};
    S.transactions.forEach(function(t){ keys[t.date+'|'+t.desc+'|'+t.amountUSD]=1; });
    rows.forEach(function(r){
      var date=parseDate(r['Date']||r['date']||'');
      var desc=(r['Description']||r['description']||'').trim();
      var wallet=(r['Wallet']||r['wallet']||'Binance').trim();
      var rawType=(r['Transaction']||r['transaction']||r['Type']||r['type']||'Debit').trim();
      var type=rawType==='Exchange'?'Debit':rawType;
      var cat=normCat((r['Category']||r['category']||'').trim());
      var amt=parseAmt(r['Amount']||r['amount']||r['USD']||r['usd']||'0');
      var isNotImported=String(r['Tracker']||r['tracker']||'')==='1';
      if(!date||!desc||!amt) return;
      var k=date+'|'+desc+'|'+amt; if(keys[k]){ skipped++; return; } keys[k]=1;
      S.transactions.push({id:Date.now()+Math.random(),seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amt,amountVES:null,originalCurrency:'USD',rateUsed:null,imported:!isNotImported,updatedAt:stamp()});
      added++;
    });
    if(added>0) S.transactionsUpdatedAt=stamp();
    save();
    result.innerHTML='<div style="background:var(--color-background-secondary);border-radius:7px;padding:1rem;margin-top:1rem;font-size:13px"><div style="color:#5DCAA5;margin-bottom:5px">Imported: '+added+'</div><div style="color:var(--color-text-secondary)">Skipped duplicates: '+skipped+'</div><button class="btn btnp btns" style="margin-top:9px" onclick="showPage(\'transactions\',null)">View transactions</button></div>';
    renderSummary();
  }});
}

function exportCSV(){
  if(!S.transactions.length){ alert('No data'); return; }
  var csv='Date,Description,Wallet,Transaction,Category,USD,VES Original,Tracker\n'+S.transactions.map(function(t){ return t.date+',"'+t.desc+'",'+(t.wallet||'')+','+t.type+','+t.category+','+t.amountUSD+','+(t.amountVES||'')+','+(t.imported?'0':'1'); }).join('\n');
  var a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='transactions_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
}

function exportAllJSON(){
  var a=document.createElement('a'); a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(S,null,2)); a.download='portfolio_backup_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
}

function importJSON(file){
  if(!file) return;
  var st=document.getElementById('json-status');
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var parsed=JSON.parse(e.target.result);
      if(!parsed.transactions&&!parsed.portfolio){ st.textContent='Invalid backup file.'; st.style.color='#E24B4A'; return; }
      if(!confirm('This will replace ALL current data with the backup. Continue?')) return;
      S=Object.assign({},S,parsed);
      // Re-estampar todo con un timestamp fresco para que el restore GANE el
      // last-writer-wins del servidor; si no, el merge autoritativo conserva la
      // nube (mas nueva) y el restore se revierte solo en el siguiente pull.
      var n=stamp();
      tsFields().forEach(function(f){ S[f]=n; });
      if(Array.isArray(S.transactions)) S.transactions.forEach(function(t){ t.updatedAt=n; });
      save(); populateWalletSelects(); updateRateUI(); renderSummary();
      st.textContent='Restored: '+(S.transactions||[]).length+' transactions, '+(S.portfolio||[]).length+' holdings.';
      st.style.color='#5DCAA5';
      document.getElementById('json-inp').value='';
    }catch(err){ st.textContent='Error: '+err.message; st.style.color='#E24B4A'; }
  };
  reader.readAsText(file);
}

function clearAll(){ if(confirm('Delete ALL data? This cannot be undone.')){ _slDisabled=true; flushSaveLocal(); localStorage.removeItem('ft13'); location.reload(); } }

var _pageInTimer=null;
function showPage(id,btn,arg){
  var pages=['summary','transactions','budget','wallets','holdings','tools','settings','import','history'];
  if(pages.indexOf(id)<0) id='summary';
  // Cambiar de tab cierra cualquier bottom-sheet abierto (en mobile quedaban
  // flotando sobre la tab nueva).
  try{
    if(document.getElementById('tx-form-panel').classList.contains('open')) closeTxForm();
    if(document.getElementById('wv-form-panel').classList.contains('open')) closeWalletForm();
    var _xwp=document.getElementById('xw-form-panel');
    if(_xwp&&_xwp.classList.contains('open')) closeExchangeForm();
  }catch(e){}
  document.querySelectorAll('.page.active').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nb.active,#mob-settings-btn.active').forEach(function(b){ b.classList.remove('active'); });
  var target=document.getElementById('page-'+id);
  // Restart the cheap CSS enter animation each navigation (no View Transition snapshot cost).
  target.classList.remove('page-in'); void target.offsetWidth; target.classList.add('active','page-in');
  // Quitar page-in al terminar las animaciones de entrada: los re-renders por
  // sync/ediciones (innerHTML nuevo) ya no re-disparan fadeUp/barGrow en cada tick.
  clearTimeout(_pageInTimer);
  _pageInTimer=setTimeout(function(){ target.classList.remove('page-in'); },700);
  document.querySelectorAll('.nb[onclick*="\''+id+'\'"],#mob-settings-btn[onclick*="\''+id+'\'"]').forEach(function(b){ b.classList.add('active'); });
  if(btn) btn.classList.add('active');
  // Reflect the tab in the URL WITHOUT stacking history entries, so the back
  // button is reserved for closing an open sheet (not bouncing between tabs).
  try{ history.replaceState(null,'','#'+id); }catch(e){ window.location.hash=id; }
  var fab=document.getElementById('fab-add');
  if(fab) fab.style.display=(id==='transactions'?'flex':'none');
  if(id==='summary') renderSummary();
  else if(id==='transactions') renderTx();
  else if(id==='budget') renderBudget();
  else if(id==='wallets') renderWallets();
  else if(id==='holdings'){ renderOnchainWallets(); renderWalletHoldings(); }
  else if(id==='tools'){ renderToolToggles(); renderToolGears(); renderBdvLimits(); fitAllCalcVals(); }
  else if(id==='history') renderHistory(arg||'snapshots');
  else if(id==='settings'){ var ae=document.getElementById('acct-email'); if(ae) ae.textContent=sbGet('sb_email')||''; }
  var sb=document.querySelector('.sb'); if(sb) sb.classList.remove('open');
  var ov=document.getElementById('overlay'); if(ov) ov.classList.remove('open');
  document.body.classList.remove('nav-open');
}
window._historyView='snapshots';
function renderHistory(view){
  window._historyView=view||'snapshots';
  var titleEl=document.getElementById('history-title');
  var wrap=document.getElementById('history-wrap');
  if(!wrap) return;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(snaps.length===0){
    if(titleEl) titleEl.textContent='History';
    wrap.innerHTML='<div class="cw"><div style="text-align:center;color:var(--color-text-secondary);padding:2rem">No snapshots yet</div></div>';
    return;
  }
  var firstTotal=snaps[0].total;
  // Build period data for each snapshot (P&L vs previous)
  var rows=snaps.map(function(s,i){
    var prev=i>0?snaps[i-1]:null;
    var profit=null, pct=null, invOut=0, invIn=0;
    if(prev){
      var f=investmentFlow(prev,s);
      invOut=f.invOut; invIn=f.invIn;
      profit=(s.total-prev.total)+invOut-invIn;
      pct=prev.total>0?(profit/prev.total)*100:null;
    }
    var cumDelta=s.total-firstTotal;
    var cumPct=firstTotal>0?(cumDelta/firstTotal)*100:0;
    return {s:s,prev:prev,profit:profit,pct:pct,invOut:invOut,invIn:invIn,cumDelta:cumDelta,cumPct:cumPct};
  });

  rows.reverse();

  if(titleEl) titleEl.textContent='Snapshot History';

  function cls(v){ return v>0?'up':v<0?'down':'flat'; }
  function sgn(v){ return v>0?'+':v<0?'-':''; }
  function adjLine(r){
    var parts=[];
    if(r.invOut>0) parts.push('<span style="color:#EF9F27">Invested '+fmtUSD(r.invOut)+'</span>');
    if(r.invIn>0)  parts.push('<span style="color:#60A5FA">Returned '+fmtUSD(r.invIn)+'</span>');
    return parts.length?'<span class="snap-adj">'+parts.join(' · ')+'</span>':'';
  }
  var PENCIL='<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg>';
  var XICO='<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>';

  var html='';
  {
    var latest=snaps[snaps.length-1];
    var totDelta=latest.total-firstTotal;
    var totPct=firstTotal>0?(totDelta/firstTotal)*100:0;
    html+='<div class="snap-hero">'
      +'<div class="snap-hero-main">'
        +'<div class="snap-hero-lbl">Latest Net Worth</div>'
        +'<div class="snap-hero-val">'+fmtUSD(latest.total)+'</div>'
        +'<div class="snap-hero-meta">'+snaps.length+' snapshots · '+snaps[0].date+' → '+latest.date+'</div>'
      +'</div>'
      +'<div class="snap-hero-delta '+cls(totDelta)+'">'+sgn(totDelta)+fmtUSD(Math.abs(totDelta))+' · '+sgn(totPct)+Math.abs(totPct).toFixed(1)+'%</div>'
    +'</div>';
  }

  function fmtMd(d){ return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  html+='<div class="snap-list">';
  html+='<div class="snap-row snap-head-row">'
    +'<div class="snap-col-date">Date</div>'
    +'<div class="snap-col-nw">Net Worth</div>'
    +'<div class="snap-col-pnl">P&L</div>'
    +'<div class="snap-col-pct">P&L %</div>'
    +'<div class="snap-col-cum">Cumulative</div>'
    +'<div class="snap-col-acts"></div>'
  +'</div>';
  rows.forEach(function(r){
    var pnlCell,pctCell;
    if(r.profit!==null){
      pnlCell='<span class="snap-chip '+cls(r.profit)+'">'+sgn(r.profit)+fmtUSD(Math.abs(r.profit))+'</span>';
      pctCell='<span class="snap-pct '+cls(r.profit)+'">'+sgn(r.pct)+Math.abs(r.pct).toFixed(2)+'%</span>';
    } else {
      pnlCell='<span class="snap-chip flat">Baseline</span>';
      pctCell='<span class="snap-pct flat">—</span>';
    }
    var cumCell='<span class="snap-cum '+cls(r.cumDelta)+'">'+sgn(r.cumDelta)+fmtUSD(Math.abs(r.cumDelta))+' <span class="snap-cum-pct">('+sgn(r.cumPct)+Math.abs(r.cumPct).toFixed(1)+'%)</span></span>';
    html+='<div class="snap-row">'
      +'<div class="snap-col-date"><span class="snap-d">'+fmtMd(r.s.date)+'</span>'+adjLine(r)+'</div>'
      +'<div class="snap-col-nw"><span class="snap-total">'+fmtUSD(r.s.total)+'</span></div>'
      +'<div class="snap-col-pnl">'+pnlCell+'</div>'
      +'<div class="snap-col-pct">'+pctCell+'</div>'
      +'<div class="snap-col-cum">'+cumCell+'</div>'
      +'<div class="snap-col-acts snap-acts"><button class="wico" title="Edit" onclick="editSnapshot('+r.s.id+')">'+PENCIL+'</button><button class="wico del" title="Delete" onclick="deleteSnapshotFromHistory('+r.s.id+')">'+XICO+'</button></div>'
    +'</div>';
  });
  html+='</div>';
  wrap.innerHTML=html;
}
window.renderHistory=renderHistory;
async function deleteSnapshotFromHistory(id){
  await deleteSnapshot(id); // sin await, la lista se re-renderizaba antes del confirm y el borrado no se veia
  renderHistory(window._historyView||'snapshots');
}
window.deleteSnapshotFromHistory=deleteSnapshotFromHistory;

// Expose functions needed by inline HTML event handlers
function toggleSidebar(){
  var sb=document.querySelector('.sb'); if(sb) sb.classList.toggle('open');
  var ov=document.getElementById('overlay'); if(ov) ov.classList.toggle('open');
  document.body.classList.toggle('nav-open');
}
window.toggleSidebar = toggleSidebar;
window.showPage = showPage;
function setTxTab(btn,val){ document.getElementById('tf-type').value=val; document.querySelectorAll('.ttt').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active'); renderTx(); }
function toggleTxFilters(){ document.getElementById('tx-filters-extra').classList.toggle('open'); }
// Movil: la lupa despliega el campo de busqueda; al cerrarlo, limpia el filtro.
function toggleTxSearch(){
  var i=document.getElementById('tf-search');
  if(i.classList.toggle('open')){ i.focus(); }
  else if(i.value){ i.value=''; renderTx(); }
}
window.setTxTab=setTxTab; window.toggleTxFilters=toggleTxFilters; window.toggleTxSearch=toggleTxSearch;
window.fetchRate = fetchRate;
window.addTx = addTx;
window.deleteTx = deleteTx;
window.editTx = editTx;
window.selectTxRow = function(el){
  document.querySelectorAll('.tx-row.tx-sel').forEach(function(r){ if(r!==el) r.classList.remove('tx-sel'); });
  el.classList.toggle('tx-sel');
};
if(!window._txSelListener){
  window._txSelListener=true;
  document.addEventListener('click',function(e){ if(!e.target.closest('.tx-row')) document.querySelectorAll('.tx-sel').forEach(function(r){ r.classList.remove('tx-sel'); }); });
}
window.selectWmRow = function(el){
  document.querySelectorAll('.wm-row.wm-sel').forEach(function(r){ if(r!==el) r.classList.remove('wm-sel'); });
  el.classList.toggle('wm-sel');
};
if(!window._wmSelListener){
  window._wmSelListener=true;
  document.addEventListener('click',function(e){ if(!e.target.closest('.wm-row')) document.querySelectorAll('.wm-sel').forEach(function(r){ r.classList.remove('wm-sel'); }); });
}
// Touch: tapping an already-open base-select reopens it after light-dismiss; close instead
if(!window._selToggleFix){
  window._selToggleFix=true;
  document.addEventListener('pointerdown',function(e){
    var sel=e.target.closest&&e.target.closest('select');
    if(!sel||!sel.closest('#tx-form-panel')) return;
    if(e.target.tagName==='OPTION'||(e.target.closest&&e.target.closest('option'))) return;
    if(sel.matches(':open')){ e.preventDefault(); }
  },true);
}
// Keep the focused tx-form field visible when the mobile keyboard opens
if(!window._txScrollListener){
  window._txScrollListener=true;
  var _txPanel=document.getElementById('tx-form-panel');
  if(_txPanel) _txPanel.addEventListener('focusin',function(e){
    var t=e.target;
    if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'||t.tagName==='TEXTAREA')){
      setTimeout(function(){ t.scrollIntoView({behavior:'smooth',block:'center'}); },300);
    }
  });
}
// Back button / system back closes an open bottom-sheet instead of leaving the page
if(!window._sheetBackListener){
  window._sheetBackListener=true;
  window.addEventListener('popstate',function(){
    var s=window._activeSheet;
    window._activeSheet=null;
    var txOpen=document.getElementById('tx-form-panel').classList.contains('open');
    var wvOpen=document.getElementById('wv-form-panel').classList.contains('open');
    var _xwp=document.getElementById('xw-form-panel');
    var xwOpen=_xwp&&_xwp.classList.contains('open');
    if(s==='tx'||txOpen) closeTxForm(true);
    else if(s==='wallet'||wvOpen) closeWalletForm(true);
    else if(s==='exchange'||xwOpen) closeExchangeForm(true);
  });
}
// Web: ESC cierra el form de tx (nueva o edicion). Solo actua si esta abierto.
if(!window._txEscListener){
  window._txEscListener=true;
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    if(document.getElementById('tx-form-panel').classList.contains('open')) closeTxForm();
    var _xwp=document.getElementById('xw-form-panel');
    if(_xwp&&_xwp.classList.contains('open')) closeExchangeForm();
  });
}
// Atajos de teclado (web): N nueva tx, / buscar, 1-7 tabs. No actuan mientras
// se escribe en un campo ni con el login abierto.
if(!window._kbShortcuts){
  window._kbShortcuts=true;
  document.addEventListener('keydown',function(e){
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    var t=e.target;
    if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
    var auth=document.getElementById('auth-overlay'); if(auth&&auth.classList.contains('open')) return;
    if(e.key==='n'||e.key==='N'){ e.preventDefault(); showPage('transactions',null); openTxForm(); }
    else if(e.key==='/'){ e.preventDefault(); showPage('transactions',null); var sIn=document.getElementById('tf-search'); if(sIn) sIn.focus(); }
    else { var tabs={'1':'summary','2':'transactions','3':'budget','4':'wallets','5':'holdings','6':'tools','7':'settings'}; if(tabs[e.key]) showPage(tabs[e.key],null); }
  });
}

// Swipe-down to dismiss the bottom-sheet (only when scrolled to the top of the panel)
function attachSheetDrag(panel, closeFn){
  if(!panel||panel._dragBound) return; panel._dragBound=true;
  var startY=0, lastY=0, dragging=false;
  panel.addEventListener('touchstart',function(e){
    var t=e.target;
    if(panel.scrollTop>0 || (t.closest&&t.closest('input,select,textarea,button,.preset-chip,.date-field,.receipt-attach'))){ dragging=false; return; }
    startY=lastY=e.touches[0].clientY; dragging=true;
    panel.style.transition='none';
  },{passive:true});
  panel.addEventListener('touchmove',function(e){
    if(!dragging) return;
    lastY=e.touches[0].clientY;
    var dy=lastY-startY;
    if(dy<=0 || panel.scrollTop>0){ panel.style.transform=''; return; }
    panel.style.transform='translate3d(-50%,'+dy+'px,0)';
  },{passive:true});
  function end(){
    if(!dragging) return; dragging=false;
    var dy=lastY-startY;
    panel.style.transition='';
    panel.style.transform='';
    if(dy>120) closeFn();
  }
  panel.addEventListener('touchend',end);
  panel.addEventListener('touchcancel',end);
}
attachSheetDrag(document.getElementById('tx-form-panel'), function(){ closeTxForm(); });
attachSheetDrag(document.getElementById('wv-form-panel'), function(){ closeWalletForm(); });
attachSheetDrag(document.getElementById('xw-form-panel'), function(){ closeExchangeForm(); });
// Keep the open bottom-sheet above the on-screen keyboard so the whole form stays scrollable
if(window.visualViewport && !window._vvSheetBound){
  window._vvSheetBound=true;
  var _vv=window.visualViewport;
  function adjustSheetForKeyboard(){
    var panel=document.querySelector('.tx-form-panel.open');
    if(!panel) return;
    var overlap=Math.max(0, window.innerHeight-(_vv.height+_vv.offsetTop));
    if(overlap>80){ panel.style.bottom=overlap+'px'; panel.style.maxHeight=(_vv.height-12)+'px'; }
    else { panel.style.bottom=''; panel.style.maxHeight=''; }
  }
  _vv.addEventListener('resize',adjustSheetForKeyboard);
  _vv.addEventListener('scroll',adjustSheetForKeyboard);
}
window.selectWvRow = function(el){
  document.querySelectorAll('.wv-row.wv-exp').forEach(function(r){ if(r!==el) r.classList.remove('wv-exp'); });
  el.classList.toggle('wv-exp');
};
if(!window._wvSelListener){
  window._wvSelListener=true;
  document.addEventListener('click',function(e){ if(!e.target.closest('.wv-row')) document.querySelectorAll('.wv-exp').forEach(function(r){ r.classList.remove('wv-exp'); }); });
}
window.onReceiptPick = onReceiptPick;
window.removeReceipt = removeReceipt;
window.toggleReceiptMenu = toggleReceiptMenu;
window.pickReceipt = pickReceipt;
window.updateDateDisplay = updateDateDisplay;
window.openReceipt = function(url){
  var ov=document.getElementById('receipt-lightbox');
  if(!ov){
    ov=document.createElement('div'); ov.id='receipt-lightbox'; ov.className='receipt-lightbox';
    ov.onclick=function(){ ov.classList.remove('open'); };
    ov.innerHTML='<img alt="">';
    document.body.appendChild(ov);
  }
  ov.querySelector('img').src=url;
  ov.classList.add('open');
};
window.addTxOrUpdate = addTxOrUpdate;
window.cancelEditTx = cancelEditTx;
window.openTxForm = openTxForm;
window.closeTxForm = closeTxForm;
window.openWalletForm = openWalletForm;
window.closeWalletForm = closeWalletForm;
window.toggleWmBalField = toggleWmBalField;
window.doUndo = doUndo;
window.doRedo = doRedo;
window.exportCSV = exportCSV;
window.clearAllTx = clearAllTx;
window.renderTx = renderTx;
window.toggleVesHint = toggleVesHint;
window.updateVesPreview = updateVesPreview;
window.renderSummary = renderSummary;
window.renderBudget = renderBudget;
window.saveBudget = saveBudget;
window.saveManualWallet = saveManualWallet;
window.deleteManualWallet = deleteManualWallet;
window.saveOnchainWallet = saveOnchainWallet;
window.deleteOnchainWallet = deleteOnchainWallet;
window.copyAddr = copyAddr;
window.renderWallets = renderWallets;
window.refreshWalletHoldings = refreshWalletHoldings;
window.forcePull = forcePull;
window.forcePush = forcePush;
window.exportAllJSON = exportAllJSON;
window.importJSON = importJSON;
window.clearAll = clearAll;
window.handleCSV = handleCSV;
window.save = save;


// ── BDV Monthly Limits ───────────────────────────────────────────────
function bdvLimitsState(){ if(!Array.isArray(S.bdvLimits)) S.bdvLimits=[]; return S.bdvLimits; }
function bdvInitVirtual(){ return 10000; }
function bdvInitFisica(name){ return String(name).trim().toLowerCase()==='jesusg'?10000:5000; }
function _bdvFind(id){ return bdvLimitsState().filter(function(n){ return n.id===id; })[0]; }
function renderBdvLimits(){
  var wrap=document.getElementById('bdvl-list'); if(!wrap) return;
  var list=bdvLimitsState();
  if(!list.length){ wrap.innerHTML='<div class="bdvl-empty">No names yet. Add one below.</div>'; return; }
  function stepper(id,key,val,on){
    if(!on) return '<span class="bdvl-off">Off</span>';
    return '<div class="bdvl-step">'
      +'<button class="bdvl-pm" onclick="bdvAdj('+id+',\''+key+'\',-500)">&#8722;</button>'
      +'<input class="bdvl-amt" type="number" step="500" value="'+(val||0)+'" onchange="bdvSet('+id+',\''+key+'\',this.value)">'
      +'<button class="bdvl-pm" onclick="bdvAdj('+id+',\''+key+'\',500)">+</button>'
    +'</div>';
  }
  wrap.innerHTML=list.map(function(n){
    return '<div class="bdvl-card">'
      +'<div class="bdvl-card-head"><span class="bdvl-name" onclick="renameBdvLimit('+n.id+')">'+escHtml(n.name)+'</span>'
        +'<button class="wico del" onclick="deleteBdvLimit('+n.id+')" title="Delete">&#10005;</button></div>'
      +'<div class="bdvl-opt"><span class="bdvl-opt-lbl">Virtual</span>'+stepper(n.id,'virtual',n.virtual,true)+'</div>'
      +'<div class="bdvl-opt"><button class="bdvl-toggle'+(n.fisicaOn?' on':'')+'" onclick="toggleBdvFisica('+n.id+')">Fisica</button>'+stepper(n.id,'fisica',n.fisica,!!n.fisicaOn)+'</div>'
    +'</div>';
  }).join('');
}
window.renderBdvLimits=renderBdvLimits;
// Every mutation stamps bdvLimitsUpdatedAt so cloud sync does correct last-writer-wins.
function bdvSave(){ S.bdvLimitsUpdatedAt=stamp(); save(); renderBdvLimits(); }
window.bdvAdj=function(id,key,delta){ var n=_bdvFind(id); if(!n) return; n[key]=Math.max(0,(n[key]||0)+delta); bdvSave(); };
window.bdvSet=function(id,key,val){ var n=_bdvFind(id); if(!n) return; var v=parseFloat(val); n[key]=isNaN(v)?0:Math.max(0,v); bdvSave(); };
window.toggleBdvFisica=function(id){ var n=_bdvFind(id); if(!n) return; n.fisicaOn=!n.fisicaOn; bdvSave(); };
window.addBdvLimit=async function(){ var r=await appPrompt('Add name','Name for the new entry','',{inputType:'text'}); if(!r||!r.value||!r.value.trim()) return; var nm=r.value.trim(); bdvLimitsState().push({id:Date.now(),name:nm,virtual:bdvInitVirtual(),fisica:bdvInitFisica(nm),fisicaOn:true}); bdvSave(); };
window.resetBdvLimits=async function(){ var list=bdvLimitsState(); if(!list.length) return; var ok=await appConfirm('Reset all limits?','Sets every Virtual to '+fmtUSD(bdvInitVirtual())+' and Fisica to its initial amount.','Reset'); if(!ok) return; list.forEach(function(n){ n.virtual=bdvInitVirtual(); n.fisica=bdvInitFisica(n.name); }); bdvSave(); };
window.renameBdvLimit=async function(id){ var n=_bdvFind(id); if(!n) return; var r=await appPrompt('Rename',escHtml(n.name),n.name,{inputType:'text'}); if(!r||!r.value||!r.value.trim()) return; n.name=r.value.trim(); bdvSave(); };
window.deleteBdvLimit=async function(id){ var n=_bdvFind(id); if(!n) return; var ok=await appConfirm('Delete name?',escHtml(n.name),'Delete'); if(!ok) return; S.bdvLimits=bdvLimitsState().filter(function(x){ return x.id!==id; }); bdvSave(); };

window.autofillFromNote = autofillFromNote;
window.recordSnapshot = recordSnapshot;
window.saveGoal = saveGoal;
window.deleteSnapshot = deleteSnapshot;

// ── Migraciones ordenadas ────────────────────────────────────────────────────
// Una sola puerta: S.schemaVersion marca hasta cual corrio este doc. Cada entrada
// debe ser IDEMPOTENTE (los flags viejos zelleMigrated/budgetPctMigrated se siguen
// respetando para docs pre-schemaVersion). Para agregar una migracion: append con
// v siguiente; corre una vez por doc, en orden, tras el pull inicial.
var MIGRATIONS=[
  { v:1, fn:function(){ // Zelle deja de ser especial → wallet tracker 'Emily'
    if(S.zelleMigrated) return;
    var zTx=S.transactions.filter(function(t){ return t.wallet==='Zelle'||t.category==='Emily'; });
    if(zTx.length){
      if(!S.manualWallets.some(function(w){ return w.name==='Emily'; })){
        S.manualWallets.push({id:Date.now(),name:'Emily',trackerOnly:true,balance:0,balanceOverride:null});
        S.manualWalletsUpdatedAt=stamp();
      }
      zTx.forEach(function(t){ if(t.wallet==='Zelle') t.wallet='Emily'; if(t.category==='Emily') t.category=''; t.updatedAt=stamp(); });
      S.transactionsUpdatedAt=stamp();
    }
    S.zelleMigrated=1;
  }},
  { v:2, fn:function(){ // limites de budget: USD fijos → % del Monthly Total
    if(S.budgetPctMigrated) return;
    var cb=S.categoryBudgets||{};
    if(Object.keys(cb).length&&S.budgetTotal>0&&!Object.keys(S.categoryBudgetPcts||{}).length){
      if(!S.categoryBudgetPcts) S.categoryBudgetPcts={};
      Object.keys(cb).forEach(function(c){ if(cb[c]>0) S.categoryBudgetPcts[c]=parseFloat((cb[c]/S.budgetTotal*100).toFixed(1)); });
      S.categoryBudgetPctsUpdatedAt=stamp();
    }
    S.budgetPctMigrated=1;
  }},
  { v:3, fn:function(){ // balanceOverride congelado → rebase a base viva
    var frozen=S.manualWallets.filter(function(w){ return w.trackerOnly&&w.balanceOverride!=null; });
    if(!frozen.length) return;
    frozen.forEach(function(w){ var txBal=calcTrackerBal(w.name)-(w.balance||0); w.balance=parseFloat((w.balanceOverride-txBal).toFixed(2)); w.balanceOverride=null; });
    S.manualWalletsUpdatedAt=stamp();
  }},
];
function runMigrations(){
  var cur=S.schemaVersion||0, ran=false;
  MIGRATIONS.forEach(function(m){
    if(m.v<=cur) return;
    try{ m.fn(); }catch(e){ console.error('migration v'+m.v+':',e); }
    ran=true;
  });
  // v3 (override rebase) debe correr en cada boot mientras existan overrides
  // (pueden llegar de un doc viejo via sync); por eso no se salta por version.
  if(cur>=3){ try{ MIGRATIONS[2].fn(); }catch(e){} }
  if(ran||cur<MIGRATIONS[MIGRATIONS.length-1].v){
    S.schemaVersion=MIGRATIONS[MIGRATIONS.length-1].v;
    save();
  }
}

async function init(){
  loadLocal();
  initTools({ getState:function(){ return S; }, save:save, stamp:stamp });
  // Restaurar la tab del hash YA, con los datos locales: antes se hacia recien en
  // bootAfterAuth (despues del pull) y el Dashboard parpadeaba unos segundos.
  // OJO: no tocar el hash de login (#access_token=...) — showPage lo reescribiria
  // antes de que sbConsumeHashSession lo lea.
  var _h0=(location.hash||'').replace('#','');
  if(_h0&&_h0.indexOf('access_token')<0) showPage(_h0,null);
  var today=localToday();
  document.getElementById('tx-date').value=today;
  populateTxMonth(); // default: All months (value queda '')
  document.getElementById('tf-search').addEventListener('input', function(){ clearTimeout(_srchTimer); _srchTimer=setTimeout(renderTx,220); });
  // Restaurar el Profit Calculator ANTES de updateRateUI: el autofill de pc-buy
  // dispara calcProfit(), y con los campos vacios pisaria S.profitCalc.
  if(!S.profitCalc||(!S.profitCalc.sell&&!S.profitCalc.amount&&!S.profitCalc.fee)){
    try{ var _pc=JSON.parse(localStorage.getItem('ft13_pc')||'{}'); if(_pc.sell||_pc.amount){ S.profitCalc={sell:_pc.sell||'',amount:_pc.amount||'',fee:''}; S.profitCalcUpdatedAt=stamp(); } }catch(e){}
  }
  if(!S.p2pCalc||S.p2pCalc.fee==null){
    try{ var _p2f=localStorage.getItem('ft13_p2pc'); if(_p2f){ S.p2pCalc=Object.assign({},S.p2pCalc,{fee:_p2f}); S.p2pCalcUpdatedAt=stamp(); } }catch(e){}
  }
  restoreProfitCalc();
  populateWalletSelects(); updateRateUI(); toggleWmBalField();
  if(!navigator.onLine){ setSyncStatus('offline','Offline'); }
  // Si viene de un enlace de correo, la sesion llega en el fragmento → login directo.
  var justLinked=sbConsumeHashSession();
  // Requiere sesion valida antes de sincronizar. Sin token o refresh fallido → login.
  var authed=justLinked||(sbGet('sb_at') ? await sbRefresh() : false);
  if(!authed){ showAuthOverlay(); return; }
  hideAuthOverlay();
  await bootAfterAuth(justLinked);
}
// Todo lo que necesita la sesion lista: pull inicial, migraciones, render, timers.
// Separado de init para poder llamarlo justo despues del login sin re-enganchar
// los listeners de una-sola-vez que quedan en init.
async function bootAfterAuth(firstLogin){
  var pulled=await pullFromCloud();
  if(pulled){ populateWalletSelects(); updateRateUI(); }
  // Cambios locales sin pushear de una sesion anterior (cerro la app offline):
  // el pull respeta LWW asi que no se pisaron, ahora los propagamos a la nube.
  if(localStorage.getItem('ft13_dirty')){ _dirty=true; pushToCloud(); }
  // Primer login multi-usuario: sube el estado local (migracion de tus datos al
  // row de tu usuario). El merge del servidor evita cualquier clobber.
  if(firstLogin){ _dirty=true; pushToCloud(); }
  runMigrations();
  if(S.binanceKey){ var bk=document.getElementById('bn-key'); if(bk) bk.value=S.binanceKey; }
  if(S.binanceSecret){ var bs=document.getElementById('bn-secret'); if(bs) bs.value=S.binanceSecret; }
  var hash=(window.location.hash||'').replace('#','');
  // La tab del hash ya se activo en init() (antes del pull). Re-navegarla aqui
  // re-disparaba la animacion de entrada (doble render visible al recargar);
  // si ya estamos en ella, solo refrescar su contenido con los datos del pull.
  if(_activePageId()!==(hash||'summary')) showPage(hash||'summary', null);
  else afterPull();
  fetchRate(false);
  // USDT: cada 5 min con la pestana visible (ahorra invocaciones Vercel; el
  // refetch al volver el foco/visibilidad cubre el timer congelado en mobile).
  fetchUsdtRate(); setInterval(function(){ if(!document.hidden) fetchUsdtRate(); }, 5*60*1000);
  migrateExchangeWallets(); stripExchangeSecrets(); renderExchangeWallets();
  renderOnchainWallets();
  fetchWalletHoldings().then(function(){ renderWalletHoldings(); }).catch(function(){});
  fetchCoinPrices().then(function(){ renderManualHoldings(); renderEquityChart(); }).catch(function(){});
  // buy y fee NO se restauran: buy lo llena la tasa Intervencion (updateRateUI) y fee arranca vacio.
  restoreProfitCalc(); // de nuevo tras el pull: la nube puede traer valores mas nuevos
  applyRecurring();
  renderToolToggles(); renderToolGears(); renderBdvLimits(); calcProfit(); calcSpread(); calcBCVEmily();
  autoFetchExchangeWallets();
  scheduleRateRefresh(); // refresco adaptativo del rate (ver rateRefreshDelay)
  setInterval(function(){ autoFetchExchangeWallets(); }, BINANCE_AUTO_MS);
  setInterval(function(){ fetchCoinPrices().then(function(){ renderManualHoldings(); renderEquityChart(); }).catch(function(){}); }, COINPRICE_AUTO_MS);
  // Keep an open, focused tab fresh without a reload: poll the cloud every 25s
  // (autoPull no-ops when hidden, offline, or holding unsynced local edits).
  _pullTimer=setInterval(autoPull, 25000);
  // Pull immediately whenever the tab regains focus or visibility, y corre las
  // recurrentes por si una pestana quedo abierta cruzando el dia de cobro.
  window.addEventListener('focus', function(){ fetchUsdtRate(); autoPull().then(applyRecurring); });
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden){ fetchUsdtRate(); autoPull().then(function(){ applyRecurring(); autoFetchExchangeWallets(); fetchCoinPrices().then(function(){ renderManualHoldings(); renderEquityChart(); }).catch(function(){}); }); }
  });
}
init();

if('serviceWorker' in navigator){
  var _isLocal=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if(_isLocal){
    // Dev: never let a cached SW serve a stale bundle. Unregister + drop caches.
    navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); });
    if(window.caches) caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); });
  } else {
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      if(!reg) return;
      // Toast de nueva version: el SW nuevo se activa solo (skipWaiting en sw.js);
      // avisamos para recargar en vez de dejar a la pestana con el bundle viejo.
      reg.addEventListener('updatefound', function(){
        var nw=reg.installing; if(!nw) return;
        nw.addEventListener('statechange', function(){
          if(nw.state==='activated'&&navigator.serviceWorker.controller) showUpdateToast();
        });
      });
      // PWA abierta dias: el navegador solo chequea el SW al navegar. Chequeo cada
      // 5 min + al volver a la pestana. sw.js es estatico (CDN, ~2KB): no gasta
      // invocaciones de Vercel.
      setInterval(function(){ if(!document.hidden) reg.update().catch(function(){}); }, 5*60*1000);
      document.addEventListener('visibilitychange', function(){ if(!document.hidden) reg.update().catch(function(){}); });
    }).catch(function(){});
  }
}
function showUpdateToast(){
  if(document.getElementById('sw-toast')) return;
  var b=document.createElement('div'); b.id='sw-toast'; b.className='sync-banner show';
  b.innerHTML='<span>⬆ Nueva version disponible.</span><button onclick="location.reload()">Actualizar</button>';
  document.body.appendChild(b);
}

// PWA install prompt
var _pwaPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();
  _pwaPrompt=e;
  var btn=document.getElementById('pwa-install-btn');
  if(btn) btn.style.display='flex';
});
window.addEventListener('appinstalled',function(){
  _pwaPrompt=null;
  var btn=document.getElementById('pwa-install-btn');
  if(btn) btn.style.display='none';
});
window.installPWA=function(){
  if(!_pwaPrompt) return;
  _pwaPrompt.prompt();
  _pwaPrompt.userChoice.then(function(){ _pwaPrompt=null; var btn=document.getElementById('pwa-install-btn'); if(btn) btn.style.display='none'; });
};
