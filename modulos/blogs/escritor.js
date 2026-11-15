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
- Entre 7 y 12 bloques. Empieza con un texto de introducción (grande:true) que enganche en la primera frase (qué es y por qué le interesa a quien lee). Títulos cortos y descriptivos (no "Introducción" ni "Conclusión").
- Escribe como un periodista gamer con experiencia: concreto, útil y honesto; tono cercano, sin exagerar ni vender, sin relleno ("en este artículo veremos…", "sin más preámbulos").
- Listas para pasos y requisitos; párrafos de 2-3 frases.
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
const FORMA_SECCIONES = `Bloques de sección (todos aceptan "fondo":"|suave|acento|degradado|oscuro", "espacio":"compacto|normal|amplio" y "alinear":"centro|izquierda"):
{"tipo":"heroe","titulo":"…","texto":"…","bTexto":"…","bUrl":"","b2Texto":"","b2Url":"","variante":"centro"}
{"tipo":"columnas","titulo":"…","texto":"…","variante":"3","items":[{"icono":"un emoji","titulo":"…","texto":"…"}]}
{"tipo":"precios","titulo":"…","texto":"…","items":[{"nombre":"…","precio":"[precio]","periodo":"…","items":"línea 1\\nlínea 2\\nlínea 3","bTexto":"…","bUrl":"","destacado":false}]}
{"tipo":"testimonios","titulo":"…","items":[{"texto":"[Escribe aquí lo que dijo un cliente real]","nombre":"[Nombre]","rol":"[Ciudad]"}]}
{"tipo":"cta","titulo":"…","texto":"…","bTexto":"…","bUrl":""}
Además: {"tipo":"texto","texto":"…"} · {"tipo":"titulo","texto":"…"} · {"tipo":"faq","items":[{"p":"…","r":"…"}]}`;

// Criterio de redacción profesional (común a todo lo que escribe Nexus para páginas)
const ESTILO_PRO = `Escribes como un redactor publicitario senior especializado en páginas que convierten:
- Habla del BENEFICIO para el cliente, no de la empresa. Concreto y visual: qué consigue, en cuánto tiempo, sin qué molestia.
- Títulos de 3 a 9 palabras, con fuerza (verbo o resultado). Nada de "Bienvenidos", "Somos los mejores", "Calidad y servicio", "Soluciones integrales", "Tu aliado", "Lleva tu X al siguiente nivel".
- Frases cortas (máx. 20 palabras). Segunda persona ("tú" en español latinoamericano neutro, salvo que el pedido use "usted"). Sin signos de exclamación en exceso ni emojis en los textos (solo el emoji del icono de columnas).
- Botones con verbo de acción y lo que obtiene: "Reservar mi cita", "Pedir por WhatsApp", "Ver el catálogo", "Quiero mi cotización". Máx. 4 palabras.
- Adapta el tono al negocio (barbería urbana ≠ consultorio médico ≠ tienda gamer).
- Usa SOLO lo que te cuentan. NO inventes precios, cifras, años de experiencia, premios, clientes, direcciones ni testimonios: pon [corchetes] para que el creador complete (p. ej. "[precio]", "[ciudad]", "[Escribe aquí lo que dijo un cliente real]").
- Deja "bUrl" vacío: el creador pone su enlace o su WhatsApp.
- Nada de contenido sexual, de odio, ilegal, engañoso ni promesas médicas o de dinero fácil.`;

