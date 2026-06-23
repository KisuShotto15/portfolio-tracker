// Pure formatting/parsing helpers. No DOM, no global state — safe to unit-test
// and import anywhere.

// Local YYYY-MM-DD (not UTC) for the date input default and recurring schedule.
export function localToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// Parse a user/string amount, stripping $ , and whitespace. NaN → 0.
export function parseAmt(s){ return parseFloat(String(s||0).replace(/[$,\s]/g,''))||0; }

// USD with thousands separators and 2 decimals.
export function fmtUSD(v){ return '$'+parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// Escape for safe insertion into innerHTML.
export function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
