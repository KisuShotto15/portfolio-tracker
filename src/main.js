import './style.css';
import { nextStamp, maxObservedStamp, localFieldWins, vesToUsd, mergeTxArrays, mergeTombstones, pruneRevokedTombstones, tombId, dueMonths, backfillRecurringTxWallets, txCreatedAt, backfillTxCreatedAt } from './sync-core.js';
import { localToday, monthKey, prevMonth, parseAmt, fmtUSD, escHtml, monthName, monthLabel, fmtDate, fmtDateWd } from './format.js';
import { initTools, renderToolToggles, renderToolGears, calcProfit, calcSpread, calcBCVEmily, fitAllCalcVals } from './tools.js';
import { monthCatTotalsCore, catNetSpendCore, monthIncomeCore, snapDerivedIncomeCore, isExtFlow, investmentFlowCore, periodNetSpendCore, periodLoggedIncomeCore, holdingsTotalUsdCore, catBudgetPctCore, budgetTotalForCore, trackerTxBalancesCore, debtSplitCore,
  rolloverCarryCore, catLimitWithCarryCore, catPaceAlertCore, dashMonthsCore, rollOnCore, migrateRolloverCore, histAllocPctCore,
  debtSinceCore, daysBetweenISO, noteMemoryCore,
  GROUP_ESSENTIAL, GROUP_BUSINESS, GROUP_LIFESTYLE, EXPENSE_CATS_DASH, BUDGET_CATS, NEUTRAL_CATS } from './finance-core.js';
import { healthScoreCore } from './health-core.js';
import { initAuth, sbGet, sbConsumeHashSession, sbRefresh, syncFetch, MULTIUSER, showAuthOverlay, hideAuthOverlay, renderPasskeys } from './auth.js';

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
initAuth({ syncProxy:SYNC_PROXY, onLogin:function(){ return bootAfterAuth(true); }, confirm:appConfirm });

// Autofill rules: matched against the first word of the note (case-insensitive)
// type: 'Debit'|'Credit', category, currency: 'VES'|'USD', wallet
// RESPALDO: primero manda tu historial (noteMemoryCore). Esta lista solo cubre la
// primera vez que anotas algo — despues la app ya aprendio de vos. Por eso no hace
// falta agregarle cada comercio nuevo.
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

var CATS         = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support','Investments','Savings'];
// SUMMARY_CATS es el mismo set que CATS: dos nombres porque semanticamente son
// cosas distintas (categorias que entran al resumen vs. todas las categorias),
// aunque hoy coinciden en contenido.
var SUMMARY_CATS = CATS;
// 'Transfer' (deposito/retiro) NO va en SUMMARY_CATS ni CATS: asi queda fuera de
// income/gasto, donut y budget automaticamente. Mueve el balance del wallet pero
// se netea del P&L como Investments (isExtFlow, ahora en finance-core.js).
// Pero SI es elegible al anotar y al filtrar: los dos <select> de categoria salen
// de aca (populateCatSelects), no de <option> escritos a mano en el HTML — antes
// eran tres listas que habia que mantener sincronizadas a mano.
var FORM_CATS    = CATS.concat(['Transfer']);
var CCOLORS      = {Income:'#34D399',Home:'#818CF8',Groceries:'#34D399',Transport:'#60A5FA',Health:'#A78BFA',Business:'#FBBF24',Discretionary:'#38BDF8','Eating Out':'#FB923C',Support:'#F59E0B',Investments:'#C084FC',Savings:'#6EE7B7',
  // legacy — kept so old transactions still render with a color
  Services:'#818CF8','Help others':'#F59E0B',Emergency:'#F87171',Other:'#6B7280'};

var S = {
  rate:null, rateDate:null, rateFetchedAt:null,
  transactions:[], portfolio:[], manualWallets:[],
  budgetTotal:600, budgetTotalUpdatedAt:null,   // default de los meses sin override
  // Total por mes: {'2026-08':850}. Editar el total desde el hero escribe SIEMPRE
  // aca (el mes visible), nunca el default: subirlo porque este mes salieron gastos
  // inesperados no debe reescribir el "me pase / no me pase" de los meses cerrados.
  budgetTotalByMonth:{}, budgetTotalByMonthUpdatedAt:null,
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
  bcvCalc:{}, bcvCalcUpdatedAt:null,     // BCV->Emily: usd/usdt/bs
  // % por categoria de ALCANCE GLOBAL. Legacy: la UI ya no lo escribe (todo % que
  // editas se guarda en el mes visible) y solo lo llena la migracion v2 desde los
  // limites en USD viejos. Sigue siendo el fallback de un mes sin plan propio.
  categoryBudgetPcts:{}, categoryBudgetPctsUpdatedAt:null,
  // El plan de cada mes: {'2026-07':{Groceries:30,...}}. Es lo que escribe la UI.
  // Un mes sin plan propio lo reparte seedMonthPlan segun el gasto promedio de los
  // 3 meses anteriores; recien si no hay historial cae al % global de arriba.
  categoryBudgetPctsByMonth:{}, categoryBudgetPctsByMonthUpdatedAt:null,
  rateUpdatedAt:null, rateEur:null, rateEurUpdatedAt:null,
  presets:[], presetsUpdatedAt:null, // legacy (plantillas eliminadas; docs viejos lo traen)
  notePins:[], notePinsUpdatedAt:null, // notas fijadas con estrella: siempre primero en sugerencias
  bdvLimits:[], bdvLimitsUpdatedAt:null,
  recurring:[], recurringUpdatedAt:null,
  recurringLog:[], recurringLogUpdatedAt:null,
  toolFees:{bpay:4.1, wally:3.745, zinli:3.75, emily:10}, toolFeesUpdatedAt:null,
  // Rollover POR MES: {'2026-09':{Groceries:true}}. Solo cuenta lo marcado en ese
  // mes concreto — apagado es la ausencia, y un mes se enciende aparte de los demas
  // (antes el mapa era plano y encender una categoria la encendia tambien en los
  // meses ya cerrados). Sincroniza solo por el LWW generico.
  rolloverCats:{}, rolloverCatsUpdatedAt:null,
  // Limite en USD fijo por mes y categoria. Manda sobre el %: existe justamente
  // para las categorias de monto fijo (suscripciones, alquiler), que no tienen
  // por que moverse cuando cambia el total del mes.
  categoryBudgetAmtsByMonth:{}, categoryBudgetAmtsByMonthUpdatedAt:null,
  // Ultimo mes cuyo cierre ya viste. Evita que el resumen vuelva a aparecer en cada
  // arranque (y que reaparezca en el otro dispositivo, via LWW).
  lastCloseSeen:null, lastCloseSeenUpdatedAt:null
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
var _budMonth=null, _budSig=null;
var syncTimer=null, _srchTimer=null, syncFailed=false, _whCollapsed={}, _rateTimer=null, _timersOn=false;
var _dirty=false, _saveSeq=0, _pullTimer=null, _pullInFlight=false, _ts=0, _pullChanged=false;
// Cambios locales sin subir a la nube (se muestran en el banner offline). Cuenta
// cada save() y se resetea cuando un push confirma. Persiste para sobrevivir reload.
var _pendingCount=0;

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
function loadLocal(){ try{ var s=localStorage.getItem('ft13'); if(s) S=Object.assign({},S,JSON.parse(s)); }catch(e){} seedClock(S); backfillTxCreatedAt(S.transactions); }

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
    if(_saveSeq===_pushSeq){ _dirty=false; _pendingCount=0; try{ localStorage.removeItem('ft13_dirty'); localStorage.removeItem('ft13_pending'); }catch(e){} updateOfflineBanner(); } // no edit landed during the push
    else { _pendingCount=Math.max(0,_saveSeq-_pushSeq); try{ localStorage.setItem('ft13_pending',_pendingCount); }catch(e){} } // quedan ediciones posteriores al push
    if(typeof _retryTimer!=='undefined') clearTimeout(_retryTimer);
    setSyncStatus('synced','Synced');
    var cs=document.getElementById('cloud-status');
    if(cs) cs.textContent='Last synced: '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  }catch(e){
    syncFailed=true; _pushFailCount++;
    if(e.message==='HTTP 401'){ if(MULTIUSER){ setSyncStatus('error','Session expired'); showAuthOverlay(); } else setSyncStatus('error','Invalid secret'); console.warn('push failed:',e.message); return; } // reintentar con el mismo secret/token no sirve
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
        backfillTxCreatedAt(S.transactions);   // las que llegan sin createdAt se congelan aca
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
    if(e.message==='HTTP 401'){ if(MULTIUSER){ setSyncStatus('error','Session expired'); showAuthOverlay(); } else setSyncStatus('error','Invalid secret'); }
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
    [S.bcvCalc||{},    [['be-usd','usd'],['be-usdt','usdt'],['be-bs','bs']],           false],
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
  updateOfflineBanner(); // oculta el banner offline; el push que sigue baja el contador
  pullFromCloud().then(function(){ pushToCloud(); });
});
window.addEventListener('offline', function(){
  setSyncStatus('offline','Offline');
  updateOfflineBanner();
});

