#!/usr/bin/env node
'use strict';

// Prueba de independencia editorial con la API real y una base desechable.
// --servir conserva la sesión local de la demostración hasta Ctrl+C.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: esperar } = require('node:timers/promises');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongoose').mongo;

const repo = path.join(__dirname, '../..');
const previa = process.argv.includes('--servir');
const puerto = Number(process.env.LURVETA_TEST_PORT || (previa ? 3000 : 10078));
const origen = `http://localhost:${puerto}`;
const clave = 'Lurveta-Demo-2026!';
const texto = (t, extra = {}) => ({ tipo: 'texto', texto: t, ...extra });
const hero = (titulo, texto, imagen, fondo = 'degradado') => ({ tipo: 'heroe', titulo, texto, imagen, fondo, variante: imagen ? 'dividido' : 'centro' });

async function llamar(ruta, metodo = 'GET', cuerpo, sesion) {
    const form = cuerpo instanceof URLSearchParams;
    const respuesta = await fetch(origen + ruta, {
        method: metodo, redirect: 'manual',
        headers: { Origin: origen, ...(cuerpo && !form ? { 'Content-Type': 'application/json' } : {}), ...(sesion ? { Authorization: `Bearer ${sesion}` } : {}) },
        body: cuerpo ? (form ? cuerpo : JSON.stringify(cuerpo)) : undefined,
    });
    const json = (respuesta.headers.get('content-type') || '').includes('application/json');
    return { status: respuesta.status, headers: respuesta.headers, data: json ? await respuesta.json() : await respuesta.text() };
}

async function ok(ruta, m, cuerpo, token) {
    const r = await llamar(ruta, m, cuerpo, token);
    assert.ok(r.status >= 200 && r.status < 300 && r.data?.success !== false, `${m || 'GET'} ${ruta}: ${r.status} ${JSON.stringify(r.data).slice(0, 350)}`);
    return r.data;
}

async function cuenta(db, usuario, bio) {
    const registro = await llamar('/auth/register', 'POST', { usuario, email: `${usuario}@demo.test`, password: clave });
    assert.equal(registro.status, 202, JSON.stringify(registro.data));
    assert.equal(registro.data.token, undefined);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // El correo no se envía en el entorno local. Se conoce el token solo para
    // recorrer la confirmación real sin depender de un proveedor de correo.
    assert.equal((await db.collection('registropendientes').updateOne({ usuario }, { $set: { tokenHash } })).modifiedCount, 1);
    const alta = await llamar('/auth/activar-registro', 'POST', new URLSearchParams({ token }));
    assert.equal(alta.status, 303);
    assert.match(alta.headers.get('location'), /verif=ok/);
    await db.collection('usuarios').updateOne({ usuario }, { $set: { bio } });
    const login = await ok('/auth/login', 'POST', { usuario, password: clave });
    assert.ok(login.token);
    return { usuario, token: login.token };
}

async function sitio(u, direccion, titulo, proposito, temas, tema, descripcion) {
    const { blog } = await ok('/blogs', 'POST', { direccion, titulo, descripcion, proposito, temas, tema, aceptaTerminos: true }, u.token);
    assert.equal(blog.ajustes.proposito, proposito);
    return blog;
}

const guardar = (u, sitio, tipo, titulo, bloques, extra) =>
    ok(`/blogs/${sitio.id}/entradas`, 'POST', { tipo, titulo, bloques, estado: 'publicada', ...extra }, u.token);
const nota = (u, sitio, campos) => ok('/blogs/comunidad/notas', 'POST', { blog: sitio.id, ...campos }, u.token);
const actualizar = (u, sitio, cambios) => ok(`/blogs/${sitio.id}`, 'PUT', cambios, u.token);
const feed = (vista, token, mas = '') => ok(`/blogs/descubrir?vista=${vista}${mas}`, 'GET', null, token);