const EJEMPLO_LANDING = `{"titulo":"Estudio de tatuajes Tinta Viva","resumen":"Tatuajes personalizados de línea fina y realismo en [ciudad]. Diseño a tu medida y agenda por WhatsApp.","bloques":[
{"tipo":"heroe","titulo":"Tu idea, tatuada para siempre","texto":"Diseñamos contigo un tatuaje único de línea fina o realismo. Agenda tu valoración gratis y llega con la idea; nosotros la convertimos en arte.","bTexto":"Agendar valoración","bUrl":"","b2Texto":"Ver estilos","b2Url":"","variante":"centro","fondo":"degradado","espacio":"amplio"},
{"tipo":"columnas","titulo":"Por qué tatuarte con nosotros","variante":"3","fondo":"","items":[{"icono":"✍️","titulo":"Diseño 100 % tuyo","texto":"Bocetamos contigo hasta que el diseño te encante. Nada de plantillas."},{"icono":"🧼","titulo":"Higiene sin atajos","texto":"Agujas desechables y estación esterilizada en cada sesión."},{"icono":"🩹","titulo":"Te acompañamos al sanar","texto":"Guía de cuidados y revisión incluida para que el tatuaje luzca nítido."}]},
{"tipo":"precios","titulo":"Precios claros desde el principio","texto":"El valor final depende del tamaño y el detalle; te lo confirmamos en la valoración.","fondo":"suave","items":[{"nombre":"Pequeño","precio":"[precio]","periodo":"hasta 5 cm","items":"Diseño personalizado\\nUna sesión\\nGuía de cuidados","bTexto":"Reservar","bUrl":"","destacado":false},{"nombre":"Mediano","precio":"[precio]","periodo":"hasta 15 cm","items":"Todo lo del pequeño\\nSombreado o color\\nRetoque gratis","bTexto":"Reservar","bUrl":"","destacado":true}]},
{"tipo":"testimonios","titulo":"Lo que dicen quienes ya se tatuaron","fondo":"","items":[{"texto":"[Escribe aquí lo que dijo un cliente real]","nombre":"[Nombre]","rol":"[Ciudad]"},{"texto":"[Escribe aquí lo que dijo un cliente real]","nombre":"[Nombre]","rol":"[Ciudad]"}]},
{"tipo":"faq","items":[{"p":"¿Duele mucho?","r":"Depende de la zona. Te recomendamos la mejor ubicación para tu primera vez y hacemos pausas cuando lo necesites."},{"p":"¿Cuánto cuesta?","r":"Depende del tamaño y el detalle. En la valoración gratis te damos el precio exacto, sin compromiso."},{"p":"¿Cómo reservo?","r":"Escríbenos por WhatsApp con tu idea y una foto de referencia; te proponemos fecha y hora."}]},
{"tipo":"cta","titulo":"¿Listo para tu próximo tatuaje?","texto":"Cuéntanos tu idea hoy y te respondemos en minutos.","bTexto":"Escribir por WhatsApp","bUrl":"","fondo":"acento"}]}`;

const SISTEMA_LANDING = `Eres Nexus, el asistente de UpGames Blogs. Diseñas landing pages profesionales para personas que no saben programar.
${ESTILO_PRO}
Devuelves SOLO un JSON: {"titulo":"nombre corto de la página","resumen":"meta descripción de 140-155 caracteres con beneficio y llamada a la acción","bloques":[…]}
${FORMA_SECCIONES}
Estructura que convierte (adáptala; omite precios si no aplica al negocio):
1. heroe: promesa principal + texto que resuelve "¿qué gano?" + botón principal (fondo "degradado", espacio "amplio"). Segundo botón solo si tiene sentido.
2. columnas: 3 beneficios o servicios concretos (no genéricos), cada uno con su emoji.
3. precios: 2 o 3 planes con 3-4 líneas cada uno; marca el recomendado con "destacado":true. Precios siempre "[precio]".
4. testimonios: 2 o 3 con [corchetes] (nunca inventes opiniones).
5. faq: 3-4 preguntas que resuelvan las OBJECIONES reales del cliente (precio, tiempo, ubicación, garantía, cómo pedir).
6. cta final: urgencia suave + botón (fondo "acento").
Alterna los fondos para separar las secciones (nunca dos seguidas con el mismo fondo, salvo "").
Ejemplo de NIVEL esperado (otro negocio; no lo copies, úsalo como referencia de calidad):
${EJEMPLO_LANDING}`;

const SISTEMA_SECCION = `Eres Nexus, el asistente de UpGames Blogs. Escribes el contenido de UNA sección de una página web, con calidad profesional.
${ESTILO_PRO}
Devuelves SOLO un JSON con el bloque pedido (sin "fondo"), con esta forma:
${FORMA_SECCIONES}
Columnas: 3 elementos (o los que pidan), cada uno con emoji, título de 2-5 palabras y una frase concreta. Precios: 2-3 planes, 3-4 líneas, uno destacado. Testimonios: 2-3 con [corchetes]. CTA: título con urgencia suave y un botón.`;