var _retryTimer=null, _pushFailCount=0;
// Banner visible cuando el sync falla repetido (el dot del sidebar es facil de no ver).
function showSyncBanner(show){
  var b=document.getElementById('sync-banner');
  if(!b&&show){
    b=document.createElement('div'); b.id='sync-banner'; b.className='sync-banner';
    b.innerHTML='<span>⚠ Could not sync. Your changes are saved on this device only.</span><button onclick="window.retrySyncNow()">Retry</button>';
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
  _pendingCount++;
  try{ localStorage.setItem('ft13_dirty','1'); localStorage.setItem('ft13_pending',_pendingCount); }catch(e){} // marca cambios sin pushear (sobrevive reload)
  updateOfflineBanner();
  saveLocal();
  clearTimeout(syncTimer);
  syncTimer=setTimeout(pushToCloud, 1500);
}
// Banner visible cuando estas offline a proposito (distinto del de fallo de sync,
// que solo sale con red disponible). Muestra cuantos cambios faltan por subir.
function updateOfflineBanner(){
  var b=document.getElementById('offline-banner');
  if(!navigator.onLine){
    if(!b){ b=document.createElement('div'); b.id='offline-banner'; b.className='offline-banner'; document.body.appendChild(b); }
    var n=_pendingCount;
    b.innerHTML='<span>&#128244; Working offline'+(n>0?' &middot; <b>'+n+'</b> unsynced change'+(n===1?'':'s'):'')+'</span>';
    b.classList.add('show');
  } else if(b){ b.classList.remove('show'); }
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
async function clearAllTx(){ if(!await appConfirm('Delete ALL transactions?','Can be undone with Undo.','Delete')) return; snapshot(); if(!S.deletedTxIds) S.deletedTxIds=[]; var _dt=stamp(); S.transactions.forEach(function(t){ S.deletedTxIds.push({id:t.id,ts:_dt}); }); S.transactions=[]; S.transactionsUpdatedAt=stamp(); save(); renderTx(); renderSummary(); }

function isTracker(name,tx){ if(!name) return false; if(tx&&tx.imported) return false; var w=S.manualWallets.find(function(x){ return x.name===name; }); return w?w.trackerOnly===true:false; }
function inSummary(t){ return SUMMARY_CATS.indexOf(t.category)>=0; }

async function fetchRate(force){
  var stale=S.rateFetchedAt&&(Date.now()-S.rateFetchedAt>60*60*1000);
  if(!force&&S.rate&&S.rateDate&&!stale){ updateRateUI(); return; }
  document.getElementById('rate-display').textContent='...';
  try{ var r=await fetch(RATE_URL); var d=await r.json(); var v=parseFloat(d.current&&d.current.usd); if(v>10){ S.rate=parseFloat(v.toFixed(2)); var _eu=parseFloat(d.current&&d.current.eur); if(_eu>10){ S.rateEur=parseFloat(_eu.toFixed(2)); S.rateEurUpdatedAt=stamp(); } S.rateDate='BCV'+(d.current.date?' ('+d.current.date+')':''); S.rateFetchedAt=Date.now(); S.rateUpdatedAt=stamp(); save(); updateRateUI(); return; } }catch(e){ console.warn('rate:',e.message); }
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
  document.getElementById('rate-display').textContent=v+' Bs';
  var iv=Math.ceil(S.rate*1.005*100)/100; // Intervencion = BCV +0.5%, redondeado hacia arriba
  var ivs=iv.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
  var ie=document.getElementById('rate-interv'); if(ie) ie.textContent=ivs+' Bs';
  var m=document.getElementById('rate-display-m'); if(m) m.textContent=v;
  var iem=document.getElementById('rate-interv-m'); if(iem) iem.textContent=ivs;
  if(S.rateEur){
    var evs=S.rateEur.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
    var ee=document.getElementById('rate-eur'); if(ee) ee.textContent=evs+' Bs';
    var eem=document.getElementById('rate-eur-m'); if(eem) eem.textContent=evs;
  }
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
    title='Median of top-10 BDV merchants · '+age+' min ago';
    if(age>30) txt+=' ⚠'; // dato viejo: el monitor no esta refrescando
  }
  // Pulso al cambiar: flecha + color 1.6s para que el movimiento de la tasa se note.
  var dir=(_usdtShown!=null&&_usdtRate!=null&&_usdtRate!==_usdtShown)?(_usdtRate>_usdtShown?'up':'down'):null;
  if(_usdtRate!=null) _usdtShown=_usdtRate;
  var els=[document.getElementById('rate-usdt'),document.getElementById('rate-usdt-m')];
  els.forEach(function(el,i){
    if(!el) return;
    el.textContent=(txt==='-')?'-':(i===0?txt+' Bs':txt)+(dir?(dir==='up'?' ↑':' ↓'):'');
    el.title=title;
    el.classList.remove('rate-up','rate-down');
    if(dir) el.classList.add('rate-'+dir);
  });
  if(dir){
    clearTimeout(_usdtFlashT);
    _usdtFlashT=setTimeout(function(){
      els.forEach(function(el,i){ if(!el) return; el.classList.remove('rate-up','rate-down'); el.textContent=(txt==='-')?'-':(i===0?txt+' Bs':txt); });
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
// Los campos que aceptan sumas (evalMath) usan inputmode="decimal", y ese teclado
// de mobile no trae el "+": la funcion existia pero era inalcanzable con el dedo.
// No hay inputmode que de digitos + operadores, asi que se agrega un chip que
// inserta el "+" en el cursor sin cerrar el teclado (de ahi el preventDefault en
// pointerdown: sin eso el input pierde el foco y el teclado se baja).
window.sumChipTap=function(e,inputId){
  e.preventDefault(); e.stopPropagation();
  var el=document.getElementById(inputId); if(!el) return;
  var v=el.value||'';
  var a=el.selectionStart==null?v.length:el.selectionStart;
  var b=el.selectionEnd==null?v.length:el.selectionEnd;
  // Nada de "++" ni un "+" al principio: no serian expresiones validas.
  if(a===b&&(a===0||/[+\-*/(]$/.test(v.slice(0,a)))) { el.focus(); return; }
  el.value=v.slice(0,a)+'+'+v.slice(b);
  var pos=a+1;
  el.focus();
  try{ el.setSelectionRange(pos,pos); }catch(_){}
  el.dispatchEvent(new Event('input',{bubbles:true}));
};
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
  if(!data.length){ wrap.innerHTML=emptyState('No holdings found','Add a manual holding or a wallet, then Refresh'); return; }
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
function owStatus(msg){ var el=document.getElementById('ow-status'); if(el){ el.textContent=msg||''; el.style.color='#E24B4A'; } }
function jsonStatus(msg,color){ var el=document.getElementById('json-status'); if(el){ el.textContent=msg||''; el.style.color=color||'var(--color-text-secondary)'; } }
function saveOnchainWallet(){
  var label=document.getElementById('ow-label').value.trim();
  var chain=document.getElementById('ow-chain').value;
  var addr=document.getElementById('ow-addr').value.trim();
  if(!label||!addr) return;
  if(chain==='evm'&&!/^0x[0-9a-fA-F]{40}$/.test(addr)){ owStatus('Invalid EVM address (must be 0x + 40 hex chars)'); return; }
  if(chain==='btc'&&!/^([xyz]pub[A-Za-z0-9]{100,}|(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,87})$/.test(addr)){ owStatus('Invalid Bitcoin address or xpub/zpub/ypub'); return; }
  owStatus('');
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
// Tap/click en una tasa (BCV/EUR/Intervencion/USDT) la copia. Se copia solo el
// numero (sin 'Bs' ni flechas de tendencia) para que sirva pegado en cualquier lado.
function copyRateVal(el){
  var m=el.textContent.match(/^[\d.,]+/);
  if(!m) return;
  navigator.clipboard.writeText(m[0]).then(function(){
    var prev=el.textContent;
    el.textContent='✓';
    setTimeout(function(){ el.textContent=prev; },900);
  });
}
window.copyRateVal=copyRateVal;
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
      +(p>0?'<span class="hld-wval">'+fmtUSD(val)+'</span>':'<span class="hld-waddr">no price</span>')
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

// Ayuda contextual bajo el selector de categoria: que le hace ESA categoria a tus
// numeros. Las reglas ya existian (EXPENSE_CATS_DASH / NEUTRAL_CATS / isExtFlow en
// finance-core.js) pero solo como comentario del codigo, asi que habia que
// acordarselas de memoria al anotar. Se derivan de esos mismos arrays a proposito:
// una lista hardcodeada aca mentiria en silencio el dia que se mueva una categoria.
function catHintFor(cat){
  if(!cat) return '';
  if(cat==='Income') return '<b>Income</b> · new money coming in. The only one that adds to the month income.';
  if(EXPENSE_CATS_DASH.indexOf(cat)>=0) return '<b>Expense</b> · lowers your net worth and counts toward this month budget.';
  if(NEUTRAL_CATS.indexOf(cat)>=0) return '<b>Neutral</b> · touches neither budget nor P&L. Money moving between accounts the app already sees.';
  if(isExtFlow(cat)) return '<b>External flow</b> · not spending, and netted out of P&L. Money leaving or entering what is tracked.';
  return '';
}
function updateCatHint(){
  var el=document.getElementById('cat-hint'); if(!el) return;
  var sel=document.getElementById('tx-cat');
  el.innerHTML=sel?catHintFor(sel.value):'';
}
window.updateCatHint=updateCatHint;

function toggleVesHint(){ var on=document.getElementById('tx-cur').value==='VES'; document.getElementById('ves-hint').style.display=on?'inline':'none'; if(on) updateVesPreview(); }

// Aplica un juego de campos al formulario. Cada uno solo si viene con valor: una
// regla que no dice nada de la moneda no tiene por que pisarte la que elegiste.
function _applyAutofill(f){
  if(f.type)     document.getElementById('tx-type').value=f.type;
  if(f.category){ document.getElementById('tx-cat').value=f.category; updateCatHint(); }
  if(f.currency){ document.getElementById('tx-cur').value=f.currency; toggleVesHint(); }
  if(f.wallet){
    var ws=document.getElementById('tx-wallet');
    for(var j=0;j<ws.options.length;j++){ if(ws.options[j].value===f.wallet){ ws.value=f.wallet; break; } }
  }
  var hint=document.getElementById('autofill-hint');
  if(hint){ hint.style.opacity='1'; clearTimeout(window._afTimer); window._afTimer=setTimeout(function(){hint.style.opacity='0';},2000); }
}
function autofillFromNote(){
  if(editingTxId) return; // never autofill while editing an existing tx
  var note=document.getElementById('tx-desc').value.trim();
  if(!note) return;
  // Tu propio historial primero: lo que hiciste la ultima vez con esta descripcion
  // le gana a la lista de palabras clave de abajo. Si le cambiaste la categoria a
  // un comercio, la proxima ya sale como vos la dejaste — y un comercio que no
  // esta en la lista se aprende solo la primera vez que lo anotas.
  var mem=noteMemoryCore(S.transactions,note);
  if(mem){ _applyAutofill(mem); return; }
  // Split note into individual words and check each against keywords
  var words=note.toLowerCase().split(/[\s,:]+/);
  for(var i=0;i<AUTOFILL_RULES.length;i++){
    var rule=AUTOFILL_RULES[i];
    var matched=words.some(function(w){ return rule.keywords.indexOf(w)>=0; });
    if(!matched) continue;
    _applyAutofill(rule);
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
  S.transactions.push({id:_now,createdAt:_now,seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:cur==='VES'?_vr:null,rateSrc:cur==='VES'?vesTxRateSrc():null,imported:false,receiptUrl:pendingReceiptUrl,updatedAt:_ut});
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
  document.getElementById('tx-cat').value=t.category; updateCatHint();
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
// Coloca el popup anclado al campo Note. Abre hacia ABAJO (lo normal en un
// dropdown) y solo voltea hacia arriba si abajo no cabe y arriba hay mas espacio.
// El area util se mide con visualViewport, no con innerHeight: con el teclado
// abierto el layout viewport no cambia, asi que innerHeight mentia y el panel
// terminaba cortado fuera de pantalla. maxHeight se ajusta al lado elegido.
function _posNotePop(){
  var pop=document.getElementById('note-suggest-pop'), inp=document.getElementById('tx-desc');
  if(!pop||!inp) return;
  var r=inp.getBoundingClientRect();
  var vv=window.visualViewport;
  var vTop=vv?vv.offsetTop:0, vBot=vTop+(vv?vv.height:window.innerHeight);
  var GAP=4, EDGE=8, MIN=140;
  var below=vBot-r.bottom-GAP-EDGE, above=r.top-vTop-GAP-EDGE;
  pop.style.left=r.left+'px'; pop.style.width=r.width+'px';
  if(below>=MIN||below>=above){
    pop.style.bottom='auto'; pop.style.top=(r.bottom+GAP)+'px';
    pop.style.maxHeight=Math.min(300,Math.max(MIN,below))+'px';
  } else {
    pop.style.top='auto'; pop.style.bottom=(window.innerHeight-r.top+GAP)+'px';
    pop.style.maxHeight=Math.min(300,Math.max(MIN,above))+'px';
  }
}
// El teclado abre/cierra despues de mostrar el popup: reposicionar cuando el
// visualViewport cambia, o el panel queda anclado a medidas viejas.
if(window.visualViewport){
  var _rp=function(){ var p=document.getElementById('note-suggest-pop'); if(p&&p.classList.contains('open')) _posNotePop(); };
  window.visualViewport.addEventListener('resize',_rp);
  window.visualViewport.addEventListener('scroll',_rp);
}
function _setNotePop(open){
  var pop=document.getElementById('note-suggest-pop');
  var btn=document.querySelector('.note-dd-btn');
  if(btn) btn.classList.toggle('open',!!open); // chevron rota 180 como el ::picker-icon de los selects
  if(!pop) return;
  pop.classList.toggle('open',!!open);
  // Posicion fija: el popover vive en el top-layer, fuera del clipping/scroll del sheet.
  if(open) _posNotePop();
  try{
    if(pop.showPopover){
      if(open&&!pop.matches(':popover-open')) pop.showPopover();
      else if(!open&&pop.matches(':popover-open')) pop.hidePopover();
    }
  }catch(e){}
}
function _renderNoteSuggest(list){
  var pop=document.getElementById('note-suggest-pop'); if(!pop) return;
  pop.innerHTML=list.map(_noteRow).join('')||'<span style="padding:8px 12px;font-size:12px;color:var(--txt3)">No history yet</span>';
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
  renderTxRecList();
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
  document.getElementById('tx-cat').value=''; updateCatHint();
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
  var rl=document.getElementById('tx-rec-list'); if(rl) rl.style.display='none';
  renderTxRecList();
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
  var _cy=document.getElementById('wm-cycle'); if(_cy) _cy.checked=false;
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
  if(lbl&&cur) lbl.textContent=cur.value==='VES'?'Balance in Bs':'Balance USD';
  // El ciclo solo tiene sentido en una deuda: es la que sube y baja. Un tracker
  // comun no tiene "sumar" ni "saldar", solo sus txs.
  var t=document.getElementById('wm-type').value;
  var cy=document.getElementById('wm-cycle-field');
  if(cy) cy.style.display=(t==='lent'||t==='debt')?'flex':'none';
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
async function editManualWalletBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var isVes=w.currency==='VES'; var r=await appPrompt(isVes?'Balance in Bs':'New balance',escHtml(w.name)+(isVes?' · converted to $ automatically at the USDT rate':'')+' · accepts sums (1000+2500)',w.balance,{math:true}); if(!r) return; var v=evalMath(r.value); if(isNaN(v)) return; w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */ w.balance=parseFloat(v.toFixed(2)); S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); renderSummary(); }
// Fijar el balance de una wallet tracker SIN congelarlo: se guarda la base
// equivalente (rebase) y las txs futuras siguen moviendo el balance solas.
// (El viejo balanceOverride congelaba el valor y las txs nuevas no lo movian.)
// Cobrar / Pagar. Lo unico que hay que decidir es cuanto se movio: la direccion la
// pone la app. Un Debit baja lo que falta en los dos casos (te pagaron parte de lo
// que te deben, o pagaste parte de lo que debes), asi que no hay convencion que
// recordar ni que anotar al reves. Categoria Savings: es plata cambiando de lugar
// entre cosas que la app ya cuenta, no un gasto ni un ingreso — no toca budget ni P&L.
// Escribe UNA sola tx, la de la deuda. El otro lado (la plata que entro o salio de
// verdad) ya lo ve la app sola: por el fetch del exchange, o editando el wallet manual.
// sube=1 agranda la deuda (le prestaste de nuevo / pediste mas), sin sube la salda.
// Es la misma tx en las dos direcciones; lo unico que cambia es Credit vs Debit.
async function settleTracker(id,sube){
  var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return;
  var falta=w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name);
  var esDeuda=w.debt==='out';
  var titulo=sube?(esDeuda?'Borrow more':'Lend'):(esDeuda?'Pay debt':'Collect');
  var r=await appPrompt(titulo,
    escHtml(w.name)+' · '+(esDeuda?'you owe ':'owed to you ')+fmtUSD(falta)+' · accepts sums (50+100)',
    '',{math:true});
  if(!r) return;
  var v=evalMath(r.value);
  if(isNaN(v)||v<=0) return;
  w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */
  snapshot();
  var _now=Date.now(), _ut=stamp();
  S.transactions.push({id:_now,createdAt:_now,seq:S.transactions.length,date:localToday(),
    desc:(sube?(esDeuda?'Debt with ':'Loan to '):(esDeuda?'Payment ':'Collected '))+w.name,
    wallet:w.name,type:sube?'Credit':'Debit',category:'Savings',
    amountUSD:parseFloat(v.toFixed(2)),amountVES:null,originalCurrency:'USD',rateUsed:null,
    imported:false,receiptUrl:null,updatedAt:_ut});
  S.transactionsUpdatedAt=_ut;
  save(); renderWallets(); renderSummary(); renderTx();
  showTxToast();
}
async function editTrackerBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var cur=w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name); var r=await appPrompt('Set balance',escHtml(w.name)+' · accepts sums (1000+2500)',cur,{math:true}); if(!r) return; var v=evalMath(r.value); if(isNaN(v)) return; w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; /* re-fetch: un sync durante el await pudo reemplazar el array */ var txBal=calcTrackerBal(w.name)-(w.balance||0); w.balance=parseFloat((v-txBal).toFixed(2)); w.balanceOverride=null; S.manualWalletsUpdatedAt=stamp(); save(); renderWallets(); renderSummary(); }
window.editTrackerBal=editTrackerBal;
window.editManualWalletBal=editManualWalletBal;

function emptyState(title, sub){
  return '<div class="es"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:.25;margin-bottom:.75rem"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="12" y2="15"/></svg><div class="es-title">'+title+'</div><div class="es-sub">'+sub+'</div></div>';
}
// localToday / parseAmt / fmtUSD / escHtml viven en ./format.js (puros).
// Pill hue mirrors the category icon background (CAT_META[cat].bg) so both stay consistent.
function tagCat(cat){ var m={Income:'tG',Home:'tB',Groceries:'tG',Transport:'tB',Health:'tP',Business:'tT',Discretionary:'tP','Eating Out':'tA',Support:'tR',Investments:'tA',Savings:'tB',
  Services:'tP','Help others':'tA',Emergency:'tR',Other:'tX'}; return m[cat]||'tX'; }
// Desempate dentro del mismo dia por MOMENTO DE ALTA (txCreatedAt), no por
// updatedAt: con updatedAt, editar una tx o adjuntarle una foto le cambiaba el
// updatedAt y la fila saltaba al tope como si fuera la ultima anotada. txCreatedAt
// tambien resuelve lo que updatedAt vino a arreglar (el id deterministico de las
// recurrentes), pero sin quedar atado a la ultima edicion.
function sortTx(data){ return data.slice().sort(function(a,b){ if(b.date!==a.date) return b.date.localeCompare(a.date); return txCreatedAt(b)-txCreatedAt(a); }); }

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
  { keywords:['farmatodo'], src:'/icon-farmatodo.png?v=1', zoom:1 },
  { keywords:['disney+'], src:'/icon-disneyp.png?v=1', zoom:1 },
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
  // Panaderia. "canilla", "sobao"/"sobado", "acema" y "cachito" son nombres
  // locales de pan. Fuera las ambiguas: "andino" (region/banco) y "dulce".
  { keywords:['pan','panes','pancito','panecillo','panecillos','panaderia','panadería','panadero','canilla','canillas','sobao','sobado','sobados','acema','acemas','baguette','baguettes','croissant','croissants','cachito','cachitos','tostada','tostadas','bakery'], src:'/logo-pan.png?v=1', zoom:1 },
  { keywords:['gatarina','mimosa','kittens','gatos','gato'], src:'/icon-mimosa.png?v=2', zoom:1 },
  { keywords:['mercantil','merpa'], src:'/icon-merpa.png?v=2', zoom:1 },
  { keywords:['verduras','verdura','vegetales','vegetal','hortalizas','platano','platanos','tomate','tomates','cebolla','cebollas','papa','papas','zanahoria','zanahorias','lechuga','aguacate','pimenton','yuca','ajo','frutas','fruta','verduleria','fruteria'], src:'/icon-veggies.png?v=4', zoom:1 },
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
  return d===today?'Today':d===yest?'Yesterday':fmtDateWd(d);
}
function txSepHtml(date){
  var dayTotal=(_txDayTotals&&_txDayTotals[date])||0;
  return '<tr class="date-sep"><td colspan="7"><div class="dsep-inner"><span class="dsep-lbl">'+fmtDateHdr(date)+'</span>'+(dayTotal>0?'<span class="dsep-sep">·</span><span class="dsep-total">-'+fmtUSD(dayTotal)+'</span>':'')+'</div></td></tr>';
}
function txRowHtml(t){
  var rateTip=t.rateUsed?('Rate '+(t.rateSrc==='p2p'?'USDT P2P':t.rateSrc==='bcv'?'BCV':'')+' '+t.rateUsed):'';
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
    +  '<span class="td-amt-val" style="color:'+mCol+'">'+(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD)+'</span>'
    +  origM
    +'</td>'
    +'<td class="td-act">'+(t.receiptUrl?'<img class="tx-receipt-thumb" src="'+escHtml(t.receiptUrl)+'" width="28" height="28" loading="lazy" decoding="async" title="Receipt" onclick="event.stopPropagation();openReceipt(this.src)">':'')+'<button class="btn-edit-tx" title="Edit" onclick="event.stopPropagation();editTx('+t.id+')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg></button><button class="btn-edit-tx btn-del-tx" title="Delete" onclick="event.stopPropagation();deleteTx('+t.id+')"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg></button></td>'
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
  return remaining>0?'<button class="btn btns" onclick="loadMoreTx()">Show '+Math.min(_txBase,remaining)+' more · '+remaining+' left</button>':'';
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
  syncTxFilterState(cF,wF,mF);
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
  // La linea de resumen solo con un filtro activo: ahi responde "cuanto es esto
  // que filtre"; sin filtros era un total historico sin uso.
  var anyFilter=!!(tF||cF||wF||mF||sF);
  var sumLine=anyFilter?'<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.875rem">'+data.length+' records &middot; Total debits: <strong style="color:#E24B4A">'+fmtUSD(totalDebits)+'</strong></div>':'';
  wrap.innerHTML=sumLine
    +'<table class="tx-table"><thead><tr><th></th><th>Note</th><th>Wallet</th><th>Category</th><th>Original</th><th>USDT</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
    +(moreBtn?'<div id="tx-more" style="text-align:center;margin-top:18px">'+moreBtn+'</div>':'');
  watchTxMore();
}

function getMonths(){ var seen={}; S.transactions.forEach(function(t){ seen[t.date.slice(0,7)]=1; }); var u=Object.keys(seen).sort().reverse(); if(!u.length) u.push(monthKey(new Date())); return u; }
function dashMonths(){ return dashMonthsCore(getMonths(), S.snapshots, monthKey(new Date())); }
function populateSumMonth(){ var sel=document.getElementById('sum-month'); var cur=sel.value; var months=dashMonths(); sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+monthLabel(m)+'</option>'; }).join(''); if(cur&&months.indexOf(cur)>=0) sel.value=cur; }
function populateTxMonth(){
  var sel=document.getElementById('tf-month'); if(!sel) return;
  var cur=sel.value;
  var months=getMonths().slice();
  var nowM=monthKey(new Date());
  if(months.indexOf(nowM)<0) months.unshift(nowM); // current month always selectable
  // Labels cortos ("Jul 2026") para que el filtro quepa en la fila compacta movil.
  sel.innerHTML='<option value="">Month</option>'+months.map(function(m){ return '<option value="'+m+'">'+monthLabel(m,true)+'</option>'; }).join('');
  sel.value=cur; // preserve selection ("" → all months)
}

// ── Dashboard helpers ──────────────────────────────────────────────────────

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
// Income del mes = creditos de la categoria Income + el income que la app dedujo al
// tomar snapshots (campo del snapshot, no tx: ver recordSnapshot). Es la UNICA via por
// la que el dashboard lee income — grafico mensual, Budget y ritmo de la meta pasan
// todos por aca, asi que alcanza con sumarlo en este punto.
function monthIncome(month){ return monthIncomeCore(monthCatTotals(), month)+snapDerivedIncomeCore(S.snapshots, month); }

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
// Gasto del periodo entre dos snapshots (mismo set que la barra Outflows del grafico).
function periodNetSpend(prevSnap, curSnap){ return periodNetSpendCore(S.transactions, prevSnap, curSnap, EXPENSE_CATS_DASH); }
// Income del periodo ya registrado a mano, excluyendo las txs que generaron los
// propios snapshots (esas no son plata que entro, son el asiento del periodo anterior).
function periodLoggedIncome(prevSnap, curSnap){
  var skip={}; (S.snapshots||[]).forEach(function(s){ if(s.txId!=null) skip[s.txId]=1; });
  return periodLoggedIncomeCore(S.transactions, prevSnap, curSnap, skip);
}
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
    // Si el periodo se "cerro", su ganancia quedo congelada al tomar el snapshot;
    // usarla evita que mover flujos de Investments ese mismo dia DESPUES del snapshot
    // desincronice el KPI Net Profit. La fuente de ese valor congelado es netProfit: el
    // crecimiento NETO ("cuanto crecio mi capital despues de gastos"), que es lo que
    // muestra Net Profit. La tx enlazada ya no sirve para esto porque guarda el
    // income BRUTO; queda solo como fallback para snapshots viejos, donde si era el neto.
    // Sin ninguno de los dos, se calcula en vivo (asi editar el snapshot lo actualiza).
    var linked=s2.txId!=null?txById[s2.txId]:null;
    var profit=typeof s2.netProfit==='number'?s2.netProfit
      :(linked&&typeof linked.amountUSD==='number'?linked.amountUSD:computed);
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
  // Net Profit: snapshot periods ending in month
  var pnls=getSnapshotPnL();
  var monthPnls=pnls.filter(function(p){ return p.to.startsWith(month); });
  var monthlyReturn=monthPnls.length>0?monthPnls.reduce(function(s,p){ return s+p.profit; },0):null;
  var lastPnl=monthPnls.length>0?monthPnls[monthPnls.length-1]:null;
  var monthlyReturnPct=lastPnl&&lastPnl.snap1>0?(monthlyReturn/lastPnl.snap1)*100:null;
  // Goal Progress
  var goalPct=(S.dashGoal>0&&netWorth!==null)?Math.min(100,(netWorth/S.dashGoal)*100):null;
  return {netWorth:netWorth,expenses:expenses,monthlyReturn:monthlyReturn,monthlyReturnPct:monthlyReturnPct,lastPnl:lastPnl,goalPct:goalPct};
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
  var retColor=cur.monthlyReturn===null?'#888':cur.monthlyReturn>0?'#1D9E75':'#E24B4A';
  var retVal=cur.monthlyReturn!==null?(cur.monthlyReturn>=0?'+':'')+fmtUSD(cur.monthlyReturn):'—';
  var retSub=cur.lastPnl!==null?(cur.monthlyReturnPct!==null?(cur.monthlyReturnPct>=0?'+':'')+cur.monthlyReturnPct.toFixed(2)+'%':''):'no snapshots for '+month;
  // Liquid: en vivo, no por mes. No lleva delta porque los snapshots solo guardan
  // el total (no el reparto liquido/por cobrar), asi que no hay mes anterior contra
  // que compararlo sin inventarlo.
  var bal=getBalanceSplit();
  var _liqBits=[];
  if(bal.receivable>0) _liqBits.push(fmtUSD(bal.receivable)+' receivable');
  if(bal.owed>0) _liqBits.push(fmtUSD(bal.owed)+' owed');
  var liqSub=_liqBits.length?_liqBits.join(' · '):'no debts';
  var kHtml='<div class="kpi-strip">'
    +kpi('Net Worth',fmtUSD(nwDisplay),snapsDesc.length>0?'as of '+snapsDesc[0].date:'live estimate','#fff',fmtDelta(cur.netWorth,prev.netWorth))
    +kpi('Net Profit',retVal,retSub,retColor,fmtDelta(cur.monthlyReturn,prev.monthlyReturn,{abs:true}))
    +kpi('Liquid',fmtUSD(bal.liquid),liqSub,'#fff',null)
    +kpi('Goal Progress',cur.goalPct!==null?cur.goalPct.toFixed(1)+'%':'—',S.dashGoal>0?'of '+fmtUSD(S.dashGoal):'set a goal below','#9B70F0',fmtDelta(cur.goalPct,prev.goalPct))
    +'</div>';
  // Solo tocar el DOM cuando cambio → la animacion de entrada no se repite en cada sync/tab return.
  if(kHtml!==_kpiSig){ document.getElementById('kpi-strip').innerHTML=kHtml; _kpiSig=kHtml; }
}

// ── Health Score ───────────────────────────────────────────────────────────
function renderHealthScore(){
  var el=document.getElementById('health-wrap'); if(!el) return;
  // Ventana movil de 90 dias (health-core.js). El score viejo leia el mes en curso,
  // asi que el dia 1 se desplomaba a ~0 y se recuperaba solo al ir cargando el mes.
  var h=healthScoreCore({
    asOf:localToday(),
    transactions:S.transactions,
    snapshots:S.snapshots,
    expenseCats:EXPENSE_CATS_DASH,
    budgetTotal:S.budgetTotal,
    budgetTotalByMonth:S.budgetTotalByMonth,
    liveNetWorth:getTotalBalance()
  });
  var total=h.total, label=h.label;
  var color=total===null?'#888':total>=80?'#1D9E75':total>=60?'#A3CB48':total>=40?'#EF9F27':'#E24B4A';
  var totalTxt=total===null?'—':total;

  // Metrica sin datos: fila atenuada y '—'. Nunca una barra en 0, que se leeria
  // como "sacaste cero" en vez de "no hay con que calcularlo".
  function item(m){
    var w=m.available?Math.max(0,Math.min(100,m.score)):0;
    return '<div class="hb-item'+(m.available?'':' hb-off')+'"'
      +(m.available?'':' title="Not enough data — excluded from the score"')+'>'
      +'<div class="hb-name">'+m.label+'</div>'
      +'<div class="hb-bar"><div class="hb-fill" style="width:'+w.toFixed(0)+'%"></div></div>'
      +'<div class="hb-pts">'+m.display+'</div>'
    +'</div>';
  }
  var RR=42, CIRC=2*Math.PI*RR, dash=((total||0)/100)*CIRC;
  var hHtml='<div class="cleg">Salud Financiera</div>'
    +'<div class="health-ring-wrap">'
      +'<div class="health-ring"><svg width="100%" height="100%" viewBox="0 0 100 100">'
        +'<circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"></circle>'
        +'<circle cx="50" cy="50" r="42" fill="none" stroke="'+color+'" stroke-width="7" stroke-linecap="round" stroke-dasharray="'+dash+' '+CIRC+'" transform="rotate(-90 50 50)"></circle>'
        +'</svg><div class="health-ring-val"><b style="color:'+color+'">'+totalTxt+'</b><span>'+label+'</span></div></div>'
      +'<div class="health-breakdown">'
        +h.metrics.map(item).join('')
      +'</div>'
    +'</div>';
  // Only touch the DOM when output actually changed → no node recreation, no re-animation on tab return.
  if(hHtml!==_healthSig){ el.innerHTML=hHtml; _healthSig=hHtml; }

  // mobile compact bar
  var barEl=document.getElementById('health-bar-m');
  if(barEl){
    var aAlerts=getActiveAlerts();
    var aDot=aAlerts.length===0?'#1D9E75':'#EF9F27';
    var aTxt=aAlerts.length===0?'All clear':aAlerts.length+' alert'+(aAlerts.length>1?'s':'');
    var chevSvg='<svg class="hbm-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 4 6 8 10 4"/></svg>';
    var healthDrop='<div id="health-drop-m" class="hbm-drop">'
      +'<div class="hbm-drop-inner">'
        +'<div class="hbm-drop-score" style="color:'+color+'">'+totalTxt+'<span class="hbm-drop-lbl">'+label+'</span></div>'
        +'<div class="hbm-items">'
          +h.metrics.map(item).join('')
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
        +'<span class="hbm-txt">Salud: <b style="color:'+color+'">'+totalTxt+'</b></span>'
        +chevSvg
      +'</button>'
      +alertPill
    +'</div>'
    +healthDrop+alertDrop;
    if(mHtml!==_healthMSig){ barEl.innerHTML=mHtml; _healthMSig=mHtml; }
    _applyHbmDrop(); // el render nuevo nace cerrado: devolverle el estado
  }
}

// La barra mobile se reconstruye entera (innerHTML) cada vez que cambia su
// contenido, asi que el estado abierto/cerrado NO puede vivir en el DOM: descartar
// una alerta desde el dropdown lo re-renderiza y se llevaba puesta la clase .open,
// obligando a reabrirlo para descartar la siguiente. Vive aca y se re-aplica
// despues de cada render (mismo criterio que _alertsOpen en el popup de desktop).
var _hbmOpen=null; // 'health' | 'alerts' | null
function _applyHbmDrop(){
  var h=document.getElementById('health-drop-m'), a=document.getElementById('alerts-drop-m');
  // Sin alertas no hay dropdown que abrir: se descarto la ultima.
  if(!a&&_hbmOpen==='alerts') _hbmOpen=null;
  if(h) h.classList.toggle('open',_hbmOpen==='health');
  if(a) a.classList.toggle('open',_hbmOpen==='alerts');
  var chevs=document.querySelectorAll('#health-bar-m .hbm-chev');
  if(chevs[0]) chevs[0].style.transform=_hbmOpen==='health'?'rotate(180deg)':'';
  if(chevs[1]) chevs[1].style.transform=_hbmOpen==='alerts'?'rotate(180deg)':'';
  if(_hbmOpen) document.addEventListener('click',_hbmOutsideClick);
  else document.removeEventListener('click',_hbmOutsideClick);
}
// Tap afuera cierra. Ojo: el tap que descarta una alerta re-renderiza la barra, y
// para cuando el click burbujea hasta document su target ya esta detached — pero
// conserva su cadena de ancestros hasta .hbm-drop, asi que closest() lo sigue
// reconociendo como "adentro". Por eso se matchea .hbm-drop/.hbm-row y no solo
// #health-bar-m, que en esa cadena ya no esta.
function _hbmOutsideClick(ev){
  if(ev.target.closest&&ev.target.closest('.hbm-drop,.hbm-row,#health-bar-m')) return;
  _hbmOpen=null; _applyHbmDrop();
}
function _hbmToggle(which){
  _hbmOpen=_hbmOpen===which?null:which;
  _applyHbmDrop();
}
window.toggleHealthDrop=function(){ _hbmToggle('health'); };
window.toggleAlertsDrop=function(){ _hbmToggle('alerts'); };

// ── Alerts ─────────────────────────────────────────────────────────────────
// ── Cierre de mes ─────────────────────────────────────────────────────────
// Las piezas ya existian sueltas (snapshots, monthIncome, gasto por categoria);
// lo que faltaba era un momento donde la app te cuente que paso. Se arma para un
// mes cerrado y se abre solo la primera vez que entras con el mes ya cambiado.
function monthCloseData(month){
  var lim={}, spent={}, carry={}, prev={}, totLim=0, totSpent=0;
  var bt=budgetTotalFor(month), pm=prevMonth(month);
  BUDGET_CATS.forEach(function(cat){
    var base=catBaseLimit(cat,month);
    var cy=catCarry(cat,month);
    var l=catLimitWithCarryCore(base,cy,rollOn(cat,month));
    var sp=catNetSpend(month,[cat]);
    if(l<=0&&sp<=0) return;
    lim[cat]=l; spent[cat]=sp; totLim+=l; totSpent+=sp;
    carry[cat]=rollOn(cat,month)&&base>0?cy:0;
    prev[cat]=catNetSpend(pm,[cat]);
  });
  // Snapshot vigente al cierre de un mes: el ultimo tomado en ese mes o antes. Sin
  // uno de cada lado no se puede hablar de variacion y la linea no se dibuja.
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var snapUpTo=function(m){
    var out=null;
    snaps.forEach(function(s){ if(s.date.slice(0,7)<=m) out=s; });
    return out;
  };
  var sNow=snapUpTo(month), sPrev=snapUpTo(prevMonth(month));
  var nwDelta=(sNow&&sPrev&&sNow!==sPrev)?parseFloat((sNow.total-sPrev.total).toFixed(2)):null;
  // Conciliacion sobre el periodo ENTRE snapshots — que es donde la identidad del
  // app se cumple exacta: nwDelta = (anotado + derivado) - gasto - (invOut - invIn).
  // Sale de la definicion de derivedIncome; si el residuo no da ~0 es que algo no
  // esta anotado, y esa linea lo dice en vez de esconderlo.
  var rec=null;
  if(nwDelta!=null){
    var f=investmentFlow(sPrev,sNow);
    var logged=periodLoggedIncome(sPrev,sNow);
    var derived=0;
    snaps.forEach(function(x){
      if(x.date>sPrev.date&&x.date<=sNow.date&&typeof x.derivedIncome==='number') derived+=x.derivedIncome;
    });
    var pSpend=periodNetSpend(sPrev,sNow);
    var ext=parseFloat((f.invOut-f.invIn).toFixed(2));
    var r2=function(n){ return parseFloat(n.toFixed(2)); };
    rec={logged:r2(logged),derived:r2(derived),spend:r2(pSpend),ext:ext,
      resid:r2(nwDelta-(logged+derived-pSpend-ext))};
  }
  var big=null;
  S.transactions.forEach(function(t){
    if(t.date.slice(0,7)!==month) return;
    if(EXPENSE_CATS_DASH.indexOf(t.category)<0) return;
    if(!big||t.amountUSD>big.amountUSD) big=t;
  });
  var nTx=S.transactions.filter(function(t){ return t.date.slice(0,7)===month; }).length;
  return {month:month,lim:lim,spent:spent,carry:carry,prev:prev,
    totLim:parseFloat(totLim.toFixed(2)),totSpent:parseFloat(totSpent.toFixed(2)),
    income:monthIncome(month),nwDelta:nwDelta,big:big,nTx:nTx,rec:rec};
}
window.showMonthClose=function(month){
  var d=monthCloseData(month);
  var lbl=monthLabel(month);
  var sgn=function(n){ return (n>=0?'+':'-')+fmtShortUSD(Math.abs(n)); };
  var cats=Object.keys(d.lim).sort(function(a,b){ return d.spent[b]-d.spent[a]; });
  var rows=cats.map(function(c){
    var diff=parseFloat((d.lim[c]-d.spent[c]).toFixed(2));
    var col=d.lim[c]<=0?'var(--txt3)':diff<0?'#E24B4A':'#4ED9A4';
    // Delta contra el mes anterior: gastar mas que el mes pasado se lee en rojo
    // aunque hayas quedado dentro del plan — son dos preguntas distintas.
    var dp=parseFloat((d.spent[c]-(d.prev[c]||0)).toFixed(2));
    var dpTxt=(d.prev[c]||0)<=0?(d.spent[c]>0?'new':'—'):sgn(dp);
    var dpCol=(d.prev[c]||0)<=0?'var(--txt3)':dp>0?'#E24B4A':dp<0?'#4ED9A4':'var(--txt3)';
    return '<div class="mc-row"><span class="mc-cat"><i class="bdg-dot" style="background:'+(CCOLORS[c]||'#9B70F0')+'"></i>'+c+'</span>'
      +'<span class="mc-num">'+fmtUSD(d.spent[c])+'</span>'
      // El plan viene de dos partes: el % asignado y el arrastre del mes anterior.
      // La segunda va debajo, chica, porque explica por que el numero no es redondo.
      +'<span class="mc-num mc-dim mc-plan">'+(d.lim[c]>0?fmtUSD(d.lim[c]):'—')
        +(d.carry[c]?'<i>'+sgn(d.carry[c])+' <b>carryover</b><u>carry</u></i>':'')+'</span>'
      +'<span class="mc-num" style="color:'+col+'">'+(d.lim[c]>0?sgn(diff):'—')+'</span>'
      +'<span class="mc-num" style="color:'+dpCol+'">'+dpTxt+'</span></div>';
  }).join('');
  var stat=function(l,v,c,sub){ return '<div class="mc-stat"><span class="mc-stat-l">'+l+'</span>'
    +'<span class="mc-stat-v"'+(c?' style="color:'+c+'"':'')+'>'+v+'</span>'
    +(sub?'<span class="mc-stat-s">'+sub+'</span>':'')+'</div>'; };
  var totDiff=parseFloat((d.totLim-d.totSpent).toFixed(2));
  var ahorro=parseFloat((d.income-d.totSpent).toFixed(2));
  var tasa=d.income>0?Math.round(ahorro/d.income*100):null;
  var incSub=d.rec?fmtShortUSD(d.rec.logged)+' logged · '+fmtShortUSD(d.rec.derived)+' derived':'';
  // Conciliacion: por que el patrimonio se movio lo que se movio. Sin esto el
  // resumen mostraba ingresos y gastos que no cierran contra la variacion real.
  var recLine=function(l,v,c){ return '<div class="mc-rec-row"><span>'+l+'</span><span class="mc-num"'+(c?' style="color:'+c+'"':'')+'>'+v+'</span></div>'; };
  var recHtml='';
  if(d.rec){
    recHtml='<div class="mc-rec"><div class="mc-rec-h">How net worth moved</div>'
      +recLine('Income',sgn(d.rec.logged+d.rec.derived),'#4ED9A4')
      +recLine('Spending',sgn(-d.rec.spend),'#E24B4A')
      +(d.rec.ext!==0?recLine('External flows · Transfer / Investments',sgn(-d.rec.ext),d.rec.ext>0?'#E24B4A':'#4ED9A4'):'')
      +(Math.abs(d.rec.resid)>=0.5?recLine('Unexplained · market or something unlogged',sgn(d.rec.resid),'var(--txt3)'):'')
      +'<div class="mc-rec-row mc-rec-tot"><span>Net worth change</span><span class="mc-num" style="color:'+(d.nwDelta>=0?'#4ED9A4':'#E24B4A')+'">'+sgn(d.nwDelta)+'</span></div>'
      +'</div>';
  }
  var ov=document.createElement('div');
  ov.className='app-modal-overlay mc-ov open';
  ov.id='month-close';
  ov.innerHTML='<div class="app-modal mc-modal">'
    +'<h3>Month close · '+lbl+'</h3>'
    +'<div class="mc-body">'
    +'<div class="mc-stats">'
      +stat('Income',fmtUSD(d.income),'#5DCAA5',incSub)
      +stat('Spending',fmtUSD(d.totSpent),'',d.nTx+' transaction'+(d.nTx===1?'':'s'))
      +stat('Saved',sgn(ahorro),ahorro>=0?'#4ED9A4':'#E24B4A',tasa!=null?tasa+'% of income':'')
      +stat('vs Plan',sgn(totDiff),totDiff>=0?'#4ED9A4':'#E24B4A',fmtShortUSD(d.totLim)+' planned')
      +(d.nwDelta!=null?stat('Net worth',sgn(d.nwDelta),d.nwDelta>=0?'#4ED9A4':'#E24B4A'):'')
    +'</div>'
    +recHtml
    +(d.big?'<div class="mc-big">Largest transaction · <b>'+escHtml(d.big.desc)+'</b> '+fmtUSD(d.big.amountUSD)+' in '+d.big.category+'</div>':'')
    +(rows?'<div class="mc-head"><span>Category</span><span class="mc-num">Actual</span><span class="mc-num">Plan</span><span class="mc-num">Diff</span><span class="mc-num">vs '+monthName(prevMonth(month),true)+'</span></div><div class="mc-rows">'+rows+'</div>'
          :'<div class="mc-big">No spending logged in '+lbl+'.</div>')
    +'</div>'
    +'<div class="modal-actions"><button class="btn btnp" id="_mcok">Done</button></div>'
    +'</div>';
  document.body.appendChild(ov);
  var close=function(){
    ov.remove();
    if(S.lastCloseSeen!==month){ S.lastCloseSeen=month; S.lastCloseSeenUpdatedAt=stamp(); save(); }
  };
  ov.querySelector('#_mcok').onclick=close;
  ov.onclick=function(e){ if(e.target===ov) close(); };
};
// Se abre solo cuando el mes YA cambio y todavia no viste ese cierre. Sin txs en
// el mes cerrado no hay nada que contar, y se sale SIN marcarlo visto: si mas
// tarde cargas las txs de ese mes, el cierre todavia te espera.
function maybeShowMonthClose(){
  var closed=prevMonth(monthKey(new Date()));
  if(S.lastCloseSeen===closed) return;
  if(!S.transactions.some(function(t){ return t.date.slice(0,7)===closed; })) return;
  window.showMonthClose(closed);
}
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
        msg:'Spending on '+cat+': '+fmtUSD(curSpend)+' (↑'+pct.toFixed(0)+'% vs average)',
        action:'Review this month\'s transactions in '+cat
      });
    }
  });

  // 2. Ritmo por categoria: al ritmo de lo que va del mes, termina pasandose. Va
  // antes de que se pase — despues el aviso no sirve, la card ya lo dice en rojo.
  var _dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  BUDGET_CATS.forEach(function(cat){
    var lim=catLimitWithCarryCore(catBaseLimit(cat,curMonth),catCarry(cat,curMonth),rollOn(cat,curMonth));
    var pace=catPaceAlertCore(catNetSpend(curMonth,[cat]),lim,now.getDate(),_dim);
    if(!pace) return;
    alerts.push({
      sev:pace.sev,
      msg:'At this pace '+cat+' ends at '+fmtUSD(pace.projected)+' of '+fmtUSD(lim),
      action:'You would go over by '+fmtUSD(pace.over)+' · '+(_dim-now.getDate())+' days left'
    });
  });

  // 3. Snapshot pendiente
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  if(snaps.length>0){
    var last=new Date(snaps[0].date+'T00:00:00');
    var daysSince=Math.floor((now-last)/(1000*60*60*24));
    if(daysSince>30){
      alerts.push({
        sev:daysSince>45?'crit':'warn',
        msg:'Last snapshot '+daysSince+' days ago',
        action:'Registra snapshot ahora',
        onClick:'recordSnapshot()'
      });
    }
  }

  // 3b. Deudas viejas. Una deuda parada no aparece en ningun gasto y su saldo no
  // se mueve: sin aviso se vuelve invisible y te olvidas de cobrarla.
  S.manualWallets.forEach(function(w){
    if(!w.trackerOnly||!w.debt) return;
    var bal=calcTrackerBal(w.name);
    if(!(bal>0.005)) return;
    var d=daysBetweenISO(debtSinceCore(S.transactions,w.name,w.balance||0),localToday());
    if(d==null||d<DEBT_STALE_DAYS) return;
    alerts.push({
      sev:d>=180?'crit':'warn',
      msg:(w.debt==='out'?'You owe '+w.name:w.name+' owes you')+' '+fmtUSD(bal)+' for '+debtAgeLabel(d),
      action:w.debt==='out'?'Pay it or agree on a date':'Collect it or agree on a date'
    });
  });

  // 4. Goal progress lento
  if(S.dashGoal>0){
    var nw=snaps.length>0?snaps[0].total:getTotalBalance();
    var contrib=getAvgMonthlyContribution();
    if(nw<S.dashGoal&&contrib>0){
      var months=Math.ceil((S.dashGoal-nw)/contrib);
      if(months>60){
        alerts.push({
          sev:'warn',
          msg:'At the current pace: '+months+' months to reach the goal',
          action:'Increase monthly contribution or adjust the goal'
        });
      }
    } else if(nw<S.dashGoal&&contrib<=0){
      alerts.push({
        sev:'warn',
        msg:'No positive net monthly contribution',
        action:'You need income > spending to move toward the goal'
      });
    }
  }

  // 5. Transacciones recurrentes auto-agregadas (info, descartable)
  (S.recurringLog||[]).forEach(function(a){
    if(a.seen) return;
    var amtTxt=a.currency==='VES'?('Bs '+a.amount):('$'+a.amount);
    alerts.unshift({
      sev:'info',
      msg:'Auto-agregado: '+a.label+' · '+amtTxt,
      action:'Tap to dismiss · '+a.date,
      onClick:'dismissRecurringAlert('+a.id+')'
    });
  });

  return alerts;
}

