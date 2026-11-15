// UpGames Blogs · fase 4: apoyar un blog con UpCoins y enlaces de afiliado
'use strict';
const assert = require('assert');
const V = require('../modulos/blogs/validar');
const R = require('../modulos/blogs/render');
const [apoyo, afil] = V.limpiarBloques([
  { tipo: 'apoyo', titulo: '', bTexto: '<b>x</b>' },
  { tipo: 'afiliado', titulo: 'Mi setup', items: [{ nombre: 'Teclado', tienda: 'Amazon', precio: '$50', url: 'https://amzn.to/x', imagen: 'https://a.com/i.png' }, { nombre: 'Sin enlace' }, { nombre: 'Malo', url: 'javascript:alert(1)' }, ...Array.from({ length: 20 }, (_, i) => ({ nombre: `P${i}`, url: 'https://a.com/' + i }))] },
]);
assert.strictEqual(apoyo.titulo, 'Apoya este blog', 'título por defecto');
assert.strictEqual(apoyo.bTexto, 'x');
assert.strictEqual(afil.items.length, 12);
assert.strictEqual(afil.items[0].url, 'https://amzn.to/x');
assert.ok(!afil.items.some(i => /javascript|Sin enlace/.test(i.url + i.nombre)));
assert.deepStrictEqual(V.limpiarBloques([{ tipo: 'afiliado', items: [{ nombre: 'x' }] }]), [], 'sin productos con enlace no hay bloque');
assert.ok(V.enlacesDe([afil]).includes('https://amzn.to/x'), 'los enlaces de afiliado pasan por la revisión');
const html = R.bloquesHtml([apoyo, afil], { blog: { _id: 'b1' }, appUrl: 'https://upgames.games', clic: (u, t) => `/_c?t=${t}&u=${encodeURIComponent(u)}` });
assert.ok(html.includes('href="https://upgames.games/public/biblioteca.html?apoyarBlog=b1"'), 'el apoyo abre UpGames con el blog');
assert.ok(html.includes('Enlaces de afiliado:') && html.includes('rel="sponsored nofollow noopener"'), 'aviso visible y enlaces patrocinados');
assert.ok(html.includes('/_c?t=b&amp;u=https%3A%2F%2Famzn.to%2Fx') && html.includes('Ver en Amazon'));
assert.ok(!R.bloquesHtml([apoyo], {}).includes('apoyarBlog'), 'sin blog (p. ej. pruebas) no hay botón');
console.log('fase4Blog: pruebas OK');
