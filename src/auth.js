// ── Multi-usuario (Supabase) ─────────────────────────────────────────────────
// Login por codigo de correo (OTP via GoTrue REST, sin SDK) + sesion en
// localStorage (sb_at/sb_rt/sb_email) + syncFetch con refresh automatico en 401.
// La URL y la publishable key son PUBLICAS por diseno (RLS protege los datos).
// main.js inyecta via initAuth() lo que necesita de vuelta (syncProxy, onLogin).

export var SUPABASE_URL = 'https://fcrqrfpjpuscorbogjho.supabase.co';
export var SUPABASE_KEY = 'sb_publishable_1ru1s3pT8wJ75GEKa2ag5A_jlz0y1GQ';
export var MULTIUSER    = !!(SUPABASE_URL && SUPABASE_KEY);

var _syncProxy='';
var _onLogin=function(){};
export function initAuth(o){ _syncProxy=o.syncProxy; _onLogin=o.onLogin||_onLogin; }

export function sbGet(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function sbSetSession(j){
  try{
    // Cambio de cuenta en el MISMO navegador (login con otro correo sin pasar por
    // logout): no arrastrar el estado local del usuario anterior — se pushearia a
    // la fila del usuario nuevo. Se limpia ft13 y se recarga con estado virgen.
    var _prev=localStorage.getItem('sb_email')||'';
    var _switch=!!(j.user&&j.user.email&&_prev&&_prev!==j.user.email);
    if(j.access_token)  localStorage.setItem('sb_at', j.access_token);
    if(j.refresh_token) localStorage.setItem('sb_rt', j.refresh_token);
    if(j.user&&j.user.email) localStorage.setItem('sb_email', j.user.email);
    if(_switch){ localStorage.removeItem('ft13'); localStorage.removeItem('ft13_dirty'); location.reload(); }
  }catch(e){}
}
function sbClearSession(){ try{ ['sb_at','sb_rt','sb_email'].forEach(function(k){ localStorage.removeItem(k); }); }catch(e){} }
// Cuando el usuario llega desde un enlace de correo (confirmacion de registro o
// magic link), Supabase pone la sesion en el fragmento de la URL (#access_token=...).
// La tomamos, la guardamos y limpiamos el hash para no dejar tokens en la URL.
export function sbConsumeHashSession(){
  var h=location.hash||'';
  if(h.indexOf('access_token=')<0) return false;
  try{
    var p=new URLSearchParams(h.replace(/^#/,''));
    var at=p.get('access_token'); if(!at) return false;
    sbSetSession({access_token:at, refresh_token:p.get('refresh_token')||''});
    history.replaceState(null,'',location.pathname+location.search);
    return true;
  }catch(e){ return false; }
}
export async function sbRefresh(){
  var rt=sbGet('sb_rt'); if(!rt) return false;
  try{
    var r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({refresh_token:rt})});
    if(!r.ok) return false;
    sbSetSession(await r.json()); return true;
  }catch(e){ return false; }
}
async function sbOtpRequest(email){
  try{
    var r=await fetch(SUPABASE_URL+'/auth/v1/otp',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({email:email})});
    if(r.ok) return {ok:true};
    var j=await r.json().catch(function(){ return {}; });
    return {ok:false, code:j.error_code||j.code||''}; // 'signup_disabled' = correo no autorizado
  }catch(e){ return {ok:false, code:'network'}; }
}
async function sbOtpVerify(email,token){
  try{
    var r=await fetch(SUPABASE_URL+'/auth/v1/verify',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({email:email,token:token,type:'email'})});
    if(!r.ok) return false;
    var j=await r.json(); if(!j.access_token) return false;
    sbSetSession(j); return true;
  }catch(e){ return false; }
}
// Headers de auth: siempre el token del usuario (Bearer) de Supabase.
function syncAuthHeaders(base){
  var h=Object.assign({},base||{});
  h['Authorization']='Bearer '+sbGet('sb_at');
  return h;
}
// fetch al sync proxy con refresh automatico del token en 401 (solo multi-usuario).
export async function syncFetch(base,init){
  init=init||{}; init.headers=syncAuthHeaders(base);
  var r=await fetch(_syncProxy,init);
  if(r.status===401&&MULTIUSER&&await sbRefresh()){
    init.headers=syncAuthHeaders(base);
    r=await fetch(_syncProxy,init);
  }
  return r;
}
window.logout=function(){ sbClearSession(); try{ localStorage.removeItem('ft13'); localStorage.removeItem('ft13_dirty'); }catch(e){} location.reload(); };
export function showAuthOverlay(){ var o=document.getElementById('auth-overlay'); if(o) o.classList.add('open'); }
export function hideAuthOverlay(){ var o=document.getElementById('auth-overlay'); if(o) o.classList.remove('open'); }
function authMsg(t){ var e=document.getElementById('auth-msg'); if(e) e.textContent=t||''; }
window.authSendCode=async function(){
  var email=(document.getElementById('auth-email').value||'').trim().toLowerCase();
  if(!email||email.indexOf('@')<1){ authMsg('Correo invalido'); return; }
  authMsg('Enviando codigo...'); window._authEmail=email;
  var res=await sbOtpRequest(email);
  if(res.ok){
    document.getElementById('auth-step-email').style.display='none';
    document.getElementById('auth-step-code').style.display='block';
    authMsg('Codigo enviado a '+email);
    var c=document.getElementById('auth-code'); if(c) c.focus();
  } else if(res.code==='signup_disabled'){
    authMsg('Este correo no esta autorizado. Pide acceso al administrador.');
  } else authMsg('No se pudo enviar el codigo. Reintenta.');
};
window.authVerifyCode=async function(){
  var code=(document.getElementById('auth-code').value||'').trim();
  if(!code){ authMsg('Ingresa el codigo'); return; }
  authMsg('Verificando...');
  if(await sbOtpVerify(window._authEmail,code)){ hideAuthOverlay(); await _onLogin(); }
  else authMsg('Codigo incorrecto o expirado.');
};
window.authBackToEmail=function(){
  document.getElementById('auth-step-code').style.display='none';
  document.getElementById('auth-step-email').style.display='block'; authMsg('');
};
