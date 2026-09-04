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
// main.js inyecta su modal de confirmacion: auth.js no puede importarlo (vive en
// main.js, que ya importa de aca). Sin inyeccion cae al confirm() del navegador.
var _ask=function(t){ return Promise.resolve(window.confirm(t)); };
export function initAuth(o){ _syncProxy=o.syncProxy; _onLogin=o.onLogin||_onLogin; if(o.confirm) _ask=o.confirm; }

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
// Devuelve true (sesion renovada), false (el servidor rechazo el token: sesion
// realmente invalida) o 'net' (fallo de red o 5xx: NO invalidar la sesion local
// — antes esto forzaba re-login cada vez que el boot pillaba la red caida).
// Single-flight: GoTrue ROTA el refresh token en cada uso; si push y autoPull
// reciben 401 a la vez y refrescan en paralelo con el mismo token, uno puede
// perder y expulsar al usuario. Todos los llamadores comparten la misma promesa.
var _refreshing=null;
export function sbRefresh(){
  if(_refreshing) return _refreshing;
  _refreshing=(async function(){
    var rt=sbGet('sb_rt'); if(!rt) return false;
    try{
      var r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({refresh_token:rt})});
      if(r.ok){ sbSetSession(await r.json()); return true; }
      return r.status>=500 ? 'net' : false;
    }catch(e){ return 'net'; }
  })();
  _refreshing.finally(function(){ _refreshing=null; });
  return _refreshing;
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
  authMsg('Sending code...'); window._authEmail=email;
  var res=await sbOtpRequest(email);
  if(res.ok){
    document.getElementById('auth-step-email').style.display='none';
    document.getElementById('auth-step-code').style.display='block';
    authMsg('Code sent to '+email);
    var c=document.getElementById('auth-code'); if(c) c.focus();
  } else if(res.code==='signup_disabled'){
    authMsg('This email is not authorized. Ask the administrator for access.');
  } else authMsg('Could not send the code. Try again.');
};
window.authVerifyCode=async function(){
  var code=(document.getElementById('auth-code').value||'').trim();
  if(!code){ authMsg('Enter the code'); return; }
  authMsg('Verifying...');
  if(await sbOtpVerify(window._authEmail,code)){ hideAuthOverlay(); await _onLogin(); }
  else authMsg('Wrong or expired code.');
};
window.authBackToEmail=function(){
  document.getElementById('auth-step-code').style.display='none';
  document.getElementById('auth-step-email').style.display='block'; authMsg('');
};

