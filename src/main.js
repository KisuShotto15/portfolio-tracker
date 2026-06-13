import './style.css';

var RATE_URL      = 'https://red-rain-afef.efrenalejandro2010.workers.dev/';
var BINANCE_PROXY = 'https://portfolio-tracker-psi-hazel.vercel.app/api/binance-balance';
var ANKR_PROXY    = 'https://portfolio-tracker-psi-hazel.vercel.app/api/ankr-balance';
var SYNC_PROXY    = 'https://portfolio-tracker-psi-hazel.vercel.app/api/sync';
var BYBIT_PROXY   = 'https://portfolio-tracker-psi-hazel.vercel.app/api/bybit-balance';
var OKX_PROXY     = 'https://portfolio-tracker-psi-hazel.vercel.app/api/okx-balance';
var VERCEL_SECRET = 'ptk-2025-kisu';
// Autofill rules: matched against the first word of the note (case-insensitive)
// type: 'Debit'|'Credit', category, currency: 'VES'|'USD', wallet
var AUTOFILL_RULES = [
  { keywords:['income','salario','cobro','pago','freelance','consulting','dividendo','ganancia','utilidad'],                                                                                                       type:'Credit', category:'Income' },
  { keywords:['patodo','madeira','rio','super','chinos','pan','botellon','viveres','abasto','bodega','mercado','automercado','central','polleria','panaderia','carneceria','charcuteria','verduras','frutas','lacteos','huevos','harina','arroz','pasta','embutidos','licoreria'], type:'Debit', category:'Groceries', currency:'VES' },
  { keywords:['remesa','emily'],                                                                                                                                                                             type:'Credit', wallet:'Zelle', category:'Remesa' },
  { keywords:['corpoelec','inter','movistar','digitel','electricidad','cantv','netuno','simpletv','directv','condominio','alquiler','agua','gas','plomero','electricista','pintura','mantenimiento','ferreteria','homemax','reparacion'], type:'Debit', category:'Home', currency:'VES' },
  { keywords:['enviado','transferencia','familia','apoyo','ayuda','envio','giro'],                                                                                                                                 type:'Debit',  category:'Support' },
  { keywords:['uber','taxi','metro','buseta','gasolina','vamos','yummy','ridery','busvero','mototaxi','encomienda','mudanza','estacionamiento','peaje'],                                                            type:'Debit',  category:'Transport', currency:'USD' },
  { keywords:['farmacia','clinica','doctor','medicina','farmatodo','locatel','farmahorro','laboratorio','examen','consulta','dentista','optometro','lentes','analisis','ecografia','rayos','seguro','bioxcell'],    type:'Debit',  category:'Health',    currency:'VES' },
  { keywords:['netflix','spotify','amazon','apple','google','hbo','disney','paramount','youtube','steam','playstation','xbox','ropa','calzado','salon','peluqueria','barbero','regalo','bar','cine','gym','gimnasio'], type:'Debit', category:'Discretionary' },
  { keywords:['yummy','ridery','almuerzo','cena','desayuno','cafe','restaurante','arepera','pizzeria','hamburgesa','sushi','helado','postre'],                                                                      type:'Debit',  category:'Eating Out' },
  { keywords:['bybit','binance','okx','btc','eth','usdt','crypto','bitcoin','trezor','fondos','acciones','circle','crcl','invertido'],                                                                             type:'Debit',  category:'Investments' },
  { keywords:['ahorro','deployed','reserva','guardado','emergencia'],                                                                                                                                             type:'Debit',  category:'Savings' },
];

var SUMMARY_CATS = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support','Investments','Savings'];
var CATS         = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support','Investments','Savings'];
var CCOLORS      = {Income:'#34D399',Home:'#818CF8',Groceries:'#34D399',Transport:'#60A5FA',Health:'#A78BFA',Business:'#FBBF24',Discretionary:'#38BDF8','Eating Out':'#FB923C',Support:'#F59E0B',Investments:'#C084FC',Savings:'#6EE7B7',
  // legacy — kept so old transactions still render with a color
  Services:'#818CF8','Help others':'#F59E0B',Emergency:'#F87171',Zelle:'#a78bfa',Other:'#6B7280'};

var S = {
  rate:null, rateDate:null, rateFetchedAt:null,
  transactions:[], portfolio:[], manualWallets:[],
  budgetTotal:600,
  binanceKey:'', binanceSecret:'',
  binanceBalance:null, binanceUpdated:null, binanceFetchedAt:null,
  bibiBinanceBalance:null, bibiBinanceUpdated:null, bibiBinanceFetchedAt:null,
  bibiBinanceKey:null, bibiBinanceSecret:null,
  bybitBalance:null,   bybitUpdated:null,
  okxBalance:null,     okxUpdated:null,
  trezorBalance:null,  trezorUpdated:null,
  walletHoldings:[],   walletHoldingsUpdated:null,
  onchainWallets:[],   onchainWalletsUpdatedAt:null,
  snapshots:[],
  manualWalletsUpdatedAt:null, portfolioUpdatedAt:null, snapshotsUpdatedAt:null,
  deletedTxIds:[],
  transactionsUpdatedAt:null,
  dashGoal:0,
  categoryBudgets:{}
};
var mChart=null, cChart=null, eChart=null, undoStack=[], redoStack=[];
var _mChartSig=null, _eChartSig=null;           // chart data signatures → skip recreate when unchanged
var _healthSig=null, _healthMSig=null, _goalSig=null, _walletsSig=null; // rendered-HTML signatures → skip re-render (avoids re-animating/flicker on tab return)
var _txLimit=200, _txBase=200, _txFilterSig=''; // tx list pagination state
var _budMonth=null, _budLimitsOpen=false;
var GROUP_ESSENTIAL=['Home','Groceries','Transport','Health'];
var GROUP_BUSINESS=['Business'];
var GROUP_LIFESTYLE=['Discretionary','Eating Out','Support'];
var GROUP_FINANCIAL=['Investments','Savings'];
var syncTimer=null, _srchTimer=null, syncFailed=false, _whCollapsed={};

function setSyncStatus(state, msg){
  var dot=document.getElementById('sync-dot');
  var lbl=document.getElementById('sync-label');
  var colors={synced:'#5DCAA5', syncing:'#EF9F27', offline:'#888', error:'#E24B4A'};
  if(dot){ dot.style.background=colors[state]||'#888'; dot.classList.toggle('is-syncing',state==='syncing'); }
  if(lbl) lbl.textContent=msg||state;
  var sw=document.querySelector('.sb-sync'); if(sw) sw.title=msg||state;
}

function saveLocal(){ try{ localStorage.setItem('ft13',JSON.stringify(S)); }catch(e){} }
function loadLocal(){ try{ var s=localStorage.getItem('ft13'); if(s) S=Object.assign({},S,JSON.parse(s)); }catch(e){} }


// Merge two transaction arrays using per-transaction last-writer-wins (updatedAt).
// Cloud version of a tx wins unless local has a strictly higher updatedAt.
// Local-only transactions (not in cloud) are always preserved.
function mergeTxArrays(localTxs, cloudTxs, deletedSet){
  var localById={};
  localTxs.forEach(function(t){ if(!deletedSet.has(t.id)) localById[t.id]=t; });
  var cloudById={};
  cloudTxs.forEach(function(t){ cloudById[t.id]=t; });
  var merged=[];
  // For every cloud tx not deleted: pick whichever version has higher updatedAt
  cloudTxs.forEach(function(t){
    if(deletedSet.has(t.id)) return;
    var local=localById[t.id];
    if(!local){ merged.push(t); return; }
    // Local wins only if it was explicitly modified more recently
    merged.push((local.updatedAt||0)>(t.updatedAt||0)?local:t);
  });
  // Append local-only txs (not in cloud, not deleted)
  localTxs.forEach(function(t){
    if(!cloudById[t.id]&&!deletedSet.has(t.id)) merged.push(t);
  });
  return merged;
}

async function pushToCloud(){
  try{
    setSyncStatus('syncing','Syncing...');
    // Merge-first: fetch cloud state and merge transactions before pushing.
    // Prevents a stale open tab from overwriting changes made on another device.
    try{
      var cr=await fetch(SYNC_PROXY,{headers:{'X-Api-Secret':VERCEL_SECRET}});
      if(cr.ok){
        var cd=await cr.json();
        if(cd.data){
          var needRender=false;
          // transactions: per-tx last-writer-wins merge
          if(cd.data.transactions){
            var mergedDeleted=new Set((S.deletedTxIds||[]).concat(cd.data.deletedTxIds||[]));
            S.deletedTxIds=Array.from(mergedDeleted);
            var before=JSON.stringify(S.transactions);
            S.transactions=mergeTxArrays(S.transactions,cd.data.transactions,mergedDeleted);
            S.transactionsUpdatedAt=Math.max(S.transactionsUpdatedAt||0,cd.data.transactionsUpdatedAt||0)||null;
            if(JSON.stringify(S.transactions)!==before) needRender=true;
          }
          // snapshots: timestamp-based (local wins if newer, cloud wins if newer)
          if(cd.data.snapshots&&(cd.data.snapshotsUpdatedAt||0)>(S.snapshotsUpdatedAt||0)){
            S.snapshots=cd.data.snapshots;
            S.snapshotsUpdatedAt=cd.data.snapshotsUpdatedAt;
            needRender=true;
          }
          // manualWallets: cloud wins when equal or newer (>= handles null==null case
          // where stale local state would otherwise overwrite cloud changes)
          if(cd.data.manualWallets&&(cd.data.manualWalletsUpdatedAt||0)>=(S.manualWalletsUpdatedAt||0)){
            S.manualWallets=cd.data.manualWallets;
            S.manualWalletsUpdatedAt=cd.data.manualWalletsUpdatedAt;
            needRender=true;
          }
          // portfolio: same
          if(cd.data.portfolio&&(cd.data.portfolioUpdatedAt||0)>=(S.portfolioUpdatedAt||0)){
            S.portfolio=cd.data.portfolio;
            S.portfolioUpdatedAt=cd.data.portfolioUpdatedAt;
            needRender=true;
          }
          if(cd.data.onchainWallets&&(cd.data.onchainWalletsUpdatedAt||0)>=(S.onchainWalletsUpdatedAt||0)){
            S.onchainWallets=cd.data.onchainWallets;
            S.onchainWalletsUpdatedAt=cd.data.onchainWalletsUpdatedAt;
            needRender=true;
          }
          if(needRender){ saveLocal(); sortTx(); renderTx(); renderSummary(); renderWallets(); populateWalletSelects(); }
        }
      }
    }catch(e){ /* continue with push even if merge-pull fails */ }
    var r=await fetch(SYNC_PROXY,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},
      body:JSON.stringify(S)
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    syncFailed=false;
    setSyncStatus('synced','Synced');
    var cs=document.getElementById('cloud-status');
    if(cs) cs.textContent='Last synced: '+new Date().toLocaleTimeString('en-US');
  }catch(e){
    syncFailed=true;
    setSyncStatus('offline','⚠ Cambios sin sincronizar');
    console.warn('push failed:',e.message);
  }
}

