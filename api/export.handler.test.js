// Tests del handler de api/export.js: el endpoint que alimenta el backup semanal
// a git. Se mockea global.fetch simulando GoTrue admin y PostgREST (app_state).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/export.js';

function mkRes(){
  var res={ statusCode:null, body:null };
  res.status=function(c){ res.statusCode=c; return res; };
  res.json=function(b){ res.body=b; return res; };
  return res;
}
function mkReq(o){
  o=o||{};
  return { method:o.method||'GET', headers:{ authorization:o.auth||'Bearer s3cret' }, query:o.query||{} };
}
function jsonRes(status, body){
  return Promise.resolve({ ok:status>=200&&status<300, status:status, json:function(){ return Promise.resolve(body); } });
}

var realFetch=global.fetch;
beforeEach(function(){
  process.env.CRON_SECRET='s3cret';
  process.env.SUPABASE_URL='https://sb.test';
  process.env.SUPABASE_SERVICE_KEY='svc';
});
afterEach(function(){ global.fetch=realFetch; });

describe('api/export', function(){
  it('sin el secret correcto: 401 y no toca Supabase', async function(){
    global.fetch=vi.fn(function(){ throw new Error('no deberia llamar'); });
    var res=mkRes();
    await handler(mkReq({auth:'Bearer otro'}), res);
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sin CRON_SECRET configurado: 401 (nunca abierto por omision)', async function(){
    delete process.env.CRON_SECRET;
    var res=mkRes();
    await handler(mkReq({auth:'Bearer '}), res);
    expect(res.statusCode).toBe(401);
  });

  it('devuelve el doc del usuario que corresponde al email', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'Yo@Mail.com'},{id:'u2',email:'otro@mail.com'}]});
      expect(url).toContain('user_id=eq.u1');
      return jsonRes(200,[{doc:{transactions:[{id:1}]}}]);
    });
    var res=mkRes();
    await handler(mkReq({query:{email:'yo@mail.com'}}), res);   // case-insensitive
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions.length).toBe(1);
  });

  it('sin email y con un solo usuario: devuelve ese', async function(){
    global.fetch=vi.fn(function(){ return jsonRes(200,[{doc:{transactions:[]}}]); });
    var res=mkRes();
    await handler(mkReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toEqual([]);
  });

  it('sin email y con varios usuarios: 400 en vez de devolver el equivocado', async function(){
    global.fetch=vi.fn(function(){ return jsonRes(200,[{doc:{a:1}},{doc:{b:2}}]); });
    var res=mkRes();
    await handler(mkReq(), res);
    expect(res.statusCode).toBe(400);
  });

  it('email que no existe: 404', async function(){
    global.fetch=vi.fn(function(){ return jsonRes(200,{users:[{id:'u1',email:'yo@mail.com'}]}); });
    var res=mkRes();
    await handler(mkReq({query:{email:'nadie@mail.com'}}), res);
    expect(res.statusCode).toBe(404);
  });

  it('POST: 405 (es solo lectura)', async function(){
    var res=mkRes();
    await handler(mkReq({method:'POST'}), res);
    expect(res.statusCode).toBe(405);
  });
});
