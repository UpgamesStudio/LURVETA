// UpGames Blogs · bloque «Redes y contacto»: lo que escribe el creador → enlace final, y su validación y render
'use strict';
const assert = require('assert');
const R = require('../public/upgames-redes');
const V = require('../modulos/blogs/validar');
const { bloquesHtml } = require('../modulos/blogs/render');

const casos = [
  ['whatsapp', '+57 300 123 4567', 'https://wa.me/573001234567'],
  ['whatsapp', 'https://wa.me/573001234567', 'https://wa.me/573001234567'],
  ['whatsapp', 'hola', ''],
  ['instagram', '@kero.xene', 'https://www.instagram.com/kero.xene'],
  ['instagram', 'instagram.com/kero', 'https://instagram.com/kero'],
  ['x', 'x.com', 'https://x.com/'],
  ['x', '@.malo', ''],
  ['tiktok', '@kero', 'https://www.tiktok.com/@kero'],
  ['email', 'a@b.co', 'mailto:a@b.co'],
  ['email', 'mailto:a@b.co', 'mailto:a@b.co'],
  ['email', 'malo', ''],
  ['telefono', '+57 300 1234567', 'tel:+573001234567'],
  ['telefono', 'tel:+573001234567', 'tel:+573001234567'],
  ['web', 'javascript:alert(1)', ''],
  ['web', 'http://x.com', ''],
  ['web', 'https://a.com/"><script>', ''],
  ['discord', 'discord.gg/abc', 'https://discord.gg/abc'],
  ['nope', 'https://a.com', ''],
];
for (const [red, valor, esperado] of casos) assert.strictEqual(R.normalizar(red, valor), esperado, `${red} «${valor}»`);

// Lo guardado se vuelve a validar igual (idempotente)
for (const [red, valor] of casos) { const u = R.normalizar(red, valor); if (u) assert.strictEqual(R.normalizar(red, u), u, `idempotente: ${red} ${u}`); }

// Validación: descarta redes desconocidas y enlaces malos, limita a 12 y fija el estilo
const [b] = V.limpiarBloques([{ tipo: 'redes', estilo: 'raro', items: [
  { red: 'whatsapp', url: '+57 300 123 4567', texto: '  Escríbeme  ' }, { red: 'web', url: 'javascript:alert(1)' }, { red: 'falsa', url: 'https://a.com' },
  ...Array.from({ length: 20 }, () => ({ red: 'instagram', url: '@kero' })) ] }]);
assert.strictEqual(b.tipo, 'redes');
assert.strictEqual(b.estilo, 'botones');
assert.strictEqual(b.items.length, 12);
assert.deepStrictEqual(b.items[0], { red: 'whatsapp', url: 'https://wa.me/573001234567', texto: 'Escríbeme' });
assert.deepStrictEqual(V.limpiarBloques([{ tipo: 'redes', items: [{ red: 'web', url: 'nada' }] }]), []);

// Render: enlace y nombre escapados; el flotante usa solo el primero
const html = bloquesHtml([{ tipo: 'redes', estilo: 'botones', items: [{ red: 'email', url: 'mailto:a@b.co', texto: '<b>hola</b>' }] }], {});
assert.ok(html.includes('href="mailto:a@b.co"') && html.includes('&lt;b&gt;hola') && !html.includes('<b>hola'));
const flota = bloquesHtml([{ tipo: 'redes', estilo: 'flotante', items: [{ red: 'whatsapp', url: 'https://wa.me/1', texto: '' }, { red: 'x', url: 'https://x.com/a', texto: '' }] }], {});
assert.ok(flota.includes('red-flota') && flota.includes('wa.me/1') && !flota.includes('x.com/a'));

// Los enlaces https de las redes pasan por la revisión de enlaces; mailto/tel no
assert.deepStrictEqual(V.enlacesDe([{ tipo: 'redes', items: [{ red: 'x', url: 'https://x.com/a' }, { red: 'email', url: 'mailto:a@b.co' }] }]), ['https://x.com/a']);

console.log('redesBlog: pruebas OK');