async function pullFromCloud(){
  try{
    setSyncStatus('syncing','Loading...');
    var r=await fetch(SYNC_PROXY,{headers:{'X-Api-Secret':VERCEL_SECRET}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    var res=await r.json();
    if(res.data){
      var cloud=res.data;
      // Transactions: per-tx last-writer-wins merge
      if(cloud.transactions){
        var mergedDeleted=new Set((S.deletedTxIds||[]).concat(cloud.deletedTxIds||[]));
        S.deletedTxIds=Array.from(mergedDeleted);
        S.transactions=mergeTxArrays(S.transactions,cloud.transactions,mergedDeleted);
        S.transactionsUpdatedAt=Math.max(S.transactionsUpdatedAt||0,cloud.transactionsUpdatedAt||0)||null;
      }
      // Replace all other fields normally
      var rest=Object.assign({},cloud);
      delete rest.transactions;
      delete rest.deletedTxIds;
      S=Object.assign({},S,rest);
      saveLocal();
      setSyncStatus('synced','Synced');
      return true;
    }
    setSyncStatus('synced','Synced (no cloud data yet)');
    return false;
  }catch(e){
    setSyncStatus('offline','Offline (local only)');
    console.warn('pull failed:',e.message);
    return false;
  }
}

window.addEventListener('online', function(){
  if(syncFailed){ syncFailed=false; pushToCloud(); }
});

function save(){
  saveLocal();
  clearTimeout(syncTimer);
  syncTimer=setTimeout(pushToCloud, 1500);
}

async function forcePull(){
  var cs=document.getElementById('cloud-status');
  if(cs) cs.textContent='Pulling...';
  var ok=await pullFromCloud();
  if(ok){
    populateWalletSelects(); updateRateUI(); sortTx(); renderTx(); renderSummary(); renderWallets();
    if(cs) cs.textContent='Pulled from cloud at '+new Date().toLocaleTimeString('en-US');
  } else {
    if(cs) cs.textContent='No cloud data found.';
  }
}
async function forcePush(){
  var cs=document.getElementById('cloud-status');
  if(cs) cs.textContent='Pushing...';
  await pushToCloud();
}

function snapshot(){ undoStack.push(JSON.stringify(S.transactions)); if(undoStack.length>50) undoStack.shift(); redoStack=[]; updateUndoBtns(); }
function doUndo(){ if(!undoStack.length) return; redoStack.push(JSON.stringify(S.transactions)); S.transactions=JSON.parse(undoStack.pop()); S.transactionsUpdatedAt=Date.now(); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function doRedo(){ if(!redoStack.length) return; undoStack.push(JSON.stringify(S.transactions)); S.transactions=JSON.parse(redoStack.pop()); S.transactionsUpdatedAt=Date.now(); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function updateUndoBtns(){ var u=document.getElementById('btn-undo'),r=document.getElementById('btn-redo'); if(u) u.disabled=!undoStack.length; if(r) r.disabled=!redoStack.length; }
function clearAllTx(){ if(!confirm('Delete ALL transactions? Can be undone with Undo.')) return; snapshot(); S.transactions=[]; S.transactionsUpdatedAt=Date.now(); save(); renderTx(); renderSummary(); }

function isTracker(name,tx){ if(!name) return false; if(tx&&tx.imported) return false; var w=S.manualWallets.find(function(x){ return x.name===name; }); if(!w&&name==='Zelle') return true; return w?w.trackerOnly===true:false; }
function inSummary(t){ return SUMMARY_CATS.indexOf(t.category)>=0; }

async function fetchRate(force){
  var stale=S.rateFetchedAt&&(Date.now()-S.rateFetchedAt>60*60*1000);
  if(!force&&S.rate&&S.rateDate&&!stale){ updateRateUI(); return; }
  document.getElementById('rate-display').textContent='...';
  try{ var r=await fetch(RATE_URL); var d=await r.json(); if(d.rate&&parseFloat(d.rate)>10){ S.rate=parseFloat(parseFloat(d.rate).toFixed(2)); S.rateDate='today ('+d.source+')'; S.rateFetchedAt=Date.now(); save(); updateRateUI(); return; } }catch(e){ console.warn('rate:',e.message); }
  if(!S.rate) showManualRate(); else updateRateUI();
}
function showManualRate(){
  var bar=document.querySelector('.rbar'); if(bar.querySelector('#mr')) return;
  var inp=document.createElement('input'); inp.id='mr'; inp.type='number'; inp.placeholder='Manual rate'; inp.step='0.01';
  inp.style='padding:5px 8px;border:0.5px solid var(--color-border-secondary);border-radius:6px;background:#1e1e1e;color:#fff;font-size:13px;width:120px';
  var b=document.createElement('button'); b.className='btn btns'; b.textContent='OK';
  b.onclick=function(){ var v=parseFloat(inp.value); if(v>0){ S.rate=v; S.rateDate='manual'; save(); updateRateUI(); inp.remove(); b.remove(); } };
  bar.appendChild(inp); bar.appendChild(b);
}
function updateRateUI(){ if(!S.rate) return; var v=S.rate.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}); document.getElementById('rate-display').textContent=v+' Bs/USD'; document.getElementById('rate-date').textContent=S.rateDate||''; var m=document.getElementById('rate-display-m'); if(m) m.textContent=v; }

async function fetchBinanceBalance(){
  var keyEl=document.getElementById('bn-key'); var secEl=document.getElementById('bn-secret');
  if(keyEl&&keyEl.value) S.binanceKey=keyEl.value;
  if(secEl&&secEl.value) S.binanceSecret=secEl.value;
  if(!S.binanceKey||!S.binanceSecret) throw new Error('API key/secret not configured');
  var r=await fetch(BINANCE_PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},body:JSON.stringify({key:S.binanceKey,secret:S.binanceSecret})});
  if(!r.ok){ var e=await r.json().catch(function(){return{};}); throw new Error(e.error||'Vercel proxy error '+r.status); }
  var data=await r.json(); if(data.error) throw new Error(data.error);
  var usdt=Array.isArray(data)?data.find(function(b){return b.asset==='USDT';}):null;
  S.binanceBalance=parseFloat((usdt?parseFloat(usdt.free||0)+parseFloat(usdt.locked||0)+parseFloat(usdt.freeze||0)+parseFloat(usdt.withdrawing||0):0).toFixed(2));
  S.binanceUpdated=new Date().toLocaleTimeString('en-US'); S.binanceFetchedAt=Date.now(); save(); return S.binanceBalance;
}
async function testBinance(){
  var st=document.getElementById('bn-status'); st.textContent='Connecting...'; st.style.color='var(--color-text-secondary)';
  try{ await fetchBinanceBalance(); st.textContent='Connected - Funding USDT: $'+S.binanceBalance.toFixed(2); st.style.color='#5DCAA5'; renderWallets(); renderSummary(); }
  catch(e){ st.textContent='Error: '+e.message; st.style.color='#E24B4A'; }
}
function clearBinance(){ S.binanceBalance=null; S.binanceUpdated=null; S.binanceFetchedAt=null; save(); document.getElementById('bn-status').textContent='Reset.'; renderWallets(); }
var BINANCE_AUTO_MS=5*60*60*1000; // 5 hours
async function autoFetchBinance(){
  if(S.binanceBalance===null) return; // not connected, skip
  var age=S.binanceFetchedAt?Date.now()-S.binanceFetchedAt:Infinity;
  if(age<BINANCE_AUTO_MS) return;
  try{ await fetchBinanceBalance(); renderWallets(); renderSummary(); }catch(e){}
}

async function fetchBibiBinanceBalance(){
  var keyEl=document.getElementById('bbn-key'); var secEl=document.getElementById('bbn-secret');
  if(keyEl&&keyEl.value) S.bibiBinanceKey=keyEl.value;
  if(secEl&&secEl.value) S.bibiBinanceSecret=secEl.value;
  if(!S.bibiBinanceKey||!S.bibiBinanceSecret) throw new Error('API key/secret not configured');
  var r=await fetch(BINANCE_PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},body:JSON.stringify({key:S.bibiBinanceKey,secret:S.bibiBinanceSecret})});
  if(!r.ok){ var e=await r.json().catch(function(){return{};}); throw new Error(e.error||'Vercel proxy error '+r.status); }
  var data=await r.json(); if(data.error) throw new Error(data.error);
  var usdt=Array.isArray(data)?data.find(function(b){return b.asset==='USDT';}):null;
  S.bibiBinanceBalance=parseFloat((usdt?parseFloat(usdt.free||0)+parseFloat(usdt.locked||0)+parseFloat(usdt.freeze||0)+parseFloat(usdt.withdrawing||0):0).toFixed(2));
  S.bibiBinanceUpdated=new Date().toLocaleTimeString('en-US'); S.bibiBinanceFetchedAt=Date.now(); save(); return S.bibiBinanceBalance;
}
async function testBibiBinance(){
  var st=document.getElementById('bbn-status'); st.textContent='Connecting...'; st.style.color='var(--color-text-secondary)';
  try{ await fetchBibiBinanceBalance(); st.textContent='Connected - Funding USDT: $'+S.bibiBinanceBalance.toFixed(2); st.style.color='#5DCAA5'; renderWallets(); renderSummary(); }
  catch(e){ st.textContent='Error: '+e.message; st.style.color='#E24B4A'; }
}
function clearBibiBinance(){ S.bibiBinanceBalance=null; S.bibiBinanceUpdated=null; S.bibiBinanceFetchedAt=null; save(); document.getElementById('bbn-status').textContent='Reset.'; renderWallets(); }
async function autoFetchBibiBinance(){
  if(S.bibiBinanceBalance===null) return;
  var age=S.bibiBinanceFetchedAt?Date.now()-S.bibiBinanceFetchedAt:Infinity;
  if(age<BINANCE_AUTO_MS) return;
  try{ await fetchBibiBinanceBalance(); renderWallets(); renderSummary(); }catch(e){}
}

async function fetchBybitBalance(){
  var r=await fetch(BYBIT_PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},body:'{}'}); if(!r.ok) throw new Error('Bybit '+r.status);
  var d=await r.json(); if(d.error) throw new Error(d.error);
  var list=(d.result&&d.result.list)||[]; var total=0;
  list.forEach(function(acc){ var usdt=acc.coin&&acc.coin.find(function(c){ return c.coin==='USDT'; }); if(usdt) total+=parseFloat(usdt.walletBalance||0); });
  S.bybitBalance=parseFloat(total.toFixed(2)); S.bybitUpdated=new Date().toLocaleTimeString('en-US'); save(); return S.bybitBalance;
}
async function testBybit(){
  var st=document.getElementById('bb-status'); st.textContent='Connecting...'; st.style.color='var(--color-text-secondary)';
  try{ await fetchBybitBalance(); st.textContent='Connected - USDT: $'+S.bybitBalance.toFixed(2); st.style.color='#5DCAA5'; renderWallets(); renderSummary(); }
  catch(e){ st.textContent='Error: '+e.message; st.style.color='#E24B4A'; }
}
function clearBybit(){ S.bybitBalance=null; S.bybitUpdated=null; save(); document.getElementById('bb-status').textContent='Reset.'; renderWallets(); }

async function fetchOKXBalance(){
  var r=await fetch(OKX_PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},body:'{}'}); if(!r.ok) throw new Error('OKX '+r.status);
  var d=await r.json(); if(d.error) throw new Error(d.error);
  var details=(d.data&&d.data[0]&&d.data[0].details)||[];
  var usdt=details.find(function(c){ return c.ccy==='USDT'; });
  S.okxBalance=parseFloat(parseFloat((usdt&&usdt.cashBal)||0).toFixed(2)); S.okxUpdated=new Date().toLocaleTimeString('en-US'); save(); return S.okxBalance;
}
async function testOKX(){
  var st=document.getElementById('okx-status'); st.textContent='Connecting...'; st.style.color='var(--color-text-secondary)';
  try{ await fetchOKXBalance(); st.textContent='Connected - USDT: $'+S.okxBalance.toFixed(2); st.style.color='#5DCAA5'; renderWallets(); renderSummary(); }
  catch(e){ st.textContent='Error: '+e.message; st.style.color='#E24B4A'; }
}
function clearOKX(){ S.okxBalance=null; S.okxUpdated=null; save(); document.getElementById('okx-status').textContent='Reset.'; renderWallets(); }

var TREZOR_ADDRESS = '0xe0c19374255aCDA45aC2727A5359f0Cfe59cF29B';
var BSC_RPC        = 'https://bsc-dataseed.binance.org/';
var BSC_USDT       = '0x55d398326f99059fF775485246999027B3197955';
async function fetchTrezorBalance(){
  var padded = '000000000000000000000000' + TREZOR_ADDRESS.slice(2).toLowerCase();
  var data   = '0x70a08231' + padded;
  var res = await fetch(BSC_RPC, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', method:'eth_call', params:[{to:BSC_USDT, data:data},'latest'], id:1 })
  });
  var json = await res.json();
  if(json.error) throw new Error(json.error.message);
  var balance = parseInt(json.result, 16) / 1e18;
  S.trezorBalance = parseFloat(balance.toFixed(2));
  S.trezorUpdated = new Date().toLocaleTimeString('en-US');
  save(); return S.trezorBalance;
}

