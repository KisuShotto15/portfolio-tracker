// Tools tab: standalone calculators (Profit, P2P spread, BDV/Bpay/Wally/Zinli,
// BCV→Emily) + the tool show/hide toggles. These only read DOM inputs and write
// DOM outputs; the only shared-state they touch is S.hiddenTools (persisted) and
// S.rate (read). Those come in via initTools() as a live getter — never capture
// S by value, it gets reassigned on every cloud merge.

import { fmtUSD, fmtNum, parseAmt } from './format.js';

let _getState = function(){ return {}; };
let _save = function(){};
let _stamp = null;
let _usdtMkt = function(){ return 0; };
export function initTools(o){ _getState = o.getState; _save = o.save; _stamp = o.stamp || null; if(o.usdtRate) _usdtMkt = o.usdtRate; }

// Comisiones ajustables (la tuerca de cada tool). Default = valor real actual;
// se persisten/sincronizan via S.toolFees + toolFeesUpdatedAt (LWW por convencion).
var TOOL_FEE_DEFAULTS = { bpay:4.1, emily:10 };
function feeOf(key){
  var f = _getState().toolFees || {};
  var v = f[key];
  return (typeof v === 'number' && isFinite(v)) ? v : TOOL_FEE_DEFAULTS[key];
}

function renderCalcCards(cardsId, resultId, cards, small){
  document.getElementById(cardsId).innerHTML = cards.map(function(c){
    var cls = c.green ? ' g' : c.red ? ' r' : '';
    var subHtml = c.sub!=null ? '<div class="tcalc-sub">'+c.sub+'</div>' : '';
    return '<div class="tcalc-card'+(small?' tcalc-sm':'')+'">'
      +'<div class="tcalc-lbl">'+c.label+'</div>'
      +'<div class="tcalc-val'+cls+'">'+c.value+'</div>'
      +subHtml
      +'</div>';
  }).join('');
  document.getElementById(resultId).style.display = 'block';
  fitCalcVals(document.getElementById(cardsId));
}

// Ajuste medido: cada valor conserva su fuente normal y SOLO se encoge lo justo
// si de verdad no entra (depende del ancho real del dispositivo y de la escala de
// fuente del sistema — nada de reglas por cantidad de digitos). Con la tab oculta
// clientWidth es 0 y no se puede medir: por eso showPage('tools') vuelve a correr
// las tres calculadoras al abrirla, que re-renderizan y re-miden.
function shrinkToFit(v){
  v.style.fontSize='';
  if(!v.clientWidth) return null; // tab oculta: se re-ajusta al abrirla
  var base=parseFloat(getComputedStyle(v).fontSize)||16;
  if(v.scrollWidth<=v.clientWidth) return base;
  var size=Math.max(10, base*v.clientWidth/v.scrollWidth-0.3);
  v.style.fontSize=size+'px';
  return size;
}
function fitCalcVals(wrap){
  if(!wrap) return;
  wrap.querySelectorAll('.tcalc-val').forEach(shrinkToFit);
}

