'use strict';

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 3301;
const BACKEND_URL = process.env.BACKEND_URL || 'http://172.168.20.183:3251';

const app = express();
app.disable('x-powered-by');

// 1) Web estatica (admin.html, credenciales.html, membrete.jpg)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

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
