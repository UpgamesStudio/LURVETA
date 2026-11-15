/**
 * UpGames Blogs · Nexus escritor
 *
 * «Escríbeme una reseña de este juego»: Nexus recibe los datos de la publicación y devuelve el
 * borrador de una entrada ya armada con bloques (no HTML). Lo que devuelve el modelo NUNCA se
 * guarda tal cual: pasa por V.limpiarBloques, igual que lo que escribe una persona.
 * Sin red ni base de datos: la ruta (rutas/blogs.js) le pasa la publicación y la respuesta del modelo.
 */
'use strict';
const V = require('./validar');

const TIPOS = {
    resena: 'una RESEÑA personal: qué es, lo mejor, lo peor, ficha técnica y una nota final',
    guia: 'una GUÍA de instalación paso a paso: requisitos, pasos numerados, avisos y preguntas frecuentes',
    noticia: 'una NOTICIA breve: titular, lo más importante y por qué le interesa a la comunidad',
};

const SISTEMA = `Eres Nexus, el asistente de escritura de UpGames Blogs. Escribes borradores en español para blogs de videojuegos, mods y apps.
Devuelves SOLO un objeto JSON con esta forma:
{"titulo":"…","resumen":"1-2 frases","etiquetas":["…"],"bloques":[…]}
Cada bloque es UNO de estos (sin HTML; en los textos se permite **negrita**, *cursiva*, listas con "- " y numeradas con "1. "):
{"tipo":"texto","texto":"…","grande":true|false}  ·  {"tipo":"titulo","texto":"…"}  ·  {"tipo":"aviso","estilo":"info|exito|alerta|peligro","texto":"…"}
{"tipo":"ficha","titulo":"…","filas":[{"k":"Género","v":"…"}]}  ·  {"tipo":"faq","items":[{"p":"pregunta","r":"respuesta"}]}  ·  {"tipo":"cita","texto":"…","autor":"…"}
Reglas:
- Usa SOLO los datos que te dan. NO inventes cifras, versiones, notas de prensa, requisitos ni funciones. Si algo falta, escribe una frase corta entre [corchetes] para que el creador la complete con su experiencia (p. ej. "[Cuenta aquí cómo corrió en tu equipo]").
- Entre 7 y 12 bloques. Empieza con un texto de introducción (grande:true). Títulos cortos. Tono cercano, sin exagerar ni vender.
- Nada de enlaces, ni de links de descarga, ni de contenido sexual, de odio o ilegal.
- El título tiene máximo 90 caracteres; las etiquetas, máximo 5.`;

/** Mensaje de usuario con los datos de la publicación (recortados: el modelo no necesita más). */
function pedido(j, tipo, nota) {
    const ex = j.extraData && typeof j.extraData === 'object' ? Object.fromEntries(Object.entries(j.extraData).filter(([k, v]) => k !== 'detectedGame' && typeof v !== 'object' && String(v).length < 120).slice(0, 12)) : {};
    return `Escribe ${TIPOS[tipo] || TIPOS.resena}.
Publicación de UpGames:
- Nombre: ${String(j.title || '').slice(0, 140)}
- Categoría: ${String(j.category || '—').slice(0, 40)}
- Etiquetas: ${(j.tags || []).slice(0, 10).join(', ') || '—'}
- Descripción del creador: ${String(j.description || '—').slice(0, 1500)}
- Otros datos: ${JSON.stringify(ex).slice(0, 600)}
${nota ? `- Enfoque pedido por quien escribe: ${String(nota).slice(0, 200)}` : ''}`;
}

/**
 * Convierte la respuesta del modelo en una entrada válida o devuelve null si no sirve.
 * Agrega por código lo que no se le deja al modelo: la imagen y la tarjeta de la publicación.
 */
function armar(o, j, tipo) {
    if (!o || typeof o !== 'object') return null;
    let bloques = V.limpiarBloques(o.bloques).filter(b => !['juego', 'descarga', 'imagen', 'boton', 'redes', 'galeria', 'video', 'audio', 'codigo'].includes(b.tipo));
    if (bloques.length < 3) return null;
    const imagen = V.urlSegura(j.image);
    const extra = [];
    if (imagen) extra.push({ tipo: 'imagen', url: imagen, alt: V.linea(j.title, 120), pie: '' });
    extra.push({ tipo: 'juego', id: String(j._id) });
    bloques = [bloques[0], ...extra, ...bloques.slice(1)];
    if (tipo === 'guia') bloques.push({ tipo: 'descarga', id: String(j._id) });   // la descarga pasa por la página puente
    return {
        titulo: V.linea(o.titulo, 90) || V.linea(j.title, 90),
        resumen: V.linea(o.resumen, 300),
        etiquetas: V.etiquetas(o.etiquetas).slice(0, 5),
        bloques: bloques.slice(0, V.LIMITES.BLOQUES_POR_ENTRADA),
    };
}

