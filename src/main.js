import './style.css';

var RATE_URL     = 'https://red-rain-afef.efrenalejandro2010.workers.dev/';
var PROXY        = 'https://portfolio-balance-worker.efrenalejandro2010.workers.dev';
var BINANCE_PROXY = 'https://portfolio-tracker-psi-hazel.vercel.app/api/binance-balance'; // Vercel function (non-blocked IPs)
var ANKR_PROXY   = 'https://portfolio-tracker-psi-hazel.vercel.app/api/ankr-balance';
var VERCEL_SECRET = 'ptk-2025-kisu'; // must match API_SECRET env var in Vercel
var DATA_URL     = 'https://portfolio-data.efrenalejandro2010.workers.dev';
var DATA_TOKEN   = '151322';
// Autofill rules: matched against the first word of the note (case-insensitive)
// type: 'Debit'|'Credit', category, currency: 'VES'|'USD', wallet
var AUTOFILL_RULES = [
  { keywords:['income','salario','cobro','pago','freelance','consulting','dividendo','ganancia','utilidad'],                                                                                                       type:'Credit', category:'Income' },
  { keywords:['patodo','madeira','rio','super','chinos','pan','botellon','viveres','abasto','bodega','mercado','automercado','central','polleria','panaderia','carneceria','charcuteria','verduras','frutas','lacteos','huevos','harina','arroz','pasta','embutidos','licoreria'], type:'Debit', category:'Groceries', currency:'VES' },
  { keywords:['remesa'],                                                                                                                                                                                           type:'Credit', wallet:'Zelle' },
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
  bybitBalance:null,   bybitUpdated:null,
  okxBalance:null,     okxUpdated:null,
  trezorBalance:null,  trezorUpdated:null,
  walletHoldings:[],   walletHoldingsUpdated:null,
  onchainWallets:[],   onchainWalletsUpdatedAt:null,
  snapshots:[],
  manualWalletsUpdatedAt:null, portfolioUpdatedAt:null, snapshotsUpdatedAt:null,
  deletedTxIds:[],
  dashGoal:0, projectionReturn:10, projectionContrib:null,
  categoryBudgets:{}
};
var mChart=null, cChart=null, eChart=null, perfChart=null, undoStack=[], redoStack=[];
var _budMonth=null, _budLimitsOpen=false;
var GROUP_ESSENTIAL=['Home','Groceries','Transport','Health'];
var GROUP_BUSINESS=['Business'];
var GROUP_LIFESTYLE=['Discretionary','Eating Out','Support'];
var GROUP_FINANCIAL=['Investments','Savings'];
var syncTimer=null, syncPending=false;

function setSyncStatus(state, msg){
  var dot=document.getElementById('sync-dot');
  var lbl=document.getElementById('sync-label');
  var colors={synced:'#5DCAA5', syncing:'#EF9F27', offline:'#888', error:'#E24B4A'};
  if(dot){ dot.style.background=colors[state]||'#888'; dot.classList.toggle('is-syncing',state==='syncing'); }
  if(lbl) lbl.textContent=msg||state;
}

function saveLocal(){ try{ localStorage.setItem('ft13',JSON.stringify(S)); }catch(e){} }
function loadLocal(){ try{ var s=localStorage.getItem('ft13'); if(s) S=Object.assign({},S,JSON.parse(s)); }catch(e){} }