async function fetchWalletHoldings(){
  var wallets = S.onchainWallets||[];
  if(!wallets.length){ S.walletHoldings=[]; S.walletHoldingsUpdated=new Date().toLocaleTimeString('en-US'); save(); return []; }
  var r=await fetch(ANKR_PROXY,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Secret':VERCEL_SECRET},body:JSON.stringify({wallets:wallets})});
  if(!r.ok){ var e=await r.json().catch(function(){return{};}); throw new Error(e.error||'Proxy error '+r.status); }
  var data=await r.json();
  if(data.error) throw new Error(data.error);
  S.walletHoldings=Array.isArray(data)?data:[];
  S.walletHoldingsUpdated=new Date().toLocaleTimeString('en-US');
  save(); return S.walletHoldings;
}
function renderWalletHoldings(){
  var wrap=document.getElementById('wh-wrap');
  var upd=document.getElementById('wh-updated');
  if(!wrap) return;
  if(upd&&S.walletHoldingsUpdated) upd.textContent='Updated '+S.walletHoldingsUpdated;
  renderOnchainWallets();
  var MIN_USD=1;
  var data=(S.walletHoldings||[]).filter(function(h){ return h.balanceUsd>=MIN_USD; });
  var wallets=S.onchainWallets||[];
  if(!wallets.length){ wrap.innerHTML=''; return; }
  if(!data.length){ wrap.innerHTML=emptyState('No holdings found','Click Refresh to load live balances'); return; }
  var netLabel={'eth':'Ethereum','arbitrum':'Arbitrum','base':'Base','bsc':'BNB Chain','bitcoin':'Bitcoin'};
  var netColor={'eth':'#378ADD','arbitrum':'#7F77DD','base':'#5BA4F5','bsc':'#EF9F27','bitcoin':'#F7931A'};
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
  var el=document.getElementById('hld-donut'); if(!el||!window.Chart) return;
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
  S.onchainWalletsUpdatedAt=Date.now();
  document.getElementById('ow-label').value='';
  document.getElementById('ow-addr').value='';
  save(); renderOnchainWallets();
}
function deleteOnchainWallet(id){
  S.onchainWallets=(S.onchainWallets||[]).filter(function(w){ return w.id!==id; });
  S.onchainWalletsUpdatedAt=Date.now();
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
  try{ await fetchWalletHoldings(); renderWalletHoldings(); }
  catch(e){ console.error('fetchWalletHoldings:',e); if(wrap) wrap.innerHTML='<div class="empty" style="color:#E24B4A">Error: '+(e.message||e.toString())+'</div>'; }
  finally{ if(btn){ btn.disabled=false; btn.textContent='↺ Refresh'; } }
}

function toggleVesHint(){ var on=document.getElementById('tx-cur').value==='VES'; document.getElementById('ves-hint').style.display=on?'inline':'none'; if(on) updateVesPreview(); }

function autofillFromNote(){
  if(window.editingTxId) return; // never autofill while editing an existing tx
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
function updateVesPreview(){ var a=parseFloat(document.getElementById('tx-amount').value)||0; document.getElementById('usd-preview').textContent=(S.rate&&a>0)?(a/S.rate).toFixed(2):'-'; }

function addTx(){
  var date=document.getElementById('tx-date').value;
  var desc=document.getElementById('tx-desc').value.trim();
  var wallet=document.getElementById('tx-wallet').value;
  var type=document.getElementById('tx-type').value;
  var cat=document.getElementById('tx-cat').value;
  var cur=document.getElementById('tx-cur').value;
  var amt=parseFloat(document.getElementById('tx-amount').value);
  if(!date||!desc||isNaN(amt)||amt<=0){ alert('Date, note and amount are required'); return; }
  var amtUSD=amt, amtVES=null;
  if(cur==='VES'){ if(!S.rate){ alert('Rate not available'); return; } amtVES=amt; amtUSD=parseFloat((amt/S.rate).toFixed(4)); }
  snapshot();
  var _now=Date.now();
  S.transactions.push({id:_now,seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:cur==='VES'?S.rate:null,imported:false,updatedAt:_now});
  S.transactionsUpdatedAt=_now;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  save(); renderTx(); renderSummary();
  closeTxForm();
}

function deleteTx(id){ snapshot(); if(!S.deletedTxIds) S.deletedTxIds=[]; S.deletedTxIds.push(id); S.transactions=S.transactions.filter(function(t){ return t.id!==id; }); S.transactionsUpdatedAt=Date.now(); save(); renderTx(); renderSummary(); }

var editingTxId = null;
function editTx(id){
  var t=S.transactions.find(function(x){ return x.id===id; }); if(!t) return;
  editingTxId=id;
  document.getElementById('tx-date').value=t.date;
  document.getElementById('tx-desc').value=t.desc;
  document.getElementById('tx-wallet').value=t.wallet||'';
  document.getElementById('tx-type').value=t.type;
  document.getElementById('tx-cat').value=t.category;
  document.getElementById('tx-cur').value=t.originalCurrency||'USD';
  document.getElementById('tx-amount').value=t.originalCurrency==='VES'&&t.amountVES?t.amountVES:t.amountUSD;
  toggleVesHint();
  var btn=document.querySelector('.btn-add');
  btn.textContent='Confirm';
  var cancelBtn=document.getElementById('btn-cancel-edit'); if(cancelBtn) cancelBtn.style.display='';
  document.getElementById('tx-desc').scrollIntoView({behavior:'smooth',block:'center'});
  openTxForm();
}
function cancelEditTx(){
  closeTxForm();
}
function openTxForm(){
  if(!editingTxId) document.getElementById('tx-date').value=localToday();
  document.getElementById('tx-form-panel').classList.add('open');
  document.getElementById('tx-overlay').classList.add('open');
  document.getElementById('fab-add').style.display='none';
  setTimeout(function(){ var d=document.getElementById('tx-desc'); if(d) d.focus(); },120);
}
function closeTxForm(){
  editingTxId=null;
  var btn=document.querySelector('.btn-add'); if(btn) btn.textContent='Add';
  var cb=document.getElementById('btn-cancel-edit'); if(cb) cb.style.display='none';
  var today=localToday();
  document.getElementById('tx-date').value=today;
  document.getElementById('tx-desc').value='';
  document.getElementById('tx-wallet').value='';
  document.getElementById('tx-type').value='Debit';
  document.getElementById('tx-cat').value='';
  document.getElementById('tx-amount').value='';
  document.getElementById('tx-cur').value='USD';
  toggleVesHint();
  document.getElementById('tx-form-panel').classList.remove('open');
  document.getElementById('tx-overlay').classList.remove('open');
  document.getElementById('fab-add').style.display='flex';
}
function openWalletForm(){
  document.getElementById('wv-form-panel').classList.add('open');
  document.getElementById('wv-overlay').classList.add('open');
  setTimeout(function(){ var d=document.getElementById('wm-name'); if(d) d.focus(); },120);
}
function closeWalletForm(){
  document.getElementById('wv-form-panel').classList.remove('open');
  document.getElementById('wv-overlay').classList.remove('open');
  document.getElementById('wm-name').value='';
  document.getElementById('wm-bal').value='';
  document.getElementById('wm-type').value='tracker';
  toggleWmBalField();
}
function toggleWmBalField(){
  var f=document.getElementById('wm-bal-field');
  if(f) f.style.display=document.getElementById('wm-type').value==='normal'?'flex':'none';
}
function addTxOrUpdate(){
  if(editingTxId) updateTx(); else addTx();
}
function updateTx(){
  var date=document.getElementById('tx-date').value;
  var desc=document.getElementById('tx-desc').value.trim();
  var wallet=document.getElementById('tx-wallet').value;
  var type=document.getElementById('tx-type').value;
  var cat=document.getElementById('tx-cat').value;
  var cur=document.getElementById('tx-cur').value;
  var amt=parseFloat(document.getElementById('tx-amount').value);
  if(!date||!desc||isNaN(amt)||amt<=0){ alert('Date, note and amount are required'); return; }
  var amtUSD=amt, amtVES=null;
  if(cur==='VES'){ if(!S.rate){ alert('Rate not available'); return; } amtVES=amt; amtUSD=parseFloat((amt/S.rate).toFixed(4)); }
  snapshot();
  var t=S.transactions.find(function(x){ return x.id===editingTxId; });
  var _now=Date.now();
  if(t){ t.date=date; t.desc=desc; t.wallet=wallet; t.type=type; t.category=cat; t.originalCurrency=cur; t.amountUSD=amtUSD; t.amountVES=amtVES; t.rateUsed=cur==='VES'?S.rate:null; t.updatedAt=_now; }
  S.transactionsUpdatedAt=_now;
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  cancelEditTx(); save(); renderTx(); renderSummary();
}
async function deleteManualWallet(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var ok=await appConfirm('Delete wallet?',escHtml(w.name),'Delete'); if(!ok) return; S.manualWallets=S.manualWallets.filter(function(x){ return x.id!==id; }); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); populateWalletSelects(); }
async function renameManualWallet(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var r=await appPrompt('Rename wallet',escHtml(w.name),w.name,{inputType:'text'}); if(!r||!r.value||!r.value.trim()||r.value.trim()===w.name) return; w.name=r.value.trim(); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); populateWalletSelects(); }
window.renameManualWallet=renameManualWallet;
async function editManualWalletBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var r=await appPrompt('New balance',escHtml(w.name),w.balance); if(!r) return; var v=parseFloat(r.value); if(isNaN(v)) return; w.balance=parseFloat(v.toFixed(2)); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); renderSummary(); }
window.editManualWalletBal=editManualWalletBal;

function emptyState(title, sub){
  return '<div class="es"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:.25;margin-bottom:.75rem"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="12" y2="15"/></svg><div class="es-title">'+title+'</div><div class="es-sub">'+sub+'</div></div>';
}
function localToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseAmt(s){ return parseFloat(String(s||0).replace(/[$,\s]/g,''))||0; }
function fmtUSD(v){ return '$'+parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function tagCat(cat){ var m={Income:'tG',Home:'tP',Groceries:'tG',Transport:'tB',Health:'tG',Business:'tA',Discretionary:'tB','Eating Out':'tA',Support:'tA',Investments:'tA',Savings:'tG',
  Services:'tP','Help others':'tA',Emergency:'tR',Zelle:'tZ',Other:'tX'}; return m[cat]||'tX'; }
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
  'Remesa':       {bg:'#1a3a5c', svg:'<line x1="2" y1="8" x2="11" y2="8"/><polyline points="8 5 11 8 8 11"/><path d="M11 3h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2"/>'},
};
function catIcon(cat){
  var m=CAT_META[cat]||{bg:'#252535',svg:''};
  return '<span class="cat-ico" style="background:'+m.bg+'"><svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+m.svg+'</svg></span>';
}

