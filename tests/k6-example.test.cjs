const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const text=fs.readFileSync(path.join(__dirname,'../load-tests/teadem.k6.js'),'utf8');
const source=text.replace(/^import .*;\r?\n/gm,'').replace(/export default function /,'function scenario ').replace(/export /g,'');
function setup(handler){
  const checks=[],logs=[],calls=[];
  const context=vm.createContext({
    __ENV:{EMAIL:'test@example.invalid',PASSWORD:'not-a-real-password',DNIS:'12345678'},__VU:1,__ITER:0,
    console:{log(s){logs.push(s);},warn(s){logs.push(s);}},
    check(response, tests){let all=true;for(const [name,fn] of Object.entries(tests)){const ok=!!fn(response);checks.push({name,ok});all=all&&ok;}return all;},
    fail(message){throw new Error(message);},sleep(){},group(name,fn){return fn();},
    http:{get(url,params){calls.push({url,params});return handler(url,params);},post(url,body,params){calls.push({url,body,params});return handler(url,params);}},
  });
  vm.runInContext(source,context);
  return {context,checks,logs,calls};
}
function response(status,body){return {status,error_code:status>=400?1500:0,timings:{duration:10},json(){return body;}};}
test('k6 example refuses invalid login before navigation',()=>{
  const s=setup(()=>response(401,{error:'bad login'}));
  assert.throws(()=>s.context.setup(),/Falló el login/);assert.equal(s.calls.length,1);
});
test('k6 example treats known-person 404 as a failed check and logs no DNI or token',()=>{
  const s=setup(()=>response(404,{error:'not found'}));
  s.context.getJSON('/personas/dni/12345678','SECRET_TOKEN','persona',p=>p.id_persona>0);
  assert.ok(s.checks.some(c=>c.name==='persona: HTTP 200'&&!c.ok));
  assert.equal(s.logs.length,1);assert.match(s.logs[0],/"http_status":404/);
  assert.doesNotMatch(s.logs[0],/12345678|SECRET_TOKEN/);
});
test('k6 diagnostics cap repeated errors per endpoint',()=>{
  const s=setup(()=>response(500,{error:'internal error'}));
  for(let i=0;i<10;i++)s.context.getJSON('/credenciales/estado/12345678','secret','estado',()=>false);
  assert.equal(s.logs.length,3);
});
test('k6 scenario rejects silently empty provinces but preserves read-only requests',()=>{
  const s=setup(url=>{
    if(url.endsWith('/provincias'))return response(200,[]);
    if(url.includes('/personas/dni/'))return response(200,{id_persona:1,dni:'12345678',id_provincia:9});
    if(url.includes('/credenciales/estado/'))return response(200,{generada:'true'});
    return response(200,[]);
  });
  s.context.scenario({token:'secret',dnis:['12345678'],provincia:9});
  assert.ok(s.checks.some(c=>c.name==='provincias: datos válidos'&&!c.ok));
  assert.equal(s.calls.length,6);assert.ok(s.calls.every(c=>!c.body));
  assert.ok(s.calls.every(c=>!c.url.includes('/unificar')));
});