async function pushToCloud(){
  try{
    setSyncStatus('syncing','Syncing...');
    // Merge-first: fetch cloud state and add any transactions missing locally.
    // Prevents a stale open tab from overwriting changes made on another device.
    try{
      var cr=await fetch(DATA_URL+'/data',{headers:{'Authorization':'Bearer '+DATA_TOKEN}});
      if(cr.ok){
        var cd=await cr.json();
        if(cd.data){
          var needRender=false;
          // transactions: additive merge, but respect local deletions (tombstones)
          if(cd.data.transactions){
            var mergedDeleted=new Set((S.deletedTxIds||[]).concat(cd.data.deletedTxIds||[]));
            S.deletedTxIds=Array.from(mergedDeleted);
            S.transactions=S.transactions.filter(function(t){ return !mergedDeleted.has(t.id); });
            var localIds=new Set(S.transactions.map(function(t){return t.id;}));
            var missing=cd.data.transactions.filter(function(t){return !localIds.has(t.id)&&!mergedDeleted.has(t.id);});
            if(missing.length){ S.transactions=S.transactions.concat(missing); needRender=true; }
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
          if(needRender){ saveLocal(); sortTx(); renderTx(); renderSummary(); renderWallets(); renderHoldings(); populateWalletSelects(); }
        }
      }
    }catch(e){ /* continue with push even if merge-pull fails */ }
    var r=await fetch(DATA_URL+'/data',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+DATA_TOKEN},
      body:JSON.stringify(S)
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    setSyncStatus('synced','Synced');
    var cs=document.getElementById('cloud-status');
    if(cs) cs.textContent='Last synced: '+new Date().toLocaleTimeString('en-US');
  }catch(e){
    setSyncStatus('offline','Offline (local only)');
    console.warn('push failed:',e.message);
  }
}

async function pullFromCloud(){
  try{
    setSyncStatus('syncing','Loading...');
    var r=await fetch(DATA_URL+'/data',{
      headers:{'Authorization':'Bearer '+DATA_TOKEN}
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var res=await r.json();
    if(res.data){
      S=Object.assign({},S,res.data);
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
    populateWalletSelects(); updateRateUI(); renderSummary();
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
function doUndo(){ if(!undoStack.length) return; redoStack.push(JSON.stringify(S.transactions)); S.transactions=JSON.parse(undoStack.pop()); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function doRedo(){ if(!redoStack.length) return; undoStack.push(JSON.stringify(S.transactions)); S.transactions=JSON.parse(redoStack.pop()); save(); renderTx(); renderSummary(); updateUndoBtns(); }
function updateUndoBtns(){ var u=document.getElementById('btn-undo'),r=document.getElementById('btn-redo'); if(u) u.style.opacity=undoStack.length?'1':'0.35'; if(r) r.style.opacity=redoStack.length?'1':'0.35'; }
function clearAllTx(){ if(!confirm('Delete ALL transactions? Can be undone with Undo.')) return; snapshot(); S.transactions=[]; save(); renderTx(); renderSummary(); }

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
function updateRateUI(){ if(!S.rate) return; document.getElementById('rate-display').textContent=S.rate.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})+' Bs/USD'; document.getElementById('rate-date').textContent=S.rateDate||''; }

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

async function fetchBybitBalance(){
  var r=await fetch(PROXY+'/bybit'); if(!r.ok) throw new Error('Bybit '+r.status);
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
  var r=await fetch(PROXY+'/okx'); if(!r.ok) throw new Error('OKX '+r.status);
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
  var data=S.walletHoldings||[];
  var wallets=S.onchainWallets||[];
  if(!wallets.length){ wrap.innerHTML=emptyState('No wallets configured','Add a wallet address above to track on-chain balances'); return; }
  if(!data.length){ wrap.innerHTML=emptyState('No on-chain holdings found','Click Refresh to load live balances'); return; }
  var netLabel={'eth':'ETH','arbitrum':'ARB','base':'BASE','bsc':'BSC'};
  var netColor={'eth':'#378ADD','arbitrum':'#7F77DD','base':'#378ADD','bsc':'#EF9F27'};
  var grouped={};
  data.forEach(function(h){ if(!grouped[h.walletLabel]) grouped[h.walletLabel]=[]; grouped[h.walletLabel].push(h); });
  var grandTotal=data.reduce(function(s,h){ return s+h.balanceUsd; },0);
  var html='';
  if(wallets.length>1) html='<div class="mc" style="margin-bottom:.875rem;display:inline-block;min-width:170px"><div class="mc-l">Total</div><div class="mc-v b">'+fmtUSD(grandTotal)+'</div></div>';
  Object.keys(grouped).forEach(function(label){
    var items=grouped[label];
    var wTotal=items.reduce(function(s,h){ return s+h.balanceUsd; },0);
    var rows=items.map(function(h){
      var net=netLabel[h.network]||h.network; var nc=netColor[h.network]||'#888';
      return '<tr><td style="font-weight:500">'+h.symbol+'</td>'
        +'<td style="color:var(--color-text-secondary);font-size:12px">'+h.name+'</td>'
        +'<td><span style="font-size:10px;padding:1px 5px;border-radius:3px;background:'+nc+'22;color:'+nc+';font-weight:600">'+net+'</span></td>'
        +'<td>'+h.balance.toLocaleString('en-US',{maximumFractionDigits:6})+'</td>'
        +'<td>'+fmtUSD(h.price)+'</td>'
        +'<td style="font-weight:500">'+fmtUSD(h.balanceUsd)+'</td></tr>';
    }).join('');
    html+='<div class="mc" style="margin-bottom:.5rem;display:inline-block;min-width:170px"><div class="mc-l">'+label+'</div><div class="mc-v b">'+fmtUSD(wTotal)+'</div></div>'
      +'<table><thead><tr><th>Symbol</th><th>Name</th><th>Network</th><th>Balance</th><th>Price</th><th>Value</th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table>';
  });
  wrap.innerHTML=html;
}
function renderOnchainWallets(){
  var wrap=document.getElementById('ow-list');
  if(!wrap) return;
  var wallets=S.onchainWallets||[];
  if(!wallets.length){ wrap.innerHTML='<p class="hint" style="margin:0">No wallets added yet.</p>'; return; }
  wrap.innerHTML=wallets.map(function(w){
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--color-border-tertiary)">'
      +'<span style="font-weight:500;flex-shrink:0">'+w.label+'</span>'
      +'<span style="font-size:11px;color:var(--color-text-secondary);font-family:monospace;word-break:break-all;flex:1">'+w.address+'</span>'
      +'<button class="btn" style="color:#E24B4A;padding:2px 7px;flex-shrink:0" onclick="deleteOnchainWallet('+w.id+')">&#x2715;</button>'
      +'</div>';
  }).join('');
}
function saveOnchainWallet(){
  var label=document.getElementById('ow-label').value.trim();
  var chain=document.getElementById('ow-chain').value;
  var addr=document.getElementById('ow-addr').value.trim();
  if(!label||!addr) return;
  if(chain==='evm'&&!/^0x[0-9a-fA-F]{40}$/.test(addr)){ alert('Invalid EVM address (must be 0x + 40 hex chars)'); return; }
  if(chain==='btc'&&!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,87}$/.test(addr)){ alert('Invalid Bitcoin address'); return; }
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
async function refreshWalletHoldings(){
  var wrap=document.getElementById('wh-wrap');
  if(wrap) wrap.innerHTML='<div class="empty">Loading...</div>';
  try{ await fetchWalletHoldings(); renderWalletHoldings(); }
  catch(e){ console.error('fetchWalletHoldings:',e); if(wrap) wrap.innerHTML='<div class="empty" style="color:#E24B4A">Error: '+(e.message||e.toString())+'</div>'; }
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
  S.transactions.push({id:Date.now(),seq:S.transactions.length,date:date,desc:desc,wallet:wallet,type:type,category:cat,amountUSD:amtUSD,amountVES:amtVES,originalCurrency:cur,rateUsed:cur==='VES'?S.rate:null,imported:false});
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  save(); renderTx(); renderSummary();
  closeTxForm();
}

function deleteTx(id){ snapshot(); if(!S.deletedTxIds) S.deletedTxIds=[]; S.deletedTxIds.push(id); S.transactions=S.transactions.filter(function(t){ return t.id!==id; }); save(); renderTx(); renderSummary(); }

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
  if(t){ t.date=date; t.desc=desc; t.wallet=wallet; t.type=type; t.category=cat; t.originalCurrency=cur; t.amountUSD=amtUSD; t.amountVES=amtVES; t.rateUsed=cur==='VES'?S.rate:null; }
  document.getElementById('tx-desc').value=''; document.getElementById('tx-amount').value='';
  cancelEditTx(); save(); renderTx(); renderSummary();
}
function deleteHolding(id){ S.portfolio=S.portfolio.filter(function(t){ return t.id!==id; }); S.portfolioUpdatedAt=Date.now(); save(); renderHoldings(); }
function deleteManualWallet(id){ S.manualWallets=S.manualWallets.filter(function(w){ return w.id!==id; }); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); populateWalletSelects(); }
function renameManualWallet(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var v=prompt('Rename "'+w.name+'" to:',w.name); if(!v||!v.trim()||v.trim()===w.name) return; w.name=v.trim(); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); populateWalletSelects(); }
window.renameManualWallet=renameManualWallet;
function editManualWalletBal(id){ var w=S.manualWallets.find(function(x){ return x.id===id; }); if(!w) return; var v=parseFloat(prompt('New balance for '+w.name+':',w.balance)); if(isNaN(v)) return; w.balance=parseFloat(v.toFixed(2)); S.manualWalletsUpdatedAt=Date.now(); save(); renderWallets(); renderSummary(); }
window.editManualWalletBal=editManualWalletBal;

function emptyState(title, sub){
  return '<div class="es"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:.25;margin-bottom:.75rem"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15" x2="12" y2="15"/></svg><div class="es-title">'+title+'</div><div class="es-sub">'+sub+'</div></div>';
}
function localToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseAmt(s){ return parseFloat(String(s||0).replace(/[$,\s]/g,''))||0; }
function fmtUSD(v){ return '$'+parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function tagCat(cat){ var m={Income:'tG',Home:'tP',Groceries:'tG',Transport:'tB',Health:'tG',Business:'tA',Discretionary:'tB','Eating Out':'tA',Support:'tA',Investments:'tA',Savings:'tG',
  Services:'tP','Help others':'tA',Emergency:'tR',Zelle:'tZ',Other:'tX'}; return m[cat]||'tX'; }
function fmtCat(cat){ return cat||'—'; }
function sortTx(data){ return data.slice().sort(function(a,b){ if(b.date!==a.date) return b.date.localeCompare(a.date); return b.id - a.id; }); }

function renderTx(){
  var wrap=document.getElementById('tx-wrap');
  var tF=document.getElementById('tf-type').value, cF=document.getElementById('tf-cat').value, wF=document.getElementById('tf-wallet').value, mF=document.getElementById('tf-month').value, sF=(document.getElementById('tf-search').value||'').toLowerCase().trim();
  var data=sortTx(S.transactions);
  if(tF) data=data.filter(function(t){ return t.type===tF; });
  if(cF) data=data.filter(function(t){ return t.category===cF; });
  if(wF) data=data.filter(function(t){ return t.wallet===wF; });
  if(mF) data=data.filter(function(t){ return t.date.startsWith(mF); });
  if(sF) data=data.filter(function(t){ return (t.desc||'').toLowerCase().indexOf(sF)>=0||(t.wallet||'').toLowerCase().indexOf(sF)>=0||(t.category||'').toLowerCase().indexOf(sF)>=0||(t.date||'').indexOf(sF)>=0; });
  if(!data.length){ wrap.innerHTML=emptyState('No transactions yet','Use the + button to add your first transaction'); return; }
  var totalDebits=data.filter(function(t){ return t.type==='Debit'&&inSummary(t); }).reduce(function(s,t){ return s+t.amountUSD; },0);
  // Group by date — single table with separator rows so columns stay aligned
  var groups={}, groupOrder=[];
  data.forEach(function(t){ if(!groups[t.date]){ groups[t.date]=[]; groupOrder.push(t.date); } groups[t.date].push(t); });
  function fmtDateHdr(d){
    var today=localToday();
    var yd=new Date(); yd.setDate(yd.getDate()-1);
    var yest=yd.getFullYear()+'-'+String(yd.getMonth()+1).padStart(2,'0')+'-'+String(yd.getDate()).padStart(2,'0');
    return d===today?'Today':d===yest?'Yesterday':new Date(d+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  }
  var rows=groupOrder.map(function(date){
    var dayTotal=groups[date].reduce(function(s,t){ return s+(t.type==='Debit'&&inSummary(t)?t.amountUSD:0); },0);
    var sep='<tr class="date-sep"><td colspan="7"><div class="dsep-inner"><span class="dsep-lbl">'+fmtDateHdr(date)+'</span>'+(dayTotal>0?'<span class="dsep-sep">·</span><span class="dsep-total">-'+fmtUSD(dayTotal)+'</span>':'')+'</div></td></tr>';
    var txRows=groups[date].map(function(t){
      var orig=t.originalCurrency==='VES'&&t.amountVES?'Bs '+t.amountVES.toLocaleString('es-VE'):'-';
      var isTrk=isTracker(t.wallet,t); var col=isTrk?'#a78bfa':(t.type==='Credit'?'#5DCAA5':'#E24B4A');
      var trk=isTrk?'<span class="badge-t">tracker</span>':'';
      var wTag=t.wallet==='Binance'?'tBinance':'tX';
      return '<tr><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+t.desc+'">'+t.desc+'</td><td><span class="tag '+wTag+'">'+(t.wallet||'-')+'</span>'+trk+'</td><td><span class="tag '+(t.type==='Debit'?'tR':'tG')+'">'+t.type+'</span></td><td>'+(t.category?'<span class="tag '+tagCat(t.category)+'">'+t.category+'</span>':'<span style="color:var(--color-text-secondary);font-size:12px">—</span>')+'</td><td style="font-size:12px;color:var(--color-text-secondary)">'+orig+'</td><td style="font-weight:500;color:'+col+'">'+fmtUSD(t.amountUSD)+'</td><td style="white-space:nowrap"><button class="btn-edit-tx" title="Edit" onclick="editTx('+t.id+')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg></button><button class="btn btnd" onclick="deleteTx('+t.id+')">x</button></td></tr>';
    }).join('');
    return sep+txRows;
  }).join('');
  wrap.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.875rem">'+data.length+' records &middot; Total debits: <strong style="color:#E24B4A">'+fmtUSD(totalDebits)+'</strong></div><table><thead><tr><th>Note</th><th>Wallet</th><th>In/Out</th><th>Category</th><th>Original</th><th>USD</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function getMonths(){ var all=S.transactions.map(function(t){ return t.date.slice(0,7); }); var u=all.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort().reverse(); if(!u.length) u.push(new Date().toISOString().slice(0,7)); return u; }
function populateSumMonth(){ var sel=document.getElementById('sum-month'); var cur=sel.value; var months=getMonths(); sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+m+'</option>'; }).join(''); if(cur&&months.indexOf(cur)>=0) sel.value=cur; }

function groupSum(txDebit, cats){ return cats.reduce(function(s,c){ return s+txDebit.filter(function(t){ return t.category===c; }).reduce(function(a,t){ return a+t.amountUSD; },0); },0); }

// ── Dashboard helpers ──────────────────────────────────────────────────────
var EXPENSE_CATS_DASH=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);

function getAvgMonthlyExpenses(){
  var now=new Date(); var months=[];
  for(var i=0;i<3;i++){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
  var totals=months.map(function(m){ return S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Debit'&&EXPENSE_CATS_DASH.indexOf(t.category)>=0; }).reduce(function(s,t){ return s+t.amountUSD; },0); });
  var nz=totals.filter(function(v){ return v>0; });
  return nz.length>0?nz.reduce(function(s,v){ return s+v; },0)/nz.length:0;
}

function getAvgMonthlyContribution(){
  var now=new Date(); var months=[];
  for(var i=0;i<3;i++){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(d.toISOString().slice(0,7)); }
  var nets=months.map(function(m){
    var inc=S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
    var exp=S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Debit'&&EXPENSE_CATS_DASH.indexOf(t.category)>=0; }).reduce(function(s,t){ return s+t.amountUSD; },0);
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
function renderKPIStrip(month){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var netWorth=snaps.length>0?snaps[0].total:getTotalBalance();
  var txM=S.transactions.filter(function(t){ return t.date.startsWith(month)&&inSummary(t); });
  var income=txM.filter(function(t){ return t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var expenses=txM.filter(function(t){ return t.type==='Debit'&&EXPENSE_CATS_DASH.indexOf(t.category)>=0; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var cashFlow=income-expenses;
  var savRate=income>0?Math.round((cashFlow/income)*100):0;
  var avgExp=getAvgMonthlyExpenses();
  var emgMo=avgExp>0?(netWorth/avgExp):null;
  var goalPct=(S.dashGoal>0)?Math.min(100,(netWorth/S.dashGoal)*100):null;
  function kpi(label,val,sub,color){
    return '<div class="kpi-card"><div class="kpi-lbl">'+label+'</div><div class="kpi-val" style="color:'+color+'">'+val+'</div><div class="kpi-sub">'+sub+'</div></div>';
  }
  var emgColor=emgMo===null?'#888':emgMo>=6?'#1D9E75':emgMo>=3?'#EF9F27':'#E24B4A';
  var emgVal=emgMo!==null?emgMo.toFixed(1)+' mo':'—';
  var emgSub=avgExp>0?'÷ '+fmtUSD(avgExp)+'/mo':'no expense data';
  document.getElementById('kpi-strip').innerHTML='<div class="kpi-strip">'
    +kpi('Net Worth',fmtUSD(netWorth),snaps.length>0?'as of '+snaps[0].date:'live estimate','#fff')
    +kpi('Cash Flow',(cashFlow>=0?'+':'')+fmtUSD(cashFlow),month,cashFlow>=0?'#1D9E75':'#E24B4A')
    +kpi('Savings Rate',savRate+'%','of income',savRate>=20?'#1D9E75':savRate>=10?'#EF9F27':'#E24B4A')
    +kpi('Emergency Fund',emgVal,emgSub,emgColor)
    +kpi('Goal Progress',goalPct!==null?goalPct.toFixed(1)+'%':'—',S.dashGoal>0?'of '+fmtUSD(S.dashGoal):'set a goal below','#9B70F0')
    +'</div>';
}

function renderSnapshotPnL(){
  var el=document.getElementById('snap-pnl-wrap'); if(!el) return;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var pnls=getSnapshotPnL();
  var HIST_ICON='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 14"/></svg>';
  var simpleHdr='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem"><span class="cleg" style="margin:0">Snapshot P&amp;L</span></div>';
  if(!snaps.length){ el.innerHTML=simpleHdr+emptyState('No snapshots yet','Record your first snapshot to begin tracking'); return; }
  if(snaps.length<2){ el.innerHTML=simpleHdr+'<div style="color:var(--color-text-secondary);font-size:13px">Record a second snapshot to see P&L between periods.</div>'; return; }
  function makePnlRow(p){
    var c=p.profit>0?'#1D9E75':p.profit<0?'#E24B4A':'#888';
    var sign=p.profit>0?'+':'';
    var adj=p.invOut>0||p.invIn>0?'<div style="font-size:11px;color:#EF9F27">'+(p.invOut>0?'Invested: '+fmtUSD(p.invOut):'')+(p.invIn>0?' · Returned: '+fmtUSD(p.invIn):'')+'</div>':'';
    return '<div class="pnl-row"><div><div class="pnl-period">'+p.from+' → '+p.to+'</div>'
      +'<div style="font-size:12px;color:var(--color-text-secondary)">'+fmtUSD(p.snap1)+' → '+fmtUSD(p.snap2)+'</div>'+adj+'</div>'
      +'<div class="pnl-profit" style="color:'+c+'">'+sign+fmtUSD(p.profit)+'</div></div>';
  }
  var latest=makePnlRow(pnls[pnls.length-1]);
  var older=pnls.slice(0,-1).reverse().map(makePnlRow).join('');
  var total=pnls.reduce(function(s,p){ return s+p.profit; },0);
  var tc=total>0?'#1D9E75':total<0?'#E24B4A':'#888';
  var histIcon=older?'<div class="hist-wrap"><button class="hist-btn" onclick="toggleHistPopup(this)" title="History">'+HIST_ICON+'</button><div class="hist-popup"><div style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem">History</div><div class="pnl-list">'+older+'</div></div></div>':'';
  var hdr='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem"><span class="cleg" style="margin:0">Snapshot P&amp;L</span>'+histIcon+'</div>';
  el.innerHTML=hdr+'<div class="pnl-list">'+latest+'</div>'
    +'<div style="display:flex;justify-content:space-between;padding:.75rem 0 0;border-top:0.5px solid var(--color-border-tertiary);margin-top:.5rem;font-size:13px">'
    +'<span style="color:var(--color-text-secondary)">Total P&L</span>'
    +'<span style="font-weight:600;color:'+tc+'">'+(total>=0?'+':'')+fmtUSD(total)+'</span></div>';
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
  var progBar=goal>0
    ?'<div style="margin-top:.75rem">'
      +'<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-text-secondary);margin-bottom:5px"><span>'+fmtUSD(current)+'</span><span>'+fmtUSD(goal)+'</span></div>'
      +'<div style="background:var(--color-background-secondary);border-radius:999px;height:7px;overflow:hidden">'
      +'<div style="background:#9B70F0;height:100%;width:'+pct.toFixed(1)+'%;border-radius:999px"></div></div>'
      +'<div style="display:flex;justify-content:space-between;margin-top:7px;font-size:13px">'
      +'<span style="color:#9B70F0;font-weight:600">'+pct.toFixed(1)+'%</span>'
      +(months?'<span style="color:var(--color-text-secondary)">~'+months+' mo · '+fmtUSD(contrib)+'/mo</span>':'')
      +'</div></div>'
    :'<div style="color:var(--color-text-secondary);font-size:13px;margin-top:.5rem">Set a target to track progress.</div>';
  el.innerHTML='<div class="cleg" style="margin-bottom:.75rem">Financial Goal</div>'
    +'<div style="display:flex;gap:8px;align-items:center">'
    +'<input type="number" id="goal-input" value="'+(goal||'')+'" placeholder="Target e.g. 100000" style="flex:1;background:var(--color-background-secondary);border:0.5px solid var(--color-border-secondary);border-radius:8px;padding:6px 10px;color:#fff;font-size:14px"/>'
    +'<button class="btn btns" onclick="saveGoal()" style="padding:6px 14px">Set</button>'
    +'</div>'+progBar;
}

function renderProjection(){
  var phdr=document.getElementById('proj-header');
  var pftr=document.getElementById('proj-footer');
  var pcanvas=document.getElementById('chart-projection');
  if(!phdr||!pcanvas) return;
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var current=snaps.length>0?snaps[snaps.length-1].total:getTotalBalance();
  var baseContrib=getAvgMonthlyContribution();
  var contrib=S.projectionContrib!==null&&S.projectionContrib!==undefined?S.projectionContrib:baseContrib;
  var annRet=S.projectionReturn||10;
  var moRet=annRet/100/12;
  var isOverride=S.projectionContrib!==null&&S.projectionContrib!==undefined;

  // Dataset 1: projected with return
  var projected=[current];
  for(var i=0;i<24;i++) projected.push(parseFloat((projected[projected.length-1]*(1+moRet)+contrib).toFixed(2)));
  // Dataset 2: zero-return baseline (pure savings)
  var baseline=[current];
  for(var i=0;i<24;i++) baseline.push(parseFloat((baseline[baseline.length-1]+contrib).toFixed(2)));

  var now=new Date(); var labels=['Now'];
  for(var j=1;j<=24;j++){ var dd=new Date(now.getFullYear(),now.getMonth()+j,1); labels.push(dd.toLocaleString('en',{month:'short',year:'2-digit'})); }

  var datasets=[
    {label:'Projected',data:projected,borderColor:'#9B70F0',backgroundColor:'rgba(155,112,240,0.07)',borderWidth:2,pointRadius:2,pointHitRadius:15,tension:0.4,fill:true},
    {label:'Savings only',data:baseline,borderColor:'#60A5FA',backgroundColor:'transparent',borderWidth:1.5,borderDash:[4,3],pointRadius:0,pointHitRadius:15,tension:0.4}
  ];
  // Dataset 3: goal line
  if(S.dashGoal>0) datasets.push({label:'Goal',data:Array(25).fill(S.dashGoal),borderColor:'#EF9F27',backgroundColor:'transparent',borderWidth:1,borderDash:[6,3],pointRadius:0,pointHitRadius:0,tension:0});

  var atTarget=S.dashGoal>0?projected.findIndex(function(v){ return v>=S.dashGoal; }):-1;

  phdr.innerHTML='<div class="cleg" style="margin-bottom:.5rem">Projection (24 months)</div>'
    +'<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:.6rem;font-size:13px">'
    +'<span style="color:var(--color-text-secondary)">Monthly contrib: <input type="number" id="proj-contrib" value="'+parseFloat(contrib.toFixed(2))+'" min="0" step="1" style="width:72px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-secondary);border-radius:6px;padding:2px 6px;color:#fff;font-size:13px;margin:0 3px" onchange="window.updateProjContrib(this.value)"/>'+(isOverride?'<span style="cursor:pointer;color:rgba(255,255,255,0.32);font-size:11px;margin-left:2px" onclick="window.resetProjContrib()" title="Reset to auto">↺ auto ('+fmtUSD(baseContrib)+')</span>':'')+'</span>'
    +'<span style="color:var(--color-text-secondary)">Annual return: <input type="number" id="proj-return" value="'+annRet+'" min="0" max="500" style="width:48px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-secondary);border-radius:6px;padding:2px 6px;color:#fff;font-size:13px;margin:0 3px" onchange="updateProjectionChart()"/>%</span>'
    +'</div>'
    +'<div style="display:flex;gap:12px;font-size:11px;margin-bottom:.5rem;color:var(--color-text-secondary)">'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:2px;background:#9B70F0;display:inline-block"></span>Projected</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:2px;background:#60A5FA;display:inline-block;opacity:.7"></span>Savings only</span>'
    +(S.dashGoal>0?'<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:2px;background:#EF9F27;display:inline-block"></span>Goal '+fmtUSD(S.dashGoal)+'</span>':'')
    +'</div>';
  pftr.innerHTML=atTarget>0&&S.dashGoal>0?'<div style="font-size:12px;color:#9B70F0;margin-top:6px">At this pace, reach '+fmtUSD(S.dashGoal)+' in ~'+atTarget+' months</div>':atTarget===-1&&S.dashGoal>0?'<div style="font-size:12px;color:rgba(255,255,255,0.3);margin-top:6px">Goal '+fmtUSD(S.dashGoal)+' not reached in 24 months at this rate</div>':'';

  if(window.projChart){ window.projChart.destroy(); window.projChart=null; }
  window.projChart=new Chart(pcanvas,{type:'line',data:{labels:labels,datasets:datasets},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){
    if(ctx.dataset.label==='Goal') return null;
    return ctx.dataset.label+': '+fmtUSD(ctx.raw);
  }}}},scales:{x:{grid:{display:false},ticks:{color:'#555',font:{size:11},maxTicksLimit:7}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:11},callback:function(v){ return '$'+(v>=1000?(v/1000).toFixed(0)+'k':v); }}}}}});
}

function updateProjectionChart(){
  var inp=document.getElementById('proj-return'); if(!inp) return;
  S.projectionReturn=parseFloat(inp.value)||10; save(); renderProjection();
}
window.updateProjectionChart=updateProjectionChart;
window.updateProjContrib=function(val){ var v=parseFloat(val); S.projectionContrib=(isNaN(v)||v<0)?null:v; save(); renderProjection(); };
window.resetProjContrib=function(){ S.projectionContrib=null; save(); renderProjection(); };

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
  renderSnapshotPnL();
  renderGoal();
  renderProjection();
  renderEquityChart(); renderMonthlyChart(); renderPerformanceChart();
}

function getLast6(){ var m=[]; var now=new Date(); for(var i=5;i>=0;i--){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); m.push(d.toISOString().slice(0,7)); } return m; }

function renderMonthlyChart(){
  var months=getLast6();
  var SPEND_CATS=GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE).concat(['Investments']);
  var cD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Debit'&&SPEND_CATS.indexOf(t.category)>=0; }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var crD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var labels=months.map(function(m){ var p=m.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1).toLocaleString('en',{month:'short',year:'2-digit'}); });
  document.getElementById('mc-leg').innerHTML='<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#34D399;display:inline-block"></span>Income</span><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#F87171;display:inline-block"></span>Expenses</span>';
  if(mChart){ mChart.destroy(); mChart=null; }
  mChart=new Chart(document.getElementById('chart-monthly'),{type:'bar',data:{labels:labels,datasets:[{label:'Income',data:crD,backgroundColor:'#34D399',borderRadius:3},{label:'Expenses',data:cD,backgroundColor:'#F87171',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{grid:{display:false},ticks:{color:'#555',autoSkip:false,font:{size:12}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:12},callback:function(v){ return '$'+(v>=1000?(v/1000).toFixed(1)+'k':v); }}}}}});
}

// ── Monthly Performance Chart ──────────────────────────────────────────────
function computeMonthlyPerformance(){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  if(snaps.length<2) return [];
  // Last snapshot per month
  var byMonth={};
  snaps.forEach(function(s){ byMonth[s.date.slice(0,7)]=s; });
  var months=Object.keys(byMonth).sort();
  if(months.length<2) return [];
  var result=[];
  for(var i=1;i<months.length;i++){
    var snapS=byMonth[months[i-1]], snapE=byMonth[months[i]];
    var sc=snapS.total, ec=snapE.total;
    var profit=parseFloat((ec-sc).toFixed(2));
    var monthlyReturn=sc>0?parseFloat((profit/sc*100).toFixed(2)):0;
    var avg=(sc+ec)/2;
    var efficiency=avg>0?parseFloat((profit/avg*100).toFixed(2)):0;
    result.push({month:months[i],startingCapital:sc,endingCapital:ec,profit:profit,monthlyReturn:monthlyReturn,capitalEfficiency:efficiency});
  }
  return result;
}
function rollingAvg3(arr){
  return arr.map(function(_,i){
    var sl=arr.slice(Math.max(0,i-2),i+1);
    return parseFloat((sl.reduce(function(s,v){ return s+v; },0)/sl.length).toFixed(2));
  });
}
function renderPerformanceChart(){
  var el=document.getElementById('chart-performance');
  var wrap=document.getElementById('perf-wrap');
  if(!el||!wrap) return;
  var data=computeMonthlyPerformance();
  if(data.length<1){
    if(perfChart){ perfChart.destroy(); perfChart=null; }
    el.style.display='none';
    wrap.innerHTML='<div style="color:var(--color-text-secondary);font-size:13px;padding:2.5rem 0;text-align:center">Not enough data yet — need at least 2 months of snapshots</div>';
    return;
  }
  el.style.display='';
  wrap.innerHTML='';
  var labels=data.map(function(d){ var p=d.month.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1).toLocaleString('en',{month:'short',year:'2-digit'}); });
  var returns=data.map(function(d){ return d.monthlyReturn; });
  var efficiencies=data.map(function(d){ return d.capitalEfficiency; });
  var rolling=rollingAvg3(efficiencies);
  var barBg=returns.map(function(v){ return v>=0?'rgba(93,202,165,0.7)':'rgba(232,75,74,0.7)'; });
  var barBorder=returns.map(function(v){ return v>=0?'#5DCAA5':'#E24B4A'; });
  if(perfChart){ perfChart.destroy(); perfChart=null; }
  perfChart=new Chart(el,{type:'bar',data:{labels:labels,datasets:[
    {type:'bar',label:'Monthly Return',data:returns,backgroundColor:barBg,borderColor:barBorder,borderWidth:1,borderRadius:4,yAxisID:'yL',order:2},
    {type:'line',label:'Capital Efficiency',data:efficiencies,borderColor:'#9B70F0',backgroundColor:'transparent',borderWidth:2,pointRadius:3,pointHitRadius:15,pointBackgroundColor:'#9B70F0',tension:0.3,yAxisID:'yR',order:1},
    {type:'line',label:'3-Month Avg',data:rolling,borderColor:'#60A5FA',backgroundColor:'transparent',borderWidth:1.5,borderDash:[4,3],pointRadius:2,pointHitRadius:15,pointBackgroundColor:'#60A5FA',tension:0.3,yAxisID:'yR',order:0}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{
    title:function(items){ return data[items[0].dataIndex].month; },
    label:function(ctx){
      var d=data[ctx.dataIndex];
      if(ctx.dataset.label==='Monthly Return') return ['Profit: '+fmtUSD(d.profit),'Return: '+d.monthlyReturn+'%','Efficiency: '+d.capitalEfficiency+'%','Avg Capital: '+fmtUSD((d.startingCapital+d.endingCapital)/2)];
      if(ctx.dataset.label==='3-Month Avg') return '3-mo Avg: '+ctx.parsed.y+'%';
      return null;
    }
  }}},scales:{
    x:{grid:{display:false},ticks:{color:'#555',font:{size:11}}},
    yL:{type:'linear',position:'left',grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:11},callback:function(v){ return v+'%'; }},title:{display:true,text:'Monthly Return (%)',color:'rgba(255,255,255,0.25)',font:{size:10}}},
    yR:{type:'linear',position:'right',grid:{drawOnChartArea:false},ticks:{color:'#555',font:{size:11},callback:function(v){ return v+'%'; }},title:{display:true,text:'Capital Efficiency (%)',color:'rgba(255,255,255,0.25)',font:{size:10}}}
  }}});
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
  if(leg) leg.innerHTML=cats.map(function(c,i){ return '<div style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:9px;height:9px;border-radius:2px;background:'+colors[i]+';flex-shrink:0"></span><span style="color:var(--color-text-secondary);flex:1">'+c+'</span><span style="font-weight:500">$'+vals[i].toLocaleString('en-US',{minimumFractionDigits:2})+'</span><span style="color:var(--color-text-secondary);font-size:11px;min-width:30px;text-align:right">'+(total>0?Math.round(vals[i]/total*100):0)+'%</span></div>'; }).join('');
  if(cChart){ cChart.destroy(); cChart=null; }
  cChart=new Chart(document.getElementById('chart-cat'),{type:'doughnut',data:{labels:cats,datasets:[{data:vals,backgroundColor:colors,borderWidth:0,hoverOffset:3}]},options:{responsive:true,maintainAspectRatio:false,transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.label+': '+fmtUSD(ctx.raw); }}}},cutout:'65%'}});
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
  var snapsSorted=snaps.slice().reverse();
  function makeSnapRow(s){ return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary)"><span style="color:var(--color-text-secondary)">'+s.date+'</span><span style="font-weight:500">'+fmtUSD(s.total)+'</span><div style="display:flex;gap:4px"><button class="btn btns" onclick="editSnapshot('+s.id+')" style="font-size:11px;padding:2px 7px;opacity:1">edit</button><button class="btn btnd" onclick="deleteSnapshot('+s.id+')" style="font-size:11px;padding:2px 7px;opacity:1">×</button></div></div>'; }
  var latestSnap=makeSnapRow(snapsSorted[0]);
  var olderSnaps=snapsSorted.slice(1).map(makeSnapRow).join('');
  var HIST_ICON2='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 14"/></svg>';
  var eHist=document.getElementById('equity-hist');
  if(eHist) eHist.innerHTML=olderSnaps?'<div class="hist-wrap"><button class="hist-btn" onclick="toggleHistPopup(this)" title="Snapshot history">'+HIST_ICON2+'</button><div class="hist-popup"><div style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:.07em;margin-bottom:.5rem">History</div><div style="font-size:13px">'+olderSnaps+'</div></div></div>':'';
  if(wrap) wrap.innerHTML='<div style="display:flex;gap:12px;font-size:12px;color:var(--color-text-secondary);margin-bottom:.5rem">'
    +'<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#5DCAA5;display:inline-block"></span>Tracked</span>'
    +'<span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:2px;background:#9B70F0;display:inline-block"></span>Incl. deployed capital</span>'
    +'</div>'
    +'<div style="font-size:13px">'+latestSnap+'</div>';
  if(eChart){ eChart.destroy(); eChart=null; }
  eChart=new Chart(el,{type:'line',data:{labels:labels,datasets:[
    {label:'Tracked',data:vals,borderColor:'#5DCAA5',backgroundColor:'rgba(93,202,165,0.06)',borderWidth:2,pointRadius:4,pointHitRadius:20,pointBackgroundColor:'#5DCAA5',tension:0.3,fill:true},
    {label:'Incl. deployed',data:adjVals,borderColor:'#9B70F0',backgroundColor:'transparent',borderWidth:1.5,pointRadius:3,pointHitRadius:15,pointBackgroundColor:'#9B70F0',tension:0.3,fill:false,borderDash:[4,3]}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},transitions:{active:{animation:{duration:0}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ctx.dataset.label+': '+fmtUSD(ctx.raw); }}}},scales:{x:{grid:{display:false},ticks:{color:'#555',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:11},callback:function(v){ return '$'+(v>=1000?(v/1000).toFixed(1)+'k':v); }}}}}});}

