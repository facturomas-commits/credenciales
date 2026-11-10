'use strict';

/**
 * Sitio de la Articulación 2026
 * Nivel Inicial (NENI 2154 Ext. 626) – 1er Grado Esc. 626
 *
 * Servidor estático independiente, pensado para correr con PM2 en el puerto 3032
 * detrás de nginx (articulacion2026.ceka.com.ar).
 */

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3032;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'articulacion-2026', port: PORT });
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (ext === '.webp' || ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.svg') {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (ext === '.mp4') {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (ext === '.css' || ext === '.js') {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else if (ext === '.pptx') {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('No encontrado');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Articulación 2026 escuchando en http://0.0.0.0:${PORT}`);
  console.log(`Web estática: ${PUBLIC_DIR}`);
});