// ── Nexus asistente: landing completa, una sección, mejorar un texto y SEO ──────────────
const FORMA_SECCIONES = `Bloques de sección (todos aceptan "fondo":"|suave|acento|degradado|oscuro" y "alinear":"centro|izquierda"):
{"tipo":"heroe","titulo":"…","texto":"…","bTexto":"…","bUrl":"","variante":"centro"}
{"tipo":"columnas","titulo":"…","texto":"…","variante":"3","items":[{"icono":"emoji","titulo":"…","texto":"…"}]}
{"tipo":"precios","titulo":"…","texto":"…","items":[{"nombre":"…","precio":"[precio]","periodo":"…","items":"línea 1\nlínea 2","bTexto":"…","bUrl":"","destacado":false}]}
{"tipo":"testimonios","titulo":"…","items":[{"texto":"[Escribe aquí lo que dijo un cliente real]","nombre":"[Nombre]","rol":"[Ciudad]"}]}
{"tipo":"cta","titulo":"…","texto":"…","bTexto":"…","bUrl":""}
También: {"tipo":"texto","texto":"…"} · {"tipo":"titulo","texto":"…"} · {"tipo":"faq","items":[{"p":"…","r":"…"}]}`;
const REGLAS_HONESTAS = `- NO inventes precios, cifras, premios, clientes ni testimonios: pon [corchetes] para que el creador complete (p. ej. "[precio]", "[Escribe aquí lo que dijo un cliente real]").
- Deja "bUrl" vacío: el creador pone su enlace o su WhatsApp.
- Iconos de columnas: un solo emoji que encaje. Títulos cortos y concretos. Tono cercano y profesional, en el idioma del pedido.
- Nada de contenido sexual, de odio, ilegal ni engañoso.`;

const SISTEMA_LANDING = `Eres Nexus, el asistente de UpGames Blogs. Diseñas landing pages que convierten para personas que no saben programar.
Devuelves SOLO un JSON: {"titulo":"nombre corto de la página","resumen":"1-2 frases para Google","bloques":[…]}
${FORMA_SECCIONES}
Estructura recomendada (adáptala al negocio): heroe (fondo "degradado") → columnas con 3 beneficios o servicios → precios si aplica → testimonios → faq con 3-4 dudas reales → cta final (fondo "acento").
Alterna fondos para que se distingan las secciones (nunca dos seguidas iguales salvo "").
${REGLAS_HONESTAS}`;

const SISTEMA_SECCION = `Eres Nexus, el asistente de UpGames Blogs. Escribes el contenido de UNA sección de una página web.
Devuelves SOLO un JSON con el bloque pedido, con esta forma:
${FORMA_SECCIONES}
${REGLAS_HONESTAS}`;

const ACCIONES_TEXTO = {
    mejorar: 'Mejora la redacción: más claro y fluido, sin cambiar el sentido ni la longitud aproximada.',
    corto: 'Hazlo más corto y directo (la mitad aproximadamente), conservando lo importante.',
    largo: 'Desarróllalo un poco más (máximo el doble), sin inventar datos.',
    vendedor: 'Reescríbelo más persuasivo, centrado en el beneficio para quien lee, sin exagerar ni prometer lo que no dice.',
    ortografia: 'Corrige solo ortografía, acentos y puntuación. No cambies nada más.',
    cercano: 'Reescríbelo con un tono más cercano y amigable.',
};
const SISTEMA_TEXTO = `Eres Nexus, el asistente de escritura de UpGames Blogs. Reescribes el texto que te pasan según la instrucción.
Devuelves SOLO un JSON: {"texto":"…"}. Conserva el formato (**negrita**, *cursiva*, listas con "- ", enlaces [texto](https://…)) y el idioma original. No añadas comentarios ni datos inventados.`;

const SISTEMA_SEO = `Eres Nexus, experto en SEO de UpGames Blogs. Con el título y el texto de una entrada o página, propones:
{"resumen":"descripción para Google y redes, 140-160 caracteres, atractiva y fiel al contenido","etiquetas":["3 a 6 etiquetas cortas en minúscula"],"titulo":"título alternativo más claro para buscadores, máx. 65 caracteres"}
Devuelves SOLO ese JSON, en el idioma del texto. No inventes datos.`;

const TIPOS_LANDING = new Set(['heroe', 'columnas', 'precios', 'testimonios', 'cta', 'texto', 'titulo', 'faq']);

/** Landing de Nexus → bloques válidos (solo tipos de landing) o null. Añade el contacto si el creador dio uno. */
function armarLanding(o, contacto) {
    if (!o || typeof o !== 'object') return null;
    let bloques = V.limpiarBloques(o.bloques).filter(b => TIPOS_LANDING.has(b.tipo));
    if (bloques.length < 3 || bloques[0].tipo !== 'heroe') return null;
    if (contacto?.items?.length) {
        const i = bloques.map(b => b.tipo).lastIndexOf('cta');
        const red = { tipo: 'redes', estilo: 'botones', items: contacto.items };
        i >= 0 ? bloques.splice(i, 0, red) : bloques.push(red);
        if (contacto.items[0].red === 'whatsapp') bloques.push({ tipo: 'redes', estilo: 'flotante', items: [contacto.items[0]] });
        const wa = contacto.items[0].url;   // los botones principales llevan al contacto
        bloques = bloques.map(b => (b.tipo === 'heroe' || b.tipo === 'cta') && b.bTexto && !b.bUrl ? { ...b, bUrl: wa }
            : b.tipo === 'precios' ? { ...b, items: b.items.map(i => i.bTexto && !i.bUrl ? { ...i, bUrl: wa } : i) } : b);
    }
    return { titulo: V.linea(o.titulo, 90) || 'Inicio', resumen: V.linea(o.resumen, 300), bloques: bloques.slice(0, V.LIMITES.BLOQUES_POR_ENTRADA) };
}

/** Sección de Nexus: devuelve el bloque si es del tipo pedido, o null. */
function armarSeccion(o, tipo) {
    const [b] = V.limpiarBloques([{ ...(o && typeof o === 'object' ? o : {}), tipo }]);
    return b || null;
}

module.exports = { SISTEMA, TIPOS, pedido, armar, SISTEMA_LANDING, SISTEMA_SECCION, SISTEMA_TEXTO, SISTEMA_SEO, ACCIONES_TEXTO, armarLanding, armarSeccion };
