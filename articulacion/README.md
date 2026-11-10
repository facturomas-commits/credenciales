# Articulación 2026

Sitio web interactivo de la presentación **“Pequeños pasos, grandes trayectorias”**.
Articulación Nivel Inicial (NENI 2154 Ext. 626) – 1er Grado Esc. 626.

Es un sitio **estático**: no necesita build ni base de datos. Las 34 diapositivas
están exportadas como imágenes WebP y el visor está hecho en HTML, CSS y JavaScript.

## Estructura

```
articulacion/
├── server.js          # servidor Express del subdominio (puerto 3032)
└── public/
    ├── index.html     # visor
    ├── 404.html
    ├── assets/
    │   ├── css/       # estilos + fuentes embebidas
    │   ├── js/        # visor y datos de las diapositivas
    │   ├── slides/    # 34 diapositivas + miniaturas + fondos
    │   ├── video/     # video de cierre
    │   └── download/  # presentación original .pptx
    ├── QR-Articulacion-2026.png
    └── QR-Articulacion-solo.png
```

## Probar en local

Desde la raíz del repositorio:

```bash
npm install
node articulacion/server.js
# http://localhost:3032
```

También queda disponible desde la app TEADEM en `http://localhost:3301/articulacion/`.

## Publicar en el servidor (PM2)

```bash
cd /ruta/al/repo
git pull
npm install
pm2 start ecosystem.config.js --only articulacion-2026
pm2 save
```

Si ya estaba corriendo:

```bash
pm2 reload articulacion-2026
```

## Nginx + HTTPS

Copiar `nginx.articulacion2026.conf` a `/etc/nginx/sites-available/`, enlazarlo y recargar:

```bash
sudo ln -s /etc/nginx/sites-available/articulacion2026.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d articulacion2026.ceka.com.ar
```

El QR apunta a `https://articulacion2026.ceka.com.ar/`.

## Actualizar contenido

El visor lee las imágenes de `public/assets/slides/`. Para reemplazar una diapositiva
basta con pisar el archivo correspondiente (`01.webp` … `34.webp`, `thumbs/` y `aura/`)
y recargar. Los títulos y capítulos están en `public/assets/js/deck-data.js`.