var TOOLS = [
  { id:'profit',   label:'Profit Calc'    },
  { id:'p2p',      label:'P2P Spread'     },
  { id:'bcvemily', label:'Rate Converter' },
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

export function calcProfit(fromUser){
  var sellRate  = parseFloat(document.getElementById('pc-sell').value)||0;
  var spent     = parseFloat(document.getElementById('pc-amount').value)||0;
  var buyRate   = parseFloat(document.getElementById('pc-buy').value)||0;
  var cardComm  = parseFloat(document.getElementById('pc-card').value)||0;
  // sell/amount/fee se recuerdan en S.profitCalc (sync LWW via profitCalcUpdatedAt).
  // buy NO: se autollena con la tasa Intervencion (main.js). SOLO persistir cuando
  // el cambio viene de un input del usuario (fromUser===true, via oninline del HTML):
  // calcProfit tambien corre en boot/pull/rate-refresh con el DOM aun sin restaurar,
  // y persistir ahi pisaba los valores sincronizados con un wipe vacio.
  if(fromUser===true){
    var S=_getState();
    var vals={sell:document.getElementById('pc-sell').value, amount:document.getElementById('pc-amount').value, fee:document.getElementById('pc-card').value};
    var prev=S.profitCalc||{};
    if(vals.sell!==(prev.sell||'')||vals.amount!==(prev.amount||'')||vals.fee!==(prev.fee||'')){
      S.profitCalc=vals;
      if(_stamp) S.profitCalcUpdatedAt=_stamp();
      _save();
    }
  }

  var usdt         = (sellRate > 0 && spent > 0) ? spent * buyRate / sellRate : 0;
  var bpayRecharge = spent > 0 ? spent / (1 + cardComm / 100) : 0;
  var bpayReceived = bpayRecharge * (1 - feeOf('bpay') / 100);
  var profit       = bpayReceived - usdt;
  var profitPct    = usdt > 0 ? (profit / usdt) * 100 : 0;

  var isPos = profit >= 0;
  var bsNeeded = spent * buyRate; // total en Bs a pagar (Bank × Buy)
  renderCalcCards('pc-cards','pc-result',[
    { label:'Invest', value: bsNeeded > 0 ? fmtNum(bsNeeded,0) : '—', sub:'Bs needed' },
    { label:'Recharge', value:fmtUSD(bpayRecharge), sub:fmtUSD(bpayReceived) },
    // El signo va antes del $ (−$5,972.73): '$-5972.73' se lee como un precio raro.
    { label:'Profit',   value:(isPos?'+':'−')+fmtUSD(Math.abs(profit)), sub:(isPos?'+':'')+profitPct.toFixed(2)+'%', green:isPos, red:!isPos },
  ], true);
}
window.calcProfit = calcProfit;

document.addEventListener('click', function(e){
  if(!e.target.closest('#tc-p2p .hist-wrap')) document.querySelectorAll('#p2p-settings-popup').forEach(function(el){ el.classList.remove('open'); });
});

export function calcSpread(fromUser){
  var sellRate = parseFloat(document.getElementById('p2p-sell').value)||0;
  var buyRate  = parseFloat(document.getElementById('p2p-buy').value)||0;
  var comm     = parseFloat(document.getElementById('p2p-comm').value)||0;
  // Igual que profitCalc: persistir SOLO cuando escribe el usuario (fromUser via
  // oninput del HTML); las llamadas programaticas no pueden pisar el estado.
  if(fromUser===true){
    var S=_getState();
    var vals={sell:document.getElementById('p2p-sell').value, buy:document.getElementById('p2p-buy').value, fee:document.getElementById('p2p-comm').value};
    var prev=S.p2pCalc||{};
    if(vals.sell!==(prev.sell||'')||vals.buy!==(prev.buy||'')||vals.fee!==(prev.fee||'')){
      S.p2pCalc=vals;
      if(_stamp) S.p2pCalcUpdatedAt=_stamp();
      _save();
    }
  }
  var netPct   = sellRate && buyRate ? ((sellRate / buyRate) * (1 - comm / 100) - 1) * 100 : 0;
  var pct = function(n){ return (n>=0?'+':'')+n.toFixed(2)+'%'; };
  renderCalcCards('p2p-cards','p2p-result',[
    { label:'Spread', value:pct(netPct), sub: sellRate&&buyRate ? fmtNum(sellRate)+' → '+fmtNum(buyRate) : '—', green:netPct>0, red:netPct<0 },
  ]);
}
window.calcSpread = calcSpread;

// Rate Converter: un solo monto en tres monedas. Bs es el eje — USD lo valora a
// la tasa BCV y USDT a la del monitor P2P menos la comision configurada (la
// tuerca 'emily'). Se edita cualquiera de los tres y los otros dos se recalculan,
// por eso hace falta saber cual escribio el usuario: _beSrc. Sin eso, un re-render
// (cambio de tab, tasa nueva) no sabria cual es el dato y cual el derivado.
var _beSrc = 'usd';
function beRates(){
  var mkt = _usdtMkt() || 0;
  return { bcv: _getState().rate || 0, mkt: mkt, eff: mkt * (1 - feeOf('emily') / 100) };
}
function beSet(id, v){
  var el = document.getElementById(id);
  if(!el || el === document.activeElement) return;
  var txt = v > 0 ? fmtNum(v) : '';
  if(el.value !== txt) el.value = txt;
}
// Un monto en Bs de 8 digitos no entra en su campo con la fuente normal. Mismo
// criterio que las cards: encoger solo lo que haga falta, medido, no por cantidad
// de digitos (depende del ancho real del dispositivo y de la escala del sistema).
function fitBeInputs(){
  ['be-usd','be-bs','be-usdt'].forEach(function(id){
    var el=document.getElementById(id); if(el) shrinkToFit(el);
  });
}
// El campo que estas escribiendo tambien lleva separador, pero reescribir el
// value mueve el cursor al final: se cuenta cuantos DIGITOS quedaban a la
// izquierda del cursor y se lo devuelve a esa misma altura despues de agrupar.
// Se agrupa solo la parte entera y con regex, no con toLocaleString: hay que
// respetar el punto decimal a medio escribir ("1234." o "1234.5") y los ceros
// a la izquierda, que Number() se comeria.
function beFormatTyped(el){
  var v = el.value;
  if(!v) return;
  var m = v.replace(/,/g,'').match(/^(-?)(\d*)(\.\d*)?$/);
  if(!m) return; // cualquier otra cosa (dos puntos, letras): se deja como esta
  var out = m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '');
  if(out === v) return;
  var caret = el.selectionStart;
  var digits = caret == null ? -1 : (v.slice(0, caret).match(/\d/g) || []).length;
  el.value = out;
  if(digits < 0) return;
  var pos = out.length, seen = 0;
  for(var i = 0; i < out.length; i++){
    if(/\d/.test(out[i])) seen++;
    if(seen === digits){ pos = i + 1; break; }
  }
  if(digits === 0) pos = m[1].length;
  try{ el.setSelectionRange(pos, pos); }catch(e){}
}
export function calcBCVEmily(fromUser, src){
  if(src) beFormatTyped(document.getElementById('be-'+src));
  if(src) _beSrc = src;
  else if((_getState().bcvCalc||{}).src) _beSrc = _getState().bcvCalc.src;
  var r = beRates();
  // parseAmt, no parseFloat: los campos llevan separador de miles y
  // parseFloat('87,654,321.55') corta en la primera coma y devuelve 87.
  var amt = parseAmt(document.getElementById('be-'+_beSrc).value);

  // Todo pasa por Bs: es la unica moneda que las dos tasas comparten.
  var bs = _beSrc === 'bs' ? amt : (_beSrc === 'usd' ? amt * r.bcv : amt * r.eff);
  if(_beSrc !== 'bs')  beSet('be-bs', bs);
  if(_beSrc !== 'usd') beSet('be-usd', r.bcv > 0 ? bs / r.bcv : 0);
  if(_beSrc !== 'usdt')beSet('be-usdt', r.eff > 0 ? bs / r.eff : 0);

  if(fromUser===true){
    var S=_getState();
    var vals={usd:document.getElementById('be-usd').value, usdt:document.getElementById('be-usdt').value, bs:document.getElementById('be-bs').value, src:_beSrc};
    var prev=S.bcvCalc||{};
    if(vals.usd!==(prev.usd||'')||vals.usdt!==(prev.usdt||'')||vals.bs!==(prev.bs||'')||vals.src!==prev.src){
      S.bcvCalc=vals;
      if(_stamp) S.bcvCalcUpdatedAt=_stamp();
      _save();
    }
  }

  // Las tasas usadas, como subtitulo de su propio campo: son referencia, no el
  // resultado, y ocupaban una fila entera de cards para mostrar dos numeros fijos.
  var f2 = function(n){ return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var setRate = function(id, txt){ var el=document.getElementById(id); if(el) el.textContent=txt; };
  setRate('be-usd-rate', r.bcv > 0 ? f2(r.bcv) : '—');
  setRate('be-usdt-rate', r.eff > 0 ? f2(r.eff)+' −'+feeOf('emily')+'%' : '—');
  fitBeInputs();
}
window.calcBCVEmily = calcBCVEmily;

// --- Tuerca de comisiones por tool -----------------------------------------
var GEAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
// Que comision ajusta cada tool. P2P ya tiene su campo Fee% inline; BDV Limits no tiene fee.
var TOOL_GEARS = {
  profit:   [{ key:'bpay',  label:'Bpay fee %' }],
  bcvemily: [{ key:'emily', label:'Below market %' }],
};

function syncGearInputs(){
  document.querySelectorAll('.tool-gear input[data-fee]').forEach(function(inp){
    if(inp !== document.activeElement) inp.value = feeOf(inp.getAttribute('data-fee'));
  });
}

export function renderToolGears(){
  Object.keys(TOOL_GEARS).forEach(function(id){
    var title = document.querySelector('#tc-'+id+' .tool-title');
    if(!title || title.querySelector('.tool-gear')) return;
    var rows = TOOL_GEARS[id].map(function(f){
      return '<div class="tool-gear-row"><label>'+f.label+'</label>'
        +'<input type="number" step="0.01" min="0" data-fee="'+f.key+'" oninput="setToolFee(\''+f.key+'\',this.value)"></div>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.className = 'hist-wrap tool-gear';
    wrap.innerHTML = '<button class="tool-gear-btn" onclick="toggleToolGear(this)" title="Adjust fees">'+GEAR_SVG+'</button>'
      +'<div class="tool-gear-pop"><div class="tool-gear-title">Fees</div>'+rows+'</div>';
    title.appendChild(wrap);
  });
  syncGearInputs();
}
window.renderToolGears = renderToolGears;

window.setToolFee = function(key, val){
  var v = parseFloat(val);
  var S = _getState();
  if(!S.toolFees) S.toolFees = {};
  S.toolFees[key] = isFinite(v) ? v : TOOL_FEE_DEFAULTS[key];
  if(_stamp) S.toolFeesUpdatedAt = _stamp();
  _save();
  calcProfit(); calcBCVEmily();
  // un mismo fee puede aparecer en varios tools: sincroniza los otros inputs
  document.querySelectorAll('.tool-gear input[data-fee="'+key+'"]').forEach(function(inp){
    if(inp !== document.activeElement) inp.value = S.toolFees[key];
  });
};

window.toggleToolGear = function(btn){
  var pop = btn.parentNode.querySelector('.tool-gear-pop');
  var open = pop.classList.contains('open');
  document.querySelectorAll('.tool-gear-pop.open').forEach(function(el){ el.classList.remove('open'); });
  if(!open) pop.classList.add('open');
};
document.addEventListener('click', function(e){
  if(!e.target.closest('.tool-gear')) document.querySelectorAll('.tool-gear-pop.open').forEach(function(el){ el.classList.remove('open'); });
});