function loadMoreTx(){ _txLimit+=_txBase; renderTx(); }
window.loadMoreTx=loadMoreTx;
function renderTx(){
  var wrap=document.getElementById('tx-wrap');
  var tF=document.getElementById('tf-type').value, cF=document.getElementById('tf-cat').value, wF=document.getElementById('tf-wallet').value, mF=document.getElementById('tf-month').value, sF=(document.getElementById('tf-search').value||'').toLowerCase().trim();
  // Reset pagination whenever the filter set changes (loadMoreTx keeps the same filters → no reset).
  var fSig=tF+'|'+cF+'|'+wF+'|'+mF+'|'+sF;
  if(fSig!==_txFilterSig){ _txLimit=_txBase; _txFilterSig=fSig; }
  // Single pass: sort once, then one combined filter instead of 5 chained passes.
  var data=sortTx(S.transactions);
  if(tF||cF||wF||mF||sF){
    data=data.filter(function(t){
      if(tF&&t.type!==tF) return false;
      if(cF&&t.category!==cF) return false;
      if(wF&&t.wallet!==wF) return false;
      if(mF&&!t.date.startsWith(mF)) return false;
      if(sF&&!((t.desc||'').toLowerCase().indexOf(sF)>=0||(t.wallet||'').toLowerCase().indexOf(sF)>=0||(t.category||'').toLowerCase().indexOf(sF)>=0||(t.date||'').indexOf(sF)>=0)) return false;
      return true;
    });
  }
  if(!data.length){ wrap.innerHTML=emptyState('No transactions yet','Use the + button to add your first transaction'); return; }
  var totalDebits=data.reduce(function(s,t){ return s+(t.type==='Debit'&&inSummary(t)?t.amountUSD:0); },0);
  // Only build DOM for the first _txLimit rows; the rest load on demand (keeps innerHTML small).
  var shown=data.length>_txLimit?data.slice(0,_txLimit):data;
  // Group by date — single table with separator rows so columns stay aligned
  var groups={}, groupOrder=[];
  shown.forEach(function(t){ if(!groups[t.date]){ groups[t.date]=[]; groupOrder.push(t.date); } groups[t.date].push(t); });
  function fmtDateHdr(d){
    var today=localToday();
    var yd=new Date(); yd.setDate(yd.getDate()-1);
    var yest=yd.getFullYear()+'-'+String(yd.getMonth()+1).padStart(2,'0')+'-'+String(yd.getDate()).padStart(2,'0');
    return d===today?'Today':d===yest?'Yesterday':new Date(d+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  }
  var rows=groupOrder.map(function(date){
    var dayTotal=groups[date].reduce(function(s,t){ return s+(t.type==='Debit'&&inSummary(t)?t.amountUSD:0); },0);
    var sep='<tr class="date-sep"><td colspan="8"><div class="dsep-inner"><span class="dsep-lbl">'+fmtDateHdr(date)+'</span>'+(dayTotal>0?'<span class="dsep-sep">·</span><span class="dsep-total">-'+fmtUSD(dayTotal)+'</span>':'')+'</div></td></tr>';
    var txRows=groups[date].map(function(t){
      var orig=t.originalCurrency==='VES'&&t.amountVES?'Bs '+t.amountVES.toLocaleString('es-VE'):'';
      var isTrk=isTracker(t.wallet,t); var col=isTrk?'#a78bfa':(t.type==='Credit'?'#5DCAA5':'#E24B4A');
      var trk=isTrk?'<span class="badge-t">tracker</span>':'';
      var wTag=t.wallet==='Binance'?'tBinance':'tX';
      var txType=isTrk?'tx-tracker':(t.type==='Debit'?'tx-debit':'tx-credit');
      var sub=escHtml(t.wallet||'')+(t.category?' · '+escHtml(t.category):'');
      var origM=orig?'<span class="td-orig-m">'+orig+'</span>':'';
      var mCol=isTrk?'var(--accent)':(t.type==='Credit'?'#5DCAA5':'var(--txt)');
      return '<tr class="tx-row '+txType+'" onclick="selectTxRow(this)">'
        +'<td class="td-icon">'+catIcon(t.category)+'</td>'
        +'<td class="td-desc" title="'+escHtml(t.desc)+'">'
        +  '<span class="td-desc-txt">'+escHtml(t.desc)+'</span>'
        +  '<span class="td-sub">'+sub+'</span>'
        +'</td>'
        +'<td class="td-wallet"><span class="tag '+wTag+'">'+escHtml(t.wallet||'-')+'</span>'+trk+'</td>'
        +'<td class="td-type"><span class="tag '+(t.type==='Debit'?'tR':'tG')+'">'+t.type+'</span></td>'
        +'<td class="td-cat">'+(t.category?'<span class="tag '+tagCat(t.category)+'">'+escHtml(t.category)+'</span>':'<span style="color:var(--color-text-secondary);font-size:12px">—</span>')+'</td>'
        +'<td class="td-orig">'+orig+'</td>'
        +'<td class="td-amt">'
        +  '<span class="td-amt-val td-amt-mob" style="color:'+mCol+'">'+(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD)+'</span>'
        +  '<span class="td-amt-val td-amt-desk" style="color:'+mCol+'">'+(t.type==='Credit'?'+':'-')+fmtUSD(t.amountUSD)+'</span>'
        +  origM
        +'</td>'
        +'<td class="td-act"><button class="btn-edit-tx" title="Edit" onclick="event.stopPropagation();editTx('+t.id+')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg></button><button class="btn-edit-tx btn-del-tx" title="Delete" onclick="event.stopPropagation();deleteTx('+t.id+')"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg></button></td>'
      +'</tr>';
    }).join('');
    return sep+txRows;
  }).join('');
  var remaining=data.length-shown.length;
  var moreBtn=remaining>0?'<div style="text-align:center;margin-top:18px"><button class="btn btns" onclick="loadMoreTx()">Mostrar '+Math.min(_txBase,remaining)+' mas · '+remaining+' restantes</button></div>':'';
  wrap.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.875rem">'+data.length+' records &middot; Total debits: <strong style="color:#E24B4A">'+fmtUSD(totalDebits)+'</strong></div>'
    +'<table class="tx-table"><thead><tr><th></th><th>Note</th><th>Wallet</th><th>In/Out</th><th>Category</th><th>Original</th><th>USD</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'+moreBtn;
}

function getMonths(){ var all=S.transactions.map(function(t){ return t.date.slice(0,7); }); var u=all.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort().reverse(); if(!u.length) u.push(new Date().toISOString().slice(0,7)); return u; }
function populateSumMonth(){ var sel=document.getElementById('sum-month'); var cur=sel.value; var months=getMonths(); sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+m+'</option>'; }).join(''); if(cur&&months.indexOf(cur)>=0) sel.value=cur; }

function groupSum(txDebit, cats){ return cats.reduce(function(s,c){ return s+txDebit.filter(function(t){ return t.category===c; }).reduce(function(a,t){ return a+t.amountUSD; },0); },0); }

// ── Dashboard helpers ──────────────────────────────────────────────────────
var EXPENSE_CATS_DASH=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);

