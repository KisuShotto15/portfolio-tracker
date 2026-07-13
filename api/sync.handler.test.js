// Tests del handler POST de api/sync.js: lock optimista (read-merge-write con
// retry cuando otra request escribio entre la lectura y el write). Se mockea
// global.fetch simulando GoTrue (/auth/v1/user) y PostgREST (app_state).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/sync.js';

function mkRes(){
  var res={ headers:{}, statusCode:null, body:null };
  res.setHeader=function(k,v){ res.headers[k]=v; };
  res.status=function(c){ res.statusCode=c; return res; };
  res.json=function(b){ res.body=b; return res; };
  res.end=function(){ return res; };
  return res;
}
function mkReq(body){ return { method:'POST', headers:{ authorization:'Bearer jwt' }, body:body }; }

var realFetch=global.fetch;
beforeEach(function(){
  process.env.SUPABASE_URL='https://sb.test';
  process.env.SUPABASE_ANON_KEY='anon';
});
afterEach(function(){ global.fetch=realFetch; });

function jsonRes(status, body){
  return Promise.resolve({ ok:status>=200&&status<300, status:status, json:function(){ return Promise.resolve(body); } });
}

describe('api/sync POST — lock optimista', function(){
  it('escribe a la primera cuando nadie toco la fila', async function(){
    var patches=0;
    global.fetch=vi.fn(function(url, opts){
      if(url.indexOf('/auth/v1/user')>=0) return jsonRes(200,{id:'u1'});
      if((opts&&opts.method)==='PATCH'){ patches++; return jsonRes(200,[{ok:1}]); }
      return jsonRes(200,[{doc:{foo:'cloud'},updated_at:'T1'}]); // readRow
    });
    var res=mkRes();
    await handler(mkReq({bar:'inc'}), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.foo).toBe('cloud');
    expect(res.body.data.bar).toBe('inc');
    expect(patches).toBe(1);
  });

  it('reintenta re-leyendo cuando el PATCH condicionado no matchea filas', async function(){
    var reads=0, patches=0;
    global.fetch=vi.fn(function(url, opts){
      if(url.indexOf('/auth/v1/user')>=0) return jsonRes(200,{id:'u1'});
      if((opts&&opts.method)==='PATCH'){
        patches++;
        // Primer intento: otra request escribio en medio → 0 filas afectadas.
        return jsonRes(200, patches===1?[]:[{ok:1}]);
      }
      reads++;
      // Segunda lectura trae el doc que escribio la request concurrente.
      return jsonRes(200,[{doc:{foo:reads===1?'cloud':'concurrente'},updated_at:'T'+reads}]);
    });
    var res=mkRes();
    await handler(mkReq({bar:'inc'}), res);
    expect(res.statusCode).toBe(200);
    expect(patches).toBe(2);
    expect(reads).toBe(2);
    expect(res.body.data.foo).toBe('concurrente'); // merge contra la lectura fresca
    expect(res.body.data.bar).toBe('inc');
  });

  it('usuario sin fila: INSERT; 409 concurrente → retry como UPDATE', async function(){
    var reads=0, inserts=0, patches=0;
    global.fetch=vi.fn(function(url, opts){
      if(url.indexOf('/auth/v1/user')>=0) return jsonRes(200,{id:'u1'});
      if((opts&&opts.method)==='POST'){ inserts++; return jsonRes(409,{}); }
      if((opts&&opts.method)==='PATCH'){ patches++; return jsonRes(200,[{ok:1}]); }
      reads++;
      return jsonRes(200, reads===1?[]:[{doc:{otro:'device'},updated_at:'T1'}]);
    });
    var res=mkRes();
    await handler(mkReq({bar:'inc'}), res);
    expect(res.statusCode).toBe(200);
    expect(inserts).toBe(1);
    expect(patches).toBe(1);
    expect(res.body.data.otro).toBe('device');
  });

  it('conflicto persistente tras 3 intentos → 503 para que el cliente reintente', async function(){
    global.fetch=vi.fn(function(url, opts){
      if(url.indexOf('/auth/v1/user')>=0) return jsonRes(200,{id:'u1'});
      if((opts&&opts.method)==='PATCH') return jsonRes(200,[]); // siempre pisado
      return jsonRes(200,[{doc:{},updated_at:'T1'}]);
    });
    var res=mkRes();
    await handler(mkReq({bar:'inc'}), res);
    expect(res.statusCode).toBe(503);
  });
});
