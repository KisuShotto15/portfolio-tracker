import './style.css';

var RATE_URL     = 'https://red-rain-afef.efrenalejandro2010.workers.dev/';
var PROXY        = 'https://fintrackerbinanceapi.efrenalejandro2010.workers.dev';
var DATA_URL     = 'https://portfolio-data.efrenalejandro2010.workers.dev';
var DATA_TOKEN   = '151322';
var SUMMARY_CATS = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Support','Investments','Savings'];
var CATS         = ['Income','Home','Groceries','Transport','Health','Business','Discretionary','Support','Investments','Savings'];
var CCOLORS      = {Income:'#1D9E75',Home:'#7F77DD',Groceries:'#1D9E75',Transport:'#378ADD',Health:'#5DCAA5',Business:'#EF9F27',Discretionary:'#378ADD',Support:'#EF9F27',Investments:'#F5A623',Savings:'#5DCAA5',
  // legacy — kept so old transactions still render with a color
  Services:'#7F77DD','Help others':'#EF9F27',Emergency:'#E24B4A',Zelle:'#a78bfa',Other:'#D85A30'};

var S = {
  rate:null, rateDate:null, rateFetchedAt:null,
  transactions:[], portfolio:[], manualWallets:[],
  budgetTotal:600,
  binanceBalance:null, binanceUpdated:null,
  bybitBalance:null,   bybitUpdated:null,
  okxBalance:null,     okxUpdated:null,
  trezorBalance:null,  trezorUpdated:null,
  walletHoldings:[],   walletHoldingsUpdated:null,
  snapshots:[]
};
var mChart=null, cChart=null, eChart=null, undoStack=[], redoStack=[];
var GROUP_ESSENTIAL=['Home','Groceries','Transport','Health'];
var GROUP_BUSINESS=['Business'];
var GROUP_LIFESTYLE=['Discretionary','Support'];
var GROUP_FINANCIAL=['Investments','Savings'];
var syncTimer=null, syncPending=false;

function setSyncStatus(state, msg){
  var dot=document.getElementById('sync-dot');
  var lbl=document.getElementById('sync-label');
  var colors={synced:'#5DCAA5', syncing:'#EF9F27', offline:'#888', error:'#E24B4A'};
  if(dot) dot.style.background=colors[state]||'#888';
  if(lbl) lbl.textContent=msg||state;
}

function saveLocal(){ try{ localStorage.setItem('ft13',JSON.stringify(S)); }catch(e){} }
function loadLocal(){ try{ var s=localStorage.getItem('ft13'); if(s) S=Object.assign({},S,JSON.parse(s)); }catch(e){} }