function getTotalBalance(){
  var api=(S.binanceBalance||0)+(S.bybitBalance||0)+(S.okxBalance||0)+(S.trezorBalance||0);
  var trackerBal=S.manualWallets.filter(function(w){ return w.trackerOnly; }).reduce(function(s,w){ return s+calcTrackerBal(w.name); },0);
  var manualBal=S.manualWallets.filter(function(w){ return !w.trackerOnly; }).reduce(function(s,w){ return s+w.balance; },0);
  var zelle=calcTrackerBal('Zelle');
  return parseFloat((api+trackerBal+manualBal+zelle).toFixed(2));
}

function recordSnapshot(){
  var auto=getTotalBalance();
  var msg='Record portfolio snapshot\n\nAuto-sum from wallets: $'+auto.toFixed(2)+'\n\nEnter total (or leave to use auto-sum):';
  var val=parseFloat(prompt(msg,auto.toFixed(2)));
  if(isNaN(val)||val<0) return;
  if(!S.snapshots) S.snapshots=[];
  var today=localToday();
  var existing=S.snapshots.findIndex(function(s){ return s.date===today; });
  if(existing>=0){ if(!confirm('A snapshot for today already exists ($'+S.snapshots[existing].total+'). Replace it?')) return; S.snapshots.splice(existing,1); }
  S.snapshots.push({id:Date.now(),date:today,total:val});
  S.snapshotsUpdatedAt=Date.now();
  save(); renderEquityChart();
}