// El bloque de alertas se reconstruye entero (innerHTML) en cada renderAlerts,
// asi que el estado abierto/cerrado NO puede vivir en el DOM: descartar una
// alerta re-renderiza y se llevaba puesta la clase .open del popup. Vive aca y
// se re-aplica despues de cada render.
var _alertsOpen=false;
function renderAlerts(){
  var el=document.getElementById('alerts-wrap'); if(!el) return;
  var alerts=getActiveAlerts();
  // El margen sale de .alerts-lbl (CSS), no inline: asi puede igualar el ritmo de
  // .kpi-lbl → .kpi-val y la palabra queda a la misma altura que los otros labels.
  var hdr='<div class="cleg alerts-lbl">Alerts</div>';
  if(alerts.length===0){
    el.innerHTML=hdr+'<div class="alerts-empty">✓ All clear</div>';
    setAlertsPopup(false); // sin alertas no hay popup: soltar el listener global
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
  // Quedaba abierto antes del re-render y todavia hay alertas: dejarlo abierto.
  if(_alertsOpen){
    var np=document.getElementById('alerts-popup'); if(np) np.classList.add('open');
  }
}
// Un solo listener global, con referencia nombrada: addEventListener ignora el
// duplicado y el close busca el popup VIVO en vez de capturar el nodo de turno
// (el viejo queda detached en cada render y removerle la clase no hacia nada).
function _alertsOutsideClick(ev){
  // Ojo: descartar una alerta re-renderiza el bloque, asi que para cuando el
  // click burbujea hasta document el target ya esta detached — pero conserva su
  // cadena de ancestros, asi que closest() sigue reconociendolo como "adentro"
  // y el popup no se cierra.
  if(ev.target.closest&&ev.target.closest('.alerts-pop-wrap')) return;
  setAlertsPopup(false);
}
function setAlertsPopup(open){
  _alertsOpen=open;
  var p=document.getElementById('alerts-popup'); if(p) p.classList.toggle('open',open);
  if(open) document.addEventListener('click',_alertsOutsideClick);
  else document.removeEventListener('click',_alertsOutsideClick);
}
function toggleAlertsPopup(e){
  if(e) e.stopPropagation(); // no llega a document: no se auto-cierra al abrirse
  var p=document.getElementById('alerts-popup'); if(!p) return;
  setAlertsPopup(!p.classList.contains('open'));
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
  // Repara txs recurrentes ya generadas que quedaron sin wallet: sin esto nunca
  // se debitan del tracker aunque despues arregles la regla.
  var fixedW=backfillRecurringTxWallets(S.recurring,S.transactions);
  var now=new Date(), added=[], deleted=new Set((S.deletedTxIds||[]).map(tombId));
  S.recurring.forEach(function(r){
    if(!r.amount||r.amount<=0||!r.dayOfMonth) return;
    dueMonths(r, now).forEach(function(d){
      var cur=r.currency||'USD', amtUSD=r.amount, amtVES=null, rateUsed=null;
      if(cur==='VES'){ var _vr=vesTxRate(); if(!_vr) return; amtVES=r.amount; amtUSD=vesToUsd(r.amount,_vr); rateUsed=_vr; var _rs=vesTxRateSrc(); } else { var _rs=null; }
      var dateStr=d.y+'-'+String(d.m+1).padStart(2,'0')+'-'+String(d.dom).padStart(2,'0');
      // Id deterministico: fecha + (ruleId mod 1 dia). Antes era mod 100000, y dos
      // reglas cuyos ids coincidieran en ese modulo generaban el MISMO id el mismo
      // dia — la segunda nunca insertaba su tx (perdida silenciosa). Con mod 86400000
      // (< separacion entre fechas) solo colisionan reglas creadas en el mismo ms del
      // dia. oldId cubre txs ya generadas con el esquema viejo (y clientes sin actualizar).
      var dayMs=Date.parse(dateStr+'T12:00:00');
      var txId=dayMs+(r.id%86400000), oldId=dayMs+(r.id%100000);
      if(deleted.has(txId)||deleted.has(oldId)){ r.lastRun=d.ym; return; }   // borrada por el usuario: no resucitar
      if(S.transactions.some(function(t){ return t.id===txId||t.id===oldId||(t.recurringId===r.id&&t.date===dateStr); })){ r.lastRun=d.ym; return; }
      var _gen=stamp();   // alta real de la recurrente: su id es deterministico por fecha, no dice cuando se genero
      S.transactions.push({id:txId,createdAt:_gen,seq:S.transactions.length,date:dateStr,desc:r.label,wallet:r.wallet||'',type:r.type||'Debit',category:r.category||'',amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:rateUsed,rateSrc:_rs,imported:false,receiptUrl:null,updatedAt:_gen,auto:true,recurringId:r.id});
      r.lastRun=d.ym;
      added.push({id:txId,rid:r.id,label:r.label,date:dateStr,amountUSD:amtUSD,currency:cur,amount:r.amount,seen:false});
    });
  });
  if(added.length||fixedW.length){
    var ut=stamp();
    S.transactionsUpdatedAt=ut;
    // updatedAt nuevo en las reparadas: asi el merge propaga el arreglo al resto
    // de los dispositivos en vez de que una copia vieja sin wallet lo revierta.
    fixedW.forEach(function(t){ t.updatedAt=ut; });
    if(added.length){
      S.recurringUpdatedAt=ut;
      if(!Array.isArray(S.recurringLog)) S.recurringLog=[];
      added.forEach(function(a){ S.recurringLog.unshift(a); });
      S.recurringLog=S.recurringLog.slice(0,30);
      S.recurringLogUpdatedAt=ut;
    }
    // renderWallets: la tx nueva (o reparada) mueve el balance de los trackers —
    // sin esto, parado en la tab Wallets el monto queda viejo hasta cambiar de tab.
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
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent=on?(_editingRecId?'Save rule':'Add rule'):'Add';
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
    tg.title='Saved rules'; tg.style.display=n?'':'none';
  }
  var wrap=document.getElementById('tx-rec-list'); if(!wrap) return;
  if(!n){ _txRecListOpen=false; wrap.style.display='none'; wrap.innerHTML=''; return; }
  wrap.innerHTML=S.recurring.slice().sort(function(a,b){ return (a.dayOfMonth||0)-(b.dayOfMonth||0); }).map(function(r){
    var amt=(r.currency==='VES'?'Bs ':'$')+r.amount;
    return '<div class="rec-lrow'+(_editingRecId===r.id?' editing':'')+'">'
      +'<span class="rec-lname">'+escHtml(r.label)+'</span>'
      +'<span class="rec-lmeta">Day '+r.dayOfMonth+' · '+amt+(r.category?' · '+escHtml(r.category):'')+'</span>'
      +'<span class="rec-lacts"><button class="wico" onclick="editRecurringRule('+r.id+')" title="Edit">✎</button><button class="wico del" onclick="deleteRecurringRule('+r.id+')">✕</button></span>'
      +'</div>';
  }).join('');
}
window.editRecurringRule=function(id){
  var r=(S.recurring||[]).find(function(x){ return x.id===id; }); if(!r) return;
  _editingRecId=id;
  document.getElementById('tx-desc').value=r.label||'';
  // Sin el else, editar una regla sin wallet dejaba el select con el valor de la
  // regla anterior: guardabas y se le pegaba un wallet ajeno. Y una regla creada
  // asi generaba txs con wallet:'' que nunca se debitan del tracker.
  // Si el wallet de la regla ya no existe, el select queda en blanco a proposito:
  // mejor que el usuario lo vea y elija, a que se guarde uno inventado.
  document.getElementById('tx-wallet').value=r.wallet||'';
  document.getElementById('tx-type').value=r.type||'Debit';
  document.getElementById('tx-cat').value=r.category||''; updateCatHint();
  document.getElementById('tx-cur').value=r.currency||'USD';
  document.getElementById('tx-amount').value=r.amount||'';
  document.getElementById('tx-rec-day').value=r.dayOfMonth||'';
  toggleVesHint();
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent='Save rule';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='';
  renderTxRecList();
};
function cancelEditRecurring(){
  _editingRecId=null;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value=''; document.getElementById('tx-rec-day').value='';
  var on=document.getElementById('tx-recurring')&&document.getElementById('tx-recurring').checked;
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent=on?'Add rule':'Add';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='none';
  renderTxRecList();
}
window.cancelEditRecurring=cancelEditRecurring;
window.addRecurringRule=function(){
  var label=document.getElementById('tx-desc').value.trim();
  var day=parseInt(document.getElementById('tx-rec-day').value,10);
  var amount=parseFloat(document.getElementById('tx-amount').value);
  if(!label||isNaN(day)||day<1||day>31||isNaN(amount)||amount<=0){ txMsg('Note, day (1-31) and amount are required'); return; }
  // Una regla sin wallet genera txs que no se debitan de ningun tracker: se ven
  // en Transactions pero el balance nunca baja. Mejor frenar aca que dejarla rota.
  var wsel=document.getElementById('tx-wallet').value;
  if(!wsel){ txMsg('Pick a wallet for the rule'); return; }
  if(!S.recurring) S.recurring=[];
  var fields={label:label,dayOfMonth:day,
    wallet:wsel,
    type:document.getElementById('tx-type').value,
    category:document.getElementById('tx-cat').value,
    currency:document.getElementById('tx-cur').value,
    amount:amount};
  if(_editingRecId){
    var r=S.recurring.find(function(x){ return x.id===_editingRecId; });
    if(r) Object.assign(r,fields); // conserva id, lastRun -> no re-agrega tx ya creadas
    cancelEditRecurring();
    txMsg('Rule updated ✓',true);
  }else{
    S.recurring.push(Object.assign({id:Date.now(),lastRun:null},fields));
    document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value=''; document.getElementById('tx-rec-day').value='';
    txMsg('Rule created ✓',true);
  }
  S.recurringUpdatedAt=stamp(); save();
  renderTxRecList();
  applyRecurring(); // si ya paso el dia este mes, se agrega de una
};
window.deleteRecurringRule=async function(id){
  var r=(S.recurring||[]).find(function(x){ return x.id===id; }); if(!r) return;
  var amt=(r.currency==='VES'?'Bs ':'$')+r.amount;
  var ok=await appConfirm('Delete recurring rule?',escHtml(r.label)+' <span style="color:'+(r.type==='Credit'?'#5DCAA5':'#E24B4A')+'">'+amt+'</span>','Delete');
  if(!ok) return;
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
      +(months?'<div class="goal-meta"><span class="goal-meta-item"><b>~'+months+'</b> mo</span><span class="goal-meta-dot">·</span><span class="goal-meta-item"><b>'+fmtUSD(contrib)+'</b>/mo</span><span class="goal-meta-dot">·</span><span class="goal-meta-item"><b>'+fmtUSD(contrib/30)+'</b>/day</span></div>':'');
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
  var prevLabel=monthName(prev,true);
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
    var budget=budgetTotalFor(month)||600;
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
    blocks=tile('Spent', fmtUSD(spent), '', 'in '+monthName(month))+vsTile;
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
  el.innerHTML='<div class="ins-head"><span class="cleg" style="margin:0">Insights</span><span class="ins-head-sub">vs '+monthName(prev,true)+'</span></div>'
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
  // Fuera las neutras (no son gasto) y los flujos externos (no son consumo).
  var DONUT_CATS=CATS.filter(function(c){ return NEUTRAL_CATS.indexOf(c)<0&&!isExtFlow(c); });
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

// Linea "+ Holdings": apagada por defecto (estiraba la escala y aplastaba la
// curva); toggle por dispositivo (localStorage), boton discreto junto a +Snapshot.
var _eqShowHoldings=false; try{ _eqShowHoldings=localStorage.getItem('ft13_eqh')==='1'; }catch(e){}
window.toggleEqHoldings=function(){
  _eqShowHoldings=!_eqShowHoldings;
  try{ localStorage.setItem('ft13_eqh',_eqShowHoldings?'1':'0'); }catch(e){}
  _eChartSig=null; renderEquityChart();
};
function renderEquityChart(){
  var _hb=document.getElementById('eq-holdings-btn');
  if(_hb) _hb.classList.toggle('on',_eqShowHoldings);
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
  // Piso del eje Y justo bajo el minimo real: con el pico de +Holdings la escala
  // llegaba a ~1.4x del net worth y la curva Tracked se veia plana.
  var _eqYMin=Math.max(0, Math.floor(Math.min.apply(null,vals)*0.96));
  // Skip rebuild when snapshots + holdings values are unchanged (adjVals folds in both).
  var sig=JSON.stringify([labels,vals,_eqShowHoldings?adjVals:null]);
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
  var _eqDs=[
    {label:'Tracked',data:vals,borderColor:'#4ED9A4',backgroundColor:function(ctx){var c=ctx.chart,a=c.chartArea;if(!a)return 'rgba(78,217,164,0.2)';var g=c.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,'rgba(78,217,164,0.4)');g.addColorStop(1,'rgba(78,217,164,0)');return g;},borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHitRadius:20,pointBackgroundColor:'#4ED9A4',tension:0.3,fill:true}
  ];
  if(_eqShowHoldings) _eqDs.push({label:'+ Holdings',data:adjVals,borderColor:'#9B70F0',backgroundColor:'transparent',borderWidth:1.5,pointRadius:0,pointHoverRadius:3,pointHitRadius:15,pointBackgroundColor:'#9B70F0',tension:0.3,fill:false,borderDash:[5,4]});
  eChart=new Chart(el,{type:'line',data:{labels:labels,datasets:_eqDs},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},layout:{padding:0},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{display:false},y:{display:false,min:_eqYMin}}}});}

