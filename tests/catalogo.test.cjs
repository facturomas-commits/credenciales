const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../public/credenciales.html'),'utf8');
const begin=html.indexOf('function htmlEsc(');
const end=html.indexOf('function setSelectValor(',begin);
const source=html.slice(begin,end);
function setup(handler){
  const elements=new Map();
  function q(id){
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},options:[{},{}],focus(){this.focused=true;},querySelectorAll(){return [...elements.values()];}});
    return elements.get(id);
  }
  const calls=[];
  const ctx=vm.createContext({q,cur:null,mostrarPersona(){},cargarProvincias(){},bootstrap:{Modal:{getOrCreateInstance(){return{show(){}};}}},api(p,o){calls.push({p,o});return handler?handler(p,o):Promise.resolve([]);}});
  vm.runInContext(source,ctx);
  q('locProvincia').value='6';
  return{ctx,q,calls};
}
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}

test('all inline JavaScript parses',()=>{
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
});
test('catalog has visible edit controls and scrollable modal',()=>{
  assert.match(html,/Localidades y pastores/);
  assert.match(html,/id="locCancelar"/);
  assert.match(html,/id="catPastorCancelar"/);
  assert.match(html,/onchange="cambiarProvinciaCatalogo\(\)"/);
});
test('city edit uses PUT with stable id and postal code, no accidental ACTIVO reset',async()=>{
  const s=setup();s.ctx.catalogoCiudades=[{id_ciudad:42,nombre:'Ciudad vieja',codigo_postal:'3500'}];
  s.ctx.editarCiudadCatalogo(42);
  assert.equal(s.q('locNombre').value,'Ciudad vieja');assert.equal(s.q('locGuardar').textContent,'Guardar cambios');
  s.q('locNombre').value='Resistencia';s.q('locCP').value='3501';
  await s.ctx.guardarCiudadCatalogo();
  assert.equal(s.calls[0].p,'/ciudades/42');assert.equal(s.calls[0].o.method,'PUT');
  assert.deepEqual(JSON.parse(s.calls[0].o.body),{id_provincia:6,nombre:'Resistencia',codigo_postal:'3501'});
  assert.equal(s.ctx.ciudadEdicion,0);assert.equal(s.q('locNombre').value,'');
  assert.equal(s.q('ciudadesCatalogoEstado').textContent,'Localidad actualizada');
});
test('pastor edit uses PUT and retains id on validation/server failure',async()=>{
  const s=setup(()=>Promise.reject(new Error('Nombre duplicado')));
  s.ctx.catalogoPastores=[{id_pastor:81,nombre:'Pastor anterior'}];s.ctx.editarPastorCatalogo(81);s.q('catPastorNombre').value='Pastor corregido';
  await s.ctx.guardarPastorCatalogo();
  assert.equal(s.calls[0].p,'/pastores/81');assert.equal(s.calls[0].o.method,'PUT');
  assert.equal(s.ctx.pastorEdicion,81);assert.equal(s.q('catPastorNombre').value,'Pastor corregido');
  assert.match(s.q('pastoresCatalogoEstado').textContent,/Nombre duplicado/);assert.equal(s.ctx.catalogoGuardando,false);
});
test('cancel restores creation, and blank names never send requests',async()=>{
  const s=setup();s.ctx.catalogoPastores=[{id_pastor:81,nombre:'Pastor'}];s.ctx.editarPastorCatalogo(81);s.ctx.cancelarEdicionPastor();
  assert.equal(s.ctx.pastorEdicion,0);assert.equal(s.q('catPastorNombre').value,'');
  await s.ctx.guardarPastorCatalogo();assert.equal(s.calls.length,0);
  s.q('catPastorNombre').value='Nuevo';await s.ctx.guardarPastorCatalogo();
  assert.equal(s.calls[0].p,'/pastores');assert.equal(s.calls[0].o.method,'POST');
});
test('province change cancels both editing modes and reloads dependent lists sequentially',async()=>{
  const pending=deferred();const s=setup((p)=>p.endsWith('/ciudades')?pending.promise:Promise.resolve([]));
  s.ctx.ciudadEdicion=42;s.ctx.pastorEdicion=81;s.q('locNombre').value='Vieja';s.q('catPastorNombre').value='Viejo';s.q('locProvincia').value='9';
  const work=s.ctx.cambiarProvinciaCatalogo();
  assert.equal(s.ctx.ciudadEdicion,0);assert.equal(s.ctx.pastorEdicion,0);assert.equal(s.q('locNombre').value,'');
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].p,'/provincias/9/ciudades');
  pending.resolve([]);await work;assert.equal(s.calls[1].p,'/provincias/9/pastores');
});
test('late response from old province cannot overwrite new province',async()=>{
  const old=deferred();const s=setup(p=>p==='/provincias/6/ciudades'?old.promise:Promise.resolve(p.endsWith('/ciudades')?[{id_ciudad:9,nombre:'Nueva'}]:[]));
  const a=s.ctx.cargarCatalogoCiudades();s.q('locProvincia').value='9';await s.ctx.cambiarProvinciaCatalogo();
  old.resolve([{id_ciudad:6,nombre:'Anterior'}]);await a;
  assert.equal(s.ctx.catalogoCiudades[0].id_ciudad,9);
  assert.match(s.q('ciudadesCatalogoLista').innerHTML,/Nueva/);assert.doesNotMatch(s.q('ciudadesCatalogoLista').innerHTML,/Anterior/);
  assert.equal(s.calls.filter(c=>c.p==='/provincias/6/pastores').length,0);
});
test('loading escapes catalog names and renders edit buttons',async()=>{
  const s=setup(p=>Promise.resolve(p.endsWith('/ciudades')?[{id_ciudad:42,nombre:'<img onerror="bad">',codigo_postal:'&'}]:[{id_pastor:81,nombre:"O'Neil"}]));
  await s.ctx.cargarCatalogoCiudades();
  assert.match(s.q('ciudadesCatalogoLista').innerHTML,/editarCiudadCatalogo\(42\)/);
  assert.match(s.q('pastoresCatalogoLista').innerHTML,/editarPastorCatalogo\(81\)/);
  assert.doesNotMatch(s.q('ciudadesCatalogoLista').innerHTML,/<img/);assert.match(s.q('pastoresCatalogoLista').innerHTML,/O&#39;Neil/);
});
test('save is single-flight and failure keeps edit data',async()=>{
  const pending=deferred();const s=setup(()=>pending.promise);s.ctx.ciudadEdicion=42;s.q('locNombre').value='Nombre';s.q('locCP').value='3500';
  const work=s.ctx.guardarCiudadCatalogo();s.ctx.guardarCiudadCatalogo();
  assert.equal(s.calls.length,1);assert.equal(s.q('locProvincia').disabled,true);
  pending.reject(new Error('Sin permisos'));await work;
  assert.equal(s.ctx.ciudadEdicion,42);assert.equal(s.q('locNombre').value,'Nombre');assert.equal(s.q('locProvincia').disabled,false);
});
test('successful rename updates only the linked person in current view',async()=>{
  const s=setup();s.ctx.cur={id_provincia:6,id_ciudad:42,localidad:'Antes'};s.ctx.ciudadEdicion=42;s.q('locNombre').value='Después';
  await s.ctx.guardarCiudadCatalogo();assert.equal(s.ctx.cur.localidad,'Después');
  s.ctx.cur={id_provincia:6,id_ciudad:0,localidad:'No vinculado'};s.q('locNombre').value='Nueva';
  await s.ctx.guardarCiudadCatalogo();assert.equal(s.ctx.cur.localidad,'No vinculado');
});
