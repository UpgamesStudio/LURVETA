// ========================================
// 🛰️ SERVICE WORKER VIEJO (alcance /public/) → MIGRACIÓN
// ========================================
// La biblioteca pasó a la portada (/) y el service worker de Lurveta ahora vive en /service-worker.js
// (alcance "/"). GitHub Pages no permite que un worker de /public/ controle "/", así que este archivo
// existe para quien tenía instalado el viejo. El navegador lo descarga solo (al visitar una página de
// /public/ o al llegar un aviso push) y entonces:
//   · corre el MISMO código que el de la raíz (caché, sin conexión, avisos push y sus clics). No se da de
//     baja: la suscripción push pertenece a este registro y, si lo hiciera, quien no abra la app dejaría de
//     recibir avisos. La portada lo da de baja cuando ya tiene su propia suscripción (upgames-pwa.js).
//   · al activarse borra las cachés VIEJAS de Lurveta (upgames-*; nunca las de los juegos) y lleva a la
//     portada, con sus parámetros, las ventanas que aún mostraban /public/biblioteca.html.
// ========================================
importScripts('/service-worker.js');

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await self.clients.claim();
        const ventanas = await self.clients.matchAll({ type: 'window' });
        await Promise.all(ventanas.map(c => {
            const u = new URL(c.url);
            if (u.pathname !== '/public/biblioteca.html') return null;   // las demás páginas siguen tal cual (p. ej. un live abierto)
            return c.navigate('/' + u.search + u.hash).catch(() => {});
        }));
    })());
});
