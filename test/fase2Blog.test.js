// Lurveta Blogs · fase 2: formulario de contacto, catálogo con pedido por WhatsApp, clics contados y kit de marca
'use strict';
const assert = require('assert');
const V = require('../modulos/blogs/validar');
const R = require('../modulos/blogs/render');
const T = require('../modulos/blogs/temas');

// ── Catálogo: precio numérico (para el total), WhatsApp obligatorio, moneda cerrada ──
const [cat] = V.limpiarBloques([{ tipo: 'catalogo', whatsapp: '+57 300 123 4567', moneda: 'XXX', items: [
  { nombre: 'Torta', precio: '$25.000', imagen: 'https://res.cloudinary.com/x/image/upload/t.jpg' }, { nombre: 'Café', precio: '4,50' }, { nombre: 'Combo', precio: '1.250.000' }, { nombre: 'Consultar', precio: '' }, { nombre: '' },
  ...Array.from({ length: 40 }, (_, i) => ({ nombre: `P${i}` })) ] }]);
assert.strictEqual(cat.whatsapp, 'https://wa.me/573001234567');
assert.strictEqual(cat.moneda, 'COP');
assert.deepStrictEqual(cat.items.slice(0, 4).map(i => i.precio), [25000, 4.5, 1250000, 0]);
assert.strictEqual(cat.items.length, 30);
assert.deepStrictEqual(V.limpiarBloques([{ tipo: 'catalogo', whatsapp: 'hola', items: [{ nombre: 'a' }] }]), [], 'sin WhatsApp válido no hay catálogo');
assert.ok(V.enlacesDe([cat]).includes('https://wa.me/573001234567'), 'el WhatsApp pasa por la revisión de enlaces');

// ── Formulario: siempre nombre y mensaje; correo por defecto, teléfono opcional ──
const [form] = V.limpiarBloques([{ tipo: 'formulario', titulo: 'Escríbenos', pideTel: 1 }]);
assert.deepStrictEqual([form.bTexto, form.pideEmail, form.pideTel], ['Enviar mensaje', true, true]);

// ── Render: acción hacia la API, sello anti-bots, campo trampa, resultados ok/err/lim, total en el servidor ──
const ctx = { accion: (t, i) => `https://api.upgames/blogs/_${t}/e1/${i}`, sello: () => 'abc.123', clic: (u, t) => `/_c?t=${t}&u=${encodeURIComponent(u)}&k=x` };
let html = R.bloquesHtml([form, cat], ctx);
assert.ok(html.includes('action="https://api.upgames/blogs/_form/e1/0"') && html.includes('action="https://api.upgames/blogs/_pedido/e1/1"'));
assert.ok(html.includes('name="t" value="abc.123"') && html.includes('class="trampa" name="web"'));
assert.ok(html.includes('name="telefono"') && html.includes('name="email"') && html.includes('name="mensaje" required'));
assert.ok(/\$\s?25\.000/.test(html) && html.includes('Consultar') && html.includes('name="c0"') && html.includes('name="solo" value="0"'));
assert.ok(R.bloquesHtml([form], { ...ctx, formRes: { i: 0, r: 'ok' } }).includes('form-ok'));
assert.ok(R.bloquesHtml([form], { ...ctx, formRes: { i: 0, r: 'lim' } }).includes('varios mensajes seguidos'));
assert.ok(R.bloquesHtml([cat], { ...ctx, formRes: { i: 0, r: 'vacio' } }).includes('Elige al menos un producto'));
assert.ok(R.bloquesHtml([form], {}).includes('action="#"') && R.bloquesHtml([form], {}).includes(' disabled'), 'en la vista previa el formulario no envía');

// ── Clics: los enlaces https salen por la redirección firmada (WhatsApp, redes, botones); mailto/tel no ──
html = R.bloquesHtml(V.limpiarBloques([
  { tipo: 'redes', items: [{ red: 'whatsapp', url: '+573001234567' }, { red: 'instagram', url: '@kero' }, { red: 'email', url: 'a@b.co' }] },
  { tipo: 'boton', texto: 'Ir', url: 'https://tienda.com' }, { tipo: 'cta', titulo: 'Ya', bTexto: 'Escribir', bUrl: 'wa.me/573001234567' }]), ctx);
assert.strictEqual((html.match(/\/_c\?t=w/g) || []).length, 2);
assert.ok(html.includes('/_c?t=r&amp;u=https%3A%2F%2Fwww.instagram.com%2Fkero') && html.includes('/_c?t=b&amp;u=https%3A%2F%2Ftienda.com'));
assert.ok(html.includes('href="mailto:a@b.co"'));
assert.ok(!R.bloquesHtml(V.limpiarBloques([{ tipo: 'boton', texto: 'Ir', url: 'https://tienda.com' }]), {}).includes('/_c'), 'sin ctx.clic, enlace directo');

// ── Kit de marca: color secundario y letra del texto llegan a las variables del sitio ──
const pag = R.entrada({ blog: { _id: 'b', titulo: 'K', tema: 'claro', ajustes: { acento: '#123456', acento2: '#abcdef', fuente: 'poppins', fuenteTexto: 'lora' }, direccion: 'k', usuario: 'k', visibilidad: 'publico' }, base: '', origen: 'https://k.com', appUrl: 'https://upgames.games', paginas: [], juegos: {} }, { _id: 'e', tipo: 'pagina', titulo: 'x', slug: 'x', bloques: [] });
assert.ok(pag.includes('--acento:#123456') && pag.includes('--acento2:#abcdef'));
assert.ok(pag.includes("--f-tit:'Poppins'") && pag.includes("--f-txt:'Lora'") && pag.includes('family=Poppins') && pag.includes('family=Lora'));
for (const id of ['poppins', 'montserrat', 'inter', 'grotesk', 'lora']) assert.ok(T.FUENTES[id]?.google, id);

console.log('fase2Blog: pruebas OK');
