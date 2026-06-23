// Tools tab: standalone calculators (Profit, P2P spread, BDV/Bpay/Wally/Zinli,
// BCV→Emily) + the tool show/hide toggles. These only read DOM inputs and write
// DOM outputs; the only shared-state they touch is S.hiddenTools (persisted) and
// S.rate (read). Those come in via initTools() as a live getter — never capture
// S by value, it gets reassigned on every cloud merge.

let _getState = function(){ return {}; };
let _save = function(){};
export function initTools(o){ _getState = o.getState; _save = o.save; }

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
  { id:'bdvlimits',label:'BDV Limits'    },
];

export function renderToolToggles(){
  var S = _getState();
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
  var S = _getState();
  if(!S.hiddenTools) S.hiddenTools={};
  S.hiddenTools[id]=!S.hiddenTools[id];
  _save();
  renderToolToggles();
};
window.renderToolToggles=renderToolToggles;

export function calcProfit(){
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
    { label:'Recharge', value:'$'+bpayRecharge.toFixed(2), sub:'$'+bpayReceived.toFixed(2) },
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

export function calcSpread(){
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

export function calcBDV(){
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

export function calcBCVEmily(){
  var usd      = parseFloat(document.getElementById('be-usd').value)||0;
  var usdtRate = parseFloat(document.getElementById('be-usdt').value)||0;
  var bcvRate  = _getState().rate || 0;

  var totalBs       = usd * bcvRate;
  var effectiveRate = usdtRate * 0.9;
  var usdtOut       = (totalBs > 0 && effectiveRate > 0) ? totalBs / effectiveRate : 0;

  renderCalcCards('be-cards','be-result',[
    { label:'Total Bs', value: totalBs > 0 ? totalBs.toFixed(2)+' Bs' : '—', sub: bcvRate ? usd+'$ × '+bcvRate : 'BCV rate N/A' },
    { label:'Received', value: usdtOut > 0 ? usdtOut.toFixed(2)+' USDT' : '—', sub: effectiveRate > 0 ? 'rate '+effectiveRate.toFixed(2) : '—', green: usdtOut > 0 },
  ]);
}
window.calcBCVEmily = calcBCVEmily;

export function calcWally(){
  calcWalletUpfront(parseFloat(document.getElementById('wally-input').value), 0.03745, 'wally-result', 'wally-cards');
}
export function calcZinli(){
  calcWalletUpfront(parseFloat(document.getElementById('zinli-input').value), 0.0375, 'zinli-result', 'zinli-cards');
}
window.calcWally = calcWally;
window.calcZinli = calcZinli;
