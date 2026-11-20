// ========================================
// 🛰️ SERVICE WORKER VIEJO (alcance /public/) → MIGRACIÓN
// ========================================
// La biblioteca pasó a la portada (/) y el service worker de UpGames ahora vive en /service-worker.js
// (alcance "/"). GitHub Pages no permite que un worker de /public/ controle "/", así que este archivo
// solo existe para quien tenía instalado el viejo: el navegador lo descarga al visitar cualquier página
// de /public/ y entonces
//   1. borra las cachés VIEJAS de UpGames (upgames-*; nunca las de los juegos ni la de imágenes),
//   2. se da de baja (las páginas de /public/ pasan a estar bajo el worker de la raíz),
//   3. lleva a la portada, con sus parámetros, a las ventanas que aún mostraban /public/biblioteca.html.
// No responde nada desde caché: sin manejador de fetch, todo va directo a la red mientras tanto.
// ========================================
const CACHE_VERSION = 'upgames-v8.0.0';   // la de /service-worker.js: esas cachés se conservan
const CACHE_IMG = 'upgames-img-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const nombres = await caches.keys();
        await Promise.all(nombres
            .filter(n => n.startsWith('upgames-') && !n.startsWith(CACHE_VERSION) && n !== CACHE_IMG)
            .map(n => caches.delete(n)));
        await self.clients.claim();
        const ventanas = await self.clients.matchAll({ type: 'window' });
        await self.registration.unregister();
        await Promise.all(ventanas.map(c => {
            const u = new URL(c.url);
            if (u.pathname !== '/public/biblioteca.html') return null;   // las demás páginas siguen tal cual (p. ej. un live abierto)
            return c.navigate('/' + u.search + u.hash).catch(() => {});
        }));
    })());
});