function toggleHistPopup(btn){ var p=btn.parentNode.querySelector('.hist-popup'); if(!p) return; p.classList.toggle('open'); }
window.toggleHistPopup=toggleHistPopup;
function deleteSnapshot(id){ if(!confirm('Delete this snapshot?')) return; S.snapshots=S.snapshots.filter(function(s){ return s.id!==id; }); S.snapshotsUpdatedAt=Date.now(); save(); renderEquityChart(); renderSnapshotPnL(); }
function editSnapshot(id){ var snap=S.snapshots.find(function(s){ return s.id===id; }); if(!snap) return; var val=parseFloat(prompt('Edit snapshot value for '+snap.date+':',snap.total)); if(isNaN(val)||val<0) return; snap.total=val; S.snapshotsUpdatedAt=Date.now(); save(); renderEquityChart(); renderSnapshotPnL(); }
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
function renderBudget(){
  var BUDGET_CATS=['Home','Groceries','Transport','Health','Business','Discretionary','Eating Out','Support'];
  var months=getMonths();
  if(!_budMonth||months.indexOf(_budMonth)<0) _budMonth=months[0]||'';
  var month=_budMonth;
  var income=S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Credit'&&t.category==='Income'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var debits=S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&BUDGET_CATS.indexOf(t.category)>=0; });
  var spent=debits.reduce(function(s,t){ return s+t.amountUSD; },0);
  var net=income-spent;
  var savRate=income>0?Math.round((net/income)*100):0;
  var remaining=S.budgetTotal-spent;
  var pct=Math.min(100,S.budgetTotal>0?Math.round(spent/S.budgetTotal*100):0);
  var bc=pct>90?'#E24B4A':pct>70?'#EF9F27':'#1D9E75';

  function kpi(label,val,color){
    return '<div class="kpi-card"><div class="kpi-lbl">'+label+'</div><div class="kpi-val" style="color:'+color+'">'+val+'</div></div>';
  }

  var html='';

  // Header row
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<div style="font-size:18px;font-weight:600;letter-spacing:-0.3px">Budget</div>'
    +'<select onchange="window._budMonthSel(this.value)" style="padding:5px 14px;border:0.5px solid rgba(255,255,255,0.1);border-radius:20px;background:rgba(255,255,255,0.07);color:#fff;font-size:13px;cursor:pointer;color-scheme:dark">'
    +months.map(function(m){ return '<option value="'+m+'"'+(m===month?' selected':'')+'>'+m+'</option>'; }).join('')
    +'</select>'
    +'</div>';

  // KPI strip
  html+='<div class="kpi-strip kpi-strip-4" style="margin-bottom:1.1rem">'
    +kpi('Income',fmtUSD(income),'#5DCAA5')
    +kpi('Spent',fmtUSD(spent),pct>90?'#E24B4A':pct>70?'#EF9F27':'#fff')
    +kpi('Savings Rate',savRate+'%',savRate>=20?'#9B70F0':savRate>=10?'#EF9F27':'#E24B4A')
    +kpi('Remaining',fmtUSD(Math.abs(remaining)),remaining>=0?'#5DCAA5':'#E24B4A')
    +'</div>';

  // Total budget bar
  html+='<div class="fc" style="margin-bottom:1.1rem">'
    +'<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">'
    +'<span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:.07em">Monthly Budget</span>'
    +'<span style="font-size:13px;font-weight:500"><span style="color:'+bc+'">'+pct+'%</span>'
    +'<span style="color:rgba(255,255,255,0.3)">&nbsp;·&nbsp;</span>'
    +'<span style="color:rgba(255,255,255,0.55)">'+fmtUSD(spent)+' of '+fmtUSD(S.budgetTotal)+'</span></span>'
    +'</div>'
    +'<div class="pb" style="height:12px;border-radius:6px">'
    +'<div class="pf" style="width:'+pct+'%;background:'+bc+';height:100%;border-radius:6px"></div>'
    +'</div>'
    +'<div style="margin-top:8px;font-size:12px;color:'+(remaining>=0?'#5DCAA5':'#E24B4A')+'">'
    +(remaining>=0?fmtUSD(remaining)+' remaining':fmtUSD(Math.abs(remaining))+' over budget')
    +'</div>'
    +'</div>';

  // Category card grid
  html+='<div class="budget-cat-grid" style="margin-bottom:1.1rem">';
  BUDGET_CATS.forEach(function(cat){
    var s=debits.filter(function(t){ return t.category===cat; }).reduce(function(a,t){ return a+t.amountUSD; },0);
    var catLim=(S.categoryBudgets||{})[cat]||0;
    var limBase=catLim>0?catLim:S.budgetTotal;
    var cp=limBase>0?Math.min(100,Math.round(s/limBase*100)):0;
    var cc=CCOLORS[cat]||'#9B70F0';
    var barC=cp>90?'#E24B4A':cp>70?'#EF9F27':cc;
    html+='<div class="budget-cat-card" style="border-left-color:'+cc+'">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      +'<span class="tag '+tagCat(cat)+'">'+cat+'</span>'
      +'<span style="font-size:11px;color:rgba(255,255,255,0.35)">'+cp+'%</span>'
      +'</div>'
      +'<div style="font-size:22px;font-weight:700;margin-bottom:10px;letter-spacing:-0.5px;color:'+cc+'">'+fmtUSD(s)+'</div>'
      +'<div class="pb" style="height:8px;border-radius:4px">'
      +'<div class="pf" style="width:'+cp+'%;background:'+barC+';height:100%;border-radius:4px"></div>'
      +'</div>'
      +'<div style="margin-top:7px;font-size:11px;color:rgba(255,255,255,0.28)">'
      +(catLim>0?'of '+fmtUSD(catLim)+' limit':'no limit set')
      +'</div>'
      +'</div>';
  });
  html+='</div>';

  // Configure limits toggle
  html+='<div class="fc">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none" onclick="window._budLimitsToggle()">'
    +'<span style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:.07em">Configure Limits</span>'
    +'<span style="font-size:12px;color:rgba(255,255,255,0.35)">'+(_budLimitsOpen?'▲':'▼')+'</span>'
    +'</div>';
  if(_budLimitsOpen){
    html+='<div style="margin-top:1rem">'
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Monthly Total</div>'
      +'<div class="fr" style="max-width:280px;margin-bottom:1.25rem">'
      +'<input type="number" id="bud-total" value="'+S.budgetTotal+'" placeholder="Total USD" step="1"/>'
      +'<button class="btn btnp" onclick="saveBudget()">Save</button>'
      +'</div>'
      +'<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Category Limits</div>'
      +'<div class="budget-limits-grid">'
      +BUDGET_CATS.map(function(cat){
        var v=(S.categoryBudgets||{})[cat]||'';
        return '<div>'
          +'<div style="margin-bottom:5px"><span class="tag '+tagCat(cat)+'" style="font-size:10px">'+cat+'</span></div>'
          +'<input type="number" placeholder="No limit" step="1" value="'+v+'" '
          +'style="width:100%;padding:7px 10px;border:0.5px solid rgba(255,255,255,0.1);border-radius:10px;background:rgba(255,255,255,0.07);color:#fff;font-size:13px" '
          +'onchange="saveCategoryBudget(\''+cat+'\',this.value)"/>'
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
  if(!name){ alert('Name required'); return; }
  var idx=S.manualWallets.findIndex(function(w){ return w.name.toLowerCase()===name.toLowerCase(); });
  var obj={id:Date.now(),name:name,balance:bal,trackerOnly:type==='tracker'};
  if(idx>=0) S.manualWallets[idx]=Object.assign(S.manualWallets[idx],obj); else S.manualWallets.push(obj);
  S.manualWalletsUpdatedAt=Date.now();
  document.getElementById('wm-name').value=''; document.getElementById('wm-bal').value='';
  save(); renderWallets(); populateWalletSelects();
}

function calcTrackerBal(name){
  var txBal=0;
  S.transactions.forEach(function(t){ if(t.wallet===name&&isTracker(t.wallet,t)) txBal+=(t.type==='Credit'?1:-1)*t.amountUSD; });
  var mw=S.manualWallets.find(function(w){ return w.name===name; });
  return (mw?mw.balance:0)+txBal;
}

function renderWallets(){
  var grid=document.getElementById('w-grid'); var cards=[];
  var apiTotal=(S.binanceBalance||0)+(S.bybitBalance||0)+(S.okxBalance||0)+(S.trezorBalance||0);
  var trackerNames=['Zelle'];
  S.manualWallets.filter(function(w){ return w.trackerOnly; }).forEach(function(w){ if(trackerNames.indexOf(w.name)<0) trackerNames.push(w.name); });
  var trackerTotal=trackerNames.reduce(function(s,n){ return s+calcTrackerBal(n); },0);
  var manualNormal=S.manualWallets.filter(function(w){ return !w.trackerOnly; }).reduce(function(s,w){ return s+w.balance; },0);
  var grand=apiTotal+trackerTotal+manualNormal;
  cards.push('<div class="wcard" style="border-color:#5DCAA5;border-width:1px"><div class="wcard-name" style="color:#5DCAA5;font-weight:500">Total</div><div class="wcard-bal g">'+fmtUSD(grand)+'</div><div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">All wallets combined</div></div>');
  function apiCard(name,connected,bal,upd,fn){
    if(connected) return '<div class="wcard"><div class="wcard-name"><span class="wstatus" style="background:'+(bal!==null?'#1D9E75':'#E24B4A')+'"></span>'+name+'</div><div class="wcard-bal b">'+(bal!==null?'$'+bal.toFixed(2):'-')+'</div><div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">'+(upd?'Updated '+upd:'')+'</div><button class="btn btns" style="margin-top:7px" onclick="'+fn+'">&#8635;</button></div>';
    return '<div class="wcard" style="border-style:dashed"><div class="wcard-name">'+name+'</div><div style="font-size:13px;color:var(--color-text-secondary);margin:5px 0">Not connected</div><button class="btn btns btnp" onclick="showPage(\'settings\',null)">Connect</button></div>';
  }
  cards.push(apiCard('Binance Funding',S.binanceBalance!==null,S.binanceBalance,S.binanceUpdated,'fetchBinanceBalance().then(function(){save();renderWallets();renderSummary();}).catch(function(e){alert(e.message);})'));
  cards.push(apiCard('Bybit',S.bybitBalance!==null,S.bybitBalance,S.bybitUpdated,'fetchBybitBalance().then(function(){save();renderWallets();renderSummary();}).catch(function(e){alert(e.message);})'));
  cards.push(apiCard('OKX',S.okxBalance!==null,S.okxBalance,S.okxUpdated,'fetchOKXBalance().then(function(){save();renderWallets();renderSummary();}).catch(function(e){alert(e.message);})'));
  cards.push(apiCard('Trezor (BSC USDT)',true,S.trezorBalance,S.trezorUpdated,'fetchTrezorBalance().then(function(){renderWallets();renderSummary();}).catch(function(e){alert(e.message);})'));
  var icoPen='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var icoX='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  trackerNames.forEach(function(name){
    var total=calcTrackerBal(name); var mw=S.manualWallets.find(function(w){ return w.name===name; });
    var actions=mw?'<div class="wcard-actions"><button class="wico" onclick="renameManualWallet('+mw.id+')">'+icoPen+'</button><button class="wico del" onclick="deleteManualWallet('+mw.id+')">'+icoX+'</button></div>':'';
    cards.push('<div class="wcard"><div class="wcard-name"><span class="wstatus" style="background:#EF9F27"></span>'+name+' <span class="badge-t">tracker</span></div><div class="wcard-bal" style="color:#a78bfa">'+fmtUSD(total)+'</div><div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">Calculated from transactions</div>'+actions+'</div>');
  });
  S.manualWallets.filter(function(w){ return !w.trackerOnly; }).forEach(function(w){
    var actions='<div class="wcard-actions"><button class="wico" onclick="editManualWalletBal('+w.id+')">'+icoPen+'</button><button class="wico del" onclick="deleteManualWallet('+w.id+')">'+icoX+'</button></div>';
    cards.push('<div class="wcard"><div class="wcard-name"><span class="wstatus" style="background:#EF9F27"></span>'+w.name+' <span style="font-size:10px;color:var(--color-text-secondary)">(manual)</span></div><div class="wcard-bal '+(w.balance<0?'r':'b')+'">'+fmtUSD(w.balance)+'</div>'+actions+'</div>');
  });
  grid.innerHTML=cards.join('');
}

function addHolding(){
  var date=document.getElementById('po-date').value; var asset=document.getElementById('po-asset').value.trim().toUpperCase();
  var type=document.getElementById('po-type').value; var qty=parseFloat(document.getElementById('po-qty').value);
  var price=parseFloat(document.getElementById('po-price').value); var notes=document.getElementById('po-notes').value.trim();
  if(!date||!asset||isNaN(qty)||isNaN(price)){ alert('Fill required fields'); return; }
  S.portfolio.push({id:Date.now(),date:date,asset:asset,type:type,qty:qty,price:price,notes:notes,totalUSD:parseFloat((qty*price).toFixed(4))});
  S.portfolioUpdatedAt=Date.now();
  ['po-asset','po-qty','po-price','po-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  save(); renderHoldings();
}
function renderHoldings(){
  var wrap=document.getElementById('po-wrap'); var data=S.portfolio.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var total=data.reduce(function(s,e){ return s+e.totalUSD; },0);
  if(!data.length){ wrap.innerHTML=emptyState('No holdings recorded','Add your first asset above to track your portfolio'); return; }
  var rows=data.map(function(e){ return '<tr><td>'+e.date+'</td><td style="font-weight:500">'+e.asset+'</td><td><span class="tag tB">'+e.type+'</span></td><td>'+e.qty+'</td><td>'+fmtUSD(e.price)+'</td><td style="font-weight:500">'+fmtUSD(e.totalUSD)+'</td><td style="color:var(--color-text-secondary)">'+(e.notes||'-')+'</td><td><button class="btn btnd" onclick="deleteHolding('+e.id+')">x</button></td></tr>'; }).join('');
  wrap.innerHTML='<div class="mc" style="margin-bottom:.875rem;display:inline-block;min-width:170px"><div class="mc-l">Total invested</div><div class="mc-v b">'+fmtUSD(total)+'</div></div><table><thead><tr><th>Date</th><th>Asset</th><th>Type</th><th>Qty</th><th>Price</th><th>Total</th><th>Notes</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
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

function handleCSV(file){
  if(!file) return;
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

function showPage(id,btn){
  var pages=['summary','transactions','budget','wallets','holdings','tools','settings','import'];
  if(pages.indexOf(id)<0) id='summary';
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('page-'+id).classList.add('active');
  if(btn) btn.classList.add('active');
  else { var nb=document.querySelector('.nb[onclick*="\''+id+'\'"]'); if(nb) nb.classList.add('active'); }
  window.location.hash = id;
  var fab=document.getElementById('fab-add');
  if(fab) fab.style.display=(id==='transactions'?'flex':'none');
  if(id==='summary') renderSummary();
  else if(id==='transactions') renderTx();
  else if(id==='budget') renderBudget();
  else if(id==='wallets') renderWallets();
  else if(id==='holdings'){ renderHoldings(); renderOnchainWallets(); renderWalletHoldings(); }
  document.querySelector('.sb').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.body.classList.remove('nav-open');
}

// Expose functions needed by inline HTML event handlers
function toggleSidebar(){
  var sb=document.querySelector('.sb');
  sb.classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
  document.body.classList.toggle('nav-open');
}
window.toggleSidebar = toggleSidebar;
window.showPage = showPage;
window.fetchRate = fetchRate;
window.addTx = addTx;
window.deleteTx = deleteTx;
window.editTx = editTx;
window.addTxOrUpdate = addTxOrUpdate;
window.cancelEditTx = cancelEditTx;
window.openTxForm = openTxForm;
window.closeTxForm = closeTxForm;
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
window.addHolding = addHolding;
window.deleteHolding = deleteHolding;
window.saveOnchainWallet = saveOnchainWallet;
window.deleteOnchainWallet = deleteOnchainWallet;
window.renderWallets = renderWallets;
window.testBinance = testBinance;
window.clearBinance = clearBinance;
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

function renderCalcCards(cardsId, resultId, cards){
  document.getElementById(cardsId).innerHTML = cards.map(function(c){
    var color = c.green ? 'var(--color-accent)' : c.red ? '#E24B4A' : 'var(--color-text-primary)';
    return '<div class="fc" style="background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:9px;padding:.75rem .625rem;text-align:center">'
      +'<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:3px">'+c.label+'</div>'
      +'<div class="bdv-val" style="font-size:18px;font-weight:500;color:'+color+'">'+c.value+'</div>'
      +'<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">'+c.sub+'</div>'
      +'</div>';
  }).join('');
  document.getElementById(resultId).style.display = 'block';
}

function calcSpread(){
  var sellRate = parseFloat(document.getElementById('p2p-sell').value)||0;
  var buyRate  = parseFloat(document.getElementById('p2p-buy').value)||0;

  var spreadPct   = sellRate && buyRate ? (sellRate / buyRate - 1) * 100 : 0;
  // BDV→Bpay factor: bank fees (1%+1.5%) + Bpay 3.3% cut
  var bpayFactor  = (1 / (1.01 * 1.015)) * 0.967;
  var effectivePct = sellRate && buyRate ? ((sellRate / buyRate) * bpayFactor - 1) * 100 : 0;
  var feesPct      = spreadPct - effectivePct;

  var fmt = function(n,d){ return n.toFixed(d||2); };
  var pct = function(n){ return (n>=0?'+':'')+fmt(n)+'%'; };
  var ac  = 'var(--color-accent)';
  var rc  = '#E24B4A';

  document.getElementById('p2p-result').innerHTML =
    '<div style="display:flex;justify-content:center;gap:8px;margin-top:.5rem">'
    +'<div style="background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:10px;padding:.75rem;flex:1;max-width:200px">'
      +'<div style="font-size:10px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">P2P Spread</div>'
      +'<div style="font-size:24px;font-weight:700;color:'+(spreadPct>0?ac:'var(--color-text-primary)')+'">'+pct(spreadPct)+'</div>'
      +'<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">'+(sellRate&&buyRate ? sellRate+' → '+buyRate+' Bs' : '—')+'</div>'
    +'</div>'
    +'<div style="background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:10px;padding:.75rem;flex:1;max-width:200px">'
      +'<div style="font-size:10px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Net BDV-Bpay</div>'
      +'<div style="font-size:24px;font-weight:700;color:'+(effectivePct>0?ac:effectivePct<0?rc:'var(--color-text-primary)')+'">'+pct(effectivePct)+'</div>'
      +'<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">after <span style="color:'+rc+'">'+fmt(feesPct)+'%</span> BDV+Bpay fees</div>'
    +'</div>'
  +'</div>';
}
window.calcSpread = calcSpread;

function calcBDV(){
  var bank = parseFloat(document.getElementById('bdv-input').value)||0;
  var charge   = bank > 0 ? bank / (1.01 * 1.015) : 0;
  var received = charge * 0.967;
  var lost     = bank - received;
  var lostPct  = bank > 0 ? (lost / bank) * 100 : 0;
  renderCalcCards('bdv-cards','bdv-result',[
    { label:'Bpay recharge', value:'$'+charge.toFixed(2),   sub:'charged on card' },
    { label:'You receive',   value:'$'+received.toFixed(2), sub:'after Bpay fee', green:true },
    { label:'Total lost',    value:'$'+lost.toFixed(2),     sub:lostPct.toFixed(2)+'% of balance', red:true },
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
    { label:'You Recharge', value:'$'+received.toFixed(2), sub:'deposited to wallet', green:true },
    { label:'Wallet fee',   value:'$'+walletFee.toFixed(2),sub:'charged upfront' },
    { label:'Total lost',   value:'$'+lost.toFixed(2),     sub:lostPct.toFixed(2)+'% of balance', red:true },
  ]);
}

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
  document.getElementById('po-date').value=today;
  document.getElementById('tf-month').value=today.slice(0,7);
  populateWalletSelects(); updateRateUI();
  var pulled=await pullFromCloud();
  if(pulled){ populateWalletSelects(); updateRateUI(); }
  if(S.binanceKey){ var bk=document.getElementById('bn-key'); if(bk) bk.value=S.binanceKey; }
  if(S.binanceSecret){ var bs=document.getElementById('bn-secret'); if(bs) bs.value=S.binanceSecret; }
  var hash=(window.location.hash||'').replace('#','');
  showPage(hash||'summary', null);
  fetchRate(false);
  fetchTrezorBalance().then(function(){ renderWallets(); renderSummary(); }).catch(function(){});
  renderOnchainWallets();
  fetchWalletHoldings().then(function(){ renderWalletHoldings(); }).catch(function(){});
  calcSpread(); calcBDV(); calcWally(); calcZinli();
  autoFetchBinance();
  setInterval(function(){ fetchRate(false); }, 60*60*1000);
  setInterval(function(){ autoFetchBinance(); }, BINANCE_AUTO_MS);
  // Pull fresh cloud state whenever user returns to this tab
  // Prevents stale open tabs from overwriting changes made on other devices
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) pullFromCloud().then(function(pulled){
      if(pulled){ populateWalletSelects(); updateRateUI(); renderTx(); renderSummary(); renderWallets(); renderHoldings(); }
    }).then(function(){ autoFetchBinance(); });
  });
}
init();

if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js'); }
