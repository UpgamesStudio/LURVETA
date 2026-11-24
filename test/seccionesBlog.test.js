// Lurveta Blogs · secciones de landing (héroe, columnas, precios, testimonios, CTA), inicio como landing y Nexus asistente
'use strict';
const assert = require('assert');
const V = require('../modulos/blogs/validar');
const R = require('../modulos/blogs/render');
const E = require('../modulos/blogs/escritor');

// ── Validación: campos limpios, opciones cerradas, botones solo con enlace válido ──
const [heroe, col, pre, tes, cta] = V.limpiarBloques([
  { tipo: 'heroe', titulo: '  Barbería <b>Kero</b> ', texto: 'Cortes', bTexto: 'Reserva', bUrl: 'wa.me/573001234567', b2Texto: 'Ver', b2Url: 'javascript:alert(1)', variante: 'rara', fondo: 'neon', espacio: 'gigante', alinear: 'derecha', imagen: 'http://x.com/a.png' },
  { tipo: 'columnas', titulo: 'Servicios', variante: '2', items: [{ icono: '✂️💈🔥🎯🧔', titulo: 'Corte', texto: 'Moderno' }, {}, ...Array.from({ length: 9 }, () => ({ titulo: 'x' }))] },
  { tipo: 'precios', items: [{ nombre: 'Básico', precio: '$20', items: 'a\nb', bTexto: 'Pedir', bUrl: 'https://a.com', destacado: 'sí' }, { nombre: '' }], fondo: 'imagen', fondoImg: 'https://res.cloudinary.com/x/image/upload/a.jpg' },
  { tipo: 'testimonios', items: [{ texto: 'Excelente', nombre: 'Ana' }, { texto: 'sin nombre' }] },
  { tipo: 'cta', titulo: '¿Listo?', bTexto: 'Escríbeme', bUrl: 'https://wa.me/573001234567', fondo: 'acento' },
  { tipo: 'heroe', titulo: '' }, { tipo: 'testimonios', items: [{ texto: 'x' }] },
]);
assert.strictEqual(heroe.titulo, 'Barbería Kero');
assert.strictEqual(heroe.bUrl, 'https://wa.me/573001234567');
assert.strictEqual(heroe.b2Url, '');
assert.strictEqual(heroe.imagen, '');
assert.deepStrictEqual([heroe.variante, heroe.fondo, heroe.espacio, heroe.alinear], ['centro', '', 'normal', 'centro']);
assert.strictEqual(col.items.length, 6);
assert.strictEqual(col.items[0].icono, '✂️', 'primer emoji completo');
assert.strictEqual(col.variante, '2');
assert.strictEqual(pre.items.length, 1);
assert.strictEqual(pre.items[0].destacado, true);
assert.strictEqual(pre.fondo, 'imagen');
assert.strictEqual(tes.items.length, 1);
assert.strictEqual(cta.fondo, 'acento');
assert.strictEqual(V.limpiarBloques([{ tipo: 'precios', fondo: 'imagen', items: [{ nombre: 'a' }] }])[0].fondo, '', 'fondo imagen sin imagen → sin fondo');

// Moderación y revisión de enlaces ven el texto y los botones de las secciones
assert.ok(V.textoDe([tes, pre]).includes('Excelente') && V.textoDe([pre]).includes('Básico'));
assert.deepStrictEqual(V.enlacesDe([heroe, pre, cta]), ['https://wa.me/573001234567', 'https://a.com/', 'https://wa.me/573001234567']);

// ── Render: escapado, variantes, fondo, botones ──
const html = R.bloquesHtml([heroe, col, pre, tes, cta], {});
assert.ok(html.includes('<section class="sec sec-heroe'));
assert.ok(html.includes('Barbería Kero') && !html.includes('<b>Kero'));
assert.ok(html.includes('href="https://wa.me/573001234567"'));
assert.ok(!html.includes('javascript:'));
assert.ok(html.includes('c-2') && html.includes('plan destacado') && html.includes('Recomendado'));
assert.ok(html.includes("--sec-img:url('https://res.cloudinary.com/x/image/upload/f_auto,q_auto,w_1800,c_limit/a.jpg')"));
assert.ok(html.includes('class="testi-ini" aria-hidden="true">A<'));
assert.ok(html.includes('sec sec-cta f-acento'));
const div = R.bloquesHtml(V.limpiarBloques([{ tipo: 'heroe', titulo: 'T', variante: 'dividido', imagen: 'https://a.com/i.png' }, { tipo: 'heroe', titulo: 'T', variante: 'fondo', imagen: 'https://a.com/i.png' }]), {});
assert.ok(div.includes('h-dividido') && div.includes('h-fondo') && div.includes('f-imagen'));

// ── Landing: una página que empieza con sección no lleva título arriba; como inicio, ruta «/» ──
const ctx = { blog: { _id: 'b1', titulo: 'Kero', tema: 'neon', ajustes: { inicio: 'p1' }, direccion: 'kero', usuario: 'kero', visibilidad: 'publico' }, base: '/b/kero', origen: 'https://lurveta.com', appUrl: 'https://lurveta.com',
  paginas: [{ _id: 'p1', titulo: 'Inicio landing', slug: 'inicio' }, { _id: 'p2', titulo: 'Contacto', slug: 'contacto' }], populares: [], nube: [], autor: null, juegos: {}, hayEntradas: true };
