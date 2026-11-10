# Articulación 2026

Sitio web interactivo de la presentación **“Pequeños pasos, grandes trayectorias”**.
Articulación Nivel Inicial (NENI 2154 Ext. 626) – 1er Grado Esc. 626.

Es un proyecto **independiente de la app TEADEM**: tiene su propio servidor, su propio
puerto (**3032**) y su propio proceso de PM2. No modifica ni depende del `server.js`
de `web-teadem`. Es un sitio **estático**: no necesita build ni base de datos.

## Estructura

```
articulacion/
├── server.js              # servidor Express propio (puerto 3032)
├── package.json           # dependencias propias (express)
├── ecosystem.config.js    # proceso PM2: articulacion-2026
├── nginx.articulacion2026.conf
└── public/
    ├── index.html         # visor
    ├── 404.html
    ├── assets/
    │   ├── css/           # estilos + fuentes embebidas
    │   ├── js/            # visor y datos de las diapositivas
    │   ├── slides/        # 34 diapositivas + miniaturas + fondos
    │   ├── video/         # video de cierre
    │   └── download/      # presentación original .pptx
    ├── QR-Articulacion-2026.png
    └── QR-Articulacion-solo.png
```

## Probar en local

```bash
cd articulacion
npm install
npm start
# http://localhost:3032
```

## Publicar en el servidor (PM2)

```bash
cd /ruta/al/repo
git pull
cd articulacion
npm install
pm2 start ecosystem.config.js
pm2 save
```

Si ya estaba corriendo:

```bash
pm2 reload articulacion-2026
```

Comprobar:

```bash
curl -I http://127.0.0.1:3032/
pm2 logs articulacion-2026 --lines 30
```

> `web-teadem` sigue funcionando igual que siempre, en su puerto 3301.
> Este sitio no se monta dentro de esa app.

## Nginx + HTTPS

Copiar `nginx.articulacion2026.conf` a `/etc/nginx/sites-available/`, enlazarlo y recargar:

```bash
sudo cp articulacion/nginx.articulacion2026.conf /etc/nginx/sites-available/articulacion2026.conf
sudo ln -sf /etc/nginx/sites-available/articulacion2026.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d articulacion2026.ceka.com.ar
```

El QR apunta a `https://articulacion2026.ceka.com.ar/`.

## Actualizar contenido

El visor lee las imágenes de `public/assets/slides/`. Para reemplazar una diapositiva
basta con pisar el archivo correspondiente (`01.webp` … `34.webp`, `thumbs/` y `aura/`)
y recargar. Los títulos y capítulos están en `public/assets/js/deck-data.js`.

## Moverlo a un repositorio propio

La carpeta `articulacion/` es autosuficiente. Si más adelante querés separarla en otro
repo, alcanza con copiarla y usar su `package.json` y su `ecosystem.config.js`.
