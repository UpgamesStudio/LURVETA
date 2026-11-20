// Lurveta Blogs · fase 3: SEO por página (título para Google, ocultar de Google)
'use strict';
const assert = require('assert');
const R = require('../modulos/blogs/render');
const ctx = { blog: { _id: 'b', titulo: 'Kero', tema: 'neon', ajustes: {}, direccion: 'k', usuario: 'k', visibilidad: 'publico' }, base: '', origen: 'https://k.com', appUrl: 'https://upgames.games', paginas: [], juegos: {} };
const e = { _id: 'e', tipo: 'entrada', titulo: 'Mi reseña de un juego', slug: 'resena', bloques: [{ tipo: 'texto', texto: 'hola' }], publicadaEn: new Date() };
let h = R.entrada(ctx, { ...e, tituloSeo: 'Reseña de Juego X para Android' });
assert.ok(h.includes('<title>Reseña de Juego X para Android · Kero</title>') && h.includes('<meta property="og:title" content="Reseña de Juego X para Android">'));
assert.ok(h.includes('<h1>Mi reseña de un juego</h1>'), 'el título visible no cambia');
assert.ok(!h.includes('noindex') && h.includes('rel="canonical"'));
h = R.entrada(ctx, { ...e, noindex: true });
assert.ok(h.includes('<meta name="robots" content="noindex, nofollow">') && !h.includes('rel="canonical"'));
assert.ok(R.entrada(ctx, e).includes('<title>Mi reseña de un juego · Kero</title>'), 'sin título SEO, el de la entrada');
console.log('fase3Blog: pruebas OK');
