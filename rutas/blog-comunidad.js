'use strict';

const crypto = require('node:crypto');
const V = require('../modulos/blogs/validar');
const R = require('../modulos/blogs/render');
const D = require('../modulos/blogs/descubrir');

const VISTAS = new Set(['todo', 'siguiendo', 'explorar', 'populares', 'recientes', 'guardados', 'perfil']);
const TIPOS = ['entrada', 'nota', 'republicacion'];
const referencias = lista => [...new Set(lista.filter(Boolean).map(String))];

function registrar(app, {
    Blog, Entrada, BlogInteraccion, BlogReporte, Usuario, Comentario, mongoose, verificarToken, Limites, CeroTolerancia,
    crearNotif, revisar, revisarConIA, enlaceProhibido, olvidar, fallo, urlPublica, APP_URL, juegosDe, contarVista,
}) {
    const { ObjectId } = mongoose.Types;
    const idOk = x => typeof x === 'string' && /^[a-f0-9]{24}$/i.test(x);
    const ahora = () => new Date();
    const publico = { estado: 'activo', visibilidad: 'publico' };
    const disponible = fecha => ({
        tipo: { $in: TIPOS }, publicadaEn: { $lte: fecha },
        $or: [{ estado: 'publicada' }, { estado: 'programada' }],
        $nor: [{ tipo: 'entrada', noindex: true }],
    });
    const campos = 'blog tipo destacada usuario titulo slug portada resumen bloques publicadaEn vistas etiquetas original enlace alcance';
    const rutaLectura = id => `${APP_URL}/public/biblioteca.html?tab=new&publicacion=${id}`;
    const urlEntrada = (e, b) => e.tipo === 'entrada' ? `${urlPublica(b)}e/${e.slug}`
        : e.tipo === 'nota' && e.alcance === 'sitio' ? `${urlPublica(b)}n/${e.slug}` : rutaLectura(e._id);
    const media = e => (e.bloques || []).filter(b => ['imagen', 'galeria', 'video'].includes(b.tipo));
    const selectPerfil = 'usuario avatar banner bio listaSeguidores';
    const avatar = u => V.urlSegura(u?.avatar);
    const error = (res, codigo, error) => res.status(codigo).json({ success: false, error });
    const envuelve = (nombre, fn) => async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
        try { await fn(req, res); } catch (e) { fallo(res, e, nombre); }
    };

    async function lector(req) {
        const usuario = req.sesion?.datos?.usuario;
        const u = usuario ? await Usuario.findOne({ usuario }).select('usuario siguiendo bloqueados').lean() : null;
        if (!u) return { usuario: '', siguiendo: [], ocultos: [], sitios: [], guardados: [], intereses: [] };
        const [bloqueos, relaciones] = await Promise.all([
            Usuario.find({ bloqueados: usuario }).select('usuario').lean(),
            BlogInteraccion.find({ usuario, tipo: { $in: ['seguir', 'guardar', 'silenciar'] } }).select('tipo objetivo').lean(),
        ]);
        const objetivos = tipo => relaciones.filter(r => r.tipo === tipo).map(r => r.objetivo);
        const sitios = objetivos('seguir'), guardados = objetivos('guardar'), silenciados = objetivos('silenciar');
        const [blogs, autores] = await Promise.all([
            Blog.find({ _id: { $in: sitios }, ...publico }).select('ajustes.temas').lean(),
            Usuario.find({ _id: { $in: silenciados } }).select('usuario').lean(),
        ]);
        return { usuario, siguiendo: u.siguiendo || [], sitios, guardados,
            ocultos: referencias([...(u.bloqueados || []), ...bloqueos.map(b => b.usuario), ...autores.map(b => b.usuario)]),
            intereses: referencias(blogs.flatMap(b => b.ajustes?.temas || [])) };
    }

    async function obtenerPublicacion(id, yo) {
        if (!idOk(id)) return null;
        const e = await Entrada.findOne({ _id: id, ...disponible(ahora()), usuario: { $nin: yo.ocultos } }).select(campos).lean();
        const b = e && await Blog.findOne({ _id: e.blog, ...publico }).lean();
        if (!b) return null;
        let original;
        if (e.tipo === 'republicacion') {
            original = e.original && await obtenerOriginal(e.original, yo);
            if (!original) return null;
        }
        return { e, b, original };
    }

    async function obtenerOriginal(id, yo) {
        const e = await Entrada.findOne({ _id: id, ...disponible(ahora()), tipo: { $in: ['entrada', 'nota'] }, usuario: { $nin: yo.ocultos } }).select(campos).lean();
        const b = e && await Blog.findOne({ _id: e.blog, ...publico }).lean();
        return b ? { e, b } : null;
    }

    // Conversación, me gusta, republicaciones y perfil de los autores de un conjunto de entradas
    async function senales(ids, autores, yo) {
        const ref = ids.map(id => `blog:${id}`);
        const [usuarios, conversaciones, reacciones, republicaciones] = await Promise.all([
            Usuario.find({ usuario: { $in: autores } }).select('usuario avatar planHasta').lean(),
            Comentario.aggregate([{ $match: { itemId: { $in: ref }, usuario: { $nin: yo.ocultos } } }, { $group: { _id: '$itemId', n: { $sum: 1 } } }]),
            BlogInteraccion.aggregate([{ $match: { objetivo: { $in: ids }, tipo: 'gusta' } }, { $group: { _id: '$objetivo', n: { $sum: 1 } } }]),
            Entrada.aggregate([{ $match: { original: { $in: ids }, estado: 'publicada', tipo: 'republicacion' } },
                { $lookup: { from: Blog.collection.name, localField: 'blog', foreignField: '_id', as: 'sitio' } },
                { $match: { 'sitio.estado': 'activo', 'sitio.visibilidad': 'publico' } }, { $group: { _id: '$original', n: { $sum: 1 } } }]),
        ]);
        const n = lista => new Map(lista.map(r => [String(r._id), r.n]));
        return { perfil: new Map(usuarios.map(u => [u.usuario, u])), com: n(conversaciones), likes: n(reacciones), reposts: n(republicaciones) };
    }

    async function tarjetas(items, yo) {
        const autores = referencias(items.flatMap(({ e, original }) => [e.usuario, original?.e.usuario]));
        const ids = items.map(({ e }) => e._id);
        const [{ perfil, com, likes, reposts }, propias] = await Promise.all([
            senales(ids, autores, yo),
            yo.usuario ? BlogInteraccion.find({ usuario: yo.usuario, objetivo: { $in: ids }, tipo: { $in: ['gusta', 'guardar'] } }).select('objetivo tipo').lean() : [],
        ]);
        const propiasSet = new Set(propias.map(r => `${r.objetivo}:${r.tipo}`));
        const sitios = new Set(yo.sitios.map(String));
        function resumir(e, b) {
            const id = String(e._id), blogId = String(b._id), u = perfil.get(e.usuario);
            const texto = V.textoDe(e.bloques || []);
            return {
                id, blogId, blog: b.titulo, tipo: e.tipo, usuario: e.usuario, avatar: avatar(u), fecha: e.publicadaEn, url: urlEntrada(e, b),
                titulo: e.titulo || '', destacada: e.destacada === true, resumen: e.resumen || V.resumen(e.bloques, 210),
                portada: e.tipo === 'entrada' ? V.urlSegura(e.portada || V.primeraImagen(e.bloques)) : '',
                texto: e.tipo === 'entrada' ? '' : (e.bloques || []).find(x => x.tipo === 'texto')?.texto || '',
                media: e.tipo === 'nota' ? media(e) : [], enlace: e.enlace?.url ? e.enlace : null,
                etiquetas: (e.etiquetas || []).slice(0, 6), temas: b.ajustes?.temas || [],
                lectura: e.tipo === 'entrada' ? Math.max(1, Math.ceil(texto.trim().split(/\s+/).length / 220)) : null,
                vistas: e.vistas || 0, comentarios: com.get(`blog:${id}`) || 0, gusta: likes.get(id) || 0, republicaciones: reposts.get(id) || 0,
                meGusta: propiasSet.has(`${id}:gusta`), guardada: propiasSet.has(`${id}:guardar`),
                sigoAutor: yo.siguiendo.includes(e.usuario), sigoBlog: sitios.has(blogId), propia: yo.usuario === e.usuario,
                premium: !!(u?.planHasta && new Date(u.planHasta) > ahora()),
            };
        }
        return items.map(({ e, b, original }) => ({ ...resumir(e, b), original: original ? resumir(original.e, original.b) : null }));
    }

    function cursorDe(valor, clave) {
        if (!valor || typeof valor !== 'string' || valor.length > 400) return null;
        try {
            const c = JSON.parse(Buffer.from(valor, 'base64url').toString());
            if (!idOk(c.id) || c.clave !== clave || !Number.isFinite(c.fecha) || !Number.isFinite(c.corte) || c.fecha > c.corte || c.corte > Date.now()) return null;
            return { ...c, id: new ObjectId(c.id), fecha: new Date(c.fecha), corte: new Date(c.corte) };
        } catch (_) { return null; }
    }

    // Vistas por relevancia: el orden sale de un conjunto representativo (las más leídas ∪ las más recientes de la
    // ventana), no de un lote cronológico de 12. El cursor guarda el valor y el id de la última entrada y la
    // normalización de la primera página: la página siguiente sigue el mismo orden y no repite entradas.
    const RANKEADAS = { todo: 90, explorar: 365, populares: 30 };   // ventana en días
    const POOL = 300;
    function cursorValor(valor, clave) {
        if (!valor || typeof valor !== 'string' || valor.length > 400) return null;
        try {
            const c = JSON.parse(Buffer.from(valor, 'base64url').toString());
            if (c.clave !== clave || c.r !== 1 || !idOk(c.id) || ![c.v, c.corte, c.mv, c.mc].every(Number.isFinite) || c.corte > Date.now()) return null;
            return c;
        } catch (_) { return null; }
    }
    async function feedRelevancia(req, res, { vista, yo, filtro, blogFiltro, clave, limite }) {
        const cursor = req.query.cursor ? cursorValor(req.query.cursor, clave) : null;
        if (req.query.cursor && !cursor) return error(res, 400, 'El cursor no es válido.');
        const corte = cursor ? new Date(cursor.corte) : ahora();
        const f = { ...filtro, ...disponible(corte), usuario: filtro.usuario };
        f.publicadaEn = { $lte: corte, $gte: new Date(Number(corte) - RANKEADAS[vista] * 864e5) };
        const lookup = [{ $lookup: { from: Blog.collection.name, localField: 'blog', foreignField: '_id', as: 'sitio' } }, { $unwind: '$sitio' }, { $match: blogFiltro }];
        const proyeccion = { $project: { _id: 1, usuario: 1, tipo: 1, publicadaEn: 1, vistas: 1, resumen: 1, etiquetas: 1, 'sitio.ajustes.temas': 1 } };
        const [masLeidas, recientes] = await Promise.all([{ vistas: -1, _id: -1 }, { publicadaEn: -1, _id: -1 }]
            .map(orden => Entrada.aggregate([{ $match: f }, { $sort: orden }, ...lookup, { $limit: POOL }, proyeccion]).allowDiskUse(true)));
        const pool = [...new Map([...masLeidas, ...recientes].map(e => [String(e._id), e])).values()];
        const { perfil, com, likes, reposts } = await senales(pool.map(e => e._id), referencias(pool.map(e => e.usuario)), yo);
        const candidatos = pool.map(e => { const id = String(e._id), u = perfil.get(e.usuario);
            return { id, usuario: e.usuario, fecha: e.publicadaEn, vistas: e.vistas || 0, comentarios: com.get(`blog:${id}`) || 0, gusta: likes.get(id) || 0,
                republicaciones: reposts.get(id) || 0, premium: !!(u?.planHasta && new Date(u.planHasta) > corte), temas: e.sitio?.ajustes?.temas || [],
                resumen: e.resumen || e.tipo === 'entrada', etiquetas: e.etiquetas || [] }; })
            .sort((a, b) => (a.id < b.id ? 1 : -1));   // orden total: valor ↓ y, a igual valor, id ↓
        const n = cursor ? { maxVistas: cursor.mv, maxCom: cursor.mc } : { maxVistas: Math.max(0, ...candidatos.map(e => e.vistas)), maxCom: Math.max(0, ...candidatos.map(e => e.comentarios)) };
        let orden = D.rankear(candidatos, { vista, ahora: Number(corte), siguiendo: yo.siguiendo, intereses: yo.intereses, n });
        if (cursor) orden = orden.filter(x => x.valor < cursor.v - 1e-12 || (Math.abs(x.valor - cursor.v) <= 1e-12 && x.e.id < cursor.id));
        const pagina = orden.slice(0, limite), ultimo = pagina.at(-1);
        const docs = await Entrada.aggregate([{ $match: { _id: { $in: pagina.map(x => new ObjectId(x.e.id)) } } }, ...lookup,
            { $project: { ...Object.fromEntries(campos.split(' ').map(k => [k, 1])), 'sitio._id': 1, 'sitio.titulo': 1, 'sitio.direccion': 1,
                'sitio.dominio.nombre': 1, 'sitio.dominio.verificado': 1, 'sitio.ajustes.temas': 1 } }]);
        const porId = new Map(docs.map(e => [String(e._id), e]));
        const items = await Promise.all(pagina.map(x => porId.get(x.e.id)).filter(Boolean)
            .map(async e => ({ e, b: e.sitio, original: e.original ? await obtenerOriginal(e.original, yo) : null })));
        const entradas = D.alternarAutores(await tarjetas(items.filter(x => x.e.tipo !== 'republicacion' || x.original), yo));
        const siguiente = orden.length > limite ? Buffer.from(JSON.stringify({ r: 1, clave, v: ultimo.valor, id: ultimo.e.id, corte: Number(corte), mv: n.maxVistas, mc: n.maxCom })).toString('base64url') : null;
        res.json({ success: true, entradas, siguiente, conSesion: !!yo.usuario });
    }

    async function feed(req, res) {
        const vista = VISTAS.has(req.query.vista) ? req.query.vista : 'todo';
        const yo = await lector(req), tema = V.slug(req.query.tema, 40);
        const blogId = idOk(req.query.blog) ? req.query.blog : '';
        if (vista === 'perfil' && !blogId) return error(res, 400, 'Elige un sitio editorial.');
        const consulta = vista === 'explorar' ? V.linea(req.query.q, 80).replace(/[^\p{L}\p{N} -]/gu, ' ').trim() : '';
        const clave = crypto.createHash('sha256').update(JSON.stringify([vista, tema, blogId, consulta])).digest('base64url').slice(0, 18);
        const relevancia = !!RANKEADAS[vista];
        const cursor = relevancia ? null : cursorDe(req.query.cursor, clave);
        if (!relevancia && req.query.cursor && !cursor) return error(res, 400, 'El cursor no es válido.');
        const corte = cursor?.corte || ahora(), limite = 12;
        const filtro = { ...disponible(corte), usuario: { $nin: yo.ocultos } };
        if (vista === 'siguiendo') filtro.$and = [{ $or: [{ usuario: { $in: yo.siguiendo } }, { blog: { $in: yo.sitios } }] }];
        if (vista === 'guardados') filtro._id = { $in: yo.guardados };
        if (vista === 'perfil') filtro.blog = new ObjectId(blogId);
        if (vista === 'populares') filtro.publicadaEn.$gte = new Date(Number(corte) - 30 * 864e5);
        if (cursor) (filtro.$and ||= []).push({ $or: [{ publicadaEn: { $lt: cursor.fecha } }, { publicadaEn: cursor.fecha, _id: { $lt: cursor.id } }] });
        const blogFiltro = { 'sitio.estado': 'activo', 'sitio.visibilidad': 'publico' };
        if (tema) {
            blogFiltro.$or = [{ 'sitio.ajustes.temasSlug': tema }, { etiquetasSlug: tema }];
        }
        if (consulta) {
            const hay = { $regex: consulta, $options: 'i' };
            (blogFiltro.$and ||= []).push({ $or: [{ titulo: hay }, { 'sitio.titulo': hay }, { resumen: hay }, { 'bloques.texto': hay }, { etiquetas: hay }] });
        }
        if (relevancia) return feedRelevancia(req, res, { vista, yo, filtro: { usuario: filtro.usuario }, blogFiltro, clave, limite });
        const lista = await Entrada.aggregate([
            { $match: filtro }, { $sort: { publicadaEn: -1, _id: -1 } },
            { $lookup: { from: Blog.collection.name, localField: 'blog', foreignField: '_id', as: 'sitio' } },
            { $unwind: '$sitio' }, { $match: blogFiltro }, { $limit: limite + 1 },
            { $project: { ...Object.fromEntries(campos.split(' ').map(k => [k, 1])), 'sitio._id': 1, 'sitio.titulo': 1, 'sitio.direccion': 1,
                'sitio.dominio.nombre': 1, 'sitio.dominio.verificado': 1, 'sitio.ajustes.temas': 1 } },
        ]);
        const lote = lista.slice(0, limite), ultimo = lote.at(-1);
        const items = await Promise.all(lote.map(async e => ({ e, b: e.sitio, original: e.original ? await obtenerOriginal(e.original, yo) : null })));
        const tarjetasFeed = await tarjetas(items.filter(x => x.e.tipo !== 'republicacion' || x.original), yo);
        const entradas = D.ordenarFeed(tarjetasFeed, { vista, ahora: Number(corte), siguiendo: yo.siguiendo, intereses: yo.intereses });
        const siguiente = lista.length > limite ? Buffer.from(JSON.stringify({ clave, fecha: Number(ultimo.publicadaEn), corte: Number(corte), id: String(ultimo._id) })).toString('base64url') : null;
        res.json({ success: true, entradas, siguiente, conSesion: !!yo.usuario });
    }

    app.get('/blogs/comunidad/feed', envuelve('feed editorial', feed));

    app.get('/blogs/comunidad/publicaciones/:id', envuelve('lectura editorial', async (req, res) => {
        const yo = await lector(req), item = await obtenerPublicacion(req.params.id, yo);
        if (!item) return error(res, 404, 'La publicación ya no está disponible.');
        const [entrada] = await tarjetas([item], yo);
        const { e, b } = item;
        const externa = e.tipo === 'entrada' && new URL(urlPublica(b)).origin !== new URL(urlPublica({ direccion: b.direccion })).origin;
        const contenido = e.tipo === 'entrada' && !externa
            ? R.bloquesHtml(e.bloques, { appUrl: APP_URL, entradaId: String(e._id), juegos: await juegosDe(e.bloques) }) : '';
        if (!externa) contarVista(b, e._id, req.ip || '', req.get('user-agent') || '');
        res.json({ success: true, entrada, contenido, externa });
    }));

    app.get('/blogs/comunidad/perfiles/:id', envuelve('perfil editorial', async (req, res) => {
        const yo = await lector(req), id = req.params.id;
        const b = idOk(id) && await Blog.findOne({ _id: id, ...publico, usuario: { $nin: yo.ocultos } }).lean();
        if (!b) return error(res, 404, 'El sitio ya no está disponible.');
        const [autor, seguidores, seguimiento, destacadas] = await Promise.all([
            Usuario.findOne({ usuario: b.usuario }).select(selectPerfil).lean(),
            BlogInteraccion.countDocuments({ tipo: 'seguir', objetivo: b._id }),
            yo.usuario ? BlogInteraccion.findOne({ tipo: 'seguir', objetivo: b._id, usuario: yo.usuario }).select('frecuencia').lean() : null,
            Entrada.find({ ...disponible(ahora()), blog: b._id, tipo: 'entrada', destacada: true })
                .sort({ publicadaEn: -1 }).limit(3).select('titulo').lean(),
        ]);
        res.json({ success: true, perfil: { id, titulo: b.titulo, descripcion: b.descripcion, usuario: b.usuario, bio: autor?.bio,
            avatar: V.urlSegura(b.ajustes?.logo) || avatar(autor), portada: V.urlSegura(b.ajustes?.portada) || V.urlSegura(autor?.banner),
            url: urlPublica(b), enlaces: b.ajustes?.enlaces || [], temas: b.ajustes?.temas || [],
            destacadas: destacadas.map(e => ({ id: String(e._id), titulo: e.titulo })), seguidores, seguidoresAutor: autor?.listaSeguidores?.length || 0, sigoBlog: !!seguimiento, sigoAutor: yo.siguiendo.includes(b.usuario),
            frecuencia: seguimiento?.frecuencia, propia: yo.usuario === b.usuario } });
    }));

    const limitado = (req, clave, porHora, porDia = 0) => Limites.permitir(`blog-${clave}:${req.usuario}`,
        [[Limites.HORA, porHora], ...(porDia ? [[Limites.DIA, porDia]] : [])]);
    async function puedeEscribir(req, res) {
        if (await CeroTolerancia.restringido(req.usuario)) { error(res, 403, 'Tu cuenta está restringida.'); return false; }
        return true;
    }

    app.post('/blogs/comunidad/notas', verificarToken, envuelve('publicar nota', async (req, res) => {
        if (!(await puedeEscribir(req, res))) return;
        const c = req.body || {};
        const blog = idOk(c.blog) && await Blog.findOne({ _id: c.blog, usuario: req.usuario, ...publico }).lean();
        if (!blog) return error(res, 404, 'Elige uno de tus sitios públicos.');
        const texto = V.parrafos(c.texto, 2000);
        const fotos = Array.isArray(c.imagenes) ? c.imagenes.slice(0, 4).map(v => V.urlSegura(v)) : [];
        const video = V.idYouTube(c.video);
        const enlace = c.enlace?.url ? { url: V.urlSegura(c.enlace.url), titulo: V.linea(c.enlace.titulo, 140),
            descripcion: V.linea(c.enlace.descripcion, 220), imagen: V.urlSegura(c.enlace.imagen) } : null;
        if (fotos.some(u => !u) || (c.video && !video) || (enlace && !enlace.url)) return error(res, 400, 'Usa enlaces HTTPS y un vídeo de YouTube válido.');
        if (!texto && !fotos.length && !video && !enlace) return error(res, 400, 'Escribe algo o añade un archivo o enlace.');
        const etiquetas = V.etiquetas(c.etiquetas);
        const bloques = V.limpiarBloques([
            { tipo: 'texto', texto }, ...(fotos.length > 1 ? [{ tipo: 'galeria', urls: fotos }] : fotos.map(url => ({ tipo: 'imagen', url }))),
            ...(video ? [{ tipo: 'video', id: video }] : []),
        ]);
        const urls = [...fotos, ...(texto.match(/https?:\/\/[^\s)]+/gi) || []), ...(enlace ? [enlace.url, enlace.imagen].filter(Boolean) : [])];
        const malo = revisar(req.usuario, [enlace?.titulo, enlace?.descripcion, ...etiquetas].filter(Boolean).join(' '), bloques, blog.direccion)
            || enlaceProhibido(urls);
        if (malo) return error(res, 400, malo);
        if (!(await limitado(req, 'nota', 8, 30))) return error(res, 429, 'Has publicado muchas notas. Inténtalo más tarde.');
        const _id = new ObjectId();
        const huella = crypto.createHash('sha256').update(JSON.stringify([texto, fotos, video, enlace?.url])).digest('hex');
        try {
            const e = await Entrada.create({ _id, blog: blog._id, usuario: req.usuario, tipo: 'nota', slug: String(_id),
                bloques, etiquetas, etiquetasSlug: etiquetas.map(t => V.slug(t)), enlace, huella,
                alcance: c.alcance === 'sitio' ? 'sitio' : 'comunidad', estado: 'publicada', publicadaEn: ahora(), noindex: true });
            olvidar();
            revisarConIA(e, blog);
            res.status(201).json({ success: true, id: String(e._id), url: urlEntrada(e, blog) });
        } catch (e) {
            if (e.code === 11000) return error(res, 409, 'Esa nota ya se publicó en ese sitio.');
            throw e;
        }
    }));

    app.delete('/blogs/comunidad/publicaciones/:id', verificarToken, envuelve('eliminar publicación corta', async (req, res) => {
        const id = req.params.id;
        const e = idOk(id) && await Entrada.findOneAndDelete({ _id: id, usuario: req.usuario, tipo: { $in: ['nota', 'republicacion'] } });
        if (!e) return error(res, 404, 'La publicación ya no está disponible.');
        await Promise.all([BlogInteraccion.deleteMany({ objetivo: e._id }), Comentario.deleteMany({ itemId: `blog:${e._id}` })]);
        olvidar();
        res.json({ success: true });
    }));

    app.post('/blogs/comunidad/publicaciones/:id/republicar', verificarToken, envuelve('republicar', async (req, res) => {
        if (!(await puedeEscribir(req, res))) return;
        const yo = await lector(req), item = await obtenerPublicacion(req.params.id, yo);
        if (!item || item.original) return error(res, 404, 'Abre la publicación original para compartirla.');
        if (item.e.usuario === req.usuario) return error(res, 400, 'Esta publicación ya es tuya.');
        const id = req.body?.blog;
        const b = idOk(id) && await Blog.findOne({ _id: id, usuario: req.usuario, ...publico }).lean();
        if (!b) return error(res, 404, 'Elige uno de tus sitios públicos.');
        const bloques = V.limpiarBloques([{ tipo: 'texto', texto: V.parrafos(req.body?.texto, 500) }]);
        const malo = revisar(req.usuario, '', bloques, b.direccion) || enlaceProhibido(V.textoDe(bloques).match(/https?:\/\/[^\s)]+/gi) || []);
        if (malo) return error(res, 400, malo);
        if (!(await limitado(req, 'republicacion', 8, 20))) return error(res, 429, 'Has hecho muchas republicaciones.');
        const _id = new ObjectId();
        try {
            const e = await Entrada.create({ _id, blog: b._id, usuario: req.usuario, tipo: 'republicacion', slug: String(_id),
                original: item.e._id, estado: 'publicada', publicadaEn: ahora(), noindex: true, bloques });
            revisarConIA(e, b);
            crearNotif({ destinatario: item.e.usuario, tipo: 'republicacion', emisor: req.usuario, itemId: rutaLectura(e._id),
                itemTitle: item.e.titulo, mensaje: 'republicó tu publicación' });
            res.status(201).json({ success: true, id: String(e._id) });
        } catch (e) {
            if (e.code === 11000) return error(res, 409, 'Ya republicaste este contenido.');
            throw e;
        }
    }));

    async function relacion(filtro, activo, cambios = {}) {
        if (!activo) return BlogInteraccion.deleteOne(filtro);
        try { return await BlogInteraccion.updateOne(filtro, { $set: cambios }, { upsert: true }); }
        catch (e) {
            if (e.code !== 11000) throw e;
            return BlogInteraccion.updateOne(filtro, { $set: cambios });
        }
    }

    app.put('/blogs/comunidad/publicaciones/:id/interaccion', verificarToken, envuelve('interacción editorial', async (req, res) => {
        if (!(await puedeEscribir(req, res))) return;
        const { tipo, activo } = req.body || {};
        if (!['gusta', 'guardar'].includes(tipo) || typeof activo !== 'boolean') return error(res, 400, 'Interacción desconocida.');
        if (!(await limitado(req, 'interaccion', 150))) return error(res, 429, 'Espera un momento antes de continuar.');
        const item = await obtenerPublicacion(req.params.id, await lector(req));
        if (!item) return error(res, 404, 'La publicación ya no está disponible.');
        const filtro = { usuario: req.usuario, tipo, objetivo: item.e._id };
        await relacion(filtro, activo);
        const [valor, gusta] = await Promise.all([BlogInteraccion.exists(filtro), BlogInteraccion.countDocuments({ objetivo: filtro.objetivo, tipo: 'gusta' })]);
        res.json({ success: true, activo: !!valor, gusta });
    }));

    app.put('/blogs/comunidad/perfiles/:id/seguir', verificarToken, envuelve('seguir sitio', async (req, res) => {
        if (!(await puedeEscribir(req, res))) return;
        const { activo, frecuencia } = req.body || {}, id = req.params.id;
        if (typeof activo !== 'boolean' || !idOk(id)) return error(res, 400, 'Elige un sitio y una acción.');
        const yo = await lector(req);
        const b = await Blog.findOne({ _id: id, ...publico, usuario: { $nin: [...yo.ocultos, req.usuario] } }).lean();
        if (!b) return error(res, 404, 'El sitio ya no está disponible.');
        if (!(await limitado(req, 'seguir', 100))) return error(res, 429, 'Espera un momento antes de continuar.');
        const cambios = { frecuencia: frecuencia === 'sin-avisos' ? 'sin-avisos' : 'cada-articulo' };
        const r = await relacion({ usuario: req.usuario, tipo: 'seguir', objetivo: b._id }, activo, cambios);
        if (r?.upsertedCount) crearNotif({ destinatario: b.usuario, tipo: 'seguidor', emisor: req.usuario, mensaje: `empezó a seguir «${b.titulo}»` });
        res.json({ success: true, activo, frecuencia: cambios.frecuencia, seguidores: await BlogInteraccion.countDocuments({ tipo: 'seguir', objetivo: b._id }) });
    }));

    app.put('/blogs/comunidad/autores/:usuario/silenciar', verificarToken, envuelve('silenciar autor', async (req, res) => {
        const { activo } = req.body || {};
        const nombre = req.params.usuario.toLowerCase();
        if (nombre === req.usuario || typeof activo !== 'boolean') return error(res, 400, 'Elige otro autor.');
        if (!(await limitado(req, 'silenciar', 50))) return error(res, 429, 'Espera un momento antes de continuar.');
        const u = await Usuario.findOne({ usuario: nombre }).select('_id').lean();
        if (!u) return error(res, 404, 'No encontramos a ese autor.');
        await relacion({ usuario: req.usuario, tipo: 'silenciar', objetivo: u._id }, activo);
        res.json({ success: true, activo });
    }));

    app.get('/blogs/comunidad/silenciados', verificarToken, envuelve('autores silenciados', async (req, res) => {
        const relaciones = await BlogInteraccion.find({ usuario: req.usuario, tipo: 'silenciar' }).select('objetivo').lean();
        const autores = await Usuario.find({ _id: { $in: relaciones.map(r => r.objetivo) } }).select('usuario -_id').lean();
        res.json({ success: true, autores: autores.map(u => u.usuario) });
    }));

    app.post('/blogs/comunidad/publicaciones/:id/reportar', verificarToken, envuelve('reportar publicación', async (req, res) => {
        const item = await obtenerPublicacion(req.params.id, await lector(req));
        if (!item) return error(res, 404, 'La publicación ya no está disponible.');
        const motivo = V.linea(req.body?.motivo, 80);
        if (!motivo) return error(res, 400, 'Indica el motivo.');
        if (!(await limitado(req, 'reporte', 3, 8))) return error(res, 429, 'Has enviado varios reportes. Inténtalo más tarde.');
        try {
            await BlogReporte.create({ blog: item.b._id, usuario: req.usuario, publicacion: item.e._id, motivo,
                detalle: `${rutaLectura(item.e._id)} · ${V.parrafos(req.body?.detalle, 300)}`, ip: String(req.ip || '').slice(0, 64) });
            await Blog.updateOne({ _id: item.b._id }, { $inc: { reportes: 1 } });
        } catch (e) { if (e.code !== 11000) throw e; }
        res.status(201).json({ success: true });
    }));

    return { feed };
}
module.exports = { registrar };
