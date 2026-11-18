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
  const ctx=vm.createContext({q,cur:null,confirm(){return false;},mostrarPersona(){},cargarProvincias(){},bootstrap:{Modal:{getOrCreateInstance(){return{show(){}};}}},api(p,o){calls.push({p,o});return handler?handler(p,o):Promise.resolve([]);}});
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
  s.ctx.abrirUnificacionPastor(81);assert.doesNotMatch(s.q('unificarPastorDestino').innerHTML,/<img/);
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

test('duplicate rename opens review with existing destination and sends no automatic mutation',async()=>{
  const s=setup();s.ctx.catalogoPastores=[{id_pastor:57,nombre:'Monzon Daniel',personas_vinculadas:1},{id_pastor:58,nombre:'Monzon Jose Daniel',personas_vinculadas:1}];
  s.ctx.editarPastorCatalogo(57);s.q('catPastorNombre').value='  MONZON JOSE DANIEL  ';
  await s.ctx.guardarPastorCatalogo();
  assert.equal(s.calls.length,0);assert.equal(s.ctx.pastorUnificarOrigen,57);assert.equal(s.q('unificarPastorDestino').value,'58');
  assert.equal(s.q('unificarPastorPanel').style.display,'');assert.match(s.q('pastoresCatalogoEstado').textContent,/todavía no/);
});
test('merge requires explicit choice and native confirmation',async()=>{
  const s=setup();s.ctx.catalogoPastores=[{id_pastor:57,nombre:'Monzon Daniel',personas_vinculadas:1},{id_pastor:58,nombre:'Monzon Jose Daniel',personas_vinculadas:1}];
  s.ctx.abrirUnificacionPastor(57);assert.equal(s.q('unificarPastorDestino').value,'');
  await s.ctx.confirmarUnificacionPastor();assert.equal(s.calls.length,0);
  s.q('unificarPastorDestino').value='58';let prompt='';s.ctx.confirm=t=>{prompt=t;return false;};
  await s.ctx.confirmarUnificacionPastor();assert.equal(s.calls.length,0);assert.match(prompt,/Monzon Daniel \(código 57\)/);assert.match(prompt,/Monzon Jose Daniel \(código 58\)/);assert.match(prompt,/1 persona/);
});
test('confirmed merge posts source and destination ids and updates current person',async()=>{
  const s=setup((p,o)=>Promise.resolve(o?{id_origen:57,id_destino:58,nombre_destino:'Monzon Jose Daniel',personas_reasignadas:1}:[]));
  s.ctx.catalogoPastores=[{id_pastor:57,nombre:'Monzon Daniel',personas_vinculadas:1},{id_pastor:58,nombre:'Monzon Jose Daniel',personas_vinculadas:1}];
  s.ctx.cur={id_pastor:57,pastor:'Monzon Daniel'};s.ctx.confirm=()=>true;
  s.ctx.abrirUnificacionPastor(57);s.q('unificarPastorDestino').value='58';
  await s.ctx.confirmarUnificacionPastor();
  assert.equal(s.calls[0].p,'/pastores/57/unificar');assert.equal(s.calls[0].o.method,'POST');assert.deepEqual(JSON.parse(s.calls[0].o.body),{id_destino:58});
  assert.equal(s.ctx.cur.id_pastor,58);assert.equal(s.ctx.cur.pastor,'Monzon Jose Daniel');assert.equal(s.ctx.pastorUnificarOrigen,0);
  assert.match(s.q('pastoresCatalogoEstado').textContent,/Personas reasignadas: 1/);
});
test('failed merge preserves selection and source state and allows retry',async()=>{
  const s=setup(()=>Promise.reject(new Error('No pertenecen a la misma provincia')));s.ctx.catalogoPastores=[{id_pastor:57,nombre:'Origen'},{id_pastor:58,nombre:'Destino'}];
  s.ctx.confirm=()=>true;s.ctx.abrirUnificacionPastor(57);s.q('unificarPastorDestino').value='58';
  await s.ctx.confirmarUnificacionPastor();
  assert.equal(s.ctx.pastorUnificarOrigen,57);assert.equal(s.q('unificarPastorDestino').value,'58');assert.equal(s.ctx.catalogoGuardando,false);
  assert.match(s.q('pastoresCatalogoEstado').textContent,/No pertenecen/);
});
test('filter supports names in different order, but never merges them',()=>{
  const s=setup();s.ctx.catalogoPastores=[{id_pastor:25,nombre:'Daniel Monzon',personas_vinculadas:14},{id_pastor:57,nombre:'Monzon Daniel',personas_vinculadas:1},{id_pastor:58,nombre:'Monzon Jose Daniel',personas_vinculadas:1},{id_pastor:99,nombre:'Otro Pastor',personas_vinculadas:2}];
  s.q('catPastorFiltro').value='Monzon Daniel';s.ctx.renderPastoresCatalogo();
  const rows=s.q('pastoresCatalogoLista').innerHTML;assert.match(rows,/Daniel Monzon/);assert.match(rows,/Monzon Jose Daniel/);assert.doesNotMatch(rows,/Otro Pastor/);assert.match(rows,/abrirUnificacionPastor\(25\)/);assert.match(rows,/>14<\/td>/);assert.equal(s.calls.length,0);
});
test('merge refuses self target and concurrent duplicate submission',async()=>{
  const pending=deferred();const s=setup((p,o)=>o?pending.promise:Promise.resolve([]));
  s.ctx.catalogoPastores=[{id_pastor:57,nombre:'Origen'},{id_pastor:58,nombre:'Destino'}];s.ctx.confirm=()=>true;s.ctx.abrirUnificacionPastor(57);
  s.q('unificarPastorDestino').value='57';await s.ctx.confirmarUnificacionPastor();assert.equal(s.calls.length,0);
  s.q('unificarPastorDestino').value='58';const work=s.ctx.confirmarUnificacionPastor();s.ctx.confirmarUnificacionPastor();assert.equal(s.calls.length,1);
  pending.resolve({id_origen:57,id_destino:58,nombre_destino:'Destino',personas_reasignadas:0});await work;
});
test('province changes cancel merge review',async()=>{
  const s=setup();s.ctx.pastorUnificarOrigen=57;s.q('unificarPastorPanel').style.display='';s.q('unificarPastorDestino').value='58';s.q('locProvincia').value='9';
  await s.ctx.cambiarProvinciaCatalogo();
  assert.equal(s.ctx.pastorUnificarOrigen,0);assert.equal(s.q('unificarPastorDestino').value,'');assert.equal(s.q('unificarPastorPanel').style.display,'none');
});