// El patrimonio partido en tres: lo que puedes gastar HOY, lo que te deben y lo que
// debes. Un wallet trackerOnly es una de tres cosas segun su campo debt: una cuenta
// propia (sin debt — banco, wallet, tarjeta: plata liquida), plata que te deben
// (debt:'in') o plata que debes (debt:'out'). Las tres guardan un numero positivo;
// el signo lo pone debtSplitCore. El KPI Liquid vive de esta separacion.
function trackerBalances(){
  var out={};
  S.manualWallets.forEach(function(w){
    if(!w.trackerOnly) return;
    out[w.name]=w.balanceOverride!=null?w.balanceOverride:calcTrackerBal(w.name);
  });
  return out;
}
function getBalanceSplit(){
  var api=(S.exchangeWallets||[]).reduce(function(s,w){ return s+(w.balance||0); },0);
  var d=debtSplitCore(S.manualWallets,trackerBalances());
  var liquid=api+manualNormalTotal()+d.cash;
  return {liquid:parseFloat(liquid.toFixed(2)),receivable:d.receivable,owed:d.owed};
}
function getTotalBalance(){
  var b=getBalanceSplit();
  return parseFloat((b.liquid+b.receivable-b.owed).toFixed(2));
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
      // opts.math: el campo pasa por evalMath, asi que necesita el chip "+" y un
      // teclado decimal (type=number no deja escribir "1000+2500" ni con teclado
      // fisico, porque el navegador descarta el valor no numerico).
      +'<div class="field" style="margin-bottom:0">'
      +  (opts&&opts.math
          ?'<span class="sum-wrap"><input id="_ami" class="modal-inp" type="text" inputmode="decimal" value="'+escHtml(String(defaultVal))+'"/><span class="sum-chip" role="button" aria-label="Add a plus sign" onpointerdown="sumChipTap(event,\'_ami\')">+</span></span>'
          :'<input id="_ami" class="modal-inp" type="'+(opts&&opts.inputType||'number')+'" step="0.01" value="'+escHtml(String(defaultVal))+'"/>')
      +'</div>'
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
    // Ya no crea ninguna transaccion: decide si se le atribuye income al periodo
    // (se guarda en el snapshot como derivedIncome/netProfit).
    hasPrev?{checkboxLabel:'Count income for this period',checkboxChecked:true}:null
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
    // La income tx que dejo el snapshot viejo (Profit ... del calculo anterior)
    // queda obsoleta al reemplazar: se borra con tombstone para no duplicar
    // Income cuando se cree la nueva. Sin esto quedaba huerfana y se sumaba doble.
    var oldTxId=S.snapshots[existing].txId;
    if(oldTxId!=null){
      if(!S.deletedTxIds) S.deletedTxIds=[];
      S.deletedTxIds.push({id:oldTxId,ts:stamp()});
      S.transactions=S.transactions.filter(function(t){ return t.id!==oldTxId; });
      S.transactionsUpdatedAt=stamp();
    }
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
    // La variacion del patrimonio es NETA (ya trae los gastos descontados), asi que
    // usarla como Income dejaba el grafico descuadrado: los gastos se restaban dos
    // veces (una dentro del income, otra en la barra Outflows). Sumandole el gasto
    // del periodo se reconstruye el income BRUTO, comparable contra Outflows.
    //   patrimonio: Δ = income - gastos  →  income = Δ + gastos
    // Se resta el income que ya esta registrado a mano en el periodo: esa plata ya
    // hizo subir el patrimonio, derivarla otra vez la contaria dos veces.
    //   income derivado = Δ + gastos - income ya registrado
    var grossIncome=Math.round((profit+periodNetSpend(prev,cur)-periodLoggedIncome(prev,cur))*100)/100;
    if(res.checked){
      // Los dos son campos del snapshot, no una transaccion. Antes el income derivado
      // se inyectaba como tx en S.transactions y eso obligaba a distinguirla de las
      // reales en cada lectura (doble conteo, tx huerfana al borrar el snapshot, txs
      // de $0, y un valor que el usuario podia editar a mano y desincronizar).
      //   netProfit    = crecimiento NETO  → KPI Net Profit
      //   derivedIncome = income BRUTO      → grafico / Budget, via monthIncome()
      cur.netProfit=profit;
      cur.derivedIncome=grossIncome;
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

function saveBudget(){
  var el=document.getElementById('bud-total'); if(!el) return;
  var v=evalMath(el.value);
  if(v>0&&_budMonth&&v!==budgetTotalFor(_budMonth)){
    if(!S.budgetTotalByMonth) S.budgetTotalByMonth={};
    S.budgetTotalByMonth[_budMonth]=parseFloat(v.toFixed(2));
    S.budgetTotalByMonthUpdatedAt=stamp(); save();
  }
  _budSig=null; renderBudget(); // cerrar el modo edicion aunque no cambie
}
// Total efectivo de un mes: override del mes > default global.
function budgetTotalFor(month){ return budgetTotalForCore(S.budgetTotal, S.budgetTotalByMonth, month); }
// % efectivo de una categoria para un mes: override del mes > default global.
function catBudgetPct(cat,month){ return catBudgetPctCore(S.categoryBudgetPcts, S.categoryBudgetPctsByMonth, cat, month); }
// Monto fijo del mes, si lo hay. null = la categoria se rige por %.
function catFixedAmt(cat,month){
  var o=(S.categoryBudgetAmtsByMonth||{})[month], v=o?o[cat]:null;
  return v>0?v:null;
}
// Limite base en USD, antes del arrastre. Un monto fijo gana sobre el %.
function catBaseLimit(cat,month){
  var f=catFixedAmt(cat,month);
  if(f!=null) return f;
  var p=catBudgetPct(cat,month);
  return p>0?parseFloat((p/100*budgetTotalFor(month)).toFixed(2)):0;
}
// % que ese limite representa del total: lo que muestra la pastilla y lo que suma
// el medidor de asignacion. Con monto fijo es derivado, no un valor guardado.
function catPctShown(cat,month){
  var f=catFixedAmt(cat,month);
  if(f==null) return catBudgetPct(cat,month);
  var t=budgetTotalFor(month);
  return t>0?parseFloat((f/t*100).toFixed(1)):0;
}
// Arrastre del mes anterior para una categoria: solo si ese MES tiene el rollover
// encendido para ella. Ausente = apagado; se enciende mes por mes a proposito.
function rollOn(cat,month){ return rollOnCore(S.rolloverCats,cat,month); }
function catCarry(cat,month){
  if(!rollOn(cat,month)) return 0;
  // Un monto fijo es "esto y punto": arrastrarle el sobrante lo contradice.
  if(catFixedAmt(cat,month)!=null) return 0;
  return rolloverCarryCore(catBaseLimit(cat,prevMonth(month)), catNetSpend(prevMonth(month),[cat]));
}
var _rolloverUI=false;
window._budRolloverUI=function(){ _rolloverUI=!_rolloverUI; renderBudget(); };
window.toggleRolloverCat=function(cat,month){
  if(!S.rolloverCats) S.rolloverCats={};
  var m=S.rolloverCats[month]||(S.rolloverCats[month]={});
  if(m[cat]===true) delete m[cat]; else m[cat]=true;
  if(!Object.keys(m).length) delete S.rolloverCats[month];
  S.rolloverCatsUpdatedAt=stamp();
  save(); renderBudget();
};
// Todo o nada para el mes visible: con seis categorias, encenderlas una por una
// era el gesto mas repetido del panel.
window.toggleRolloverAll=function(month){
  if(!S.rolloverCats) S.rolloverCats={};
  if(BUDGET_CATS.every(function(c){ return rollOn(c,month); })) delete S.rolloverCats[month];
  else { var m={}; BUDGET_CATS.forEach(function(c){ m[c]=true; }); S.rolloverCats[month]=m; }
  S.rolloverCatsUpdatedAt=stamp();
  save(); renderBudget();
};
// Scope de edicion: 'default' escribe el % global, 'month' escribe el override
// del mes visible. Solo afecta la edicion; la vista siempre muestra el efectivo.
// Fila de scope + presets del Budget (Default / <mes> only / 3-mo avg / 50-30-20).
// En la practica el flujo es "Default y ajusto a mano", asi que la fila se oculta
// en vez de borrarse: poner esto en true la devuelve entera, sin tocar nada mas.
// Con la fila oculta, _budEditScope se queda en 'default' — no hay forma de
// cambiarlo — asi que editar un % siempre escribe el valor global.
var BUDGET_SCOPE_UI=false;
var _budEditScope='default';
window._budScope=function(s){ if(!BUDGET_SCOPE_UI) return; _budEditScope=s; renderBudget(); };
window._budResetMonth=function(){
  var touched=false;
  if(S.categoryBudgetPctsByMonth&&S.categoryBudgetPctsByMonth[_budMonth]){
    delete S.categoryBudgetPctsByMonth[_budMonth];
    S.categoryBudgetPctsByMonthUpdatedAt=stamp(); touched=true;
  }
  if(S.budgetTotalByMonth&&S.budgetTotalByMonth[_budMonth]!=null){
    delete S.budgetTotalByMonth[_budMonth];
    S.budgetTotalByMonthUpdatedAt=stamp(); touched=true;
  }
  if(touched) save();
  renderBudget();
};
// Scroll del mouse sube/baja el % (solo si el input esta enfocado, para no
// alterar valores por accidente al pasar el cursor mientras se hace scroll de
// la pagina). Se debounce el guardado: renderBudget() recrea el input y
// perderia el foco si guardaramos en cada tick de la rueda.
// Click en cualquier parte de la pastilla (el `%`, el padding) enfoca el input.
// Sin esto solo contaban los 32px de los digitos, que es justo lo incomodo.
window.bdgPctFocus=function(wrap){
  var el=wrap.firstElementChild;
  if(el&&document.activeElement!==el){ el.focus(); el.select(); }
};
// La rueda SOLO mueve el numero en pantalla. No guarda: guardar dispara
// renderBudget(), que reconstruye las tarjetas y te arranca el foco de debajo del
// cursor a mitad de ajuste. El commit ocurre al salir del campo (bdgPctCommit).
//
// El listener va en el DOCUMENTO, no en cada pastilla: el gesto se ata al foco y
// no a donde este el cursor, asi que una vez seleccionado el campo se ajusta con
// la rueda desde cualquier parte de la pagina. Sin foco no hace nada, que es lo
// que evita cambiar un presupuesto al pasar de largo haciendo scroll.
// passive:false es obligatorio para poder preventDefault y que la pagina no se
// desplace al mismo tiempo; el precio es que mientras el campo este enfocado la
// rueda no scrollea (se sale clickeando fuera).
if(!window._bdgWheelBound){
  window._bdgWheelBound=true;
  document.addEventListener('wheel',function(e){
    var el=document.activeElement;
    if(!el||!el.classList||!el.classList.contains('bdg-lim-inp')) return;
    e.preventDefault();
    var step=parseFloat(el.step)||0.5;
    var cur=parseFloat(el.value)||0;
    el.value=Math.max(0,Math.round((cur+(e.deltaY<0?step:-step))*10)/10);
  },{passive:false});
}
// Al saltar de una pastilla a otra, el blur de la primera guarda y renderBudget()
// reemplaza todas las tarjetas — incluida la que estabas por clickear. El click
// aterriza en un nodo ya desechado y el foco se pierde. Se anota en el pointerdown
// (que ocurre ANTES del blur) a que categoria ibas, y tras el render se re-enfoca.
var _bdgPendingFocus=null;
document.addEventListener('pointerdown',function(e){
  var w=e.target&&e.target.closest?e.target.closest('.bdg-lim-wrap'):null;
  _bdgPendingFocus=w?w.getAttribute('data-cat'):null;
},true);
// Solo se re-enfoca si el pointerdown apuntaba a OTRA pastilla: eso es "estoy
// saltando de una a la siguiente". Si coincide con la que acaba de guardar, la
// bandera quedo vieja (el foco se fue por Tab o por codigo, sin pointerdown nuevo)
// y devolver el foco ahi seria pelearse con el usuario.
function bdgRestoreFocus(fromCat){
  var target=_bdgPendingFocus;
  _bdgPendingFocus=null;
  if(!target||target===fromCat) return;
  var w=document.querySelector('.bdg-lim-wrap[data-cat="'+target.replace(/"/g,'\\"')+'"]');
  if(!w) return;
  var el=w.firstElementChild;
  if(el){ el.focus(); el.select(); }
}
// Commit al perder el foco. Se aplaza un tick para no re-renderizar en medio del
// propio blur.
window.bdgPctCommit=function(el,cat){
  if(!el||el._pctCommitting) return;
  var v=el.value;
  // Sin cambios respecto a lo guardado: no re-renderizar por nada.
  if(String(v)===String(el.defaultValue)){ return; }
  el._pctCommitting=true;
  setTimeout(function(){ saveCategoryPct(cat,v); },0);
};
// Editar un % escribe SIEMPRE el mes visible, igual que el total del hero. Antes
// escribia el global salvo que _budEditScope fuera 'month', y como la fila de
// scope esta oculta (BUDGET_SCOPE_UI) ese scope no se podia elegir: planificar
// septiembre reescribia agosto y todos los meses cerrados sin avisar.
// Vaciar el campo guarda 0 para ESE mes (no hay presupuesto para esa categoria
// este mes), no un hueco que vuelva a heredar el default: para volver al default
// esta el chip "Reset <mes>".
// Editar el % vuelve a poner la categoria bajo el %: si tenia un monto fijo se
// borra, porque si no el monto seguiria mandando y el % que acabas de escribir no
// haria nada visible.
function clearFixedAmt(cat,month){
  var o=(S.categoryBudgetAmtsByMonth||{})[month];
  if(!o||o[cat]==null) return;
  delete o[cat];
  if(!Object.keys(o).length) delete S.categoryBudgetAmtsByMonth[month];
  S.categoryBudgetAmtsByMonthUpdatedAt=stamp();
}
// Limite en USD de una categoria para el mes visible. Vacio o 0 la devuelve al %.
window.saveCategoryAmt=function(cat,val){
  var v=parseFloat(val);
  if(!S.categoryBudgetAmtsByMonth) S.categoryBudgetAmtsByMonth={};
  if(isFinite(v)&&v>0){
    var o=S.categoryBudgetAmtsByMonth[_budMonth]||(S.categoryBudgetAmtsByMonth[_budMonth]={});
    o[cat]=parseFloat(v.toFixed(2));
    S.categoryBudgetAmtsByMonthUpdatedAt=stamp();
  } else clearFixedAmt(cat,_budMonth);
  save(); renderBudget();
};
window.bdgAmtCommit=function(el,cat){ var v=el.value; setTimeout(function(){ saveCategoryAmt(cat,v); },0); };
window.saveCategoryPct=function(cat,val){
  var v=parseFloat(val);
  if(!isFinite(v)||v<0) v=0;
  clearFixedAmt(cat,_budMonth);
  if(_budMonth){
    if(!S.categoryBudgetPctsByMonth) S.categoryBudgetPctsByMonth={};
    var o=S.categoryBudgetPctsByMonth[_budMonth]||(S.categoryBudgetPctsByMonth[_budMonth]={});
    o[cat]=v;
    S.categoryBudgetPctsByMonthUpdatedAt=stamp();
  } else {
    if(!S.categoryBudgetPcts) S.categoryBudgetPcts={};
    if(v>0) S.categoryBudgetPcts[cat]=v; else delete S.categoryBudgetPcts[cat];
    S.categoryBudgetPctsUpdatedAt=stamp();
  }
  save(); renderBudget(); bdgRestoreFocus(cat);
};
// Promedio de gasto por categoria en los 3 meses previos a `anchor` (meses sin
// gasto no bajan el promedio). Anclado al mes que se esta mirando y no a hoy:
// si no, el plan de un mes cambiaria segun cuando lo abras.
function _budHistAvg(anchor){
  var now=anchor?new Date(anchor+'-01T00:00:00'):new Date(), months=[];
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
  var avg=_budHistAvg(_budMonth), pcts={};
  if(kind==='hist'){
    pcts=histAllocPctCore(avg,budgetTotalFor(_budMonth))||{};
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
// getMonths() solo lista meses CON transacciones; el Budget suma el mes en curso,
// que se planifica antes de gastar.
// El mes SIGUIENTE ya no se ofrece: abrirlo antes de tiempo hacia que se repartiera
// con el promedio de los 3 meses previos a EL, que deja afuera el mes en curso
// todavia sin cerrar. Sin esa opcion, el reparto de octubre lo calcula el 1 de
// octubre — con septiembre ya cerrado y contando.
function budgetMonths(){
  var seen={}, out=[];
  getMonths().concat([monthKey(new Date())])
    .forEach(function(m){ if(!seen[m]){ seen[m]=1; out.push(m); } });
  return out.sort().reverse();
}
// Un mes sin plan propio se reparte solo, segun tu gasto real de los 3 meses
// anteriores. Antes caia al % global — que ya no lo escribe nadie desde la UI —
// asi que cada mes nuevo arrancaba practicamente vacio.
// Solo el mes en curso: uno ya cerrado sin plan se quedo sin plan y rellenarlo
// despues falsearia su cierre; y uno futuro (llega aca si tiene una tx con fecha
// adelantada) se repartiria sin contar el mes que todavia corre. Corre una sola vez
// por mes: al escribirlo el mes pasa a tener overrides propios y el guard lo saltea.
function seedMonthPlan(month){
  if(!month||month!==monthKey(new Date())) return;
  var o=(S.categoryBudgetPctsByMonth||{})[month];
  if(o&&Object.keys(o).length) return;
  var pcts=histAllocPctCore(_budHistAvg(month),budgetTotalFor(month));
  if(!pcts) return;
  if(!S.categoryBudgetPctsByMonth) S.categoryBudgetPctsByMonth={};
  S.categoryBudgetPctsByMonth[month]=pcts;
  S.categoryBudgetPctsByMonthUpdatedAt=stamp();
  save();
}
function renderBudget(){
  var months=budgetMonths();
  // Default: el mes en curso, no months[0] (que ahora es el mes SIGUIENTE).
  var curKey=monthKey(new Date());
  if(!_budMonth||months.indexOf(_budMonth)<0) _budMonth=months.indexOf(curKey)>=0?curKey:(months[0]||'');
  seedMonthPlan(_budMonth);
  var month=_budMonth;
  var budTotal=budgetTotalFor(month);
  var income=monthIncome(month);
  var spent=catNetSpend(month, BUDGET_CATS);
  var net=income-spent;
  var savRate=income>0?Math.round((net/income)*100):0;
  var remaining=budTotal-spent;
  var pct=Math.min(100,budTotal>0?Math.round(spent/budTotal*100):0);
  var bc=pct>90?'#E24B4A':pct>70?'#EF9F27':'#1D9E75';
  // Ritmo: proyeccion lineal a fin de mes (solo mes actual, desde el dia 3 para
  // no proyectar ruido de los primeros dias).
  var todayStr=localToday(), isCurMonth=month===todayStr.slice(0,7);
  var dayNum=+todayStr.slice(8,10);
  var dimP=month?(function(){ var p=month.split('-'); return new Date(+p[0],+p[1],0).getDate(); })():30;
  var canPace=isCurMonth&&dayNum>=3;
  var projTotal=canPace&&spent>0?spent/dayNum*dimP:null;

  var monthLbl=month?monthLabel(month):'';
  // ¿el total de este mes es un override o hereda el default?
  var totOvr=(S.budgetTotalByMonth||{})[month]!=null;
  var remColor=remaining>=0?'#4ED9A4':'#E24B4A';
  function bstat(l,v,col){ return '<div class="bdg-stat"><span class="bdg-stat-l">'+l+'</span><span class="bdg-stat-v"'+(col?' style="color:'+col+'"':'')+'>'+v+'</span></div>'; }

  var html='';

  // Header
  html+='<div class="dash-head">'
    +'<span class="dash-eyebrow">Budget</span>'
    +'<select onchange="window._budMonthSel(this.value)">'
    +months.map(function(m){ return '<option value="'+m+'"'+(m===month?' selected':'')+'>'+monthLabel(m)+'</option>'; }).join('')
    +'</select>'
    +'</div>';

  // Top band — hero + donut
  html+='<div class="bdg-top">'
    +'<div class="bdg-hero">'
      +'<div class="bdg-hero-lbl">Remaining'+(monthLbl?' · '+monthLbl:'')+'</div>'
      +'<div class="bdg-hero-val" style="color:'+remColor+'">'+fmtUSD(Math.abs(remaining))+(remaining<0?' over':'')+'</div>'
      +'<div class="bdg-pb"><div class="bdg-pf" style="width:'+pct+'%;background:'+bc+'"></div></div>'
      +'<div class="bdg-hero-sub"><span>'+fmtUSD(spent)+' spent of '
        +'<span class="bdg-total-view'+(totOvr?' is-ovr':'')+'" title="'+(totOvr?monthLbl+' only — tap to edit':'Tap to set the budget for '+monthLbl)+'" onclick="this.style.display=\'none\';var w=this.nextElementSibling;w.style.display=\'inline-flex\';w.querySelector(\'input\').focus()">'+fmtUSD(budTotal)+'</span>'
        // onblur guardaba y cerraba el modo edicion; tocar el chip "+" hacia
        // justamente eso. sumChipTap cancela el blur con preventDefault, pero se
        // deja el chip dentro del wrap para que el foco nunca salga del input.
        +'<span class="bdg-total-edit" style="display:none">$<span class="sum-wrap"><input type="text" inputmode="decimal" id="bud-total" value="'+budTotal+'" onkeydown="if(event.key===\'Enter\')saveBudget()" onblur="saveBudget()"><span class="sum-chip" role="button" aria-label="Add a plus sign" onpointerdown="sumChipTap(event,\'bud-total\')">+</span></span></span>'
        +'</span><span class="bdg-pct">'+pct+'%</span></div>'
      +'<div class="bdg-stats">'
        +bstat('Income',fmtUSD(income),'#5DCAA5')
        +bstat('Spent',fmtUSD(spent),'')
        +bstat('Savings rate',savRate+'%','#9B70F0')
        +(projTotal!=null?bstat('Proyeccion',fmtUSD(projTotal),projTotal>budTotal?'#E24B4A':'#4ED9A4'):'')
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
  var mShort=month?monthName(month,true):'';
  var monthOvr=(S.categoryBudgetPctsByMonth||{})[month]||null;
  var hasOvr=!!(monthOvr&&Object.keys(monthOvr).length)||totOvr;
  // Medidor de asignacion total: cuanto % del presupuesto esta repartido entre
  // las categorias (con overrides del mes visible) y cuanto falta/sobra para 100%.
  var sumPctHead=BUDGET_CATS.reduce(function(s,c){ return s+catPctShown(c,month); },0);
  var allocDiff=Math.round((100-sumPctHead)*10)/10;
  var allocCol=Math.abs(allocDiff)<0.5?'#1D9E75':allocDiff>0?'#EF9F27':'#E24B4A';
  // El % va pegado al titulo y el detalle ("· 20% short") aparte, porque en mobile
  // ese detalle se oculta por CSS: ahi el ancho lo necesitan los botones.
  var ok=Math.abs(allocDiff)<0.5;
  var allocPct=sumPctHead.toFixed(1)+'%'+(ok?' ✓':'');
  var allocDet=ok?'':' · '+Math.abs(allocDiff)+'% '+(allocDiff>0?'short':'over');
  var rollN=BUDGET_CATS.filter(function(c){ return rollOn(c,month); }).length;
  html+='<div class="bdg-cat-head" style="--ac:'+allocCol+'"><span class="cleg" style="margin:0">Categories</span>'
    +'<span class="bdg-alloc" title="Sum of allocated % (target: 100%)"><b>'+allocPct+'</b><i>'+allocDet+'</i></span>'
    // Un solo contenedor para TODOS los chips: antes eran dos <span> block-level
    // y cada boton caia en su propia linea.
    +'<span class="bdg-acts">'
    // La fila de scope hoy esta apagada (BUDGET_SCOPE_UI) pero el rollover se ve igual.
    +'<button class="bdg-scope-btn roll-tgl'+(_rolloverUI?' on':'')+'" title="Carry into '+mShort+' whatever was left over (or overspent) last month. Now: '+rollN+' of '+BUDGET_CATS.length+' categories. Chosen month by month." onclick="window._budRolloverUI()">Rollover</button>'
    +(BUDGET_SCOPE_UI
      ?'<button class="bdg-scope-btn'+(_budEditScope!=='month'?' on':'')+'" onclick="window._budScope(\'default\')">Default</button>'
        +'<button class="bdg-scope-btn'+(_budEditScope==='month'?' on':'')+'" onclick="window._budScope(\'month\')">'+mShort+' only</button>'
        +(hasOvr?'<button class="bdg-scope-btn reset" onclick="window._budResetMonth()">Reset '+mShort+'</button>':'')
        +'<button class="bdg-scope-btn" title="Allocate % from your 3-month average spend" onclick="applyBudgetRec(\'hist\')">3-mo avg</button>'
        +'<button class="bdg-scope-btn" title="50% essentials / 30% lifestyle / 10% business" onclick="applyBudgetRec(\'503020\')">50/30/20</button>'
      // Con la fila oculta no queda ningun boton: el Reset se saco de la cabecera
      // a pedido. window._budResetMonth() sigue existiendo para quitar a mano un
      // override de mes viejo (hoy no hay forma de crear uno nuevo desde la UI).
      :'')
    +'</span></div>'
    // La barra pasa a ser una regla de ancho completo bajo el titulo: separa la
    // cabecera de las cards y a 100% se lee de punta a punta.
    +'<div class="bdg-alloc-rule" style="--ac:'+allocCol+'"><i style="width:'+Math.min(100,sumPctHead)+'%"></i></div>';
  // Elegir a que categorias se les arrastra el sobrante. Se despliega desde el
  // boton para no ocupar una fila permanente por una opcion que se toca una vez.
  if(_rolloverUI){
    var allOn=rollN===BUDGET_CATS.length;
    html+='<div class="bdg-roll-row">'
      +'<span class="bdg-roll-hint">Adds to '+mShort+' whatever was left over in '+monthLabel(prevMonth(month))+', and subtracts what you overspent. Applies to '+mShort+' only: each month is switched on separately.</span>'
      +'<span class="bdg-scope">'
        +'<button class="bdg-scope-btn roll-all" onclick="toggleRolloverAll(\''+month+'\')">'+(allOn?'None':'All')+'</button>'
        +BUDGET_CATS.map(function(c){
          return '<button class="bdg-scope-btn'+(rollOn(c,month)?' on':'')+'" onclick="toggleRolloverCat(\''+c+'\',\''+month+'\')">'+c+'</button>';
        }).join('')+'</span></div>';
  }
  html+='<div class="bdg-cats">';
  var insMonth=prevMonth(month);
  var catInfo=BUDGET_CATS.map(function(cat){
    var s=catNetSpend(month,[cat]);
    var pcta=catPctShown(cat,month);
    var base=catBaseLimit(cat,month);
    var fixed=catFixedAmt(cat,month)!=null;
    // El arrastre mueve SOLO el limite de la categoria. El total del mes, el
    // "Remaining" del hero y el medidor de % siguen siendo los asignados: el
    // rollover reparte distinto, no crea presupuesto.
    var on=rollOn(cat,month), carry=on?catCarry(cat,month):0;
    return {cat:cat,s:s,pct:pcta,base:base,fixed:fixed,lim:catLimitWithCarryCore(base,carry,on),carry:on?carry:0,
      ovr:!!(monthOvr&&monthOvr[cat]!=null)};
  });
  // El input se dimensiona con el largo del numero para que se lea como texto y
  // no como un campo: es el mismo gesto que la pastilla del %.
  function amtInp(cat,ci){
    var v=ci.base>0?parseFloat(ci.base.toFixed(2)):'';
    var w=Math.max(2,String(v||0).length+1);
    return '<span class="bdg-amt-wrap'+(ci.fixed?' is-fixed':'')+'" title="'+(ci.fixed?'Fixed amount for the month':'Month limit — type it in USD and it stays fixed')+'">$'
      +'<input type="number" class="bdg-amt-inp" style="width:'+w+'ch" value="'+v+'" placeholder="0" step="1" min="0" inputmode="decimal"'
      +' onclick="event.stopPropagation()" onblur="bdgAmtCommit(this,\''+cat+'\')"'
      +' onkeydown="if(event.key===\'Enter\')this.blur();if(event.key===\'Escape\'){this.value=this.defaultValue;this.blur();}"></span>';
  }
  catInfo.forEach(function(ci){
    var cat=ci.cat, s=ci.s, catLim=ci.lim;
    var limBase=catLim>0?catLim:budTotal;
    var cp=limBase>0?Math.min(100,Math.round(s/limBase*100)):0;
    var cc=CCOLORS[cat]||'#9B70F0';
    var barC=cp>90?'#E24B4A':cp>70?'#EF9F27':cc;
    // Titular = lo que QUEDA (o lo que te pasaste), no lo gastado: es la pregunta
    // que le haces a la tarjeta. Lo gastado y el limite bajan al pie. Sin limite
    // no hay "queda", asi que ahi el titular vuelve a ser lo gastado.
    var hero=fmtUSD(s), heroLbl='', heroCls='';
    if(catLim>0&&s>catLim){ hero=fmtUSD(s-catLim); heroLbl='over'; heroCls=' is-ovr'; }
    else if(catLim>0){ hero=fmtUSD(catLim-s); heroLbl='left'; }
    // Layout: nombre + input de % (asignacion) en la primera fila; titular grande
    // a la izquierda con su etiqueta (left/over) al ras derecho; barra; y al pie,
    // centrado, gastado of limite. Sin delta mes-a-mes (vive en la card Mes vs mes).
    html+='<div class="bdg-cat">'
      // El nombre va en su propio span: text-overflow:ellipsis no aplica al texto
      // suelto dentro de un contenedor flex, y en mobile "Discretionary" se cortaba
      // en seco ("Discretiona") sin puntos suspensivos.
      +'<div class="bdg-cat-top"><span class="bdg-cat-name"><i class="bdg-dot" style="background:'+cc+'"></i><span class="bdg-cat-txt" title="'+cat+'">'+cat+'</span></span>'
        // onwheel/onclick van en la pastilla y no en el input: asi la rueda se
        // acciona desde cualquier punto de la pastilla (incluido el `%` y el
        // padding) sin que el cursor tape el numero que se esta ajustando.
        // La pastilla entera se tiñe cuando el % es un override del mes, en vez de
        // colgar un punto de 6px al lado: el scope cambia el ALCANCE del valor (un
        // mes vs todos los meses) y eso merece leerse de un vistazo.
        +'<span class="bdg-lim-wrap'+(ci.ovr?' is-ovr':'')+'" data-cat="'+escHtml(cat)+'"'+(ci.ovr?' title="'+mShort+' only — overrides the default %"':'')+' onclick="bdgPctFocus(this)"><input type="number" class="bdg-lim-inp" value="'+(ci.pct>0?ci.pct:'')+'" placeholder="—" step="0.5" min="0" inputmode="decimal" onblur="bdgPctCommit(this,\''+cat+'\')" onkeydown="if(event.key===\'Enter\')this.blur();if(event.key===\'Escape\'){this.value=this.defaultValue;this.blur();}">%</span>'
      +'</div>'
      +'<div class="bdg-cat-hero'+heroCls+'"><span class="bdg-cat-amt">'+hero+'</span>'+(heroLbl?'<span class="bdg-cat-lbl">'+heroLbl+'</span>':'')+'</div>'
      +'<div class="bdg-pb sm"><div class="bdg-pf" style="width:'+cp+'%;background:'+barC+'"></div></div>'
      // El limite del pie se edita en USD igual que el % de arriba: para una
      // categoria de monto fijo (una suscripcion) pensar en % es la cuenta al reves.
      +'<div class="bdg-cat-sub">'+(catLim>0?fmtUSD(s)+' of '+amtInp(cat,ci):amtInp(cat,ci)+' planned')
        +(ci.carry?'<span class="bdg-carry'+(ci.carry<0?' is-neg':'')+'">'+(ci.carry>0?'+':'-')+fmtShortUSD(Math.abs(ci.carry))+' from last month · '+fmtUSD(catLim)+'</span>':'')
      +'</div>'
      +'</div>';
  });
  html+='</div>';

  // Month-vs-month comparison card (siempre desplegada, todas las categorias).
  // Con el mes en curso, comparar al MISMO corte de dia (May 1-12 vs Jun 1-12 vs
  // Jul 1-12): comparar meses completos contra uno a medias no significaba nada.
  // Viendo un mes pasado en el selector, meses completos como siempre.
  (function(){
    var m1=prevMonth(month), m2=prevMonth(m1);          // m2=mas viejo, month=mas nuevo
    var lbl=function(m){ return monthName(m,true); };
    var cut=isCurMonth?dayNum:32;                       // dia de corte (32 = mes completo)
    var per={}, wanted={}; wanted[m2]=1; wanted[m1]=1; wanted[month]=1;
    S.transactions.forEach(function(t){
      var m=t.date.slice(0,7); if(!wanted[m]) return;
      if(+t.date.slice(8,10)>cut) return;
      var k=m+'|'+t.category;
      var e=per[k]||(per[k]={d:0,c:0});
      if(t.type==='Debit') e.d+=t.amountUSD; else if(t.type==='Credit') e.c+=t.amountUSD;
    });
    var cutVal=function(m,cat){ var e=per[m+'|'+cat]; return e?Math.max(0,e.d-e.c):0; };
    var rows='', t2=0, t1=0, t0=0;
    BUDGET_CATS.forEach(function(cat){
      var v2=cutVal(m2,cat), v1=cutVal(m1,cat), v0=cutVal(month,cat);
      t2+=v2; t1+=v1; t0+=v0;
      if(v2===0&&v1===0&&v0===0) return;
      var d=v0-v1, col=d===0?'var(--txt3)':(d>0?'#E24B4A':'#5DCAA5'), arr=d===0?'·':(d>0?'▲':'▼');
      rows+='<div class="mvm-row"><span class="mvm-cat"><i class="bdg-dot" style="background:'+(CCOLORS[cat]||'#9B70F0')+'"></i>'+cat+'</span>'
        +'<span class="mvm-num mvm-pre">'+fmtUSD(v2)+'</span><span class="mvm-num mvm-pre">'+fmtUSD(v1)+'</span><span class="mvm-num">'+fmtUSD(v0)+'</span>'
        +'<span class="mvm-num mvm-delta" style="color:'+col+'">'+arr+' '+(d===0?'—':fmtUSD(Math.abs(d)))+'</span></div>';
    });
    var dT=t0-t1, colT=dT===0?'var(--txt3)':(dT>0?'#E24B4A':'#5DCAA5'), arrT=dT===0?'·':(dT>0?'▲':'▼');
    html+='<div class="mvm-card">'
      +'<span class="cleg" style="margin-bottom:20px">Month vs month'+(isCurMonth?' <span style="text-transform:none;letter-spacing:0;color:var(--txt3)">· through day '+dayNum+'</span>':'')+'</span>'
      +'<div class="mvm-row mvm-head"><span class="mvm-cat">Category</span><span class="mvm-num">'+lbl(m2)+'</span><span class="mvm-num">'+lbl(m1)+'</span><span class="mvm-num">'+lbl(month)+'</span><span class="mvm-num">Δ</span></div>'
      +(rows||'<div style="font-size:14px;color:var(--txt3);padding:10px 2px">No spending in these months.</div>')
      +'<div class="mvm-row mvm-total"><span class="mvm-cat">Total</span><span class="mvm-num mvm-pre">'+fmtUSD(t2)+'</span><span class="mvm-num mvm-pre">'+fmtUSD(t1)+'</span><span class="mvm-num">'+fmtUSD(t0)+'</span><span class="mvm-num mvm-delta" style="color:'+colT+'">'+arrT+' '+(dT===0?'—':fmtUSD(Math.abs(dT)))+'</span></div>'
      +'</div>';
  })();

  // Al pie de la pagina: el resumen del mes se abre solo cuando cambia el mes, y
  // este es el modo de volver a verlo (o de mirar otro mes). Va ultimo porque es
  // un cierre, no un control del budget que estas editando arriba.
  html+='<div class="bdg-close-row"><button class="btn btns" onclick="showMonthClose(\''+month+'\')">View month close · '+monthLabel(month)+'</button></div>';

  // (la config del Monthly Total vive en el hero: 'of $X' tap-to-edit)

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
  // Los tres tipos tracker comparten motor (el balance sale de las txs); lo unico
  // que cambia es debt, que decide con que signo entra al patrimonio y en que
  // grupo se lista. null explicito y no ausente: convertir una deuda de vuelta en
  // tracker comun con el mismo nombre tiene que apagar la marca de verdad.
  var cyEl=document.getElementById('wm-cycle');
  var obj={id:Date.now(),name:name,balance:bal,trackerOnly:type!=='normal',
    debt:type==='lent'?'in':type==='debt'?'out':null,
    // cycle: la deuda va y viene (le prestas de nuevo antes de que termine de
    // pagarte). Solo decide si la fila ofrece el boton de SUMAR ademas del de
    // saldar; no toca ningun numero.
    cycle:!!(cyEl&&cyEl.checked&&(type==='lent'||type==='debt')),
    currency:(type==='normal'&&curSel&&curSel.value==='VES')?'VES':'USD'};
  // Conversion Manual → Tracker (re-agregar con el mismo nombre): conservar el
  // balance mostrado. El tracker suma sus txs, asi que la base se rebasa
  // restando las txs existentes del wallet; sin esto arrancaria desde 0.
  // Cambiar de tipo entre trackers (ej: marcar un tracker que ya existe como "me
  // deben") es solo re-guardarlo con el mismo nombre. El balance base es suyo y no
  // se toca: el campo del form esta oculto para los tipos tracker, asi que tomar su
  // 0 le borraria el saldo.
  if(idx>=0&&type!=='normal'&&S.manualWallets[idx].trackerOnly===true){
    obj.balance=S.manualWallets[idx].balance||0;
    obj.name=S.manualWallets[idx].name;
  }
  if(idx>=0&&type!=='normal'&&S.manualWallets[idx].trackerOnly!==true){
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
// A partir de dos meses el aviso salta y la etiqueta pasa a meses: "hace 74 dias"
// no se lee, "hace 2 meses" si.
var DEBT_STALE_DAYS=60;
function debtAgeLabel(d){
  if(d<=0) return 'today';
  if(d===1) return '1 day';
  if(d<DEBT_STALE_DAYS) return d+' days';
  var m=Math.round(d/30.44);
  return m===1?'1 mo':m+' mo';
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
    if(!canFetchExchanges()) throw new Error('No session');
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
  if(!name){ if(st) st.textContent='Enter a name'; return; }
  var w={id:Date.now(),name:name,type:type,balance:null,updated:null,fetchedAt:null};
  if(type==='bsc'){
    var addr=(document.getElementById('xw-address').value||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(addr)){ if(st) st.textContent='Invalid 0x address'; return; }
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
  renderWallets(); renderSummary();
  closeExchangeForm(); // cierre rapido; el balance aparece en la fila al resolver el fetch
  try{ await fetchExchangeWallet(w); }catch(e){ /* balance queda en — hasta el proximo refresh */ }
  renderWallets(); renderSummary();
};
window.removeExchangeWallet=async function(id){
  if(!await appConfirm('Delete this exchange wallet?','Its keys are removed from this device.','Delete')) return;
  S.exchangeWallets=(S.exchangeWallets||[]).filter(function(w){ return w.id!==id; });
  xkDel(id);
  S.exchangeWalletsUpdatedAt=stamp(); save();
  renderWallets(); renderSummary();
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
  var trackerNames=[], lentNames=[], debtNames=[];
  S.manualWallets.filter(function(w){ return w.trackerOnly; }).forEach(function(w){
    var into=w.debt==='out'?debtNames:w.debt==='in'?lentNames:trackerNames;
    if(into.indexOf(w.name)<0) into.push(w.name);
  });
  // Orden por balance, de mayor a menor.
  var _trkVal=function(n){ var mw=S.manualWallets.find(function(w){return w.name===n;}); return mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(n); };
  trackerNames.sort(function(a,b){ return _trkVal(b)-_trkVal(a); });
  var trackerTotal=trackerNames.reduce(function(s,n){ return s+_trkVal(n); },0);
  [lentNames,debtNames].forEach(function(l){ l.sort(function(a,b){ return _trkVal(b)-_trkVal(a); }); });
  var lentTotal=lentNames.reduce(function(s,n){ return s+_trkVal(n); },0);
  var debtTotal=debtNames.reduce(function(s,n){ return s+_trkVal(n); },0);
  var manualNormal=manualNormalTotal();
  // `assets` es de lo que se reparten la barra, la dona y los %: lo que debes no es
  // una porcion de nada, es plata que ya no es tuya. `grand` (el total del hero) si
  // lo resta, para que coincida con el net worth del dashboard.
  var assets=apiTotal+trackerTotal+lentTotal+manualNormal;
  var grand=assets-debtTotal;
  // ── allocation bar data ──────────────────────────────────────────────
  // Each tracker wallet gets its own segment (palette avoids the exchange hues).
  var TRK_COLORS=['#A78BFA','#2DD4BF','#F472B6','#22D3EE','#84CC16','#F59E0B','#EC4899','#14B8A6'];
  var trkEntries=trackerNames.concat(lentNames).map(function(n,i){
    var mw=S.manualWallets.find(function(w){return w.name===n;});
    var v=mw&&mw.balanceOverride!=null?mw.balanceOverride:calcTrackerBal(n);
    return {nm:n,v:v,col:TRK_COLORS[i%TRK_COLORS.length]};
  });
  var XW_COLS=['#FB923C','#60A5FA','#F472B6','#22D3EE','#A78BFA','#FBBF24'];
  var xwEntries=xwList.map(function(w,i){ return {nm:w.name,v:w.balance||0,col:XW_COLS[i%XW_COLS.length]}; });
  var wvA=xwEntries.concat(trkEntries).concat([
    {nm:'Cash',v:manualNormal,col:'#6B7280'}
  ]).filter(function(a){return a.v>0;}).sort(function(a,b){return b.v-a.v;});
  var wvBar=assets>0?wvA.map(function(a){return '<i style="width:'+(a.v/assets*100).toFixed(2)+'%;background:'+a.col+'"></i>';}).join(''):'';
  var wvLeg=wvA.map(function(a){return '<span class="wm-key"><i style="background:'+a.col+'"></i><span class="wm-key-nm">'+a.nm+'</span><b>'+(assets>0?(a.v/assets*100).toFixed(1):'0')+'%</b></span>';}).join('');

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
    var metaExtra=w.type==='bsc'?'BSC USDT':(noKeys?'Keys are not on this device':'');
    var meta=metaExtra+(metaExtra&&w.updated?' · ':'')+(w.updated?'Updated '+w.updated:'');
    var right=w.balance!=null?balHtml(w.balance):'<span class="wm-bal" style="color:var(--txt3)">—</span>';
    var icK='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
    var acts=(noKeys?'<button class="wico" title="Enter API keys on this device" onclick="setExchangeKeys('+w.id+')">'+icK+'</button>':'')
      +'<button class="wico del" onclick="removeExchangeWallet('+w.id+')">'+icX+'</button>';
    return wmRow('#9B70F0',escHtml(w.name).slice(0,1).toUpperCase(),w.balance!=null?'on':'off',escHtml(w.name),meta||'Connected',right,acts,logo);
  }
  var exRows=!showEx?'':(xwList.map(xwRow).join('')
    ||'<p class="hint" style="padding:8px 4px">No exchanges added yet.</p>');

  // ── Trackers + Manual ─────────────────────────────────────────────────
  // Una sola fabrica para las dos listas: lo unico que cambia es el color, la
  // etiqueta y el verbo del boton. El movimiento es el mismo en los dos casos.
  // Una sola fabrica para los tres tipos: cambia la etiqueta, el color y si hay
  // boton de saldar. El movimiento por debajo es identico.
  function trkRow(name,kind){
    var mw=S.manualWallets.find(function(w){return w.name===name&&w.trackerOnly;});
    var total=_trkVal(name), isDebt=kind==='out';
    var meta='<span class="wm-badge'+(isDebt?' is-debt':'')+'">'+(kind==='in'?'owes you':isDebt?'you owe':'tracker')+'</span>';
    // Hace cuanto que existe ESTA deuda. Solo si hay saldo: a cero no hay deuda
    // de la que contar dias.
    if(kind&&total>0.005){
      var dAge=daysBetweenISO(debtSinceCore(S.transactions,name,mw?(mw.balance||0):0),localToday());
      if(dAge!=null) meta+='<span class="wm-age'+(dAge>=DEBT_STALE_DAYS?' is-stale':'')+'">'+debtAgeLabel(dAge)+' old</span>';
    }
    var right='<span class="wm-bal"'+(isDebt?' style="color:#E24B4A"':'')+'>'+(isDebt?'-':'')+fmtUSD(total)+'</span>';
    var acts='';
    if(mw){
      // El boton de sumar solo aparece si el wallet se marco como ciclo: en una
      // deuda de una sola vez seria un boton que no se usa nunca.
      if(kind&&mw.cycle) acts+='<button class="wico wsettle" onclick="settleTracker('+mw.id+',1)">'+(isDebt?'Borrow':'Lend')+'</button>';
      if(kind&&total>0) acts+='<button class="wico wsettle" onclick="settleTracker('+mw.id+')">'+(isDebt?'Pay':'Collect')+'</button>';
      acts+='<button class="wico" onclick="editTrackerBal('+mw.id+')">'+icP+'</button>';
      acts+='<button class="wico del" onclick="deleteManualWallet('+mw.id+')">'+icX+'</button>';
    }
    return wmRow(isDebt?'#E24B4A':'#A78BFA',escHtml(name).slice(0,1).toUpperCase(),'',escHtml(name),meta,right,acts,walletLogo(name));
  }
  var trRows=trackerNames.map(function(n){ return trkRow(n,null); }).join('');
  // Las dos direcciones en la misma lista: son la misma pregunta ("quien le debe a
  // quien") y separarlas obligaba a mirar dos lugares para saber como estas parado.
  var dbRows=lentNames.map(function(n){ return trkRow(n,'in'); })
    .concat(debtNames.map(function(n){ return trkRow(n,'out'); })).join('');
  // Orden por balance (en USD), de mayor a menor.
  var mnList=S.manualWallets.filter(function(w){return !w.trackerOnly;})
    .slice().sort(function(a,b){ return manualWalletUsd(b)-manualWalletUsd(a); });
  var mnRows=mnList.map(function(w){
    var acts='<button class="wico" onclick="editManualWalletBal('+w.id+')">'+icP+'</button><button class="wico del" onclick="deleteManualWallet('+w.id+')">'+icX+'</button>';
    var isVes=w.currency==='VES';
    var meta=isVes?('Bs '+(w.balance||0).toLocaleString('es-VE')+' · rate '+(vesTxRateSrc()==='p2p'?'USDT':'BCV')):'Manual balance';
    return wmRow('#6B7280',escHtml(w.name).slice(0,1).toUpperCase(),'',escHtml(w.name),meta,balHtml(manualWalletUsd(w)),acts,walletLogo(w.name));
  }).join('');

  // Neto: positivo si te deben mas de lo que debes.
  var debtNet=parseFloat((lentTotal-debtTotal).toFixed(2));
  var manualNormalCount=S.manualWallets.filter(function(w){return !w.trackerOnly;}).length;
  var exCount=showEx?xwList.length:0;
  var walletCount=exCount+trackerNames.length+lentNames.length+debtNames.length+manualNormalCount;
  var notConn=0;

  function htile(lbl,val,col){
    var pct=assets>0?(val/assets*100).toFixed(1):'0';
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
          +(lentTotal>0||debtTotal>0?'<div class="whtile"><span class="whtile-lbl"><i style="background:#E24B4A"></i>Debts</span><span class="whtile-val"'+(debtNet<0?' style="color:#E24B4A"':'')+'>'+(debtNet<0?'-':'')+fmtUSD(Math.abs(debtNet))+'</span><span class="whtile-sub">'+fmtUSD(lentTotal)+' owed to you · '+fmtUSD(debtTotal)+' you owe</span></div>':'')
        +'</div>'
      +'</div>'
      +'<div class="wm-alloc">'+wvBar+'</div>'
      +'<div class="wm-viz">'
        +'<div class="wm-donut-wrap"><canvas id="wm-donut"></canvas></div>'
        +'<div class="wm-legend">'+wvLeg+'</div>'
      +'</div>'
    +'</div>'
    +'<div class="wm-cols wm-cols-'+((showEx?1:0)+3)+'">'
      +(showEx?'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Exchanges</span><span class="wm-group-sum">'+fmtUSD(apiTotal)+'</span></div><div class="wm-rows">'+exRows+'</div><button class="wm-add" onclick="openExchangeForm()">+ Add exchange</button></div>':'')
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Trackers</span><span class="wm-group-sum">'+fmtUSD(trackerTotal)+'</span></div><div class="wm-rows">'+trRows+'</div><button class="wm-add" onclick="openWalletForm(\'tracker\')">+ Add wallet</button></div>'
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Manual</span><span class="wm-group-sum">'+fmtUSD(manualNormal)+'</span></div><div class="wm-rows">'+mnRows+'</div><button class="wm-add" onclick="openWalletForm(\'normal\')">+ Add wallet</button></div>'
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Debts</span><span class="wm-group-sum"'+(debtNet<0?' style="color:#E24B4A"':'')+'>'+(debtNet<0?'-':'')+fmtUSD(Math.abs(debtNet))+'</span></div><div class="wm-rows">'+(dbRows||'<p class="hint" style="padding:8px 4px">Who owes you and who you owe, in one list.</p>')+'</div><div class="wm-add-pair"><button class="wm-add" onclick="openWalletForm(\'lent\')">+ Owed to me</button><button class="wm-add" onclick="openWalletForm(\'debt\')">+ I owe</button></div></div>'
    +'</div>';
  // Skip re-render when unchanged → no flicker / re-animation on tab return.
  if(wHtml!==_walletsSig){ grid.innerHTML=wHtml; _walletsSig=wHtml; }
  // Draw outside the signature guard: the first render happens while the page is
  // hidden (offsetParent null), so the donut must be (re)attempted on every visible render.
  drawWalletDonut(wvA, assets);
}
function drawWalletDonut(data, grand){
  var el=document.getElementById('wm-donut'); if(!el||el.offsetParent===null) return;
  if(!window.Chart){ ensureChart().then(function(){ drawWalletDonut(data,grand); }).catch(function(){}); return; }
  if(window.Chart.getChart(el)) return; // already drawn for this canvas (data unchanged)
  new Chart(el,{type:'doughnut',data:{labels:data.map(function(a){return a.nm;}),datasets:[{data:data.map(function(a){return parseFloat(a.v.toFixed(2));}),backgroundColor:data.map(function(a){return a.col;}),borderWidth:0,spacing:2}]},options:{cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return ctx.label+': '+fmtUSD(ctx.raw)+' ('+(grand>0?(ctx.raw/grand*100).toFixed(1):0)+'%)';}}}},animation:{animateRotate:true,duration:600},responsive:true,maintainAspectRatio:false}});
}


function populateCatSelects(){
  var opts=FORM_CATS.map(function(c){ return '<option>'+c+'</option>'; }).join('');
  var tx=document.getElementById('tx-cat');
  if(tx) tx.innerHTML='<option value="">\u2014</option>'+opts;
  var tf=document.getElementById('tf-cat');
  if(tf){ var cur=tf.value; tf.innerHTML='<option value="">Category</option>'+opts; tf.value=cur; }
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
      var _imp=Date.now()+Math.random();
      S.transactions.push({id:_imp,createdAt:_imp,seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amt,amountVES:null,originalCurrency:'USD',rateUsed:null,imported:!isNotImported,updatedAt:stamp()});
      added++;
    });
    if(added>0) S.transactionsUpdatedAt=stamp();
    save();
    result.innerHTML='<div style="background:var(--color-background-secondary);border-radius:7px;padding:1rem;margin-top:1rem;font-size:13px"><div style="color:#5DCAA5;margin-bottom:5px">Imported: '+added+'</div><div style="color:var(--color-text-secondary)">Skipped duplicates: '+skipped+'</div><button class="btn btnp btns" style="margin-top:9px" onclick="showPage(\'transactions\',null)">View transactions</button></div>';
    renderSummary();
  }});
}