async function escenarios(db, media) {
    const foto = archivo => `${origen}/__demo/media/${archivo}.jpg`;
    const y = await cuenta(db, 'demo_lola', 'Edito vídeos sobre el oficio de contar historias.');
    const f = await cuenta(db, 'demo_ines', 'Fotógrafa de paisajes y cuadernos de campo.');
    const e = await cuenta(db, 'demo_abril', 'Escribo ensayos sobre las cosas que pasan desapercibidas.');
    const n = await cuenta(db, 'demo_estudio', 'Equipo independiente de diseño para negocios.');
    const d = await cuenta(db, 'demo_teo', 'Documento mis experimentos de programación.');
    const equipo = [y, f, e, n].map(a => a.usuario);
    assert.equal(await db.collection('juegos').countDocuments({ usuario: { $in: equipo } }), 0);

    const canal = await sitio(y, 'demo-fuera-de-cuadro', 'Fuera de cuadro', 'Canal de YouTube', ['Cine', 'Creatividad'], 'vidrio', 'Vídeo, edición y lo que pasa detrás de una buena toma. Demo local.');
    const yInicio = await guardar(y, canal, 'pagina', 'Inicio', [
        hero('Fuera de cuadro', 'Lo que aprendemos al mirar otra vez.', foto('camara')),
        { tipo: 'video', id: 'aqz-KE-bpKQ' }, { tipo: 'articulos', titulo: 'Cuaderno de edición' }, { tipo: 'suscripcion', texto: 'Sigue el canal para leer nuevos artículos.' },
    ]);
    await actualizar(y, canal, { ajustes: { inicio: yInicio.entrada.id, notasEnMenu: true, portada: foto('camara') } });
    const video = await guardar(y, canal, 'entrada', 'Lo que queda fuera del encuadre', [
        texto('Una escena puede empezar en el sonido. Estos son los apuntes de montaje que escribí al comparar tres comienzos para el mismo vídeo.'),
        { tipo: 'video', id: 'aqz-KE-bpKQ' },
    ], { portada: foto('camara'), etiquetas: ['Edición', 'Vídeo'] });
    const yNota = await nota(y, canal, { texto: 'Estoy editando el próximo vídeo. ¿Qué les da más curiosidad del montaje: el sonido o el ritmo?', alcance: 'sitio', etiquetas: ['Edición'] });
    assert.match(await ok('/b/demo-fuera-de-cuadro/'), /youtube-nocookie\.com\/embed\/aqz-KE-bpKQ/);
    assert.match(await ok('/b/demo-fuera-de-cuadro/'), /Lo que queda fuera del encuadre/);
    assert.match((await llamar(new URL(yNota.url).pathname)).headers.get('x-robots-tag'), /noindex/);
    assert.match(await ok('/b/demo-fuera-de-cuadro/notas'), /Estoy editando el próximo/);
    assert.doesNotMatch(await ok('/b/demo-fuera-de-cuadro/sitemap.xml'), /\/n\/|\/notas/);
    await ok(`/usuarios/toggle-seguir/${f.usuario}/${y.usuario}`, 'PUT', undefined, f.token);
    await ok(`/blogs/comunidad/perfiles/${canal.id}/seguir`, 'PUT', { activo: true }, e.token);
    const comentario = await ok(`/blogs/comentarios/${yNota.id}`, 'POST', { texto: 'Me interesa el ritmo. ¿Cómo evalúas un corte?' }, f.token);
    await ok(`/blogs/comentarios/${yNota.id}`, 'POST', { texto: 'Primero veo el corte sin mirar la línea de tiempo.', padre: comentario.comentario.id }, y.token);
    assert.equal((await ok(`/blogs/comentarios/${yNota.id}`)).comentarios[0].padre, comentario.comentario.id);
    assert.equal((await ok(`/blogs/comunidad/perfiles/${canal.id}`, 'GET', null, e.token)).perfil.seguidores, 1);
    await guardar(y, canal, 'entrada', 'Editar con el oído', [texto('Una práctica para escuchar el ritmo de un montaje sin mirar la pantalla.')]);
    for (let intento = 0; intento < 25 && !(await db.collection('notificaciones').findOne({ destinatario: e.usuario, tipo: 'nueva_entrada' })); intento++) await esperar(200);
    assert.ok(await db.collection('notificaciones').findOne({ destinatario: e.usuario, tipo: 'nueva_entrada' }));
    console.log('✓ A · Canal de YouTube, nota visible en el sitio, seguidores, respuestas y aviso editorial');

    const portfolio = await sitio(f, 'demo-luz-en-el-borde', 'Luz en el borde', 'Fotografía', ['Arte', 'Fotografía'], 'claro', 'Paisaje, luz y trabajo en campo. Demo local.');
    const galeria = await guardar(f, portfolio, 'pagina', 'Portafolio', [
        hero('Luz en el borde', 'Paisajes entre la niebla y la primera luz.', foto('valle'), 'suave'),
        { tipo: 'galeria', urls: [foto('valle'), foto('montana')] },
        { tipo: 'formulario', titulo: 'Hablemos de tu proyecto', pideEmail: true },
    ]);
    await actualizar(f, portfolio, { ajustes: { inicio: galeria.entrada.id, portada: foto('valle') } });
    const paginaFoto = await ok('/b/demo-luz-en-el-borde/');
    assert.match(paginaFoto, /class="galeria"/);
    const sello = paginaFoto.match(/name="t" value="([^"]+)"/)?.[1];
    assert.ok(sello);
    await guardar(f, portfolio, 'entrada', 'Un día siguiendo la niebla', [texto('La primera imagen llegó antes de que despejara. Volví al mismo sendero tres veces para observar cómo cambia la luz en el valle.')], { portada: foto('montana'), etiquetas: ['Paisaje'] });
    const fNota = await nota(f, portfolio, { texto: 'Dos mañanas en el valle. La luz cambió antes de que pudiera mover el trípode.', imagenes: [foto('valle'), foto('montana')] });
    const fFeed = await ok(`/blogs/comunidad/publicaciones/${fNota.id}`);
    assert.equal(fFeed.entrada.media[0].tipo, 'galeria');
    assert.doesNotMatch(await ok('/b/demo-luz-en-el-borde/notas'), /Dos mañanas/);
    await esperar(2600);
    const form = await llamar(`/blogs/_form/${galeria.entrada.id}/2`, 'POST', new URLSearchParams({ t: sello, nombre: 'Lector demo', email: 'lector@demo.test', mensaje: 'Me gustaría preguntar por una sesión exterior.' }));
    assert.equal(form.status, 303);
    assert.match(form.headers.get('location'), /f=2-ok/);
    assert.equal((await ok(`/blogs/${portfolio.id}/mensajes`, 'GET', null, f.token)).sinLeer, 1);
    console.log('✓ B · Portafolio, galería, publicación multimedia y entrega real del formulario');

    const editorial = await sitio(e, 'demo-margen-abierto', 'Margen abierto', 'Medio digital', ['Cultura', 'Literatura'], 'revista', 'Ensayos de lectura lenta. Demo local.');
    const largo = await guardar(e, editorial, 'entrada', 'El oficio de hacer preguntas pequeñas', [
        texto('Hay preguntas que cambian de tamaño cuando las escribimos. En el cuaderno caben las que uno descartaría en una reunión: las que empiezan con una duda concreta y terminan al lado de otra.'),
        { tipo: 'titulo', texto: 'Una escena antes que una conclusión' },
        texto('Me gusta guardar una escena completa antes de intentar explicarla. La luz en el pasillo, una pausa a mitad de una frase, la costumbre de volver por el mismo camino. Esos detalles son evidencia de algo que solo a veces puedo nombrar.'),
        { tipo: 'cita', texto: 'En el margen caben las preguntas que todavía no encuentran sitio.' },
        texto('Este método nace de leer despacio. Si cada pregunta se puede sostener por sí misma, la siguiente llega con menos prisa. Una respuesta breve también puede abrir un ensayo largo.'),
    ], { tituloSeo: 'Cómo hacer buenas preguntas pequeñas', resumen: 'Un ensayo sobre la observación, las dudas concretas y la escritura de un cuaderno.', etiquetas: ['Ensayo', 'Cuadernos'], destacada: true });
    const eNota = await nota(e, editorial, { texto: 'Lectura para el fin de semana. ¿Con qué poema empezarían una conversación?', enlace: { url: 'https://www.gutenberg.org/', titulo: 'Project Gutenberg', descripcion: 'Biblioteca de libros electrónicos de acceso libre.' } });
    assert.equal((await ok(`/blogs/comunidad/publicaciones/${eNota.id}`)).entrada.enlace.titulo, 'Project Gutenberg');
    const articulo = await ok('/b/demo-margen-abierto/e/' + largo.entrada.slug);
    assert.match(articulo, /Cómo hacer buenas preguntas pequeñas/);
    assert.ok(articulo.includes(`rel="canonical" href="${largo.url}"`));
    const lectura = await ok(`/blogs/comunidad/publicaciones/${largo.entrada.id}`);
    assert.equal(lectura.entrada.portada, '');
    assert.match(lectura.contenido, /Una escena antes que una conclusión/);
    assert.equal(lectura.externa, false);
    assert.equal((await ok(`/blogs/comunidad/perfiles/${editorial.id}`)).perfil.destacadas[0].id, largo.entrada.id);
    assert.ok((await feed('explorar', null, '&q=' + encodeURIComponent('preguntas pequeñas'))).entradas.some(p => p.id === largo.entrada.id));
    const sinAvisos = await ok(`/blogs/comunidad/perfiles/${canal.id}/seguir`, 'PUT', { activo: true, frecuencia: 'sin-avisos' }, e.token);
    assert.equal(sinAvisos.frecuencia, 'sin-avisos');
    assert.equal((await ok(`/blogs/${editorial.id}/estadisticas`, 'GET', null, e.token)).notas, 1);
    assert.equal((await llamar('/blogs/nexus/ayuda', 'POST', { accion: 'editorial', blog: editorial.id, idea: 'Un calendario editorial de viajes.' }, e.token)).status, 503);
    console.log('✓ C · Artículo sin portada, SEO canónico, lectura integrada, nota de enlace, preferencias y estadísticas');

    const negocio = await sitio(n, 'demo-estudio-umbral', 'Estudio Umbral', 'Negocio', ['Negocios', 'Emprendimiento'], 'claro', 'Diseño e identidad para proyectos pequeños. Demo local.');
    const nInicio = await guardar(n, negocio, 'pagina', 'Inicio', [
        hero('Diseño para negocios que quieren empezar bien', 'Una identidad clara, una web propia y herramientas que tu equipo puede usar.', foto('estudio')),
        { tipo: 'columnas', titulo: 'Servicios', items: [{ titulo: 'Identidad visual', texto: 'Decisiones de marca que funcionan desde el primer día.' }, { titulo: 'Diseño web', texto: 'Sitios accesibles y fáciles de mantener.' }] },
    ]);
    const contacto = await guardar(n, negocio, 'pagina', 'Contacto', [{ tipo: 'formulario', titulo: 'Cuéntanos qué necesitas' }]);
    const equipoPagina = await guardar(n, negocio, 'pagina', 'Equipo', [texto('Somos un estudio independiente de dos personas.')]);
    const nArticulo = await guardar(n, negocio, 'entrada', 'Qué llevamos a la primera reunión', [texto('La primera reunión empieza por tu objetivo, las personas que usarán el sitio y el tiempo que tienes para mantenerlo.')], { portada: foto('estudio') });
    await actualizar(n, negocio, { ajustes: { inicio: nInicio.entrada.id, blogEnMenu: false, paginasMenu: [contacto.entrada.id, equipoPagina.entrada.id], pie: 'Estudio Umbral · Demostración local', portada: foto('estudio') }, monetizar: true });
    const negocioHtml = await ok('/b/demo-estudio-umbral/');
    assert.match(negocioHtml, /Identidad visual/);
    assert.match(negocioHtml, /Estudio Umbral · Demostración local/);
    const menu = negocioHtml.match(/<nav class="menu"[^>]*>(.*?)<\/nav>/)?.[1];
    assert.ok(menu.indexOf('Contacto') < menu.indexOf('Equipo'));
    assert.doesNotMatch(menu, />Blog</);
    assert.match(negocioHtml, /\/_anuncio/);
    assert.match(await ok('/b/demo-estudio-umbral/p/contacto'), /name="mensaje"/);
    console.log('✓ D · Servicios, contacto, página inicial, navegación personalizada y publicidad editorial sin catálogo');

    const dev = await sitio(d, 'demo-bitacora-teo', 'Bitácora de Teo', 'Desarrollo de software', ['Programación', 'Tecnología'], 'vidrio', 'Notas de desarrollo independientes. Demo local.');
    const documentacion = await guardar(d, dev, 'entrada', 'Una guía para empezar con el proyecto', [texto('La documentación comienza con una descripción de los pasos y de cómo recuperar tu trabajo.')]);
    await fs.writeFile(path.join(media, 'proyecto-local.txt'), 'Lurveta · archivo de descarga local para el proyecto de práctica.\n');
    const archivo = `${origen}/__demo/proyecto-local.txt`;
    const { insertedId: juego } = await db.collection('juegos').insertOne({ title: 'Proyecto de práctica local', usuario: d.usuario, status: 'aprobado', category: 'Game', link: archivo, createdAt: new Date() });
    const integrado = await guardar(d, dev, 'entrada', 'Probando el proyecto de práctica', [texto('Puedes consultar la documentación o probar este proyecto separado.'), { tipo: 'juego', id: String(juego) }, { tipo: 'descarga', id: String(juego) }]);
    const descarga = await ok(new URL(integrado.url).pathname);
    assert.ok(descarga.includes(`/public/puente.html?id=${juego}&amp;via=${integrado.entrada.id}`));
    assert.doesNotMatch(await ok(new URL(documentacion.url).pathname), /puente\.html\?id=/);
    const ticket = await ok('/economia/ticket', 'POST', { juegoId: String(juego), via: integrado.entrada.id });
    const intento = { juegoId: String(juego), via: integrado.entrada.id, ticket: ticket.ticket, tieneAdBlocker: false };
    let r = await llamar('/economia/validar-descarga', 'POST', intento);
    if (r.status === 425) {
        await esperar(1000 * (r.data.esperaRestante + 1));
        r = await llamar('/economia/validar-descarga', 'POST', intento);
    }
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.link, archivo);
    assert.match(await ok(new URL(r.data.link).pathname), /archivo de descarga local/);
    assert.equal(r.data.descargaContada, true);
    assert.equal(await db.collection('juegos').countDocuments({ usuario: { $in: equipo } }), 0);
    console.log('✓ E · Documentación generalista y descarga opcional con ticket oficial y contador local');

    for (const titulo of ['Tres maneras de tomar apuntes', 'Cuando una libreta se vuelve archivo', 'Sobre releer al final de una semana', 'Cuatro libros de camino']) {
        await guardar(e, editorial, 'entrada', titulo, [texto('Notas sobre los pequeños cambios que surgen al releer las páginas de un cuaderno.')]);
    }
    const primerLote = await feed('recientes');
    assert.ok(primerLote.siguiente);
    const segundo = await feed('recientes', null, '&cursor=' + encodeURIComponent(primerLote.siguiente));
    assert.ok(segundo.entradas.length > 0 && segundo.entradas.every(x => !primerLote.entradas.some(a => a.id === x.id)));
    const todos = [...primerLote.entradas, ...segundo.entradas];
    assert.ok(todos.some(x => x.id === yNota.id) && todos.some(x => x.id === largo.entrada.id));
    for (const p of todos) assert.ok(!('versiones' in p) && !('bloques' in p));
    const siguiendo = await feed('siguiendo', f.token);
    assert.ok(siguiendo.entradas.length && siguiendo.entradas.every(x => x.usuario === y.usuario));
    assert.deepEqual((await feed('siguiendo', e.token)).entradas.map(x => x.blogId), siguiendo.entradas.map(x => x.blogId));
    assert.ok((await feed('explorar', null, '&tema=fotografia')).entradas.every(x => x.blogId === portfolio.id));

    const inter = `/blogs/comunidad/publicaciones/${yNota.id}/interaccion`;
    assert.equal((await llamar(inter, 'PUT', { tipo: 'gusta', activo: true })).status, 401);
    await Promise.all([ok(inter, 'PUT', { tipo: 'gusta', activo: true }, e.token), ok(inter, 'PUT', { tipo: 'gusta', activo: true }, e.token)]);
    assert.equal((await ok(`/blogs/comunidad/publicaciones/${yNota.id}`)).entrada.gusta, 1);
    await ok(inter, 'PUT', { tipo: 'guardar', activo: true }, e.token);
    assert.equal((await feed('guardados', e.token)).entradas[0].id, yNota.id);
    const republicar = `/blogs/comunidad/publicaciones/${video.entrada.id}/republicar`;
    const republicada = await ok(republicar, 'POST', { blog: editorial.id, texto: 'Me gustó la forma de empezar con el sonido.' }, e.token);
    assert.equal((await llamar(republicar, 'POST', { blog: editorial.id }, e.token)).status, 409);
    assert.equal((await ok(`/blogs/comunidad/publicaciones/${republicada.id}`)).entrada.original.id, video.entrada.id);
    assert.equal((await llamar('/blogs/comunidad/notas', 'POST', { blog: canal.id, texto: 'Sin autorización' }, n.token)).status, 404);
    const reparar = `/blogs/comunidad/publicaciones/${yNota.id}/reportar`;
    await ok(reparar, 'POST', { motivo: 'Comprobación local' }, n.token);
    await ok(reparar, 'POST', { motivo: 'Duplicado de prueba' }, n.token);
    assert.equal(await db.collection('blogreportes').countDocuments({ usuario: n.usuario }), 1);
    assert.equal((await llamar('/blogs/comunidad/notas', 'POST', { blog: canal.id, texto: 'Estoy editando el próximo vídeo. ¿Qué les da más curiosidad del montaje: el sonido o el ritmo?' }, y.token)).status, 409);
    await ok(`/blogs/comunidad/autores/${y.usuario}/silenciar`, 'PUT', { activo: true }, e.token);
    assert.equal((await feed('siguiendo', e.token)).entradas.length, 0);
    await ok(`/blogs/comunidad/autores/${y.usuario}/silenciar`, 'PUT', { activo: false }, e.token);
    const oculto = await guardar(y, canal, 'entrada', 'Una entrada sin indexación', [texto('Este artículo se puede abrir directamente y no aparece en el feed.')], { noindex: true });
    assert.equal((await llamar(`/blogs/comunidad/publicaciones/${oculto.entrada.id}`)).status, 404);
    assert.equal((await llamar(new URL(oculto.url).pathname)).status, 200);
    await actualizar(n, negocio, { visibilidad: 'oculto' });
    assert.equal((await llamar(`/blogs/comunidad/publicaciones/${nArticulo.entrada.id}`)).status, 404);
    await actualizar(n, negocio, { visibilidad: 'publico' });
    // El reporte de la prueba se elimina de la base local antes de dejar el sitio disponible.
    await db.collection('blogreportes').deleteMany({ usuario: n.usuario });
    await db.collection('blogs').updateOne({ direccion: canal.direccion }, { $set: { reportes: 0 } });
    console.log('✓ Comunidad · cursor estable, temática independiente, privacidad, sesión, guardado, reportes y republicación sin duplicados');

    if (previa) {
        const blogs = [canal, portfolio, editorial, negocio, dev];
        const enlaces = [
            ['Feed y compositor', '/public/biblioteca.html?tab=new'],
            ['Experiencia de lectura', `/public/biblioteca.html?tab=new&publicacion=${largo.entrada.id}`],
            ['Perfil editorial', `/public/biblioteca.html?tab=new&perfilBlog=${editorial.id}`],
            ['Post Studio', `/public/blog.html?escribir=1&sitio=${editorial.id}`],
            ['Constructor de sitios', `/public/blog.html?construir=1&sitio=${editorial.id}`],
            ...blogs.map(b => [b.titulo, new URL(b.url).pathname]),
        ];
        await fs.writeFile(path.join(media, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Demostración local de Lurveta Blogs</title>
<style>body{font:1rem/1.55 system-ui;background:#111513;color:#e9eae4;max-width:650px;margin:60px auto;padding:0 20px}h1{font:3rem Georgia}a{color:#9de8b8}</style>
<h1>Demostración local</h1><p>Las cuentas, sitios y publicaciones de esta página son datos de prueba.</p>
<p>Para probar el compositor y los editores, <a href="/login.html?volver=./public/biblioteca.html%3Ftab%3Dnew">inicia sesión</a> como <b>${e.usuario}</b> con la contraseña <b>${clave}</b>.</p>
<ul>${enlaces.map(([nombre, url]) => `<li><a href="${url}">${nombre}</a></li>`).join('')}</ul></html>`);
        await fs.writeFile(path.join(media, 'pruebas.json'), JSON.stringify({ canal, editorial, entrada: largo.entrada.id, nota: yNota.id, cuentas: { e: e.usuario, f: f.usuario } }));
    }
}

async function main() {
    const dir = process.env.LURVETA_PREVIA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'lurveta-editorial-'));
    const mongo = await MongoMemoryServer.create();
    const uri = mongo.getUri('lurveta_editorial_local');
    const cliente = new MongoClient(uri);
    const servidor = spawn(process.execPath, ['index.js'], { cwd: repo, env: {
        PATH: process.env.PATH, NODE_ENV: 'development', MONGODB_URI: uri, JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        PORT: String(puerto), APP_URL: origen, LURVETA_PREVIA_LOCAL: '1', LURVETA_PREVIA_DIR: dir,
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    for (const stream of [servidor.stdout, servidor.stderr]) stream.on('data', d => { log = (log + d).slice(-13000); });
    try {
        let listo = false;
        for (let i = 0; i < 80 && servidor.exitCode == null; i++) {
            await esperar(200);
            try { if ((await llamar('/salud')).status === 200) { listo = true; break; } } catch (_) {}
        }
        assert.ok(listo, log);
        await cliente.connect();
        await escenarios(cliente.db(), dir);
        if (previa) {
            console.log(`Demostración disponible en ${origen}/__demo/`);
            await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM'), once(servidor, 'exit')]);
        }
    } catch (e) { console.error(log); throw e; }
    finally {
        if (servidor.exitCode == null) { servidor.kill('SIGTERM'); await once(servidor, 'exit'); }
        await cliente.close();
        await mongo.stop();
        if (!process.env.LURVETA_PREVIA_DIR) await fs.rm(dir, { recursive: true, force: true });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
