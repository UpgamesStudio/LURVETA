/**
 * Lurveta Blogs · validación y limpieza
 *
 * Todo lo que escribe el creador pasa por aquí antes de guardarse: la dirección del blog,
 * el dominio propio y los bloques de cada entrada. El contenido se guarda como bloques
 * (JSON), nunca como HTML libre: así un blog no puede llevar scripts.
 */
'use strict';

const Redes = require('../../public/upgames-redes');

const LIMITES = {
    BLOGS_POR_CUENTA: 3,
    BLOGS_PREMIUM: 10,
    ENTRADAS_POR_BLOG: 300,
    BLOQUES_POR_ENTRADA: 80,
    TEXTO_BLOQUE: 20000,
    TITULO: 140,
    DESCRIPCION: 300,
    ETIQUETAS: 8,
    GALERIA: 12,
};

// Direcciones que no puede usar un blog (se confundirían con Lurveta o con servicios conocidos)
const RESERVADOS = new Set(['www', 'admin', 'api', 'app', 'blog', 'blogs', 'upgames', 'upgame', 'soporte', 'support', 'ayuda', 'help',
    'login', 'registro', 'cuenta', 'account', 'pago', 'pagos', 'paypal', 'google', 'facebook', 'banco', 'bank', 'seguridad', 'security',
    'mail', 'correo', 'ftp', 'cdn', 'static', 'assets', 'nexus', 'live', 'studio', 'racing', 'premium', 'oficial', 'official',
    'root', 'null', 'undefined', 'test', 'dev', 'staging', 'status', 'docs', 'legal', 'terminos', 'privacidad']);

const TIPOS = new Set(['texto', 'titulo', 'imagen', 'galeria', 'video', 'cita', 'boton', 'separador', 'codigo', 'juego', 'descarga', 'aviso', 'faq', 'ficha', 'audio', 'redes', 'heroe', 'columnas', 'precios', 'testimonios', 'cta', 'formulario', 'catalogo', 'apoyo', 'afiliado', 'articulos', 'suscripcion']);
// Secciones de landing: tipos de bloque que ocupan todo el ancho y llevan su propio estilo
const SECCIONES = new Set(['heroe', 'columnas', 'precios', 'testimonios', 'cta', 'formulario', 'catalogo', 'apoyo', 'afiliado', 'articulos', 'suscripcion']);
const MONEDAS = ['COP', 'USD', 'MXN', 'ARS', 'CLP', 'PEN', 'EUR', 'BRL', 'UYU', 'BOB', 'GTQ', 'DOP', 'VES'];
const FONDOS_SEC = new Set(['', 'suave', 'acento', 'degradado', 'oscuro', 'imagen']);
const ESPACIOS_SEC = new Set(['compacto', 'normal', 'amplio']);
const ESTILOS_AVISO = new Set(['info', 'exito', 'alerta', 'peligro']);

/** Texto plano de una línea: sin etiquetas, sin saltos, recortado. */
function linea(v, max) {
    return String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Texto de varios párrafos: conserva los saltos de línea, quita caracteres de control. */
function parrafos(v, max) {
    return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
}

/** Convierte un título en la parte final de una URL: «¡Hola, Mundo!» → «hola-mundo». */
function slug(texto, max = 80) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

/** Dirección del blog (la parte de la URL): 3–30 caracteres, letras, números y guiones. */
function validarDireccion(v) {
    const d = String(v ?? '').trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(d)) return { error: 'La dirección debe tener entre 3 y 30 caracteres: letras, números y guiones (sin empezar ni terminar en guion).' };
    if (d.includes('--')) return { error: 'La dirección no puede tener dos guiones seguidos.' };
    if (RESERVADOS.has(d)) return { error: 'Esa dirección está reservada. Elige otra.' };
    return { valor: d };
}

