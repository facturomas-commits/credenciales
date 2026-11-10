'use strict';

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 3301;
const BACKEND_URL = process.env.BACKEND_URL || 'http://172.168.20.183:3251';
const ARTICULACION_HOST = 'articulacion2026.ceka.com.ar';

const app = express();
app.disable('x-powered-by');

// 0) Si el pedido llega por el subdominio de la Articulación, servimos ese sitio en la raíz.
//    (Sirve como respaldo si nginx apunta este proceso al puerto 3301 en lugar del 3032.)
app.use((req, res, next) => {
  if ((req.hostname || '').toLowerCase() !== ARTICULACION_HOST) return next();
  express.static(path.join(__dirname, 'articulacion', 'public'), { extensions: ['html'] })(req, res, next);
});

// 1) Web estatica (admin.html, credenciales.html, membrete.jpg)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// 1a) Sitio de la Articulación 2026 (también accesible en /articulacion/)
app.use('/articulacion', express.static(path.join(__dirname, 'articulacion', 'public'), {
  extensions: ['html'],
}));

// 1b) Rutas estilo backend -> sirven la web NUEVA (evita que el proxy traiga la vieja)
app.get(['/admin', '/admin/'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get(['/admin/credenciales', '/admin/credenciales/'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'credenciales.html')));

// 2) Todo lo demas (personas, credenciales, usuarios, filiales, ...) -> backend Horse
app.use(createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  xfwd: true,
  proxyTimeout: 120000,
  timeout: 120000,
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Web TEADEM escuchando en http://0.0.0.0:${PORT}`);
  console.log(`API proxy -> ${BACKEND_URL}`);
});
