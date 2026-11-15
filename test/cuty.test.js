// Acortador de anuncios (Cuty): mismo enlace que su script de página completa, y nunca para enlaces de UpGames
'use strict';
const assert = require('assert');
const C = require('../public/upgames-cuty');
// Fórmula de cdn.cuty.io/fps.js: base64(utf8(rot13(url)))
const fps = u => `https://cuty.io/fps?token=${C.TOKEN}&data=${btoa(String.fromCharCode(...new TextEncoder().encode(C.rot13(u))))}`;
for (const u of ['https://www.mediafire.com/file/abc/Juego_ñ.zip/file', 'https://mega.nz/file/X#k', 'http://drive.google.com/x?id=1&a=b']) {
  assert.strictEqual(C.enlace(u), fps(u), u);
  assert.strictEqual(C.rot13(Buffer.from(C.enlace(u).split('data=')[1], 'base64').toString('utf8')), u, 'se decodifica al enlace original');
}
for (const u of ['https://upgames.games/public/x', 'https://upgames-production.up.railway.app/descargas/x', 'https://cuty.io/abc', 'javascript:alert(1)', 'nada'])
  assert.strictEqual(C.enlace(u), u, `no se acorta: ${u}`);
console.log('cuty: pruebas OK');