const ACCIONES_TEXTO = {
    mejorar: 'Mejora la redacción como un editor profesional: más claro, fluido y preciso; corrige ortografía y puntuación; elimina repeticiones y relleno. Conserva el sentido, los datos y una longitud parecida.',
    corto: 'Reduce el texto a la mitad aproximadamente: quédate con lo esencial y lo más útil para quien lee. Frases cortas y directas.',
    largo: 'Desarrolla el texto (máximo el doble) con explicaciones, ejemplos o pasos útiles. No inventes datos, cifras ni experiencias: si hace falta un dato, ponlo entre [corchetes].',
    vendedor: 'Reescríbelo con técnica de copywriting (problema → solución → beneficio → llamada a la acción): centrado en lo que gana quien lee, concreto y creíble, sin exagerar, sin prometer lo que el texto no dice y sin exclamaciones de más.',
    ortografia: 'Corrige SOLO ortografía, tildes, mayúsculas y puntuación. No cambies palabras, estilo ni orden.',
    cercano: 'Reescríbelo con un tono cercano, cálido y natural, como si se lo explicaras a un amigo, sin perder profesionalidad.',
};
const SISTEMA_TEXTO = `Eres Nexus, el editor de textos de UpGames Blogs: escribes con la calidad de un redactor profesional.
Reescribes el texto que te pasan según la instrucción. Devuelves SOLO un JSON: {"texto":"…"}.
Reglas: conserva el idioma original y el formato (**negrita**, *cursiva*, listas con "- " o "1. ", enlaces [texto](https://…) y párrafos separados por una línea en blanco). Mantén los [corchetes] que ya existan. No añadas saludos, comentarios, títulos ni datos inventados.`;

const SISTEMA_SEO = `Eres Nexus, especialista SEO de UpGames Blogs. Con el título y el texto de una página propones:
{"titulo":"título SEO de 45-60 caracteres: palabra clave principal al inicio + beneficio o lugar; sin mayúsculas sostenidas ni clickbait","resumen":"meta descripción de 140-155 caracteres: qué ofrece, para quién y una llamada a la acción","etiquetas":["3 a 6 palabras clave cortas en minúscula, las que buscaría la gente"]}
Devuelves SOLO ese JSON, en el idioma del texto. Fiel al contenido: no inventes datos, precios ni lugares.`;

const TIPOS_LANDING = new Set(['heroe', 'columnas', 'precios', 'testimonios', 'cta', 'texto', 'titulo', 'faq']);

/**
 * Retoque de diseño por código (no se le deja al modelo): héroe amplio y con fondo, CTA final con color
 * y fondos alternos para que dos secciones seguidas nunca se vean iguales.
 */
function pulirSecciones(bloques) {
    let previo = null;
    return bloques.map((b, i) => {
        if (!V.SECCIONES.has(b.tipo)) { previo = null; return b; }
        const n = { ...b };
        if (n.tipo === 'heroe' && i === 0) { n.espacio = 'amplio'; if (!n.fondo) n.fondo = 'degradado'; }
        if (n.tipo === 'cta' && !n.fondo) n.fondo = 'acento';
        if (previo && n.fondo && n.fondo === previo) n.fondo = n.fondo === 'suave' ? '' : 'suave';
        else if (previo && !n.fondo && previo === '' && n.tipo !== 'cta') n.fondo = 'suave';
        previo = n.fondo;
        return n;
    });
}

/** Landing de Nexus → bloques válidos (solo tipos de landing) o null. Añade el contacto si el creador dio uno. */
function armarLanding(o, contacto) {
    if (!o || typeof o !== 'object') return null;
    let bloques = pulirSecciones(V.limpiarBloques(o.bloques).filter(b => TIPOS_LANDING.has(b.tipo)));
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

module.exports = { SISTEMA, TIPOS, pedido, armar, pulirSecciones, SISTEMA_LANDING, SISTEMA_SECCION, SISTEMA_TEXTO, SISTEMA_SEO, ACCIONES_TEXTO, armarLanding, armarSeccion };