function exportCSV(){
  if(!S.transactions.length){ jsonStatus('No transactions to export.','#E24B4A'); return; }
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
  reader.onload=async function(e){
    try{
      var parsed=JSON.parse(e.target.result);
      if(!parsed.transactions&&!parsed.portfolio){ st.textContent='Invalid backup file.'; st.style.color='#E24B4A'; return; }
      if(!await appConfirm('Restore backup?','This replaces ALL current data with the file, on this device and in the cloud.','Restore')) return;
      S=Object.assign({},S,parsed);
      // Re-estampar todo con un timestamp fresco para que el restore GANE el
      // last-writer-wins del servidor; si no, el merge autoritativo conserva la
      // nube (mas nueva) y el restore se revierte solo en el siguiente pull.
      var n=stamp();
      tsFields().forEach(function(f){ S[f]=n; });
      // createdAt PRIMERO: el re-estampado deja a todas las txs con el mismo
      // updatedAt, asi que si se derivara despues el orden del backup se perderia.
      if(Array.isArray(S.transactions)) backfillTxCreatedAt(S.transactions);
      if(Array.isArray(S.transactions)) S.transactions.forEach(function(t){ t.updatedAt=n; });
      save(); populateWalletSelects(); updateRateUI(); renderSummary();
      st.textContent='Restored: '+(S.transactions||[]).length+' transactions, '+(S.portfolio||[]).length+' holdings.';
      st.style.color='#5DCAA5';
      document.getElementById('json-inp').value='';
    }catch(err){ st.textContent='Error: '+err.message; st.style.color='#E24B4A'; }
  };
  reader.readAsText(file);
}