/** Dominio propio: «www.misitio.com». Se rechazan IP, puertos, rutas y los dominios de Lurveta. */
function validarDominio(v) {
    let d = String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!d || d.length > 253) return { error: 'Escribe tu dominio, por ejemplo www.misitio.com' };
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return { error: 'Ese dominio no es válido. Escríbelo así: www.misitio.com (sin https:// ni barras).' };
    if (/(^|\.)(lurveta\.com|upgames\.games|upgames\.site|railway\.app|github\.io|localhost)$/.test(d)) return { error: 'Ese dominio no se puede conectar.' };
    return { valor: d };
}

/** URL https segura (o '' si no lo es). Sin espacios, comillas ni símbolos de etiqueta. */
function urlSegura(v, max = 600) {
    const u = String(v ?? '').trim();
    if (!u || u.length > max || /[\s"'<>`\\]/.test(u)) return '';
    try {
        const p = new URL(u);
        if (p.username || p.password) return '';
        const local = process.env.LURVETA_PREVIA_LOCAL === '1' && process.env.NODE_ENV === 'development' &&
            p.origin === `http://localhost:${process.env.PORT || 10000}` && p.pathname.startsWith('/__demo/media/');
        return local || (p.protocol === 'https:' && p.hostname.includes('.')) ? p.href : '';
    } catch (_) { return ''; }
}

/** Saca el identificador de un video de YouTube de cualquiera de sus formatos de enlace. */
function idYouTube(v) {
    const s = String(v ?? '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    return m ? m[1] : '';
}

/** Canción, álbum, lista, programa o episodio de Spotify a partir de su enlace. */
function idSpotify(v) {
    const m = String(v ?? '').trim().match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})(?:[/?#].*)?$/);
    return m ? { clase: m[1], id: m[2] } : null;
}

function etiquetas(v) {
    const lista = Array.isArray(v) ? v : String(v ?? '').split(',');
    const vistas = new Set(), out = [];
    for (const e of lista) {
        const t = linea(e, 30).replace(/^#/, '');
        const k = slug(t);
        if (!k || vistas.has(k)) continue;
        vistas.add(k); out.push(t);
        if (out.length >= LIMITES.ETIQUETAS) break;
    }
    return out;
}

/** Enlace de un botón de sección: https (acepta «wa.me/57…» sin el https://). */
const urlBoton = v => Redes.https(v);
/** Estilo común de las secciones: fondo, imagen de fondo, espacio y alineación (opciones cerradas). */
function estiloSec(b) {
    const fondo = FONDOS_SEC.has(b.fondo) ? b.fondo : '';
    const fondoImg = fondo === 'imagen' ? urlSegura(b.fondoImg) : '';
    return { fondo: fondo === 'imagen' && !fondoImg ? '' : fondo, ...(fondoImg ? { fondoImg } : {}), espacio: ESPACIOS_SEC.has(b.espacio) ? b.espacio : 'normal', alinear: b.alinear === 'izquierda' ? 'izquierda' : 'centro' };
}
/** El icono de una columna: el primer emoji o carácter completo (sin partir emojis compuestos). */
const unIcono = v => { const t = linea(v, 32); try { return [...new Intl.Segmenter().segment(t)][0]?.segment || ''; } catch (_) { return [...t].slice(0, 2).join(''); } };
const lista = (v, max) => (Array.isArray(v) ? v : []).slice(0, max);

/**
 * Limpia la lista de bloques de una entrada. Devuelve solo bloques conocidos y con sus
 * campos permitidos; lo demás se descarta. Nunca lanza.
 */
function limpiarBloques(entrada) {
    if (!Array.isArray(entrada)) return [];
    const out = [];
    for (const b of entrada) {
        if (!b || typeof b !== 'object' || !TIPOS.has(b.tipo)) continue;
        let n = null;
        switch (b.tipo) {
            case 'texto': { const t = parrafos(b.texto, LIMITES.TEXTO_BLOQUE); if (t) n = { tipo: 'texto', texto: t, ...(b.centro ? { centro: true } : {}), ...(b.grande ? { grande: true } : {}) }; break; }
            case 'titulo': { const t = linea(b.texto, 160); if (t) n = { tipo: 'titulo', texto: t, nivel: b.nivel === 3 ? 3 : 2, ...(b.centro ? { centro: true } : {}) }; break; }
            case 'imagen': { const url = urlSegura(b.url); if (url) n = { tipo: 'imagen', url, pie: linea(b.pie, 200), alt: linea(b.alt, 200), enlace: urlSegura(b.enlace) }; break; }
            case 'aviso': { const t = parrafos(b.texto, 1500); if (t) n = { tipo: 'aviso', texto: t, estilo: ESTILOS_AVISO.has(b.estilo) ? b.estilo : 'info' }; break; }
            case 'faq': {
                const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ p: linea(i?.p, 200), r: parrafos(i?.r, 1500) })).filter(i => i.p && i.r).slice(0, 20);
                if (items.length) n = { tipo: 'faq', items };
                break;
            }
            case 'ficha': {
                const filas = (Array.isArray(b.filas) ? b.filas : []).map(f => ({ k: linea(f?.k, 60), v: linea(f?.v, 200) })).filter(f => f.k && f.v).slice(0, 20);
                if (filas.length) n = { tipo: 'ficha', filas, titulo: linea(b.titulo, 80) };
                break;
            }
            case 'audio': { const a = idSpotify(b.url || (b.clase && b.id ? `https://open.spotify.com/${b.clase}/${b.id}` : '')); if (a) n = { tipo: 'audio', clase: a.clase, id: a.id }; break; }
            case 'galeria': {
                const urls = (Array.isArray(b.urls) ? b.urls : []).map(u => urlSegura(u)).filter(Boolean).slice(0, LIMITES.GALERIA);
                if (urls.length) n = { tipo: 'galeria', urls };
                break;
            }
            case 'video': { const id = idYouTube(b.id || b.url); if (id) n = { tipo: 'video', id }; break; }
            case 'cita': { const t = parrafos(b.texto, 1200); if (t) n = { tipo: 'cita', texto: t, autor: linea(b.autor, 80) }; break; }
            case 'boton': { const url = urlSegura(b.url), t = linea(b.texto, 60); if (url && t) n = { tipo: 'boton', texto: t, url }; break; }
            case 'redes': {
                const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ red: Redes.REDES[i?.red] ? i.red : '', url: Redes.normalizar(i?.red, i?.url), texto: linea(i?.texto, 40) })).filter(i => i.red && i.url).slice(0, Redes.MAX);
                if (items.length) n = { tipo: 'redes', items, estilo: Redes.ESTILOS.includes(b.estilo) ? b.estilo : 'botones' };
                break;
            }
            case 'heroe': {
                const t = linea(b.titulo, 120);
                if (t) n = { tipo: 'heroe', titulo: t, texto: parrafos(b.texto, 400), bTexto: linea(b.bTexto, 40), bUrl: urlBoton(b.bUrl), b2Texto: linea(b.b2Texto, 40), b2Url: urlBoton(b.b2Url),
                    imagen: urlSegura(b.imagen), variante: ['centro', 'dividido', 'fondo'].includes(b.variante) ? b.variante : 'centro', ...estiloSec(b) };
                break;
            }
            case 'columnas': {
                const items = lista(b.items, 30).map(i => ({ icono: unIcono(i?.icono), titulo: linea(i?.titulo, 80), texto: parrafos(i?.texto, 300) })).filter(i => i.titulo || i.texto).slice(0, 6);
                if (items.length) n = { tipo: 'columnas', titulo: linea(b.titulo, 120), texto: parrafos(b.texto, 400), items, variante: b.variante === '2' ? '2' : '3', ...estiloSec(b) };
                break;
            }
            case 'precios': {
                const planes = lista(b.items, 30).map(i => ({ nombre: linea(i?.nombre, 40), precio: linea(i?.precio, 30), periodo: linea(i?.periodo, 20), items: parrafos(i?.items, 600), bTexto: linea(i?.bTexto, 40), bUrl: urlBoton(i?.bUrl), destacado: !!i?.destacado })).filter(i => i.nombre).slice(0, 4);
                if (planes.length) n = { tipo: 'precios', titulo: linea(b.titulo, 120), texto: parrafos(b.texto, 400), items: planes, ...estiloSec(b) };
                break;
            }
            case 'testimonios': {
                const items = lista(b.items, 30).map(i => ({ texto: parrafos(i?.texto, 500), nombre: linea(i?.nombre, 60), rol: linea(i?.rol, 60) })).filter(i => i.texto && i.nombre).slice(0, 6);
                if (items.length) n = { tipo: 'testimonios', titulo: linea(b.titulo, 120), items, ...estiloSec(b) };
                break;
            }
            case 'cta': {
                const t = linea(b.titulo, 120);
                if (t) n = { tipo: 'cta', titulo: t, texto: parrafos(b.texto, 300), bTexto: linea(b.bTexto, 40), bUrl: urlBoton(b.bUrl), ...estiloSec(b) };
                break;
            }
            case 'formulario': {
                // Formulario de contacto: siempre pide nombre y mensaje; correo y teléfono son opcionales
                n = { tipo: 'formulario', titulo: linea(b.titulo, 120), texto: parrafos(b.texto, 400), bTexto: linea(b.bTexto, 40) || 'Enviar mensaje', exito: linea(b.exito, 200), pideEmail: b.pideEmail !== false, pideTel: !!b.pideTel, ...estiloSec(b) };
                break;
            }
            case 'catalogo': {
                // Catálogo con pedido por WhatsApp: el precio es un número (para sumar el total en el servidor)
                const wa = Redes.normalizar('whatsapp', b.whatsapp);
                const items = lista(b.items, 60).map(i => { const p = Number(String(i?.precio ?? '').replace(/[^\d.,]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.')); return { nombre: linea(i?.nombre, 80), precio: Number.isFinite(p) && p > 0 ? Math.round(p * 100) / 100 : 0, descripcion: parrafos(i?.descripcion, 300), imagen: urlSegura(i?.imagen) }; }).filter(i => i.nombre).slice(0, 30);
                if (items.length && /^https:\/\/wa\.me\/\d+$/.test(wa)) n = { tipo: 'catalogo', titulo: linea(b.titulo, 120), texto: parrafos(b.texto, 400), whatsapp: wa, moneda: MONEDAS.includes(b.moneda) ? b.moneda : 'COP', items, ...estiloSec(b) };
                break;
            }
            case 'articulos':
                n = { tipo: 'articulos', titulo: linea(b.titulo, 120) || 'Últimos artículos', texto: parrafos(b.texto, 400), ...estiloSec(b) };
                break;
            case 'suscripcion':
                n = { tipo: 'suscripcion', titulo: linea(b.titulo, 120) || 'Recibe las novedades', texto: parrafos(b.texto, 400),
                    bTexto: linea(b.bTexto, 40) || 'Seguir este blog', ...estiloSec(b) };
                break;
            case 'apoyo': {
                // Apoyo con UpCoins: el botón abre Lurveta (mismas reglas que apoyar una publicación)
                n = { tipo: 'apoyo', titulo: linea(b.titulo, 120) || 'Apoya este blog', texto: parrafos(b.texto, 400), bTexto: linea(b.bTexto, 40) || 'Apoyar con UpCoins', ...estiloSec(b) };
                break;
            }
            case 'afiliado': {
                // Enlaces de afiliado: siempre con el aviso visible; el enlace es del creador
                const items = lista(b.items, 30).map(i => ({ nombre: linea(i?.nombre, 80), precio: linea(i?.precio, 30), tienda: linea(i?.tienda, 40), imagen: urlSegura(i?.imagen), url: urlSegura(i?.url) })).filter(i => i.nombre && i.url).slice(0, 12);
                if (items.length) n = { tipo: 'afiliado', titulo: linea(b.titulo, 120), texto: parrafos(b.texto, 400), items, ...estiloSec(b) };
                break;
            }
            case 'separador': n = { tipo: 'separador' }; break;
            case 'codigo': { const t = String(b.texto ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').slice(0, 8000); if (t.trim()) n = { tipo: 'codigo', texto: t }; break; }
            case 'descarga': { const id = String(b.id ?? ''); if (/^[a-f0-9]{24}$/i.test(id)) n = { tipo: 'descarga', id: id.toLowerCase() }; break; }
            case 'juego': { const id = String(b.id ?? ''); if (/^[a-f0-9]{24}$/i.test(id)) n = { tipo: 'juego', id: id.toLowerCase() }; break; }
        }
        if (n) out.push(n);
        if (out.length >= LIMITES.BLOQUES_POR_ENTRADA) break;
    }
    return out;
}

/** Todo el texto de una entrada junto, para la moderación y para el resumen. */
function textoDe(bloques) {
    return (bloques || []).map(b => [b.texto, b.pie, b.autor, b.titulo, ...(b.items || []).flatMap(i => [i.p, i.r]), ...(b.filas || []).flatMap(f => [f.k, f.v]), ...(b.tipo === 'redes' ? b.items.map(i => i.texto) : []), ...(SECCIONES.has(b.tipo) ? [b.titulo, b.bTexto, b.b2Texto, ...(b.items || []).flatMap(i => [i.titulo, i.texto, i.nombre, i.rol, i.precio, i.periodo, i.items, i.bTexto, i.descripcion, i.nombre, i.tienda])] : []), ...(b.tipo === 'formulario' ? [b.exito] : [])].filter(Boolean).join(' ')).filter(Boolean).join('\n');
}

/** Enlaces que aparecen en una entrada (botones y enlaces dentro del texto). */
function enlacesDe(bloques) {
    const out = [];
    for (const b of bloques || []) {
        if (b.tipo === 'boton') out.push(b.url);
        if (b.tipo === 'imagen' && b.enlace) out.push(b.enlace);
        if (b.tipo === 'redes') for (const i of b.items || []) if (/^https:/.test(i.url)) out.push(i.url);
        if (SECCIONES.has(b.tipo)) for (const u of [b.bUrl, b.b2Url, ...(b.items || []).map(i => i.bUrl)]) if (u) out.push(u);
        if (b.tipo === 'catalogo') out.push(b.whatsapp);
        if (b.tipo === 'afiliado') for (const i of b.items || []) out.push(i.url);
        for (const i of b.items || []) for (const m of String(i.r).matchAll(/\]\((https:\/\/[^\s)]+)\)/g)) out.push(m[1]);
        if (b.tipo === 'texto' || b.tipo === 'cita' || b.tipo === 'aviso') for (const m of String(b.texto).matchAll(/\]\((https:\/\/[^\s)]+)\)/g)) out.push(m[1]);
    }
    return out;
}

/** Resumen corto de la entrada (para la portada, el feed y las etiquetas meta). */
function resumen(bloques, max = 180) {
    const t = (bloques || []).filter(b => b.tipo === 'texto').map(b => b.texto).join(' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|`/g, '').replace(/(^|\s)[-•]\s+/g, '$1').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

/** Primera imagen de la entrada: sirve de portada si el autor no eligió una. */
function primeraImagen(bloques) {
    for (const b of bloques || []) {
        if (b.tipo === 'imagen') return b.url;
        if (b.tipo === 'galeria' && b.urls[0]) return b.urls[0];
    }
    return '';
}

module.exports = { SECCIONES, MONEDAS, LIMITES, RESERVADOS, linea, parrafos, slug, validarDireccion, validarDominio, urlSegura, idYouTube, idSpotify, etiquetas, limpiarBloques, textoDe, enlacesDe, resumen, primeraImagen };