// ── Passkeys (WebAuthn, beta de Supabase) ────────────────────────────────────
// GoTrue expone /auth/v1/passkeys/*: options entrega un challenge en base64url,
// el navegador firma con navigator.credentials y verify canjea la firma.
// Login es "discoverable": no pide correo, el authenticator sabe quien es.
function b64uToBuf(s){
  s=String(s).replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='=';
  var bin=atob(s), a=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i);
  return a.buffer;
}
function bufToB64u(b){
  var a=new Uint8Array(b), s='';
  for(var i=0;i<a.length;i++) s+=String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function pkSupported(){ return !!(window.PublicKeyCredential&&navigator.credentials&&navigator.credentials.create); }
// Serializa el PublicKeyCredential al formato JSON que espera go-webauthn.
// toJSON() nativo cuando existe; si no, base64url a mano campo por campo.
function pkCredToJson(cred,kind){
  if(typeof cred.toJSON==='function') return cred.toJSON();
  var resp=cred.response;
  var out={ id:cred.id, rawId:bufToB64u(cred.rawId), type:cred.type,
    clientExtensionResults:(cred.getClientExtensionResults&&cred.getClientExtensionResults())||{} };
  if(cred.authenticatorAttachment) out.authenticatorAttachment=cred.authenticatorAttachment;
  if(kind==='create'){
    out.response={ clientDataJSON:bufToB64u(resp.clientDataJSON), attestationObject:bufToB64u(resp.attestationObject) };
    if(resp.getTransports) out.response.transports=resp.getTransports();
  } else {
    out.response={ clientDataJSON:bufToB64u(resp.clientDataJSON), authenticatorData:bufToB64u(resp.authenticatorData),
      signature:bufToB64u(resp.signature), userHandle:resp.userHandle?bufToB64u(resp.userHandle):null };
  }
  return out;
}
// fetch a GoTrue con Bearer del usuario + un retry tras refresh en 401.
async function sbAuthedFetch(path,method,body){
  var mk=function(){ return {'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+sbGet('sb_at')}; };
  var r=await fetch(SUPABASE_URL+'/auth/v1'+path,{method:method,headers:mk(),body:body});
  if(r.status===401&&(await sbRefresh())===true) r=await fetch(SUPABASE_URL+'/auth/v1'+path,{method:method,headers:mk(),body:body});
  return r;
}
window.authPasskey=async function(){
  if(!pkSupported()){ authMsg('This browser does not support passkeys'); return; }
  authMsg('Waiting for passkey...');
  try{
    var r=await fetch(SUPABASE_URL+'/auth/v1/passkeys/authentication/options',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:'{}'});
    if(!r.ok){ authMsg('Passkeys are unavailable right now'); return; }
    var j=await r.json(), o=j.options;
    o.challenge=b64uToBuf(o.challenge);
    (o.allowCredentials||[]).forEach(function(c){ c.id=b64uToBuf(c.id); });
    var cred=await navigator.credentials.get({publicKey:o});
    var v=await fetch(SUPABASE_URL+'/auth/v1/passkeys/authentication/verify',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({challenge_id:j.challenge_id,credential:pkCredToJson(cred,'get')})});
    var t=await v.json().catch(function(){ return {}; });
    if(v.ok&&t.access_token){ sbSetSession(t); hideAuthOverlay(); authMsg(''); await _onLogin(); }
    else authMsg('Passkey rejected'+(t.msg?': '+t.msg:''));
  }catch(e){ authMsg(e&&e.name==='NotAllowedError'?'Cancelled':'Passkey error'); }
};
function pkStatus(t){ var e=document.getElementById('pk-status'); if(e) e.textContent=t||''; }
window.passkeyRegister=async function(){
  if(!pkSupported()){ pkStatus('This browser does not support passkeys'); return; }
  pkStatus('Creating passkey...');
  try{
    var r=await sbAuthedFetch('/passkeys/registration/options','POST','{}');
    if(!r.ok){ var e1=await r.json().catch(function(){ return {}; }); pkStatus('Could not start: '+(e1.msg||e1.error_code||r.status)); return; }
    var j=await r.json(), o=j.options;
    o.challenge=b64uToBuf(o.challenge);
    o.user.id=b64uToBuf(o.user.id);
    (o.excludeCredentials||[]).forEach(function(c){ c.id=b64uToBuf(c.id); });
    var cred=await navigator.credentials.create({publicKey:o});
    var v=await sbAuthedFetch('/passkeys/registration/verify','POST',JSON.stringify({challenge_id:j.challenge_id,credential:pkCredToJson(cred,'create')}));
    var t=await v.json().catch(function(){ return {}; });
    if(v.ok){ pkStatus('Passkey created'); renderPasskeys(); }
    else pkStatus('Verification failed: '+(t.msg||t.error_code||v.status));
  }catch(e){ pkStatus(e&&e.name==='NotAllowedError'?'Cancelled':'Error: '+(e&&e.message||e)); }
};
window.passkeyDelete=async function(id){
  if(!await _ask('Delete this passkey?','The device using it will have to sign in by email.','Delete')) return;
  var r=await sbAuthedFetch('/passkeys/'+id,'DELETE');
  if(r.ok) renderPasskeys(); else pkStatus('Could not delete');
};
export async function renderPasskeys(){
  var el=document.getElementById('pk-list'); if(!el) return;
  var r=await sbAuthedFetch('/passkeys/','GET').catch(function(){ return null; });
  if(!r||!r.ok){ el.innerHTML=''; return; }
  var list=await r.json();
  if(!Array.isArray(list)||!list.length){ el.innerHTML=''; return; }
  el.innerHTML=list.map(function(p){
    var d=p.created_at?new Date(p.created_at).toLocaleDateString():'';
    return '<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:3px 0">'
      +'<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🔑 '+(p.friendly_name||'Passkey')+'</span>'
      +'<span style="color:var(--color-text-secondary)">'+d+'</span>'
      +'<button class="btn btns" style="padding:2px 8px;font-size:11px;color:#E24B4A" onclick="passkeyDelete(\''+p.id+'\')">✕</button></div>';
  }).join('');
}