async function clearAll(){
  if(!await appConfirm('Delete ALL data?','Transactions, wallets, holdings and settings on this device. This cannot be undone.','Delete')) return;
  _slDisabled=true; flushSaveLocal(); localStorage.removeItem('ft13'); location.reload();
}
// El Sign out vivia como confirm() nativo en el onclick del boton; aca usa el
// mismo modal que el resto de la app.
async function signOut(){
  if(!await appConfirm('Sign out?','Your data stays synced in the cloud and comes back when you sign in again.','Sign out')) return;
  logout();
}
window.signOut=signOut;

var _pageInTimer=null;
var _historyCameFrom=null;
// Atajos del manifest (mantener presionado el icono de la PWA en Android). No son
// paginas: #add cae en Transactions y ademas abre el formulario. Cualquier otro
// hash sigue siendo el id de la pagina, como siempre.
var LAUNCH_ACTIONS={add:'transactions'};
var _launchAction=null;
// El formulario se abre DESPUES del pull: antes los selects de wallet estan vacios.
function runLaunchAction(){
  if(_launchAction!=='add') return;
  _launchAction=null;
  try{ openTxForm(); }catch(e){}
}
function showPage(id,btn,arg){
  var pages=['summary','transactions','budget','wallets','holdings','tools','settings','import','history'];
  if(pages.indexOf(id)<0) id='summary';
  // History no vive en el bottom-nav (se entra desde un boton de Summary), asi
  // que a diferencia de un tab normal necesitamos recordar de donde se vino.
  var prevActive=document.querySelector('.page.active');
  var prevId=prevActive?prevActive.id.replace('page-',''):null;
  // Cambiar de tab cierra cualquier bottom-sheet abierto (en mobile quedaban
  // flotando sobre la tab nueva).
  try{
    if(document.getElementById('tx-form-panel').classList.contains('open')) closeTxForm();
    if(document.getElementById('wv-form-panel').classList.contains('open')) closeWalletForm();
    var _xwp=document.getElementById('xw-form-panel');
    if(_xwp&&_xwp.classList.contains('open')) closeExchangeForm();
    setAlertsPopup(false); // el popup de alertas tampoco sobrevive al cambio de tab
    _hbmOpen=null; _applyHbmDrop(); // idem el dropdown mobile
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
  // History es la excepcion: es una pagina secundaria, no un tab del bottom-nav,
  // y entrar sin apilar dejaba SIN entrada a la que volver — el back del sistema
  // salia directo de la app en vez de volver a Summary. Solo se apila al ENTRAR
  // desde otra pagina (prevId!=='history'); de ahi en mas (otro render de
  // History, o salir hacia un tab normal) sigue siendo replaceState in-place.
  if(id==='history'&&prevId!=='history'){
    _historyCameFrom=prevId||'summary';
    try{ history.pushState({historyPage:1},'','#'+id); }catch(e){ window.location.hash=id; }
  } else {
    try{ history.replaceState(null,'','#'+id); }catch(e){ window.location.hash=id; }
  }
  var fab=document.getElementById('fab-add');
  if(fab) fab.style.display=(id==='transactions'?'flex':'none');
  if(id==='summary') renderSummary();
  else if(id==='transactions') renderTx();
  else if(id==='budget') renderBudget();
  else if(id==='wallets') renderWallets();
  else if(id==='holdings'){ renderOnchainWallets(); renderWalletHoldings(); }
  else if(id==='tools'){ renderToolToggles(); renderToolGears(); renderBdvLimits(); fitAllCalcVals(); }
  else if(id==='history') renderHistory(arg||'snapshots');
  else if(id==='settings'){ var ae=document.getElementById('acct-email'); if(ae) ae.textContent=sbGet('sb_email')||''; renderPasskeys(); }
  var sb=document.querySelector('.sb'); if(sb) sb.classList.remove('open');
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

  function fmtTime(id){ return new Date(id).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
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
      +'<div class="snap-col-date"><span class="snap-d">'+fmtDate(r.s.date)+' <span class="snap-time">'+fmtTime(r.s.id)+'</span></span>'+adjLine(r)+'</div>'
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
  document.body.classList.toggle('nav-open');
}
window.toggleSidebar = toggleSidebar;
window.showPage = showPage;
function setTxTab(btn,val){ document.getElementById('tf-type').value=val; document.querySelectorAll('.ttt').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active'); renderTx(); }
function toggleTxFilters(){ document.getElementById('tx-filters-extra').classList.toggle('open'); }
// En movil los selects de categoria/wallet/mes se ocultan al colapsar el panel, pero
// siguen filtrando la lista. El badge dice cuantos hay puestos y la X los limpia,
// asi no queda una lista filtrada sin nada visible que lo explique.
function syncTxFilterState(cF,wF,mF){
  var n=(cF?1:0)+(wF?1:0)+(mF?1:0);
  var btn=document.querySelector('.tx-filter-toggle');
  if(btn) btn.classList.toggle('on',n>0);
  var b=document.getElementById('tf-badge');
  if(b) b.textContent=n||'';
  var c=document.getElementById('tf-clear');
  if(c) c.style.display=n?'':'none';
}
function clearTxFilters(){
  ['tf-cat','tf-wallet','tf-month'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  renderTx();
}
// Movil: la lupa despliega el campo de busqueda; al cerrarlo, limpia el filtro.
function toggleTxSearch(){
  var i=document.getElementById('tf-search');
  if(i.classList.toggle('open')){ i.focus(); }
  else if(i.value){ i.value=''; renderTx(); }
}
window.setTxTab=setTxTab; window.toggleTxFilters=toggleTxFilters; window.toggleTxSearch=toggleTxSearch;
window.clearTxFilters=clearTxFilters;
window.fetchRate = fetchRate;
window.fetchUsdtRate = fetchUsdtRate;
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
    // Back en la pagina de History (la entrada que se apilo al entrar ya se
    // consumio): volver a la pagina de origen en vez de dejar la UI mostrando
    // History con el hash de otra pagina.
    else if(document.getElementById('page-history').classList.contains('active')) showPage(_historyCameFrom||'summary', null);
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
// Atajos de teclado (web): N nueva tx, / buscar, 1-7 tabs, ? esta ayuda. No actuan
// mientras se escribe en un campo ni con el login abierto.
var KB_SHORTCUTS=[
  ['N','New transaction'],
  ['/','Search transactions'],
  ['1'+'–'+'7','Switch tab'],
  ['?','This panel'],
  ['Esc','Close panel / form'],
];
// Se muestra salvo que el puntero sea GRUESO (tactil). Es el complemento exacto
// del @media(pointer:coarse) que enseña el chip "+": o una ayuda o la otra, nunca
// las dos ni ninguna. Preguntar por pointer:fine seria mas estrecho y dejaria sin
// pista a los entornos que reportan pointer:none, donde el teclado si funciona.
function kbHasKeyboard(){ return !(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches); }
window.toggleKbHelp=function(force){
  var ov=document.getElementById('kb-help');
  if(!ov){
    ov=document.createElement('div');
    ov.id='kb-help'; ov.className='kb-help';
    ov.innerHTML='<div class="kb-help-box" role="dialog" aria-label="Keyboard shortcuts">'
      +'<div class="kb-help-ttl">Keyboard shortcuts</div>'
      +KB_SHORTCUTS.map(function(k){
          return '<div class="kb-help-row"><kbd>'+k[0]+'</kbd><span>'+k[1]+'</span></div>';
        }).join('')
      +'</div>';
    ov.addEventListener('click',function(){ window.toggleKbHelp(false); });
    document.body.appendChild(ov);
  }
  var open=force!==undefined?force:!ov.classList.contains('open');
  ov.classList.toggle('open',open);
};
if(!window._kbShortcuts){
  window._kbShortcuts=true;
  document.addEventListener('keydown',function(e){
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    var help=document.getElementById('kb-help');
    var helpOpen=!!(help&&help.classList.contains('open'));
    // Esc cierra la ayuda antes que cualquier otra cosa, y funciona incluso con
    // el foco dentro de un campo.
    if(e.key==='Escape'&&helpOpen){ window.toggleKbHelp(false); return; }
    var t=e.target;
    if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
    var auth=document.getElementById('auth-overlay'); if(auth&&auth.classList.contains('open')) return;
    if(e.key==='?'){ e.preventDefault(); if(kbHasKeyboard()) window.toggleKbHelp(); return; }
    // Con la ayuda abierta, cualquier tecla la cierra antes de ejecutar el atajo:
    // asi se puede leer el panel y usar el atajo en un solo gesto.
    if(helpOpen) window.toggleKbHelp(false);
    if(e.key==='n'||e.key==='N'){ e.preventDefault(); showPage('transactions',null); openTxForm(); }
    else if(e.key==='/'){ e.preventDefault(); showPage('transactions',null); var sIn=document.getElementById('tf-search'); if(sIn) sIn.focus(); }
    else { var tabs={'1':'summary','2':'transactions','3':'budget','4':'wallets','5':'holdings','6':'tools','7':'settings'}; if(tabs[e.key]) showPage(tabs[e.key],null); }
  });
  // Pista permanente: un "?" discreto abajo a la derecha. Sin el, el panel es tan
  // descubrible como los atajos que documenta, o sea nada.
  if(kbHasKeyboard()){
    var hint=document.createElement('button');
    hint.className='kb-hint'; hint.type='button';
    hint.textContent='?';
    hint.title='Keyboard shortcuts (?)';
    hint.setAttribute('aria-label','Keyboard shortcuts');
    hint.onclick=function(){ window.toggleKbHelp(); };
    document.body.appendChild(hint);
  }
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
window.settleTracker = settleTracker;
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
  // De aca para abajo, SIEMPRE append: runMigrations referencia MIGRATIONS[2] (la
  // v3, que corre en cada boot) por indice, y toma la ultima entrada como version
  // vigente. Insertar en el medio rompe las dos cosas.
  { v:4, fn:function(){ // owed:true → debt:'out' (el flag paso a tener tres estados)
    var hit=S.manualWallets.filter(function(w){ return w.owed===true; });
    S.manualWallets.forEach(function(w){ if('owed' in w){ if(w.owed===true) w.debt='out'; delete w.owed; } });
    if(hit.length) S.manualWalletsUpdatedAt=stamp();
  }},
  { v:5, fn:function(){ // rollover plano (valia para todos los meses) → por mes
    var next=migrateRolloverCore(S.rolloverCats,BUDGET_CATS,monthKey(new Date()));
    if(next===S.rolloverCats) return;
    S.rolloverCats=next; S.rolloverCatsUpdatedAt=stamp();
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
  if(_h0&&_h0.indexOf('access_token')<0){
    if(LAUNCH_ACTIONS[_h0]) _launchAction=_h0;
    showPage(LAUNCH_ACTIONS[_h0]||_h0,null);
  }
  // La PWA ya abierta no siempre re-navega al tocar un atajo: puede limitarse a
  // cambiar el hash. Solo reacciona a los atajos — todo lo demas lo maneja el
  // manejador de history que ya existe.
  window.addEventListener('hashchange',function(){
    var h=(location.hash||'').replace('#','');
    if(!LAUNCH_ACTIONS[h]) return;
    _launchAction=h;
    showPage(LAUNCH_ACTIONS[h],null);
    runLaunchAction();
  });
  var today=localToday();
  document.getElementById('tx-date').value=today;
  populateCatSelects();
  populateTxMonth(); // default: All months (value queda '')
  document.getElementById('tf-search').addEventListener('input', function(){ clearTimeout(_srchTimer); _srchTimer=setTimeout(renderTx,220); });
  restoreProfitCalc();
  populateWalletSelects(); updateRateUI(); toggleWmBalField();
  try{ _pendingCount=parseInt(localStorage.getItem('ft13_pending'),10)||0; }catch(e){}
  if(!navigator.onLine){ setSyncStatus('offline','Offline'); updateOfflineBanner(); }
  // Si viene de un enlace de correo, la sesion llega en el fragmento → login directo.
  var justLinked=sbConsumeHashSession();
  // Requiere sesion valida antes de sincronizar. Sin token o refresh rechazado
  // por el servidor → login. 'net' (red caida / 5xx) NO expulsa: se arranca con
  // el token guardado y syncFetch reintenta el refresh cuando haya red.
  var ref=sbGet('sb_at') ? await sbRefresh() : false;
  var authed=justLinked||ref===true||ref==='net';
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
  try{ maybeShowMonthClose(); }catch(e){ console.error('month close:',e); }
  // Marca observable de "el arranque post-pull ya corrio". El e2e esperaba a que
  // subiera pullCount, pero ese contador lo incrementa el SERVIDOR al responder el
  // GET: entre eso y este punto todavia faltan las migraciones, el cierre de mes y
  // el primer render, asi que un chequeo inmediato despues de boot() podia leer un
  // DOM viejo. Una linea aca es mas barata que un sleep adivinado en cada test.
  window.__bootDone=(window.__bootDone||0)+1;
  var hash=(window.location.hash||'').replace('#','');
  // La tab del hash ya se activo en init() (antes del pull). Re-navegarla aqui
  // re-disparaba la animacion de entrada (doble render visible al recargar);
  // si ya estamos en ella, solo refrescar su contenido con los datos del pull.
  var _lp=LAUNCH_ACTIONS[hash]||hash||'summary';
  if(_activePageId()!==_lp) showPage(_lp, null);
  else afterPull();
  runLaunchAction();
  fetchRate(false);
  fetchUsdtRate();
  migrateExchangeWallets(); stripExchangeSecrets();
  renderOnchainWallets();
  fetchWalletHoldings().then(function(){ renderWalletHoldings(); }).catch(function(){});
  fetchCoinPrices().then(function(){ renderManualHoldings(); renderEquityChart(); }).catch(function(){});
  // buy y fee NO se restauran: buy lo llena la tasa Intervencion (updateRateUI) y fee arranca vacio.
  restoreProfitCalc(); // de nuevo tras el pull: la nube puede traer valores mas nuevos
  applyRecurring();
  renderToolToggles(); renderToolGears(); renderBdvLimits(); calcProfit(); calcSpread(); calcBCVEmily();
  autoFetchExchangeWallets();
  scheduleRateRefresh(); // refresco adaptativo del rate (ver rateRefreshDelay; re-entrante, hace clearTimeout)
  // Timers y listeners globales: SOLO una vez por pestana. bootAfterAuth vuelve a
  // correr en cada re-login sin recarga (sesion expirada → overlay → entrar) y
  // sin este guard se acumulaban intervals/listeners duplicados para siempre.
  if(!_timersOn){ _timersOn=true;
    // USDT: cada 5 min con la pestana visible (ahorra invocaciones Vercel; el
    // refetch al volver el foco/visibilidad cubre el timer congelado en mobile).
    setInterval(function(){ if(!document.hidden) fetchUsdtRate(); }, 5*60*1000);
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
}
// Marca que el bundle parseo y ejecuto: lo lee el watchdog inline de index.html.
// Va ANTES de init() a proposito — un error dentro de init() es un bug de la app,
// no un problema de cache, y no debe disparar el borrado de caches + reload.
window.__appBooted = 1;
var BUILD_ID=__BUILD_ID__;
var _bid=document.getElementById('build-id');
if(_bid) _bid.textContent='Build '+BUILD_ID;
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
          if(nw.state!=='activated'||!navigator.serviceWorker.controller) return;
          // El SW nuevo ya controla la pestana, pero el DOM sigue corriendo el
          // bundle viejo hasta un reload. Si no hay nada que perder recargamos
          // solos: en la PWA "reiniciar la app" suele restaurar el documento sin
          // navegar, asi que esperar a que alguien toque el toast dejaba el
          // dispositivo en la version vieja indefinidamente.
          if(canAutoReload()) location.reload(); else showUpdateToast();
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
// Recargar solo es seguro si no hay edicion a medio hacer ni push pendiente.
function canAutoReload(){
  if(_dirty||_pendingCount>0) return false;
  if(document.querySelector('.app-modal-overlay.open')) return false;
  var a=document.activeElement;
  if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  return true;
}
// Escotilla manual: borra caches, desregistra el SW y recarga. Es lo mismo que
// hace heal() ante un bundle roto, pero a pedido — para cuando un deploy no
// termina de bajar a un dispositivo.
window.forceUpdate=function(){
  var st=document.getElementById('build-status');
  if(st) st.textContent='Limpiando cache...';
  var jobs=[];
  if(window.caches) jobs.push(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); }));
  if(navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){ return Promise.all(rs.map(function(r){ return r.unregister(); })); }));
  var go=function(){ location.reload(); };
  Promise.all(jobs).then(go, go);
};
function showUpdateToast(){
  if(document.getElementById('sw-toast')) return;
  var b=document.createElement('div'); b.id='sw-toast'; b.className='sync-banner show';
  b.innerHTML='<span>⬆ New version available.</span><button onclick="location.reload()">Update</button>';
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