const pag = { _id: 'p1', tipo: 'pagina', titulo: 'Inicio landing', slug: 'inicio', bloques: [heroe, cta] };
const casa = R.entrada(ctx, pag, { inicio: true });
assert.ok(casa.includes('<main class="landing sin-final">'));
assert.ok(casa.includes('<h1 class="oculto">Inicio landing</h1>'));
assert.ok(casa.includes('<link rel="canonical" href="https://lurveta.com/b/kero/">'));
assert.ok(casa.includes('href="/b/kero/blog"'), 'menú con «Blog» cuando el inicio es una landing');
assert.ok(!casa.includes('href="/b/kero/p/inicio"'), 'la página de inicio no se repite en el menú');
assert.ok(casa.includes('href="/b/kero/p/contacto"'));
const normal = R.entrada({ ...ctx, blog: { ...ctx.blog, ajustes: {} } }, { ...pag, bloques: [{ tipo: 'texto', texto: 'hola' }] });
assert.ok(normal.includes('<header><h1>Inicio landing</h1>') && !normal.includes('class="landing'));
const listaBlog = R.inicio(ctx, { entradas: [], enBlog: true });
assert.ok(listaBlog.includes('<title>Blog · Kero</title>') && listaBlog.includes('href="/b/kero/blog" class="activo"'));

// ── Nexus: landing (solo tipos permitidos, empieza con héroe, añade contacto) y sección ──
const wa = { items: [{ red: 'whatsapp', url: 'https://wa.me/573001234567', texto: 'Escríbenos por WhatsApp' }] };
const o = { titulo: 'Barbería', resumen: 'Cortes', bloques: [
  { tipo: 'heroe', titulo: 'Tu mejor corte', bTexto: 'Reserva' }, { tipo: 'columnas', items: [{ icono: '✂️', titulo: 'Corte' }] },
  { tipo: 'imagen', url: 'https://a.com/x.png' }, { tipo: 'redes', items: [{ red: 'x', url: '@a' }] }, { tipo: 'cta', titulo: '¿Listo?', bTexto: 'Escríbenos' }] };
const L = E.armarLanding(o, wa);
assert.deepStrictEqual(L.bloques.map(b => b.estilo === 'flotante' ? 'flotante' : b.tipo), ['heroe', 'columnas', 'redes', 'cta', 'flotante']);
assert.strictEqual(L.bloques[0].bUrl, 'https://wa.me/573001234567', 'los botones principales llevan al WhatsApp');
assert.strictEqual(L.bloques[3].bUrl, 'https://wa.me/573001234567');
assert.strictEqual(E.armarLanding({ bloques: [{ tipo: 'texto', texto: 'a' }, { tipo: 'cta', titulo: 'x' }, { tipo: 'heroe', titulo: 'y' }] }), null, 'debe empezar con héroe');
assert.strictEqual(E.armarLanding(null), null);
assert.deepStrictEqual(E.armarLanding({ bloques: [{ tipo: 'heroe', titulo: 'a' }, { tipo: 'texto', texto: 'b' }, { tipo: 'cta', titulo: 'c' }] }).bloques.length, 3);
assert.strictEqual(E.armarSeccion({ titulo: 'Planes', items: [{ nombre: 'Pro', precio: '[precio]' }] }, 'precios').items[0].precio, '[precio]');
assert.strictEqual(E.armarSeccion({ tipo: 'texto', texto: 'colado' }, 'precios'), null, 'el tipo lo decide el pedido, no el modelo');
assert.ok(E.SISTEMA_LANDING.includes('NO inventes precios') && E.SISTEMA_SECCION.includes('testimonios'));
assert.ok(Object.keys(E.ACCIONES_TEXTO).includes('ortografia'));


// ── Fuentes de visitas (panel de estadísticas) ──
const { categoriaFuente: cf } = require('../rutas/blogs');
assert.strictEqual(cf(''), 'rd');
assert.strictEqual(cf('https://www.google.com.co/search'), 'rb');
assert.strictEqual(cf('https://l.facebook.com/l.php'), 'rs');
assert.strictEqual(cf('https://t.co/abc'), 'rs');
assert.strictEqual(cf('https://box.com/x'), 'ro');
assert.strictEqual(cf('https://fbi.gov/'), 'ro');
assert.strictEqual(cf('https://kero.com/p/x', 'kero.com'), '', 'navegar dentro del blog no cuenta');
assert.strictEqual(cf('https://lurveta.com/b/kero/e/a', 'lurveta.com', '/b/kero'), '');
assert.strictEqual(cf('https://lurveta.com/public/biblioteca.html', 'lurveta.com', '/b/kero'), 'ru');

// ── Retoque de diseño de Nexus: héroe amplio, CTA con color, fondos alternos ──
const pul = E.pulirSecciones(V.limpiarBloques([{ tipo: 'heroe', titulo: 'a' }, { tipo: 'columnas', fondo: 'suave', items: [{ titulo: 'x' }] }, { tipo: 'precios', fondo: 'suave', items: [{ nombre: 'p' }] }, { tipo: 'texto', texto: 't' }, { tipo: 'cta', titulo: 'c' }]));
assert.deepStrictEqual(pul.map(b => b.fondo), ['degradado', 'suave', '', undefined, 'acento']);
assert.strictEqual(pul[0].espacio, 'amplio');
// El ejemplo de las instrucciones es JSON válido (si no, el modelo aprende JSON roto)
assert.ok(JSON.parse(E.SISTEMA_LANDING.match(/\{"titulo":"Estudio[\s\S]*\]\}/)[0]).bloques.length >= 5);

console.log('seccionesBlog: pruebas OK');