// Net spending for a category in a month: debits - credits (refunds reduce spend)
function catNetSpend(month, cats){
  var txM=S.transactions.filter(function(t){ return t.date.startsWith(month)&&(cats.indexOf(t.category)>=0); });
  var d=txM.filter(function(t){ return t.type==='Debit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var c=txM.filter(function(t){ return t.type==='Credit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  return Math.max(0, d-c);
}

function getAvgMonthlyOutflows(){
  var now=new Date(); var months=[];
  for(var i=0;i<3;i++){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
  var totals=months.map(function(m){ return catNetSpend(m, EXPENSE_CATS_DASH); });
  var nz=totals.filter(function(v){ return v>0; });
  return nz.length>0?nz.reduce(function(s,v){ return s+v; },0)/nz.length:0;
}

function getAvgMonthlyContribution(){
  var now=new Date(); var months=[];
  for(var i=0;i<3;i++){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
  var nets=months.map(function(m){
    var inc=S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    var exp=catNetSpend(m, EXPENSE_CATS_DASH);
    return inc-exp;
  });
  var nz=nets.filter(function(v){ return v>0; });
  return nz.length>0?nz.reduce(function(s,v){ return s+v; },0)/nz.length:0;
}

function getSnapshotPnL(){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(snaps.length<2) return [];
  var results=[];
  for(var i=1;i<snaps.length;i++){
    var s1=snaps[i-1],s2=snaps[i];
    var txBetween=S.transactions.filter(function(t){ return t.date>=s1.date&&t.date<=s2.date&&t.category==='Investments'; });
    var invOut=txBetween.filter(function(t){ return t.type==='Debit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    var invIn=txBetween.filter(function(t){ return t.type==='Credit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    results.push({ from:s1.date,to:s2.date,snap1:s1.total,snap2:s2.total,invOut:invOut,invIn:invIn,profit:(s2.total-s1.total)+invOut-invIn });
  }
  return results;
}

// ── Dashboard render sections ──────────────────────────────────────────────
function prevMonth(month){
  var p=month.split('-'); var y=parseInt(p[0]), m=parseInt(p[1])-1;
  var d=new Date(y,m-1,1);
  return d.toISOString().slice(0,7);
}

function getMonthlyKPIs(month){
  // Net Worth = last snapshot of (or before) the month's end
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var monthEnd=month+'-31';
  var snapsBefore=snaps.filter(function(s){ return s.date<=monthEnd; });
  var netWorth=snapsBefore.length>0?snapsBefore[snapsBefore.length-1].total:null;
  // Tx for month
  var txM=S.transactions.filter(function(t){ return t.date.startsWith(month)&&inSummary(t); });
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
  document.getElementById('kpi-strip').innerHTML='<div class="kpi-strip">'
    +kpi('Net Worth',fmtUSD(nwDisplay),snapsDesc.length>0?'as of '+snapsDesc[0].date:'live estimate','#fff',fmtDelta(cur.netWorth,prev.netWorth))
    +kpi('Monthly Return',retVal,retSub,retColor,fmtDelta(cur.monthlyReturn,prev.monthlyReturn,{abs:true}))
    +kpi('Savings Rate',cur.savRate!==null?cur.savRate+'%':'—','of net flow',savColor,fmtDelta(cur.savRate,prev.savRate))
    +kpi('Emergency Fund',emgVal,emgSub,emgColor,fmtDelta(cur.emgMo,prev.emgMo))
    +kpi('Goal Progress',cur.goalPct!==null?cur.goalPct.toFixed(1)+'%':'—',S.dashGoal>0?'of '+fmtUSD(S.dashGoal):'set a goal below','#9B70F0',fmtDelta(cur.goalPct,prev.goalPct))
    +'</div>';
}

// ── Health Score ───────────────────────────────────────────────────────────
function getWalletShares(){
  var shares={};
  shares['Binance']=S.binanceBalance||0;
  shares['Bibi Binance']=S.bibiBinanceBalance||0;
  shares['Bybit']=S.bybitBalance||0;
  shares['OKX']=S.okxBalance||0;
  shares['Trezor']=S.trezorBalance||0;
  shares['Zelle']=calcTrackerBal('Zelle');
  S.manualWallets.forEach(function(w){
    var bal=w.trackerOnly?calcTrackerBal(w.name):w.balance;
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
  var nowMonth=new Date().toISOString().slice(0,7);
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
        +item('Growth',growthPts)+item('Diversif.',divPts)+item('Savings',savPts)+item('Emergency',emgPts)
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
          +item('Growth',growthPts)+item('Diversif.',divPts)+item('Savings',savPts)+item('Emergency',emgPts)
        +'</div>'
      +'</div>'
    +'</div>';
    var alertItems=aAlerts.map(function(a){
      var dot=a.sev==='crit'?'#E24B4A':'#EF9F27';
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
  var curMonth=now.toISOString().slice(0,7);

  // 1. Overspend per category (current month vs 3-month avg excluding current)
  EXPENSE_CATS_DASH.forEach(function(cat){
    var curSpend=catNetSpend(curMonth, [cat]);
    if(curSpend<50) return;
    var prior=[];
    for(var i=1;i<=3;i++){
      var d=new Date(now.getFullYear(),now.getMonth()-i,1);
      var m=d.toISOString().slice(0,7);
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
    var icon=a.sev==='crit'?'⚠':'!';
    var clickAttr=a.onClick?' onclick="'+a.onClick+'" style="cursor:pointer"':'';
    return '<div class="alert-item alert-'+a.sev+'"'+clickAttr+'><div class="alert-icon">'+icon+'</div><div class="alert-body"><div class="alert-msg">'+a.msg+'</div><div class="alert-action">'+a.action+'</div></div></div>';
  }).join('');
  el.innerHTML=hdr+'<div class="alert-list">'+items+'</div>';
}

function renderSnapshotPnL(){
  var el=document.getElementById('snap-pnl-wrap'); if(!el) return;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var pnls=getSnapshotPnL();
  var HIST_ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 14"/></svg>';
  var simpleHdr='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem"><span class="cleg" style="margin:0">Snapshot P&amp;L</span></div>';
  if(!snaps.length){ el.innerHTML=simpleHdr+emptyState('No snapshots yet','Record your first snapshot to begin tracking'); return; }
  if(snaps.length<2){ el.innerHTML=simpleHdr+'<div style="color:var(--color-text-secondary);font-size:13px">Record a second snapshot to see P&L between periods.</div>'; return; }
  function fmtSnapDate(d){ return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
  function makePnlRow(p){
    var c=p.profit>0?'#1D9E75':p.profit<0?'#E24B4A':'#888';
    var sign=p.profit>0?'+':'';
    var adj=p.invOut>0||p.invIn>0?'<span class="pnl-adj">'+(p.invOut>0?'Invested '+fmtUSD(p.invOut):'')+(p.invIn>0?(p.invOut>0?' · ':'')+' Returned '+fmtUSD(p.invIn):'')+'</span>':'';
    return '<div class="pnl-row">'
      +'<div>'
        +'<div class="pnl-period">'+fmtSnapDate(p.from)+' → '+fmtSnapDate(p.to)+'</div>'
        +'<div class="pnl-range">'+fmtUSD(p.snap1)+' → '+fmtUSD(p.snap2)+'</div>'
        +(adj?'<div>'+adj+'</div>':'')
      +'</div>'
      +'<div class="pnl-profit" style="color:'+c+'">'+sign+fmtUSD(p.profit)+'</div>'
      +'</div>';
  }
  var last3=pnls.slice(-3).reverse();
  var hasMore=pnls.length>3;
  var hdr='<div class="snap-head"><span class="cleg" style="margin:0">Snapshot P&amp;L</span>'+(hasMore?'<button class="hist-btn-txt" onclick="showPage(\'history\',null,\'pnl\')">'+HIST_ICON+' History</button>':'')+'</div>';
  el.innerHTML=hdr+last3.map(makePnlRow).join('');
}

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

function saveGoal(){ var v=parseFloat(document.getElementById('goal-input').value); if(v>0){ S.dashGoal=v; save(); renderSummary(); } }

function renderSummary(){
  populateSumMonth();
  var month=document.getElementById('sum-month').value;
  var txM=S.transactions.filter(function(t){ return t.date.startsWith(month)&&inSummary(t); });
  var txD=txM.filter(function(t){ return t.type==='Debit'; });
  var txC=txM.filter(function(t){ return t.type==='Credit'; });
  // Income = only new money entering (Income category credits)
  var income=txC.filter(function(t){ return t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var essential=groupSum(txD,GROUP_ESSENTIAL);
  var business=groupSum(txD,GROUP_BUSINESS);
  var lifestyle=groupSum(txD,GROUP_LIFESTYLE);
  // Investments: net flow — negative=capital deployed, positive=net gain/return
  var invOut=txD.filter(function(t){ return t.category==='Investments'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var invIn=txC.filter(function(t){ return t.category==='Investments'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var invNet=invIn-invOut;
  // Savings: amount moved to savings wallets (informational, not an expense)
  var saved=txD.filter(function(t){ return t.category==='Savings'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  // Net = real spending efficiency, excludes investments and savings
  var net=income-essential-business-lifestyle;
  var savRate=income>0?Math.round((net/income)*100):0;
  function mc(label,val,cls,sub){ var d=val<0?'-'+fmtUSD(-val):fmtUSD(val); return '<div class="mc"><div class="mc-l">'+label+'</div><div class="mc-v '+cls+'">'+d+'</div>'+(sub?'<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">'+sub+'</div>':'')+'</div>'; }
  function mcs(label,val,cls,sub){ var d=val>0?'+'+fmtUSD(val):val<0?'-'+fmtUSD(-val):fmtUSD(0); return '<div class="mc"><div class="mc-l">'+label+'</div><div class="mc-v '+cls+'">'+d+'</div>'+(sub?'<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">'+sub+'</div>':'')+'</div>'; }
  var invSub=invOut>0||invIn>0?'Out: '+fmtUSD(invOut)+(invIn>0?' · In: '+fmtUSD(invIn):''):'';
  document.getElementById('sum-cards').innerHTML='';
  renderKPIStrip(month);
  renderHealthScore();
  renderAlerts();
  renderSnapshotPnL();
  renderGoal();
  renderEquityChart(); renderMonthlyChart();
}

function getLast6(){ var m=[]; var now=new Date(); for(var i=5;i>=0;i--){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); m.push(d.toISOString().slice(0,7)); } return m; }

function renderMonthlyChart(){
  var months=getLast6();
  var SPEND_CATS=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);
  var cD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Debit'&&SPEND_CATS.indexOf(t.category)>=0; }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var crD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var labels=months.map(function(m){ var p=m.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1).toLocaleString('en',{month:'short',year:'2-digit'}); });
  // Skip rebuild when the underlying data is identical (re-navigation, visibilitychange, sync with no change).
  var sig=JSON.stringify([labels,cD,crD]);
  if(sig===_mChartSig&&mChart) return;
  _mChartSig=sig;
  document.getElementById('mc-leg').innerHTML='<span style="display:flex;align-items:center;gap:14px"><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#209473;display:inline-block"></span>Income</span><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#721414;display:inline-block"></span>Outflows</span></span>';
  if(mChart){ mChart.destroy(); mChart=null; }
  mChart=new Chart(document.getElementById('chart-monthly'),{type:'bar',data:{labels:labels,datasets:[{label:'Income',data:crD,backgroundColor:'#209473',borderRadius:3,maxBarThickness:18},{label:'Outflows',data:cD,backgroundColor:'#721414',borderRadius:3,maxBarThickness:18}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{grid:{display:false},ticks:{color:'#555',autoSkip:false,font:{size:15}}},y:{display:false}}}});
}

function renderCatChart(month){
  var map={};
  var DONUT_CATS=CATS.filter(function(c){ return c!=='Savings'&&c!=='Investments'; });
  S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&DONUT_CATS.indexOf(t.category)>=0; }).forEach(function(t){ map[t.category]=(map[t.category]||0)+t.amountUSD; });
  var cats=Object.keys(map).sort(function(a,b){ return map[b]-map[a]; }); var vals=cats.map(function(c){ return parseFloat(map[c].toFixed(2)); }); var total=vals.reduce(function(s,v){ return s+v; },0);
  var colors=cats.map(function(c){ return CCOLORS[c]||'#888'; });
  var leg=document.getElementById('cat-leg');
  if(!cats.length){
    if(cChart){ cChart.destroy(); cChart=null; }
    if(leg) leg.innerHTML='<span style="color:var(--color-text-secondary)">No expenses this month</span>';
    return;
  }
  if(leg) leg.innerHTML=cats.map(function(c,i){ return '<div class="bdg-leg-item"><i style="background:'+colors[i]+'"></i><span class="bdg-leg-name">'+c+'</span><span class="bdg-leg-val">$'+Math.round(vals[i]).toLocaleString('en-US')+'</span></div>'; }).join('');
  if(cChart){ cChart.destroy(); cChart=null; }
  cChart=new Chart(document.getElementById('chart-cat'),{type:'doughnut',data:{labels:cats,datasets:[{data:vals,backgroundColor:colors,borderWidth:0,spacing:2,hoverOffset:3}]},options:{responsive:true,maintainAspectRatio:false,transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.label+': '+fmtUSD(ctx.raw); }}}},cutout:'72%'}});
}

function renderEquityChart(){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var el=document.getElementById('chart-equity'); if(!el) return;
  var wrap=document.getElementById('equity-wrap');
  if(!snaps.length){
    if(eChart){ eChart.destroy(); eChart=null; }
    if(wrap) wrap.innerHTML='<div style="color:var(--color-text-secondary);font-size:13px;padding:1rem 0">No snapshots yet. Record your first one to start the equity curve.</div>';
    return;
  }
  var labels=snaps.map(function(s){ return s.date; });
  var vals=snaps.map(function(s){ return s.total; });
  // O(n) two-pointer — both arrays sorted by date
  var invTx=S.transactions.filter(function(t){ return t.category==='Investments'; }).sort(function(a,b){ return a.date.localeCompare(b.date); });
  var cumOut=0,cumIn=0,ti=0;
  var adjVals=snaps.map(function(s){
    while(ti<invTx.length&&invTx[ti].date<=s.date){
      if(invTx[ti].type==='Debit') cumOut+=invTx[ti].amountUSD; else cumIn+=invTx[ti].amountUSD;
      ti++;
    }
    return parseFloat((s.total+cumOut-cumIn).toFixed(2));
  });
  // Skip rebuild when snapshots + investment flows are unchanged (adjVals folds in both).
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
    +'<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#9B70F0;display:inline-block"></span>Incl. deployed capital</span>'
    +'</div>'
    +'<div style="font-size:13px">'+latestSnap+'</div>';
  if(eChart){ eChart.destroy(); eChart=null; }
  eChart=new Chart(el,{type:'line',data:{labels:labels,datasets:[
    {label:'Tracked',data:vals,borderColor:'#4ED9A4',backgroundColor:function(ctx){var c=ctx.chart,a=c.chartArea;if(!a)return 'rgba(78,217,164,0.2)';var g=c.ctx.createLinearGradient(0,a.top,0,a.bottom);g.addColorStop(0,'rgba(78,217,164,0.4)');g.addColorStop(1,'rgba(78,217,164,0)');return g;},borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHitRadius:20,pointBackgroundColor:'#4ED9A4',tension:0.3,fill:true},
    {label:'Incl. deployed',data:adjVals,borderColor:'#9B70F0',backgroundColor:'transparent',borderWidth:1.5,pointRadius:0,pointHoverRadius:3,pointHitRadius:15,pointBackgroundColor:'#9B70F0',tension:0.3,fill:false,borderDash:[5,4]}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},layout:{padding:0},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{display:false},y:{display:false}}}});}

function getTotalBalance(){
  var api=(S.binanceBalance||0)+(S.bibiBinanceBalance||0)+(S.bybitBalance||0)+(S.okxBalance||0)+(S.trezorBalance||0);
  var trackerBal=S.manualWallets.filter(function(w){ return w.trackerOnly; }).reduce(function(s,w){ return s+calcTrackerBal(w.name); },0);
  var manualBal=S.manualWallets.filter(function(w){ return !w.trackerOnly; }).reduce(function(s,w){ return s+w.balance; },0);
  var zelle=calcTrackerBal('Zelle');
  return parseFloat((api+trackerBal+manualBal+zelle).toFixed(2));
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
  S.snapshots.push({id:Date.now(),date:today,total:val});
  S.snapshotsUpdatedAt=Date.now();
  var sorted=S.snapshots.slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(sorted.length>=2){
    var prev=sorted[sorted.length-2];
    var txBetween=S.transactions.filter(function(t){ return t.date>=prev.date&&t.date<=today&&t.category==='Investments'; });
    var invOut=txBetween.filter(function(t){ return t.type==='Debit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    var invIn=txBetween.filter(function(t){ return t.type==='Credit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    var profit=Math.round(((val-prev.total)+invOut-invIn)*100)/100;
    var fmtD=function(s){var p=s.split('-');return +p[2]+'/'+p[1].replace(/^0/,'')+'/'+p[0];};
    if(res.checked){
      var txId=Date.now()+1;
      S.transactions.push({id:txId,date:today,desc:'Profit '+fmtD(prev.date)+' → '+fmtD(today),type:'Credit',wallet:'Binance',category:'Income',amountUSD:profit,originalCurrency:'USD'});
      S.transactionsUpdatedAt=Date.now();
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
  S.snapshotsUpdatedAt=Date.now();
  if(snap&&snap.txId){
    var linked=S.transactions.find(function(t){ return t.id===snap.txId; });
    var delLinked=linked&&await appConfirm('Delete linked transaction?',escHtml(linked.desc)+' <span style="color:#5DCAA5">'+fmtUSD(linked.amountUSD)+'</span>','Delete');
    if(delLinked){
      if(!S.deletedTxIds) S.deletedTxIds=[];
      S.deletedTxIds.push(snap.txId);
      S.transactions=S.transactions.filter(function(t){ return t.id!==snap.txId; });
      S.transactionsUpdatedAt=Date.now();
    }
  }
  save(); renderEquityChart(); renderSnapshotPnL();
}
function editSnapshot(id){ var snap=S.snapshots.find(function(s){ return s.id===id; }); if(!snap) return; var val=parseFloat(prompt('Edit snapshot value for '+snap.date+':',snap.total)); if(isNaN(val)||val<0) return; snap.total=val; S.snapshotsUpdatedAt=Date.now(); save(); if(document.getElementById('page-history').classList.contains('active')) renderHistory(window._historyView||'snapshots'); else { renderEquityChart(); renderSnapshotPnL(); } }
window.editSnapshot=editSnapshot;

function saveBudget(){ var v=parseFloat(document.getElementById('bud-total').value); if(v>0){ S.budgetTotal=v; save(); renderBudget(); } }
function saveCategoryBudget(cat,val){
  if(!S.categoryBudgets) S.categoryBudgets={};
  var v=parseFloat(val);
  if(v>0) S.categoryBudgets[cat]=v; else delete S.categoryBudgets[cat];
  save(); renderBudget();
}
window._budMonthSel=function(v){ _budMonth=v; renderBudget(); };
window._budLimitsToggle=function(){ _budLimitsOpen=!_budLimitsOpen; renderBudget(); };
window._budPctLive=function(cat,val){
  var v=parseFloat(val)||0;
  var total=S.budgetTotal||600;
  var pct=v>0?parseFloat(((v/total)*100).toFixed(1)):0;
  var barW=Math.min(100,pct);
  var barCol=pct>25?'#E24B4A':pct>15?'#EF9F27':'#1D9E75';
  var key=cat.replace(/ /g,'-');
  var pctEl=document.getElementById('bud-pct-'+key);
  var barEl=document.getElementById('bud-bar-'+key);
  if(pctEl){ pctEl.textContent=v>0?pct+'%':'—'; pctEl.style.color=v>0?barCol:'rgba(255,255,255,0.25)'; pctEl.style.fontWeight=v>0?'600':'400'; }
  if(barEl){ barEl.style.width=barW+'%'; barEl.style.background=barCol; }
  // Update allocated total bar
  var allocEl=document.getElementById('bud-alloc-bar');
  if(allocEl){
    var cats=Object.keys(S.categoryBudgets||{});
    var sum=cats.reduce(function(s,c){ return s+(c===cat?v:((S.categoryBudgets||{})[c]||0)); },0);
    // add cats not in S.categoryBudgets (the one being typed)
    var sumAll=0;
    document.querySelectorAll('.budget-limits-grid input[type="number"]').forEach(function(inp,i){
      sumAll+=parseFloat(inp.value)||0;
    });
    var ap=total>0?((sumAll/total)*100):0;
    var ac=Math.abs(sumAll-total)<1?'#1D9E75':sumAll>total?'#E24B4A':'#EF9F27';
    allocEl.innerHTML='<span style="color:var(--color-text-secondary)">Allocated:</span>'
      +'<span style="color:'+ac+';font-weight:600">'+fmtUSD(sumAll)+'</span>'
      +'<span style="color:var(--color-text-secondary)">/ '+fmtUSD(total)+'</span>'
      +'<span style="flex:1;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;max-width:140px"><span style="display:block;height:100%;width:'+Math.min(100,ap)+'%;background:'+ac+';border-radius:3px;transition:width .2s"></span></span>'
      +'<span style="color:'+ac+';font-weight:600">'+ap.toFixed(1)+'%</span>';
  }
};
function renderBudget(){
  var BUDGET_CATS=['Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support'];
  var months=getMonths();
  if(!_budMonth||months.indexOf(_budMonth)<0) _budMonth=months[0]||'';
  var month=_budMonth;
  var income=S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var debits=S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&BUDGET_CATS.indexOf(t.category)>=0; });
  var spent=catNetSpend(month, BUDGET_CATS);
  var net=income-spent;
  var savRate=income>0?Math.round((net/income)*100):0;
  var remaining=S.budgetTotal-spent;
  var pct=Math.min(100,S.budgetTotal>0?Math.round(spent/S.budgetTotal*100):0);
  var bc=pct>90?'#E24B4A':pct>70?'#EF9F27':'#1D9E75';

  var monthLabel=month?new Date(month+'-01T00:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}):'';
  var remColor=remaining>=0?'#4ED9A4':'#E24B4A';
  function bstat(l,v,col){ return '<div class="bdg-stat"><span class="bdg-stat-l">'+l+'</span><span class="bdg-stat-v"'+(col?' style="color:'+col+'"':'')+'>'+v+'</span></div>'; }

  var html='';

  // Header
  html+='<div class="dash-head">'
    +'<span class="dash-eyebrow">Budget</span>'
    +'<select onchange="window._budMonthSel(this.value)">'
    +months.map(function(m){ return '<option value="'+m+'"'+(m===month?' selected':'')+'>'+m+'</option>'; }).join('')
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

  // Categories grid
  html+='<div class="bdg-cat-head"><span class="cleg" style="margin:0">Categories</span><span class="bdg-cat-meta">'+BUDGET_CATS.length+' tracked</span></div>';
  html+='<div class="bdg-cats">';
  BUDGET_CATS.forEach(function(cat){
    var s=catNetSpend(month, [cat]);
    var catLim=(S.categoryBudgets||{})[cat]||0;
    var limBase=catLim>0?catLim:S.budgetTotal;
    var cp=limBase>0?Math.min(100,Math.round(s/limBase*100)):0;
    var cc=CCOLORS[cat]||'#9B70F0';
    var barC=cp>90?'#E24B4A':cp>70?'#EF9F27':cc;
    html+='<div class="bdg-cat">'
      +'<div class="bdg-cat-top"><span class="bdg-cat-name"><i class="bdg-dot" style="background:'+cc+'"></i>'+cat+'</span><span class="bdg-cat-pct">'+cp+'%</span></div>'
      +'<div class="bdg-cat-amt">'+fmtUSD(s)+'</div>'
      +'<div class="bdg-pb sm"><div class="bdg-pf" style="width:'+cp+'%;background:'+barC+'"></div></div>'
      +'<div class="bdg-cat-lim">'+(catLim>0?'of '+fmtUSD(catLim)+' limit':'no limit set')+'</div>'
      +'</div>';
  });
  html+='</div>';

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
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Category Limits</div>'
      +(function(){
        var total=BUDGET_CATS.reduce(function(s,c){ return s+((S.categoryBudgets||{})[c]||0); },0);
        var pct=S.budgetTotal>0?((total/S.budgetTotal)*100):0;
        var col=Math.abs(total-S.budgetTotal)<1?'#1D9E75':total>S.budgetTotal?'#E24B4A':'#EF9F27';
        return '<div id="bud-alloc-bar" style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;font-size:12px">'
          +'<span style="color:var(--color-text-secondary)">Allocated:</span>'
          +'<span style="color:'+col+';font-weight:600">'+fmtUSD(total)+'</span>'
          +'<span style="color:var(--color-text-secondary)">/ '+fmtUSD(S.budgetTotal)+'</span>'
          +'<span style="flex:1;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;max-width:140px"><span style="display:block;height:100%;width:'+Math.min(100,pct)+'%;background:'+col+';border-radius:3px;transition:width .2s"></span></span>'
          +'<span style="color:'+col+';font-weight:600">'+pct.toFixed(1)+'%</span>'
          +'</div>';
      })()
      +'<div class="budget-limits-grid">'
      +BUDGET_CATS.map(function(cat){
        var v=(S.categoryBudgets||{})[cat]||0;
        var pct=v>0&&S.budgetTotal>0?parseFloat(((v/S.budgetTotal)*100).toFixed(1)):0;
        var barW=Math.min(100,pct);
        var barCol=pct>25?'#E24B4A':pct>15?'#EF9F27':'#1D9E75';
        return '<div>'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">'
            +'<span class="tag '+tagCat(cat)+'" style="font-size:10px">'+cat+'</span>'
            +(v>0?'<span id="bud-pct-'+cat.replace(/ /g,'-')+'" style="font-size:10px;font-weight:600;color:'+barCol+'">'+pct+'%</span>':'<span id="bud-pct-'+cat.replace(/ /g,'-')+'" style="font-size:10px;color:rgba(255,255,255,0.25)">—</span>')
          +'</div>'
          +'<input type="number" placeholder="No limit" step="1" value="'+(v||'')+'" '
          +'style="width:100%;padding:7px 10px;border:0.5px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.07);color:#fff;font-size:13px" '
          +'oninput="window._budPctLive(\''+cat+'\',this.value)" '
          +'onchange="saveCategoryBudget(\''+cat+'\',this.value)"/>'
          +'<div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-top:5px;overflow:hidden">'
            +'<div id="bud-bar-'+cat.replace(/ /g,'-')+'" style="height:100%;width:'+barW+'%;background:'+barCol+';border-radius:2px;transition:width .2s"></div>'
          +'</div>'
          +'</div>';
      }).join('')
      +'</div>'
      +'</div>';
  }
  html+='</div>';

  document.getElementById('bud-wrap').innerHTML=html;
  renderCatChart(month);
}

function saveManualWallet(){
  var name=document.getElementById('wm-name').value.trim(); var bal=parseFloat(document.getElementById('wm-bal').value)||0; var type=document.getElementById('wm-type').value;
  if(!name){ return; }
  var idx=S.manualWallets.findIndex(function(w){ return w.name.toLowerCase()===name.toLowerCase(); });
  var obj={id:Date.now(),name:name,balance:bal,trackerOnly:type==='tracker'};
  if(idx>=0) S.manualWallets[idx]=Object.assign(S.manualWallets[idx],obj); else S.manualWallets.push(obj);
  S.manualWalletsUpdatedAt=Date.now();
  closeWalletForm();
  save(); renderWallets(); populateWalletSelects();
}

function calcTrackerBal(name){
  var txBal=0;
  S.transactions.forEach(function(t){ if(t.wallet===name&&isTracker(t.wallet,t)) txBal+=(t.type==='Credit'?1:-1)*t.amountUSD; });
  var mw=S.manualWallets.find(function(w){ return w.name===name; });
  return (mw?mw.balance:0)+txBal;
}

window.refreshAllWallets=async function(){
  var btn=document.getElementById('refresh-all-btn');
  if(btn){ btn.disabled=true; btn.textContent='Refreshing...'; }
  var fns=[
    S.binanceBalance!==null?fetchBinanceBalance().then(function(){save();}).catch(function(){}):Promise.resolve(),
    S.bibiBinanceBalance!==null?fetchBibiBinanceBalance().then(function(){save();}).catch(function(){}):Promise.resolve(),
    S.bybitBalance!==null?fetchBybitBalance().catch(function(){}):Promise.resolve(),
    S.okxBalance!==null?fetchOKXBalance().catch(function(){}):Promise.resolve(),
    fetchTrezorBalance().catch(function(){})
  ];
  await Promise.allSettled(fns);
  save(); renderWallets(); renderSummary();
  if(btn){ btn.disabled=false; btn.textContent='↻ Refresh all'; }
};

function renderWallets(){
  var grid=document.getElementById('w-grid'); var cards=[];
  var apiTotal=(S.binanceBalance||0)+(S.bibiBinanceBalance||0)+(S.bybitBalance||0)+(S.okxBalance||0)+(S.trezorBalance||0);
  var trackerNames=['Zelle'];
  S.manualWallets.filter(function(w){ return w.trackerOnly; }).forEach(function(w){ if(trackerNames.indexOf(w.name)<0) trackerNames.push(w.name); });
  var trackerTotal=trackerNames.reduce(function(s,n){ return s+calcTrackerBal(n); },0);
  var manualNormal=S.manualWallets.filter(function(w){ return !w.trackerOnly; }).reduce(function(s,w){ return s+w.balance; },0);
  var grand=apiTotal+trackerTotal+manualNormal;
  // ── allocation bar data ──────────────────────────────────────────────
  var wvA=[
    {nm:'Binance',v:S.binanceBalance||0,col:'#9B70F0'},
    {nm:'Bybit',v:S.bybitBalance||0,col:'#4ED9A4'},
    {nm:'Trezor',v:S.trezorBalance||0,col:'#60A5FA'},
    {nm:'Bibi Binance',v:S.bibiBinanceBalance||0,col:'#FB923C'},
    {nm:'OKX',v:S.okxBalance||0,col:'#FBBF24'},
    {nm:'Zelle',v:calcTrackerBal('Zelle'),col:'#A78BFA'},
    {nm:'Cash',v:manualNormal,col:'#6B7280'}
  ].filter(function(a){return a.v>0;});
  var wvBar=grand>0?wvA.map(function(a){return '<i style="width:'+(a.v/grand*100).toFixed(2)+'%;background:'+a.col+'"></i>';}).join(''):'';
  var wvLeg=wvA.map(function(a){return '<span class="wm-key"><i style="background:'+a.col+'"></i>'+a.nm+' <b>'+(grand>0?(a.v/grand*100).toFixed(1):'0')+'%</b></span>';}).join('');

  // ── icon helpers ─────────────────────────────────────────────────────
  var icP='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var icX='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  function balHtml(v){ return '<span class="wm-bal">'+fmtUSD(v)+'</span>'; }
  function wmRow(color,mono,statusClass,name,meta,right,acts){
    var st=statusClass?'<i class="wm-status '+statusClass+'"></i>':'';
    return '<div class="wm-row"><span class="wm-chip" style="--c:'+color+'">'+mono+st+'</span>'
      +'<div class="wm-rid"><span class="wm-name">'+name+'</span>'+(meta?'<span class="wm-meta">'+meta+'</span>':'')+'</div>'
      +right+(acts?'<span class="wm-acts" onclick="event.stopPropagation()">'+acts+'</span>':'')+'</div>';
  }
  function apiRow(color,mono,name,connected,balv,upd,metaExtra){
    if(connected){
      var meta=(metaExtra?metaExtra:'')+(metaExtra&&upd?' · ':'')+(upd?'Updated '+upd:'');
      return wmRow(color,mono,balv!==null?'on':'off',name,meta||'Connected',balv!==null?balHtml(balv):'<span class="wm-bal" style="color:var(--txt3)">—</span>','');
    }
    return wmRow(color,mono,'off',name,'Not connected','<button class="btn btns btnp wm-connect" onclick="showPage(\'settings\',null)">Connect</button>','');
  }

  // ── Exchanges ─────────────────────────────────────────────────────────
  var exRows=''
    +apiRow('#9B70F0','B','Binance Funding',S.binanceBalance!==null,S.binanceBalance,S.binanceUpdated,'')
    +apiRow('#FB923C','B','Bibi Binance',S.bibiBinanceBalance!==null,S.bibiBinanceBalance,S.bibiBinanceUpdated,'')
    +apiRow('#4ED9A4','B','Bybit',S.bybitBalance!==null,S.bybitBalance,S.bybitUpdated,'')
    +apiRow('#FBBF24','O','OKX',S.okxBalance!==null,S.okxBalance,S.okxUpdated,'')
    +apiRow('#60A5FA','T','Trezor',true,S.trezorBalance,S.trezorUpdated,'BSC USDT');

  // ── Trackers + Manual ─────────────────────────────────────────────────
  var trRows=trackerNames.map(function(name){
    var total=calcTrackerBal(name); var mw=S.manualWallets.find(function(w){return w.name===name;});
    var meta=name==='Zelle'?'+5%: '+fmtUSD(total*1.05):'Calculated from transactions';
    var acts=mw?'<button class="wico" onclick="renameManualWallet('+mw.id+')">'+icP+'</button><button class="wico del" onclick="deleteManualWallet('+mw.id+')">'+icX+'</button>':'';
    return wmRow('#A78BFA',escHtml(name).slice(0,1).toUpperCase(),'',escHtml(name)+' <span class="wm-badge">tracker</span>',meta,balHtml(total),acts);
  }).join('');
  var mnRows=S.manualWallets.filter(function(w){return !w.trackerOnly;}).map(function(w){
    var acts='<button class="wico" onclick="editManualWalletBal('+w.id+')">'+icP+'</button><button class="wico del" onclick="deleteManualWallet('+w.id+')">'+icX+'</button>';
    return wmRow('#6B7280',escHtml(w.name).slice(0,1).toUpperCase(),'',escHtml(w.name),'Manual balance',balHtml(w.balance),acts);
  }).join('');

  var manualNormalCount=S.manualWallets.filter(function(w){return !w.trackerOnly;}).length;
  var walletCount=5+trackerNames.length+manualNormalCount;
  var notConn=[S.binanceBalance,S.bibiBinanceBalance,S.bybitBalance,S.okxBalance].filter(function(b){return b===null;}).length;

  var wHtml=
    '<div class="wm-hero">'
      +'<div class="wm-hero-lbl">Total · All Wallets</div>'
      +'<div class="wm-hero-val">'+fmtUSD(grand)+'</div>'
      +'<div class="wm-hero-meta">'+walletCount+' wallets'+(notConn>0?' · '+notConn+' not connected':'')+'</div>'
      +'<div class="wm-alloc">'+wvBar+'</div>'
      +'<div class="wm-legend">'+wvLeg+'</div>'
    +'</div>'
    +'<div class="wm-cols">'
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Exchanges</span><span class="wm-group-sum">'+fmtUSD(apiTotal)+'</span></div><div class="wm-rows">'+exRows+'</div></div>'
      +'<div class="wm-group"><div class="wm-group-head"><span class="wm-group-title">Trackers &amp; Manual</span><span class="wm-group-sum">'+fmtUSD(trackerTotal+manualNormal)+'</span></div><div class="wm-rows">'+trRows+mnRows+'</div><button class="wm-add" onclick="openWalletForm()">+ Add wallet</button></div>'
    +'</div>';
  // Skip re-render when unchanged → no flicker / re-animation on tab return.
  if(wHtml!==_walletsSig){ grid.innerHTML=wHtml; _walletsSig=wHtml; }
}


function populateWalletSelects(){
  var names=['Binance','Zelle','Cash'];
  S.manualWallets.forEach(function(w){ if(names.indexOf(w.name)<0) names.push(w.name); });
  ['tx-wallet','tf-wallet'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    var cur=el.value; var isF=id.startsWith('tf');
    el.innerHTML=(isF?'<option value="">All wallets</option>':'')+names.map(function(n){ return '<option>'+n+'</option>'; }).join('');
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
  if(c.indexOf('services')>=0) return 'Services'; if(c.indexOf('zelle')>=0) return 'Zelle'; if(c.indexOf('other')>=0) return 'Other';
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
      S.transactions.push({id:Date.now()+Math.random(),seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amt,amountVES:null,originalCurrency:'USD',rateUsed:null,imported:!isNotImported});
      added++;
    });
    if(added>0) S.transactionsUpdatedAt=Date.now();
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
      save(); populateWalletSelects(); updateRateUI(); renderSummary();
      st.textContent='Restored: '+S.transactions.length+' transactions, '+S.portfolio.length+' holdings.';
      st.style.color='#5DCAA5';
      document.getElementById('json-inp').value='';
    }catch(err){ st.textContent='Error: '+err.message; st.style.color='#E24B4A'; }
  };
  reader.readAsText(file);
}

function clearAll(){ if(confirm('Delete ALL data? This cannot be undone.')){ localStorage.removeItem('ft13'); location.reload(); } }

function showPage(id,btn,arg){
  var pages=['summary','transactions','budget','wallets','holdings','tools','settings','import','history'];
  if(pages.indexOf(id)<0) id='summary';
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('page-'+id).classList.add('active');
  document.querySelectorAll('.nb[onclick*="\''+id+'\'"]').forEach(function(b){ b.classList.add('active'); });
  if(btn) btn.classList.add('active');
  window.location.hash = id;
  var fab=document.getElementById('fab-add');
  if(fab) fab.style.display=(id==='transactions'?'flex':'none');
  if(id==='summary') renderSummary();
  else if(id==='transactions') renderTx();
  else if(id==='budget') renderBudget();
  else if(id==='wallets') renderWallets();
  else if(id==='holdings'){ renderOnchainWallets(); renderWalletHoldings(); }
  else if(id==='tools') renderToolToggles();
  else if(id==='history') renderHistory(arg||'snapshots');
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
      var txBetween=S.transactions.filter(function(t){ return t.date>prev.date&&t.date<=s.date&&t.category==='Investments'; });
      invOut=txBetween.filter(function(t){ return t.type==='Debit'; }).reduce(function(a,t){ return a+t.amountUSD; },0);
      invIn=txBetween.filter(function(t){ return t.type==='Credit'; }).reduce(function(a,t){ return a+t.amountUSD; },0);
      profit=(s.total-prev.total)+invOut-invIn;
      pct=prev.total>0?(profit/prev.total)*100:null;
    }
    var cumDelta=s.total-firstTotal;
    var cumPct=firstTotal>0?(cumDelta/firstTotal)*100:0;
    return {s:s,prev:prev,profit:profit,pct:pct,invOut:invOut,invIn:invIn,cumDelta:cumDelta,cumPct:cumPct};
  });

  if(view==='pnl'){
    rows=rows.filter(function(r){ return r.prev!==null; });
  }
  rows.reverse();

  if(titleEl) titleEl.textContent=view==='pnl'?'Snapshot P&L History':'Snapshot History';

  function colorP(v){ return v>0?'#1D9E75':v<0?'#E24B4A':'#888'; }
  function sign(v){ return v>0?'+':v<0?'-':''; }

  var headers=view==='pnl'
    ?['Period','From','To','P&L','%','Adjustments']
    :['Date','Total','P&L','%','Adjustments','Cumulative','Actions'];

  var html='<div class="cw" style="padding:0;overflow:hidden">'
    +'<div style="overflow-x:auto"><table class="hist-table">'
    +'<thead><tr>'+headers.map(function(h){ return '<th>'+h+'</th>'; }).join('')+'</tr></thead>'
    +'<tbody>';

  rows.forEach(function(r){
    var adjTxt='';
    if(r.invOut>0||r.invIn>0){
      var parts=[];
      if(r.invOut>0) parts.push('<span style="color:#EF9F27">Invested '+fmtUSD(r.invOut)+'</span>');
      if(r.invIn>0) parts.push('<span style="color:#60A5FA">Returned '+fmtUSD(r.invIn)+'</span>');
      adjTxt=parts.join(' · ');
    } else adjTxt='<span style="color:rgba(255,255,255,0.2)">—</span>';

    var profitCell=r.profit!==null
      ?'<span style="color:'+colorP(r.profit)+'">'+sign(r.profit)+fmtUSD(Math.abs(r.profit))+'</span>'
      :'<span style="color:rgba(255,255,255,0.2)">—</span>';
    var pctCell=r.pct!==null
      ?'<span style="color:'+colorP(r.pct)+'">'+sign(r.pct)+r.pct.toFixed(2)+'%</span>'
      :'<span style="color:rgba(255,255,255,0.2)">—</span>';

    if(view==='pnl'){
      html+='<tr>'
        +'<td>'+r.prev.date+' → '+r.s.date+'</td>'
        +'<td>'+fmtUSD(r.prev.total)+'</td>'
        +'<td>'+fmtUSD(r.s.total)+'</td>'
        +'<td>'+profitCell+'</td>'
        +'<td>'+pctCell+'</td>'
        +'<td style="font-size:12px">'+adjTxt+'</td>'
        +'</tr>';
    } else {
      var cumColor=colorP(r.cumDelta);
      html+='<tr>'
        +'<td>'+r.s.date+'</td>'
        +'<td style="font-weight:500">'+fmtUSD(r.s.total)+'</td>'
        +'<td>'+profitCell+'</td>'
        +'<td>'+pctCell+'</td>'
        +'<td style="font-size:12px">'+adjTxt+'</td>'
        +'<td><span style="color:'+cumColor+'">'+sign(r.cumDelta)+fmtUSD(Math.abs(r.cumDelta))+'</span> <span style="color:rgba(255,255,255,0.4);font-size:11px">('+sign(r.cumPct)+r.cumPct.toFixed(1)+'%)</span></td>'
        +'<td style="white-space:nowrap"><button class="btn btns" style="padding:3px 8px;font-size:11px;margin-right:4px" onclick="editSnapshot('+r.s.id+')">edit</button><button class="btn btnd" style="padding:3px 8px;font-size:11px;opacity:1" onclick="deleteSnapshotFromHistory('+r.s.id+')">×</button></td>'
        +'</tr>';
    }
  });
  html+='</tbody></table></div></div>';
  wrap.innerHTML=html;
}
window.renderHistory=renderHistory;
function deleteSnapshotFromHistory(id){
  deleteSnapshot(id);
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
window.setTxTab=setTxTab; window.toggleTxFilters=toggleTxFilters;
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
window.selectWvRow = function(el){
  document.querySelectorAll('.wv-row.wv-exp').forEach(function(r){ if(r!==el) r.classList.remove('wv-exp'); });
  el.classList.toggle('wv-exp');
};
if(!window._wvSelListener){
  window._wvSelListener=true;
  document.addEventListener('click',function(e){ if(!e.target.closest('.wv-row')) document.querySelectorAll('.wv-exp').forEach(function(r){ r.classList.remove('wv-exp'); }); });
}
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
window.saveCategoryBudget = saveCategoryBudget;
window.saveBudget = saveBudget;
window.saveManualWallet = saveManualWallet;
window.deleteManualWallet = deleteManualWallet;
window.saveOnchainWallet = saveOnchainWallet;
window.deleteOnchainWallet = deleteOnchainWallet;
window.copyAddr = copyAddr;
window.renderWallets = renderWallets;
window.testBinance = testBinance;
window.clearBinance = clearBinance;
window.fetchBibiBinanceBalance = fetchBibiBinanceBalance;
window.testBibiBinance = testBibiBinance;
window.clearBibiBinance = clearBibiBinance;
window.testBybit = testBybit;
window.clearBybit = clearBybit;
window.testOKX = testOKX;
window.clearOKX = clearOKX;
window.fetchBinanceBalance = fetchBinanceBalance;
window.fetchTrezorBalance = fetchTrezorBalance;
window.refreshWalletHoldings = refreshWalletHoldings;
window.fetchBybitBalance = fetchBybitBalance;
window.fetchOKXBalance = fetchOKXBalance;
window.forcePull = forcePull;
window.forcePush = forcePush;
window.exportAllJSON = exportAllJSON;
window.importJSON = importJSON;
window.clearAll = clearAll;
window.handleCSV = handleCSV;
window.save = save;

function renderCalcCards(cardsId, resultId, cards, small){
  document.getElementById(cardsId).innerHTML = cards.map(function(c){
    var cls = c.green ? ' g' : c.red ? ' r' : '';
    return '<div class="tcalc-card'+(small?' tcalc-sm':'')+'">'
      +'<div class="tcalc-lbl">'+c.label+'</div>'
      +'<div class="tcalc-val'+cls+'">'+c.value+'</div>'
      +'<div class="tcalc-sub">'+c.sub+'</div>'
      +'</div>';
  }).join('');
  document.getElementById(resultId).style.display = 'block';
}

var TOOLS = [
  { id:'profit',   label:'Profit Calc'    },
  { id:'p2p',      label:'P2P Spread'     },
  { id:'bcvemily', label:'BCV→Emily USD' },
  { id:'bdvbpay',  label:'BDV→Bpay'      },
  { id:'bdvwally', label:'BDV→Wally'     },
  { id:'bdvzinli', label:'BDV→Zinli'     },
];

function renderToolToggles(){
  if(!S.hiddenTools) S.hiddenTools={};
  var wrap=document.getElementById('tools-toggles');
  if(!wrap) return;
  wrap.innerHTML='<div class="fc">'
    +'<div class="cleg" style="margin-bottom:14px">Manage tools</div>'
    +'<div class="tool-toggle-row">'
    +TOOLS.map(function(t){
      var on=!S.hiddenTools[t.id];
      return '<button class="tool-toggle'+(on?' on':'')+'" onclick="toggleTool(\''+t.id+'\')">'+t.label+'</button>';
    }).join('')
    +'</div>'
    +'</div>';
  TOOLS.forEach(function(t){
    var el=document.getElementById('tc-'+t.id);
    if(el) el.style.display=S.hiddenTools[t.id]?'none':'';
  });
}
window.toggleTool=function(id){
  if(!S.hiddenTools) S.hiddenTools={};
  S.hiddenTools[id]=!S.hiddenTools[id];
  save();
  renderToolToggles();
};
window.renderToolToggles=renderToolToggles;

function calcProfit(){
  var sellRate  = parseFloat(document.getElementById('pc-sell').value)||0;
  var spent     = parseFloat(document.getElementById('pc-amount').value)||0;
  var buyRate   = parseFloat(document.getElementById('pc-buy').value)||0;
  var cardComm  = parseFloat(document.getElementById('pc-card').value)||0;
  try{ localStorage.setItem('ft13_pc', JSON.stringify({sell:document.getElementById('pc-sell').value, amount:document.getElementById('pc-amount').value, buy:document.getElementById('pc-buy').value, card:document.getElementById('pc-card').value})); }catch(e){}

  var usdt         = (sellRate > 0 && spent > 0) ? spent * buyRate / sellRate : 0;
  var bpayRecharge = spent > 0 ? spent / (1 + cardComm / 100) : 0;
  var bpayReceived = bpayRecharge * 0.964;
  var profit       = bpayReceived - usdt;
  var profitPct    = usdt > 0 ? (profit / usdt) * 100 : 0;

  var isPos = profit >= 0;
  renderCalcCards('pc-cards','pc-result',[
    { label:'Received', value: usdt > 0 ? usdt.toFixed(2) : '—', sub:'in USDT' },
    { label:'Recharge', value:'$'+bpayRecharge.toFixed(2), sub:'$'+bpayReceived.toFixed(2)+' after fee' },
    { label:'Profit',   value:(isPos?'+':'')+'$'+profit.toFixed(2), sub:(isPos?'+':'')+profitPct.toFixed(2)+'%', green:isPos, red:!isPos },
  ], true);
}
window.calcProfit = calcProfit;

function saveP2PComm(){ try{ localStorage.setItem('ft13_p2pc', document.getElementById('p2p-comm').value); }catch(e){} }
function toggleP2PSettings(btn){
  var p=document.getElementById('p2p-settings-popup'); var isOpen=p.classList.contains('open');
  document.querySelectorAll('.hist-popup.open').forEach(function(el){ el.classList.remove('open'); });
  if(!isOpen) p.classList.add('open');
}
window.saveP2PComm=saveP2PComm; window.toggleP2PSettings=toggleP2PSettings;
document.addEventListener('click', function(e){
  if(!e.target.closest('#tc-p2p .hist-wrap')) document.querySelectorAll('#p2p-settings-popup').forEach(function(el){ el.classList.remove('open'); });
});

function calcSpread(){
  var sellRate = parseFloat(document.getElementById('p2p-sell').value)||0;
  var buyRate  = parseFloat(document.getElementById('p2p-buy').value)||0;
  var comm     = parseFloat(document.getElementById('p2p-comm').value)||0;
  var netPct   = sellRate && buyRate ? ((sellRate / buyRate) * (1 - comm / 100) - 1) * 100 : 0;
  var pct = function(n){ return (n>=0?'+':'')+n.toFixed(2)+'%'; };
  renderCalcCards('p2p-cards','p2p-result',[
    { label:'Spread', value:pct(netPct), sub: sellRate&&buyRate ? sellRate+' → '+buyRate : '—', green:netPct>0, red:netPct<0 },
  ]);
}
window.calcSpread = calcSpread;

function calcBDV(){
  var bank = parseFloat(document.getElementById('bdv-input').value)||0;
  var charge   = bank > 0 ? bank / (1.01 * 1.015) : 0;
  var received = charge * 0.964;
  var lost     = bank - received;
  var lostPct  = bank > 0 ? (lost / bank) * 100 : 0;
  renderCalcCards('bdv-cards','bdv-result',[
    { label:'Recharge', value:'$'+charge.toFixed(2),   sub:'on card' },
    { label:'Received', value:'$'+received.toFixed(2), sub:'after fee', green:true },
    { label:'Lost',     value:'$'+lost.toFixed(2),     sub:lostPct.toFixed(2)+'% of total', red:true },
  ]);
}
window.calcBDV = calcBDV;
window.autofillFromNote = autofillFromNote;
window.recordSnapshot = recordSnapshot;
window.saveGoal = saveGoal;
window.deleteSnapshot = deleteSnapshot;

function calcWalletUpfront(bank, walletFeeRate, resultId, cardsId){
  bank = bank || 0;
  var cardCharge = bank > 0 ? bank / 1.02515 : 0;
  var received   = bank > 0 ? cardCharge / (1 + walletFeeRate) : 0;
  var walletFee  = cardCharge - received;
  var lost       = bank - received;
  var lostPct    = bank > 0 ? (lost / bank) * 100 : 0;
  renderCalcCards(cardsId, resultId, [
    { label:'Received', value:'$'+received.toFixed(2), sub:'to wallet', green:true },
    { label:'Fee',      value:'$'+walletFee.toFixed(2),sub:'upfront' },
    { label:'Lost',     value:'$'+lost.toFixed(2),     sub:lostPct.toFixed(2)+'% of total', red:true },
  ]);
}

function calcBCVEmily(){
  var usd      = parseFloat(document.getElementById('be-usd').value)||0;
  var usdtRate = parseFloat(document.getElementById('be-usdt').value)||0;
  var bcvRate  = S.rate || 0;

  var totalBs       = usd * bcvRate;
  var effectiveRate = usdtRate * 0.9;
  var usdtOut       = (totalBs > 0 && effectiveRate > 0) ? totalBs / effectiveRate : 0;

  renderCalcCards('be-cards','be-result',[
    { label:'Total Bs', value: totalBs > 0 ? totalBs.toFixed(2)+' Bs' : '—', sub: bcvRate ? usd+'$ × '+bcvRate : 'BCV rate N/A' },
    { label:'Received', value: usdtOut > 0 ? usdtOut.toFixed(2)+' USDT' : '—', sub: effectiveRate > 0 ? 'rate '+effectiveRate.toFixed(2) : '—', green: usdtOut > 0 },
  ]);
}
window.calcBCVEmily = calcBCVEmily;

function calcWally(){
  calcWalletUpfront(parseFloat(document.getElementById('wally-input').value), 0.03745, 'wally-result', 'wally-cards');
}
function calcZinli(){
  calcWalletUpfront(parseFloat(document.getElementById('zinli-input').value), 0.0375, 'zinli-result', 'zinli-cards');
}
window.calcWally = calcWally;
window.calcZinli = calcZinli;

async function init(){
  loadLocal();
  var today=localToday();
  document.getElementById('tx-date').value=today;
  document.getElementById('tf-month').value=today.slice(0,7);
  document.getElementById('tf-search').addEventListener('input', function(){ clearTimeout(_srchTimer); _srchTimer=setTimeout(renderTx,220); });
  populateWalletSelects(); updateRateUI(); toggleWmBalField();
  var pulled=await pullFromCloud();
  if(pulled){ populateWalletSelects(); updateRateUI(); }
  if(S.binanceKey){ var bk=document.getElementById('bn-key'); if(bk) bk.value=S.binanceKey; }
  if(S.binanceSecret){ var bs=document.getElementById('bn-secret'); if(bs) bs.value=S.binanceSecret; }
  if(S.bibiBinanceKey){ var bbk=document.getElementById('bbn-key'); if(bbk) bbk.value=S.bibiBinanceKey; }
  if(S.bibiBinanceSecret){ var bbs=document.getElementById('bbn-secret'); if(bbs) bbs.value=S.bibiBinanceSecret; }
  try{ var _p2pc=localStorage.getItem('ft13_p2pc'); if(_p2pc){ var el=document.getElementById('p2p-comm'); if(el) el.value=_p2pc; } }catch(e){}
  var hash=(window.location.hash||'').replace('#','');
  showPage(hash||'summary', null);
  fetchRate(false);
  fetchTrezorBalance().then(function(){ renderWallets(); renderSummary(); }).catch(function(){});
  renderOnchainWallets();
  fetchWalletHoldings().then(function(){ renderWalletHoldings(); }).catch(function(){});
  try{ var _pc=JSON.parse(localStorage.getItem('ft13_pc')||'{}'); if(_pc.sell) document.getElementById('pc-sell').value=_pc.sell; if(_pc.amount) document.getElementById('pc-amount').value=_pc.amount; if(_pc.buy) document.getElementById('pc-buy').value=_pc.buy; if(_pc.card) document.getElementById('pc-card').value=_pc.card; }catch(e){}
  renderToolToggles(); calcProfit(); calcSpread(); calcBDV(); calcWally(); calcZinli(); calcBCVEmily();
  autoFetchBinance(); autoFetchBibiBinance();
  setInterval(function(){ fetchRate(false); }, 60*60*1000);
  setInterval(function(){ autoFetchBinance(); autoFetchBibiBinance(); }, BINANCE_AUTO_MS);
  // Pull fresh cloud state whenever user returns to this tab
  // Prevents stale open tabs from overwriting changes made on other devices
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) pullFromCloud().then(function(pulled){
      if(pulled){ populateWalletSelects(); updateRateUI(); renderTx(); renderSummary(); renderWallets(); }
    }).then(function(){ autoFetchBinance(); autoFetchBibiBinance(); });
  });
}
init();

if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js'); }

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
