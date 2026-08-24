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
  delete process.env.EXPORT_SECRET;
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

  it('sin ningun secret configurado: 401 (nunca abierto por omision)', async function(){
    delete process.env.CRON_SECRET;
    var res=mkRes();
    await handler(mkReq({auth:'Bearer '}), res);
    expect(res.statusCode).toBe(401);
  });

  it('EXPORT_SECRET le gana a CRON_SECRET: el de CI no sirve para /api/restore', async function(){
    process.env.EXPORT_SECRET='solo-export';
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'yo@mail.com'}]});
      return jsonRes(200,[{user_id:'u1',doc:{transactions:[]}}]);
    });
    var conExport=mkRes();
    await handler(mkReq({auth:'Bearer solo-export'}), conExport);
    expect(conExport.statusCode).toBe(200);
    var conCron=mkRes();
    await handler(mkReq({auth:'Bearer s3cret'}), conCron);   // el del cron ya no entra aca
    expect(conCron.statusCode).toBe(401);
  });

  it('devuelve el doc del usuario que corresponde al email', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'Yo@Mail.com'},{id:'u2',email:'otro@mail.com'}]});
      return jsonRes(200,[{user_id:'u2',doc:{transactions:[{id:9}]}},{user_id:'u1',doc:{transactions:[{id:1}]}}]);
    });
    var res=mkRes();
    await handler(mkReq({query:{email:'yo@mail.com'}}), res);   // case-insensitive
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions[0].id).toBe(1);
  });

  // EL bug real: el backup semanal commiteo el doc de una cuenta de prueba con
  // 1 sola transaccion porque habia dos usuarios y se elegia al primero que
  // apareciera en la lista de GoTrue.
  it('mismo correo en dos filas: gana la que tiene datos, no la primera', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'viejo',email:'yo@mail.com'},{id:'real',email:'yo@mail.com'}]});
      return jsonRes(200,[{user_id:'viejo',doc:{transactions:[{id:1}]}},{user_id:'real',doc:{transactions:[{id:1},{id:2},{id:3}]}}]);
    });
    var res=mkRes();
    await handler(mkReq({query:{email:'yo@mail.com'}}), res);
    expect(res.body.data.transactions.length).toBe(3);
  });

  it('un usuario soft-deleted con el mismo correo no cuenta', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'muerto',email:'yo@mail.com',deleted_at:'2026-01-01'},{id:'vivo',email:'yo@mail.com'}]});
      return jsonRes(200,[{user_id:'muerto',doc:{transactions:[{id:1},{id:2},{id:3},{id:4}]}},{user_id:'vivo',doc:{transactions:[{id:9}]}}]);
    });
    var res=mkRes();
    await handler(mkReq({query:{email:'yo@mail.com'}}), res);
    expect(res.body.data.transactions[0].id).toBe(9);
  });

  it('?list=1 dice que cuentas hay y cuanto tienen, sin devolver ningun doc', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'yo@mail.com'},{id:'u2',email:'test@mail.com'}]});
      return jsonRes(200,[{user_id:'u2',doc:{transactions:[{id:1}]}},{user_id:'u1',doc:{transactions:[{id:1},{id:2}]}}]);
    });
    var res=mkRes();
    await handler(mkReq({query:{list:'1'}}), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.map(function(x){ return x.email; })).toEqual(['yo@mail.com','test@mail.com']);  // ordenado por txs
    expect(JSON.stringify(res.body)).not.toContain('transactions');
  });

  it('sin email y con un solo usuario: devuelve ese', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'yo@mail.com'}]});
      return jsonRes(200,[{user_id:'u1',doc:{transactions:[]}}]);
    });
    var res=mkRes();
    await handler(mkReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transactions).toEqual([]);
  });

  it('sin email y con varios usuarios: 400 en vez de devolver el equivocado', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[]});
      return jsonRes(200,[{user_id:'a',doc:{a:1}},{user_id:'b',doc:{b:2}}]);
    });
    var res=mkRes();
    await handler(mkReq(), res);
    expect(res.statusCode).toBe(400);
  });

  it('email que no existe: 404', async function(){
    global.fetch=vi.fn(function(url){
      if(url.indexOf('/auth/v1/admin/users')>=0) return jsonRes(200,{users:[{id:'u1',email:'yo@mail.com'}]});
      return jsonRes(200,[{user_id:'u1',doc:{transactions:[]}}]);
    });
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
