import http from 'k6/http';
import { check, fail, sleep, group } from 'k6';

// Solo lectura: nunca llama PUT, DELETE, generar, imprimir ni unificar.
// El login se hace una vez en setup; los VU comparten el token de prueba.
const BASE = (__ENV.BASE_URL || 'https://centralizado.teadem.com.ar').replace(/\/+$/, '');
const MAX_VUS = Number(__ENV.VUS || 3);
if (!/^https?:\/\//i.test(BASE)) throw new Error('Definí BASE_URL, por ejemplo http://127.0.0.1:3251');
if (!Number.isInteger(MAX_VUS) || MAX_VUS < 1) throw new Error('VUS debe ser un entero positivo');
if (!__ENV.EMAIL || !__ENV.PASSWORD) throw new Error('Definí EMAIL y PASSWORD como variables de entorno');

export const options = {
  stages: [
    { duration: '10s', target: 1 },
    { duration: '10s', target: MAX_VUS },
    { duration: __ENV.DURACION || '30s', target: MAX_VUS },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    http_req_duration: ['p(95)<2000'],
    'http_req_duration{name:listado}': ['p(95)<3000'],
  },
  // Evita incluir DNI/URLs individuales en etiquetas de métricas.
  systemTags: ['status', 'method', 'name', 'group', 'scenario', 'error_code', 'expected_response'],
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '45s',
};

function params(token, name) {
  return {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    tags: { name },
    timeout: '10s',
    redirects: 0,
  };
}
function json(response) {
  try { return response.json(); } catch (_) { return null; }
}
function listaPath() {
  const query = [];
  if (__ENV.FECHA_DESDE) query.push(`fecha_desde=${encodeURIComponent(__ENV.FECHA_DESDE)}`);
  if (__ENV.FECHA_HASTA) query.push(`fecha_hasta=${encodeURIComponent(__ENV.FECHA_HASTA)}`);
  return `/credenciales/lista${query.length ? '?' + query.join('&') : ''}`;
}
const erroresRegistrados = {};
function getJSON(path, token, name, validate) {
  const response = http.get(BASE + path, params(token, name));
  const body = json(response);
  const datosValidos = body !== null && validate(body);
  check(response, {
    [`${name}: HTTP 200`]: (r) => r.status === 200,
    [`${name}: datos válidos`]: () => datosValidos,
  });
  // Máximo tres avisos por endpoint y VU; sin URL, DNI, cuerpo ni token.
  if ((response.status !== 200 || !datosValidos) && (erroresRegistrados[name] || 0) < 3) {
    erroresRegistrados[name] = (erroresRegistrados[name] || 0) + 1;
    console.warn(JSON.stringify({
      endpoint: name,
      http_status: response.status,
      error_code: response.error_code || 0,
      duracion_ms: response.timings.duration,
      datos_validos: datosValidos,
    }));
  }
  if (response.status === 401) fail('Sesión expirada: revisá la vigencia del token de prueba');
  return body;
}

export function setup() {
  const response = http.post(BASE + '/usuarios/login', JSON.stringify({
    email: __ENV.EMAIL,
    password: __ENV.PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' }, timeout: '10s', redirects: 0,
  });
  const login = json(response);
  const ok = check(response, {
    'login: HTTP 200 y token': (r) => r.status === 200 && !!(login && login.token),
  });
  if (!ok) throw new Error(`Falló el login (HTTP ${response.status}). Revisá URL y credenciales.`);

  const token = login.token;
  let dnis = (__ENV.DNIS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!dnis.length) {
    const lista = getJSON(listaPath(), token, 'listado', Array.isArray);
    if (!Array.isArray(lista)) throw new Error('El listado no devolvió un arreglo JSON');
    dnis = [...new Set(lista.filter((p) => p && p.id_persona > 0 && p.dni).map((p) => String(p.dni)))].slice(0, 10);
  }
  if (!dnis.length) throw new Error('No hay DNI para probar. Definí DNIS o ajustá el filtro de fechas.');

  // Verifica el primer DNI y descubre su provincia, sin imprimir datos personales.
  const persona = getJSON('/personas/dni/' + encodeURIComponent(dnis[0]), token, 'persona',
    (p) => !!(p && p.id_persona > 0 && String(p.dni) === dnis[0]));
  if (!persona || !persona.id_persona) throw new Error('El primer DNI no tiene una ficha accesible');
  const provincia = Number(__ENV.PROVINCIA_ID || persona.id_provincia);
  if (!Number.isInteger(provincia) || provincia <= 0) throw new Error('Definí PROVINCIA_ID con una provincia válida');
  console.log(`Prueba de solo lectura: hasta ${MAX_VUS} VU; ${dnis.length} DNI de muestra. Fotos: ${__ENV.FOTOS === '1' ? 'sí' : 'no'}.`);
  return { token, dnis, provincia };
}

export default function (data) {
  const dni = data.dnis[(__VU - 1 + __ITER) % data.dnis.length];
  const encodedDni = encodeURIComponent(dni);

  // Secuencial dentro de cada VU, como la web. Los VU sí trabajan en paralelo.
  group('01_Carga_Inicial_Panel', function () {
    getJSON('/provincias', data.token, 'provincias',
      (items) => Array.isArray(items) && items.length > 0 && items.every((p) => p && Number(p.id_provincia) > 0 && typeof p.nombre === 'string'));
    getJSON(listaPath(), data.token, 'listado', Array.isArray);
  });
  sleep(1);
  let provincia = data.provincia;
  group('02_Busqueda_Por_DNI', function () {
    const persona = getJSON('/personas/dni/' + encodedDni, data.token, 'persona',
      (p) => !!(p && p.id_persona > 0 && String(p.dni) === dni));
    if (persona && Number(persona.id_provincia) > 0) provincia = Number(persona.id_provincia);
    getJSON('/credenciales/estado/' + encodedDni, data.token, 'estado',
      (e) => !!(e && typeof e === 'object' && !Array.isArray(e) && !e.error && 'generada' in e));
    if (__ENV.FOTOS === '1') {
      getJSON('/credenciales/foto-mini/' + encodedDni, data.token, 'foto',
        (f) => !!(f && typeof f.foto_base64 === 'string'));
    }
  });
  group('03_Catalogos', function () {
    getJSON(`/provincias/${provincia}/ciudades`, data.token, 'ciudades', Array.isArray);
    getJSON(`/provincias/${provincia}/pastores`, data.token, 'pastores', Array.isArray);
  });
  sleep(2);
}