async function pushToCloud(){
  try{
    setSyncStatus('syncing','Syncing...');
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
  var r=await fetch(PROXY,{method:'POST',headers:{'Content-Type':'application/json'}});
  if(!r.ok){ var e=await r.text(); throw new Error('Binance '+r.status+': '+e); }
  var data=await r.json(); if(data.error) throw new Error(data.error);
  var usdt=Array.isArray(data)?data.find(function(b){ return b.asset==='USDT'; }):null;
  S.binanceBalance=parseFloat(((usdt?parseFloat(usdt.free||0)+parseFloat(usdt.locked||0):0)).toFixed(2));
  S.binanceUpdated=new Date().toLocaleTimeString('en-US'); save(); return S.binanceBalance;
}
async function testBinance(){
  var st=document.getElementById('bn-status'); st.textContent='Connecting...'; st.style.color='var(--color-text-secondary)';
  try{ await fetchBinanceBalance(); st.textContent='Connected - Funding USDT: $'+S.binanceBalance.toFixed(2); st.style.color='#5DCAA5'; renderWallets(); renderSummary(); }
  catch(e){ st.textContent='Error: '+e.message; st.style.color='#E24B4A'; }
}
function clearBinance(){ S.binanceBalance=null; S.binanceUpdated=null; save(); document.getElementById('bn-status').textContent='Reset.'; renderWallets(); }

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
var ANKR_URL       = 'https://rpc.ankr.com/multichain/';
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
  var res = await fetch(ANKR_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', method:'ankr_getAccountBalance',
      params:{ blockchain:['eth','arbitrum','base','bsc'], walletAddress:TREZOR_ADDRESS, onlyWhitelisted:false }, id:1 })
  });
  var json = await res.json();
  if(json.error) throw new Error(json.error.message);
  var assets = (json.result && json.result.assets) || [];
  S.walletHoldings = assets
    .filter(function(a){ return parseFloat(a.balanceUsd) > 1; })
    .map(function(a){ return { symbol:a.tokenSymbol, name:a.tokenName,
      balance:parseFloat(a.balance), balanceUsd:parseFloat(a.balanceUsd), price:parseFloat(a.tokenPrice),
      network:a.blockchain }; })
    .sort(function(a,b){ return b.balanceUsd - a.balanceUsd; });
  S.walletHoldingsUpdated = new Date().toLocaleTimeString('en-US');
  save(); return S.walletHoldings;
}
function renderWalletHoldings(){
  var wrap = document.getElementById('wh-wrap');
  var upd  = document.getElementById('wh-updated');
  if(!wrap) return;
  if(upd && S.walletHoldingsUpdated) upd.textContent = 'Updated '+S.walletHoldingsUpdated;
  var data = S.walletHoldings || [];
  if(!data.length){ wrap.innerHTML='<div class="empty">No on-chain holdings found (or not yet loaded)</div>'; return; }
  var netLabel={'eth':'ETH','arbitrum':'ARB','base':'BASE','bsc':'BSC'};
  var netColor={'eth':'#378ADD','arbitrum':'#7F77DD','base':'#378ADD','bsc':'#EF9F27'};
  var rows = data.map(function(h){
    var net=netLabel[h.network]||h.network; var nc=netColor[h.network]||'#888';
    return '<tr><td style="font-weight:500">'+h.symbol+'</td>'
      +'<td style="color:var(--color-text-secondary);font-size:12px">'+h.name+'</td>'
      +'<td><span style="font-size:10px;padding:1px 5px;border-radius:3px;background:'+nc+'22;color:'+nc+';font-weight:600">'+net+'</span></td>'
      +'<td>'+h.balance.toLocaleString('en-US',{maximumFractionDigits:6})+'</td>'
      +'<td>'+fmtUSD(h.price)+'</td>'
      +'<td style="font-weight:500">'+fmtUSD(h.balanceUsd)+'</td></tr>';
  }).join('');
  var total = data.reduce(function(s,h){ return s+h.balanceUsd; },0);
  wrap.innerHTML = '<div class="mc" style="margin-bottom:.875rem;display:inline-block;min-width:170px">'
    +'<div class="mc-l">Trezor Total</div><div class="mc-v b">'+fmtUSD(total)+'</div></div>'
    +'<table><thead><tr><th>Symbol</th><th>Name</th><th>Network</th><th>Balance</th><th>Price</th><th>Value</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table>';
}
async function refreshWalletHoldings(){
  var wrap = document.getElementById('wh-wrap');
  if(wrap) wrap.innerHTML='<div class="empty">Loading...</div>';
  try{ await fetchWalletHoldings(); renderWalletHoldings(); }
  catch(e){ if(wrap) wrap.innerHTML='<div class="empty" style="color:#E24B4A">Error: '+e.message+'</div>'; }
}

function toggleVesHint(){ var on=document.getElementById('tx-cur').value==='VES'; document.getElementById('ves-hint').style.display=on?'inline':'none'; if(on) updateVesPreview(); }
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
}

