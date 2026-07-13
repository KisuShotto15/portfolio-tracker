// Pure formatting/parsing helpers. No DOM, no global state — safe to unit-test
// and import anywhere.

// Local YYYY-MM-DD (not UTC) for the date input default and recurring schedule.
export function localToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// YYYY-MM local de un Date. Nunca via toISOString(): en UTC-4, entre las 20:00
// y medianoche el mes/dia UTC ya es el siguiente y los KPIs saltaban de mes.
export function monthKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }

// Mes anterior de un 'YYYY-MM' por aritmetica pura (sin Date ni UTC).
export function prevMonth(month){ var p=month.split('-'); var y=+p[0], m=+p[1]-1; if(m===0){ y--; m=12; } return y+'-'+String(m).padStart(2,'0'); }

// Parse a user/string amount, stripping $ , and whitespace. NaN → 0.
export function parseAmt(s){ return parseFloat(String(s||0).replace(/[$,\s]/g,''))||0; }

// USD with thousands separators and 2 decimals. Valores no finitos (undefined/NaN/Infinity) → 0.
export function fmtUSD(v){ var n=parseFloat(v); if(!isFinite(n)) n=0; return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// Escape for safe insertion into innerHTML (incluye atributos entre comillas simples).
export function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