function deleteTx(id){ snapshot(); S.transactions=S.transactions.filter(function(t){ return t.id!==id; }); save(); renderTx(); renderSummary(); }

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
  btn.textContent='Update'; btn.style.background='#5DCAA5';
  document.getElementById('tx-desc').scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelEditTx(){
  editingTxId=null;
  var btn=document.querySelector('.btn-add');
  btn.textContent='Add'; btn.style.background='';
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
function deleteHolding(id){ S.portfolio=S.portfolio.filter(function(t){ return t.id!==id; }); save(); renderHoldings(); }
function deleteManualWallet(id){ S.manualWallets=S.manualWallets.filter(function(w){ return w.id!==id; }); save(); renderWallets(); populateWalletSelects(); }

function parseAmt(s){ return parseFloat(String(s||0).replace(/[$,\s]/g,''))||0; }
function fmtUSD(v){ return '$'+parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function tagCat(cat){ var m={Income:'tG',Home:'tP',Groceries:'tG',Transport:'tB',Health:'tG',Business:'tA',Discretionary:'tB',Support:'tA',Investments:'tA',Savings:'tG',
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
  if(!data.length){ wrap.innerHTML='<div class="empty">No transactions</div>'; return; }
  var totalDebits=data.filter(function(t){ return t.type==='Debit'&&inSummary(t); }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var rows=data.map(function(t){
    var orig=t.originalCurrency==='VES'&&t.amountVES?'Bs '+t.amountVES.toLocaleString('es-VE'):'-';
    var isTrk=isTracker(t.wallet,t); var col=isTrk?'#a78bfa':(t.type==='Credit'?'#5DCAA5':'#E24B4A');
    var trk=isTrk?'<span class="badge-t">tracker</span>':'';
    var wTag=t.wallet==='Binance'?'tBinance':'tX';
    return '<tr><td style="white-space:nowrap">'+t.date+'</td><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+t.desc+'">'+t.desc+'</td><td><span class="tag '+wTag+'">'+(t.wallet||'-')+'</span>'+trk+'</td><td><span class="tag '+(t.type==='Debit'?'tR':'tG')+'">'+t.type+'</span></td><td>'+(t.category?'<span class="tag '+tagCat(t.category)+'">'+t.category+'</span>':'<span style="color:var(--color-text-secondary);font-size:12px">—</span>')+'</td><td style="font-size:12px;color:var(--color-text-secondary)">'+orig+'</td><td style="font-weight:500;color:'+col+'">'+fmtUSD(t.amountUSD)+'</td><td style="white-space:nowrap"><button class="btn-edit-tx" title="Edit" onclick="editTx('+t.id+')"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-9 9H2v-3L11 2z"/></svg></button><button class="btn btnd" onclick="deleteTx('+t.id+')">x</button></td></tr>';
  }).join('');
  wrap.innerHTML='<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:7px">'+data.length+' records &middot; Total debits: <strong style="color:#E24B4A">'+fmtUSD(totalDebits)+'</strong></div><table><thead><tr><th>Date</th><th>Note</th><th>Wallet</th><th>In/Out</th><th>Category</th><th>Original</th><th>USD</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function getMonths(){ var all=S.transactions.map(function(t){ return t.date.slice(0,7); }); var u=all.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort().reverse(); if(!u.length) u.push(new Date().toISOString().slice(0,7)); return u; }
function populateSumMonth(){ var sel=document.getElementById('sum-month'); var cur=sel.value; var months=getMonths(); sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+m+'</option>'; }).join(''); if(cur&&months.indexOf(cur)>=0) sel.value=cur; }

function groupSum(txDebit, cats){ return cats.reduce(function(s,c){ return s+txDebit.filter(function(t){ return t.category===c; }).reduce(function(a,t){ return a+t.amountUSD; },0); },0); }

function renderSummary(){
  populateSumMonth();
  var month=document.getElementById('sum-month').value;
  var txM=S.transactions.filter(function(t){ return t.date.startsWith(month)&&inSummary(t); });
  var txD=txM.filter(function(t){ return t.type==='Debit'; });
  var debits=txD.reduce(function(s,t){ return s+t.amountUSD; },0);
  var credits=txM.filter(function(t){ return t.type==='Credit'; }).reduce(function(s,t){ return s+t.amountUSD; },0);
  var net=credits-debits;
  var essential=groupSum(txD,GROUP_ESSENTIAL);
  var business=groupSum(txD,GROUP_BUSINESS);
  var lifestyle=groupSum(txD,GROUP_LIFESTYLE);
  var financial=groupSum(txD,GROUP_FINANCIAL);
  var savRate=credits>0?Math.round((net/credits)*100):0;
  function mc(label,val,cls,sub){ return '<div class="mc"><div class="mc-l">'+label+'</div><div class="mc-v '+cls+'">'+fmtUSD(val)+'</div>'+(sub?'<div style="font-size:11px;color:var(--color-text-secondary);margin-top:2px">'+sub+'</div>':'')+'</div>'; }
  document.getElementById('sum-cards').innerHTML=
    mc('Income',credits,'g')
   +mc('Essential',essential,'r','Home · Groceries · Transport · Health')
   +mc('Business',business,'a','')
   +mc('Lifestyle',lifestyle,'b','Discretionary · Support')
   +mc('Financial',financial,'g','Investments · Savings')
   +mc('Net',net,net>=0?'g':'r')
   +'<div class="mc"><div class="mc-l">Savings rate</div><div class="mc-v '+(savRate>=0?'g':'r')+'">'+savRate+'%</div></div>';
  renderEquityChart(); renderMonthlyChart(); renderCatChart(month);
}

function getLast6(){ var m=[]; var now=new Date(); for(var i=5;i>=0;i--){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); m.push(d.toISOString().slice(0,7)); } return m; }

function renderMonthlyChart(){
  var months=getLast6();
  var cD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Debit'&&inSummary(t); }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var crD=months.map(function(m){ return parseFloat(S.transactions.filter(function(t){ return t.date.startsWith(m)&&t.type==='Credit'&&inSummary(t); }).reduce(function(s,t){ return s+t.amountUSD; },0).toFixed(2)); });
  var labels=months.map(function(m){ var p=m.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1).toLocaleString('en',{month:'short',year:'2-digit'}); });
  if(mChart) mChart.destroy();
  mChart=new Chart(document.getElementById('chart-monthly'),{type:'bar',data:{labels:labels,datasets:[{label:'Income',data:crD,backgroundColor:'#1D9E75',borderRadius:3},{label:'Expenses',data:cD,backgroundColor:'#E24B4A',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#555',autoSkip:false,font:{size:12}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:12},callback:function(v){ return '$'+(v>=1000?(v/1000).toFixed(1)+'k':v); }}}}}});
  document.getElementById('mc-leg').innerHTML='<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#1D9E75;display:inline-block"></span>Income</span><span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#E24B4A;display:inline-block"></span>Expenses</span>';
}

function renderCatChart(month){
  var map={};
  S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&inSummary(t); }).forEach(function(t){ map[t.category]=(map[t.category]||0)+t.amountUSD; });
  var cats=Object.keys(map); var vals=cats.map(function(c){ return parseFloat(map[c].toFixed(2)); }); var total=vals.reduce(function(s,v){ return s+v; },0);
  if(cChart) cChart.destroy();
  if(!cats.length){ document.getElementById('cat-leg').innerHTML='<span style="color:var(--color-text-secondary)">No expenses this month</span>'; return; }
  var colors=cats.map(function(c){ return CCOLORS[c]||'#888'; });
  cChart=new Chart(document.getElementById('chart-cat'),{type:'doughnut',data:{labels:cats,datasets:[{data:vals,backgroundColor:colors,borderWidth:0,hoverOffset:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},cutout:'65%'}});
  document.getElementById('cat-leg').innerHTML=cats.map(function(c,i){ return '<div style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:9px;height:9px;border-radius:2px;background:'+colors[i]+';flex-shrink:0"></span><span style="color:var(--color-text-secondary);flex:1">'+c+'</span><span style="font-weight:500">$'+vals[i].toLocaleString('en-US',{minimumFractionDigits:2})+'</span><span style="color:var(--color-text-secondary);font-size:11px;min-width:30px;text-align:right">'+(total>0?Math.round(vals[i]/total*100):0)+'%</span></div>'; }).join('');
}

function renderEquityChart(){
  var snaps=(S.snapshots||[]).slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  var el=document.getElementById('chart-equity'); if(!el) return;
  var wrap=document.getElementById('equity-wrap');
  if(!snaps.length){
    if(wrap) wrap.innerHTML='<div style="color:var(--color-text-secondary);font-size:13px;padding:1rem 0">No snapshots yet. Record your first one to start the equity curve.</div>';
    return;
  }
  var labels=snaps.map(function(s){ return s.date; });
  var vals=snaps.map(function(s){ return s.total; });
  var first=vals[0], last=vals[vals.length-1], pnl=last-first, pnlPct=first>0?((pnl/first)*100).toFixed(1):0;
  if(wrap) wrap.innerHTML='<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:.75rem;font-size:13px">'
    +'<span>First: <strong>'+fmtUSD(first)+'</strong></span>'
    +'<span>Latest: <strong>'+fmtUSD(last)+'</strong></span>'
    +'<span>P&amp;L: <strong style="color:'+(pnl>=0?'#1D9E75':'#E24B4A')+'">'+(pnl>=0?'+':'')+fmtUSD(pnl)+' ('+pnlPct+'%)</strong></span>'
    +'</div>';
  if(eChart) eChart.destroy();
  eChart=new Chart(el,{type:'line',data:{labels:labels,datasets:[{data:vals,borderColor:'#5DCAA5',backgroundColor:'rgba(93,202,165,0.08)',borderWidth:2,pointRadius:4,pointBackgroundColor:'#5DCAA5',tension:0.3,fill:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#555',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#555',font:{size:11},callback:function(v){ return '$'+(v>=1000?(v/1000).toFixed(1)+'k':v); }}}}}});
}

function getTotalBalance(){
  var api=(S.binanceBalance||0)+(S.bybitBalance||0)+(S.okxBalance||0)+(S.trezorBalance||0);
  var manual=S.manualWallets.reduce(function(s,w){ return s+calcTrackerBal(w.name); },0);
  var zelle=calcTrackerBal('Zelle');
  return parseFloat((api+manual+zelle).toFixed(2));
}

function recordSnapshot(){
  var auto=getTotalBalance();
  var val=parseFloat(prompt('Record portfolio snapshot\n\nAuto-sum from wallets: $'+auto.toFixed(2)+'\n\nEnter total (or leave to use auto-sum):',auto.toFixed(2)));
  if(isNaN(val)||val<0) return;
  if(!S.snapshots) S.snapshots=[];
  var today=new Date().toISOString().slice(0,10);
  var existing=S.snapshots.findIndex(function(s){ return s.date===today; });
  if(existing>=0){ if(!confirm('A snapshot for today already exists ($'+S.snapshots[existing].total+'). Replace it?')) return; S.snapshots.splice(existing,1); }
  S.snapshots.push({id:Date.now(),date:today,total:val});
  save(); renderEquityChart();
}

function deleteSnapshot(id){ S.snapshots=S.snapshots.filter(function(s){ return s.id!==id; }); save(); renderEquityChart(); }

function saveBudget(){ var v=parseFloat(document.getElementById('bud-total').value); if(v>0){ S.budgetTotal=v; save(); renderBudget(); } }
function renderBudget(){
  var sel=document.getElementById('bud-month'); var months=getMonths(); var prev=sel.value;
  sel.innerHTML=months.map(function(m){ return '<option value="'+m+'">'+m+'</option>'; }).join('');
  if(prev&&months.indexOf(prev)>=0) sel.value=prev;
  sel.onchange=renderBudget;
  var month=sel.value||months[0];
  document.getElementById('bud-total').value=S.budgetTotal;
  var debits=S.transactions.filter(function(t){ return t.date.startsWith(month)&&t.type==='Debit'&&inSummary(t); });
  var spent=debits.reduce(function(s,t){ return s+t.amountUSD; },0);
  var left=S.budgetTotal-spent; var pct=Math.min(100,S.budgetTotal>0?Math.round(spent/S.budgetTotal*100):0);
  var bc=pct>90?'#E24B4A':pct>70?'#EF9F27':'#1D9E75';
  var html='<div class="fc"><div style="display:flex;justify-content:space-between;margin-bottom:7px;font-size:14px"><span>Spent: <strong style="color:#E24B4A">'+fmtUSD(spent)+'</strong> / <strong>'+fmtUSD(S.budgetTotal)+'</strong></span><span style="color:'+bc+';font-weight:500">'+pct+'%</span></div><div class="pb"><div class="pf" style="width:'+pct+'%;background:'+bc+'"></div></div><div style="margin-top:6px;font-size:12px;color:'+(left>=0?'#5DCAA5':'#E24B4A')+'">'+(left>=0?'Remaining: '+fmtUSD(left):'Exceeded: '+fmtUSD(Math.abs(left)))+'</div></div><div class="fc">';
  CATS.filter(function(c){ return c!=='Zelle'&&c!=='Income'; }).forEach(function(cat){
    var s=debits.filter(function(t){ return t.category===cat; }).reduce(function(a,t){ return a+t.amountUSD; },0);
    if(!s) return;
    var cp=S.budgetTotal>0?Math.min(100,Math.round(s/S.budgetTotal*100)):0;
    html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--color-border-tertiary)"><span class="tag '+tagCat(cat)+'" style="min-width:95px">'+cat+'</span><div style="flex:1"><div class="pb"><div class="pf" style="width:'+cp+'%;background:'+(CCOLORS[cat]||'#888')+'"></div></div></div><span style="font-weight:500;min-width:70px;text-align:right">'+fmtUSD(s)+'</span><span style="color:var(--color-text-secondary);font-size:11px;min-width:30px;text-align:right">'+cp+'%</span></div>';
  });
  document.getElementById('bud-wrap').innerHTML=html+'</div>';
}

function saveManualWallet(){
  var name=document.getElementById('wm-name').value.trim(); var bal=parseFloat(document.getElementById('wm-bal').value)||0; var type=document.getElementById('wm-type').value;
  if(!name){ alert('Name required'); return; }
  var idx=S.manualWallets.findIndex(function(w){ return w.name.toLowerCase()===name.toLowerCase(); });
  var obj={id:Date.now(),name:name,balance:bal,trackerOnly:type==='tracker'};
  if(idx>=0) S.manualWallets[idx]=Object.assign(S.manualWallets[idx],obj); else S.manualWallets.push(obj);
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
  trackerNames.forEach(function(name){
    var total=calcTrackerBal(name); var mw=S.manualWallets.find(function(w){ return w.name===name; });
    var del=mw?'<button class="btn btnd" style="margin-top:5px;font-size:11px" onclick="deleteManualWallet('+mw.id+')">Remove</button>':'';
    cards.push('<div class="wcard"><div class="wcard-name"><span class="wstatus" style="background:#EF9F27"></span>'+name+' <span class="badge-t">tracker</span></div><div class="wcard-bal" style="color:#a78bfa">'+fmtUSD(total)+'</div><div style="font-size:11px;color:var(--color-text-secondary);margin-top:3px">Calculated from transactions</div>'+del+'</div>');
  });
  S.manualWallets.filter(function(w){ return !w.trackerOnly; }).forEach(function(w){
    cards.push('<div class="wcard"><div class="wcard-name"><span class="wstatus" style="background:#EF9F27"></span>'+w.name+' <span style="font-size:10px;color:var(--color-text-secondary)">(manual)</span></div><div class="wcard-bal '+(w.balance<0?'r':'b')+'">'+fmtUSD(w.balance)+'</div><button class="btn btnd" style="margin-top:5px;font-size:11px" onclick="deleteManualWallet('+w.id+')">Remove</button></div>');
  });
  grid.innerHTML=cards.join('');
}

function addHolding(){
  var date=document.getElementById('po-date').value; var asset=document.getElementById('po-asset').value.trim().toUpperCase();
  var type=document.getElementById('po-type').value; var qty=parseFloat(document.getElementById('po-qty').value);
  var price=parseFloat(document.getElementById('po-price').value); var notes=document.getElementById('po-notes').value.trim();
  if(!date||!asset||isNaN(qty)||isNaN(price)){ alert('Fill required fields'); return; }
  S.portfolio.push({id:Date.now(),date:date,asset:asset,type:type,qty:qty,price:price,notes:notes,totalUSD:parseFloat((qty*price).toFixed(4))});
  ['po-asset','po-qty','po-price','po-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  save(); renderHoldings();
}
function renderHoldings(){
  var wrap=document.getElementById('po-wrap'); var data=S.portfolio.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var total=data.reduce(function(s,e){ return s+e.totalUSD; },0);
  if(!data.length){ wrap.innerHTML='<div class="empty">No holdings</div>'; return; }
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
  if(id==='summary') renderSummary();
  else if(id==='transactions') renderTx();
  else if(id==='budget') renderBudget();
  else if(id==='wallets') renderWallets();
  else if(id==='holdings'){ renderHoldings(); renderWalletHoldings(); }
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
window.addHolding = addHolding;
window.deleteHolding = deleteHolding;
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
    return '<div class="fc" style="background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:9px;padding:.75rem .625rem">'
      +'<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:3px">'+c.label+'</div>'
      +'<div class="bdv-val" style="font-size:18px;font-weight:500;color:'+color+'">'+c.value+'</div>'
      +'<div style="font-size:10px;color:var(--color-text-secondary);margin-top:2px">'+c.sub+'</div>'
      +'</div>';
  }).join('');
  document.getElementById(resultId).style.display = 'block';
}

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
window.recordSnapshot = recordSnapshot;
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
  var today=new Date().toISOString().slice(0,10);
  document.getElementById('tx-date').value=today;
  document.getElementById('po-date').value=today;
  document.getElementById('tf-month').value=today.slice(0,7);
  populateWalletSelects(); updateRateUI();
  var pulled=await pullFromCloud();
  if(pulled){ populateWalletSelects(); updateRateUI(); }
  var hash=(window.location.hash||'').replace('#','');
  showPage(hash||'summary', null);
  fetchRate(false);
  fetchTrezorBalance().then(function(){ renderWallets(); renderSummary(); }).catch(function(){});
  fetchWalletHoldings().then(function(){ renderWalletHoldings(); }).catch(function(){});
  calcBDV(); calcWally(); calcZinli();
  setInterval(function(){ fetchRate(false); }, 60*60*1000);
}
init();
