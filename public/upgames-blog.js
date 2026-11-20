/* ══════════════════════════════════════════════════════════════════
   UpGames Blogs · panel del creador (public/blog.html)

   Una sola página con cuatro partes:
     1. Base: sesión, llamadas a la API, avisos y hojas (menús).
     2. Bienvenida, asistente para crear el blog y formulario de reporte.
     3. Panel: Entradas, Páginas, Estadísticas, Tema y Ajustes (con dominio propio).
     4. Editor por bloques.
   El servidor está en rutas/blogs.js. Lo que se guarda son bloques (JSON), no HTML.
   ══════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

// ── 1. BASE ─────────────────────────────────────────────────────────
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = (LOCAL && new URLSearchParams(location.search).get('api')) || window.UG_CONFIG?.API_URL || 'https://upgames-production.up.railway.app';
const leer = k => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } };
const TOKEN = leer('token'), YO = leer('user_admin').toLowerCase();
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = n => `<ion-icon name="${n}"></ion-icon>`;

const S = { blogs: [], blog: null, vista: 'entradas', temas: [], fuentes: [], fondos: [], cpm: 0, maximo: 3, premium: false };

async function api(ruta, { metodo = 'GET', cuerpo, publico } = {}) {
  let r;
  try {
    r = await fetch(API + ruta, { method: metodo, headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(publico ? {} : { Authorization: `Bearer ${TOKEN}` }) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  } catch (_) { throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !publico) { toast('Tu sesión expiró. Inicia sesión de nuevo.', true); setTimeout(() => location.replace('../login.html'), 1500); throw new Error('Sesión expirada'); }
  if (!r.ok || d.success === false) { const e = new Error(d.error || 'No se pudo completar. Inténtalo de nuevo.'); e.code = d.code; throw e; }
  if (d.cupo) nexusCupoVisto(d.cupo);
  return d;
}

let tToast;
function toast(msg, mal) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (mal ? ' mal' : ''); t.hidden = false;
  clearTimeout(tToast); tToast = setTimeout(() => { t.hidden = true; }, mal ? 4200 : 2600);
}

/** Hoja inferior: menús y diálogos. Devuelve la caja para enganchar eventos. */
function hoja(html) {
  const el = $('#hoja');
  el.innerHTML = `<div class="caja" role="dialog" aria-modal="true">${html}</div>`;
  el.hidden = false;
  el.onclick = e => { if (e.target === el) cerrarHoja(); };
  return el.firstElementChild;
}
function cerrarHoja() { const el = $('#hoja'); el.hidden = true; el.innerHTML = ''; }
function confirmar(titulo, texto, boton = 'Aceptar', rojo = false) {
  return new Promise(ok => {
    const c = hoja(`<h3>${h(titulo)}</h3><p>${h(texto)}</p><div class="fila"><button class="btn" data-no style="flex:1">Cancelar</button><button class="btn ${rojo ? 'rojo' : 'pri'}" data-si style="flex:1">${h(boton)}</button></div>`);
    $('[data-no]', c).onclick = () => { cerrarHoja(); ok(false); };
    $('[data-si]', c).onclick = () => { cerrarHoja(); ok(true); };
  });
}
async function ocupado(boton, tarea) {
  if (boton.disabled) return;
  const antes = boton.innerHTML;
  boton.disabled = true; boton.innerHTML = '<span class="giro" style="width:18px;height:18px;border-width:2px"></span>';
  try { return await tarea(); } catch (e) { avisarError(e); } finally { boton.disabled = false; boton.innerHTML = antes; }
}
/** Error para el usuario; si es el límite del plan gratis de Nexus, ofrece Premium en vez de un aviso suelto. */
function avisarError(e) {
  if (e.code !== 'LIMITE') return toast(e.message, true);
  hoja(`<h3>✦ Llegaste al límite de hoy</h3><p>${h(e.message)}</p><p style="color:var(--txt2)">Con <b>Premium</b> tienes Nexus ilimitado, temas exclusivos y tu blog sin la marca de UpGames.</p>
    <div class="fila"><button class="btn" data-no style="flex:1">Mañana sigo</button><a class="btn pri" style="flex:1" href="/?plan=1">${ico('star')} Ver Premium</a></div>`).querySelector('[data-no]').onclick = cerrarHoja;
}
// Cupo de Nexus (lo devuelve el servidor en cada respuesta de Nexus)
let NX_CUPO = null;
function nexusCupoVisto(c) { if (NX_CUPO && !c.premium && c.quedan != null && NX_CUPO.ultima) NX_CUPO.acciones[NX_CUPO.ultima] = { ...NX_CUPO.acciones[NX_CUPO.ultima], quedan: c.quedan }; }
async function nexusCupo() { try { NX_CUPO = await api('/blogs/nexus/cupo'); } catch (_) {} return NX_CUPO; }
function lineaCupo() {
  if (!NX_CUPO) return '';
  if (NX_CUPO.premium) return `<p class="nx-cupo pro">${ico('star')} Premium: Nexus ilimitado</p>`;
  const a = NX_CUPO.acciones, n = (k, s, p) => `<b>${a[k].quedan}</b> ${a[k].quedan === 1 ? s : p}`;
  return `<p class="nx-cupo">Plan gratis · hoy te quedan ${n('landing', 'landing', 'landings')}, ${n('seccion', 'sección', 'secciones')}, ${n('texto', 'mejora de texto', 'mejoras de texto')} y ${n('seo', 'SEO', 'SEO')}. <a href="/?plan=1">✦ Ilimitado con Premium</a></p>`;
}
const fechaCorta = d => d ? new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
const num = n => Number(n || 0).toLocaleString('es');
async function copiar(texto) { try { await navigator.clipboard.writeText(texto); toast('Enlace copiado'); } catch (_) { prompt('Copia el enlace:', texto); } }

/** Sube una imagen directo a Cloudinary con la firma del servidor (igual que las portadas de UpGames). */
function elegirImagen() { return elegirImagenes(false).then(l => l[0] || null); }
/** Varias a la vez (galería). Devuelve [] si cierra sin elegir. */
function elegirImagenes(varias = true) {
  return new Promise(ok => {
    const inp = $('#archivo');
    inp.value = ''; inp.multiple = varias;
    inp.onchange = () => ok([...inp.files]);
    inp.click();
  });
}
// Mismo subidor que el resto de UpGames (preset público de Cloudinary); la firma del servidor queda de respaldo
const CLD_NUBE = 'dd4w2plxn', CLD_PRESET = 'upgames_videos';
async function enviarCloudinary(nube, campos, archivo) {
  const fd = new FormData();
  fd.append('file', archivo);
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  let r;
  try { r = await fetch(`https://api.cloudinary.com/v1_1/${nube}/image/upload`, { method: 'POST', body: fd }); } catch (_) { throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.'); }
  const d = await r.json().catch(() => null);
  if (d?.secure_url) return d.secure_url;
  throw new Error(d?.error?.message ? `No se pudo subir la imagen: ${d.error.message}` : 'No se pudo subir la imagen. Inténtalo de nuevo.');
}
async function subirImagen(archivo) {
  // Algunas galerías de Android entregan la foto sin tipo (o HEIC): se mira también la extensión
  const esImagen = archivo.type.startsWith('image/') || (!archivo.type && /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(archivo.name));
  if (!esImagen) throw new Error('Ese archivo no es una imagen.');
  if (archivo.size > 20 * 1024 * 1024) throw new Error('La imagen pesa más de 20 MB. Elige una más ligera.');
  try { return await enviarCloudinary(CLD_NUBE, { upload_preset: CLD_PRESET, folder: 'covers' }, archivo); }
  catch (e) {
    if (/conexión/.test(e.message)) throw e;
    const f = await api('/upload/sign?folder=covers');
    return enviarCloudinary(f.cloud_name, { api_key: f.api_key, timestamp: f.timestamp, signature: f.signature, folder: f.folder }, archivo);
  }
}
const mini = (url, w) => String(url || '').replace(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!.*\/(?:w_|c_))/, `$1f_auto,q_auto,w_${w},c_limit/`);

// ── 2. BIENVENIDA, ASISTENTE Y REPORTE ──────────────────────────────
const LOGO = '<a class="logo" href="/"><span><i>UP</i>GAMES</span><small>BLOGS</small></a>';

function bienvenida() {
  app.innerHTML = `<div class="portal">${LOGO}
    <section class="heroe">
      <h1>Tu sitio web,<br><em>hecho en UpGames</em></h1>
      <p>Elige un diseño, escribe y publica. Sin programar y gratis. Cuando quieras, conéctale tu propio dominio.</p>
      <a class="btn pri" href="../login.html">${ico('rocket-outline')} Entrar y crear mi blog</a>
    </section>
    <div class="ventajas">
      <div class="glass">${ico('color-palette-outline')}<b>Temas listos</b><span>Cinco diseños que puedes personalizar con tu color, tu logo y tu portada.</span></div>
      <div class="glass">${ico('create-outline')}<b>Editor fácil</b><span>Secciones de landing (portada, servicios, precios, opiniones), texto, galerías, videos, redes y WhatsApp.</span></div>
      <div class="glass">${ico('sparkles-outline')}<b>✦ Nexus te ayuda</b><span>Crea tu landing con IA a partir de una frase, mejora tus textos y te dice qué falta antes de publicar.</span></div>
      <div class="glass">${ico('globe-outline')}<b>Tu dominio</b><span>Empieza con una dirección gratis y conecta tu dominio cuando lo tengas.</span></div>
      <div class="glass">${ico('stats-chart-outline')}<b>Estadísticas</b><span>Mira cuántas visitas tienes cada día y qué entradas gustan más.</span></div>
    </div>
    <p class="guia-enlace"><a href="./blogs-guia.html">${ico('book-outline')} Lee la guía de UpGames Blogs: cómo funciona, cómo ganar y tus responsabilidades</a></p></div>`;
}

function tarjetasTema(elegido) {
  return `<div class="temas">${S.temas.map(t => `<button type="button" class="tema${t.id === elegido ? ' on' : ''}" data-tema="${h(t.id)}">${t.premium ? `<em class="pro">${S.premium ? 'PREMIUM' : '🔒 PREMIUM'}</em>` : ''}
    <div class="mini" style="background:${h(t.colores.bg)}"><i style="background:${h(t.colores.txt)};width:60%"></i><i style="background:${h(t.colores.acento)};width:34%"></i><u style="background:${h(t.colores.tarjeta)};border:1px solid ${h(t.colores.acento)}55"></u></div>
    <b>${h(t.nombre)}</b><span>${h(t.descripcion)}</span></button>`).join('')}</div>`;
}

function asistente(puedeVolver) {
  let tema = S.temas[0]?.id || 'neon', tDir, dirTocada = false;
  app.innerHTML = `<div class="portal">${LOGO}
    <form class="asistente glass" autocomplete="off">
      <h2>Crea tu blog</h2><p>Solo te toma un minuto. Todo se puede cambiar después.</p>
      <label class="campo"><span>Nombre del blog</span><input class="inp" name="titulo" maxlength="140" placeholder="Ej.: Mods y trucos de Kale" required></label>
      <label class="campo"><span>Dirección</span><div class="prefijo"><b>…/b/</b><input class="inp" name="direccion" maxlength="30" placeholder="mi-blog" required autocapitalize="off" spellcheck="false"></div><small id="dir-nota">Letras, números y guiones. Entre 3 y 30 caracteres.</small></label>
      <label class="campo"><span>De qué trata (opcional)</span><input class="inp" name="descripcion" maxlength="300" placeholder="Una frase que lo describa"></label>
      <div class="campo"><span>Elige un tema</span>${tarjetasTema(tema)}</div>
      <label class="acepto"><input type="checkbox" name="acepto" required><span>Soy el único responsable de todo lo que publique en mi blog (textos, imágenes, enlaces, descargas, dominio y comentarios que mantenga). UpGames solo presta la herramienta. Acepto los <a href="./terminos_condiciones.html#blogs" target="_blank" rel="noopener">Términos de UpGames Blogs</a> y la <a href="./politica-privacidad.html#blogs-datos" target="_blank" rel="noopener">Política de Privacidad</a>.</span></label>
      <button class="btn pri ancho" type="submit">${ico('sparkles-outline')} Crear mi blog</button>
      ${puedeVolver ? '<button class="btn ancho" type="button" data-volver>Cancelar</button>' : ''}
    </form></div>`;
  const f = $('form', app), nota = $('#dir-nota');
  const limpiar = v => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 30);
  const comprobar = () => {
    clearTimeout(tDir);
    const d = f.direccion.value.replace(/-+$/, '');
    if (d.length < 3) { nota.className = ''; nota.textContent = 'Letras, números y guiones. Entre 3 y 30 caracteres.'; return; }
    tDir = setTimeout(async () => {
      try { const r = await api(`/blogs/direccion-libre?d=${encodeURIComponent(d)}`); nota.className = r.libre ? 'ok' : 'mal'; nota.textContent = r.libre ? '✓ Disponible' : r.motivo; } catch (_) {}
    }, 350);
  };
  f.titulo.oninput = () => { if (!dirTocada) { f.direccion.value = limpiar(f.titulo.value).replace(/-+$/, ''); comprobar(); } };
  f.direccion.oninput = () => { dirTocada = true; f.direccion.value = limpiar(f.direccion.value); comprobar(); };
  f.onclick = e => { const b = e.target.closest('[data-tema]'); if (b && S.temas.find(x => x.id === b.dataset.tema)?.premium && !S.premium) return toast('Ese tema es exclusivo de Premium.', true); if (b) { tema = b.dataset.tema; f.querySelectorAll('.tema').forEach(x => x.classList.toggle('on', x === b)); } };
  if (puedeVolver) $('[data-volver]', f).onclick = () => panel();
  f.onsubmit = e => {
    e.preventDefault();
    ocupado($('[type=submit]', f), async () => {
      const r = await api('/blogs', { metodo: 'POST', cuerpo: { titulo: f.titulo.value, direccion: f.direccion.value.replace(/-+$/, ''), descripcion: f.descripcion.value, tema, aceptaTerminos: f.acepto.checked } });
      S.blogs.push({ ...r.blog, entradas: 0 }); S.blog = S.blogs[S.blogs.length - 1]; S.vista = 'entradas';
      JUEGO_INICIAL ? editor('entrada') : (panel(), toast('¡Tu blog está listo! Escribe tu primera entrada.'));
    });
  };
}

function reporte(direccion) {
  app.innerHTML = `<div class="portal">${LOGO}
    <form class="asistente glass">
      <h2>Reportar un blog</h2><p>Vas a reportar el blog <b>${h(direccion)}</b>. El equipo de UpGames lo revisará.</p>
      <label class="campo"><span>¿Qué pasa con este blog?</span><select class="inp" name="motivo">
        <option value="estafa">Es una estafa o intenta robar datos</option><option value="malware">Lleva a virus o descargas peligrosas</option>
        <option value="sexual">Contenido sexual</option><option value="odio">Odio o acoso</option><option value="copia">Copia contenido de otra persona</option><option value="otro">Otro motivo</option></select></label>
      <label class="campo"><span>Cuéntanos más (opcional)</span><textarea class="inp" name="detalle" maxlength="500"></textarea></label>
      <button class="btn pri ancho" type="submit">Enviar reporte</button>
    </form></div>`;
  const f = $('form', app);
  f.onsubmit = e => {
    e.preventDefault();
    ocupado($('[type=submit]', f), async () => {
      await api('/blogs/reportar', { metodo: 'POST', publico: true, cuerpo: { direccion, motivo: f.motivo.value, detalle: f.detalle.value } });
      f.innerHTML = `<h2>Gracias por avisar</h2><p>Recibimos tu reporte y lo vamos a revisar.</p><a class="btn ancho" href="/">Ir a UpGames</a>`;
    });
  };
}

// ── 3. PANEL ────────────────────────────────────────────────────────
const SECCIONES = [['entradas', 'document-text', 'Entradas'], ['paginas', 'copy', 'Páginas'], ['mensajes', 'mail', 'Mensajes'], ['estadisticas', 'stats-chart', 'Estadísticas'], ['ingresos', 'cash', 'Ingresos'], ['tema', 'color-palette', 'Tema'], ['ajustes', 'settings', 'Ajustes']];

function panel() {
  const b = S.blog;
  app.innerHTML = `<div class="panel">
    <header class="barra">
      <a class="ico" href="/" aria-label="Volver a UpGames">${ico('chevron-back')}</a>
      <button class="quien" id="cambiar"><b><span>${h(b.titulo)}</span>${ico('chevron-down')}</b><small>${h(b.url.replace(/^https?:\/\//, ''))}</small></button>
      <a class="btn chico" href="${h(b.url)}" target="_blank" rel="noopener">${ico('open-outline')} Ver</a>
    </header>
    <nav class="nav" aria-label="Secciones">${SECCIONES.map(([id, i, n]) => `<button data-v="${id}" class="${S.vista === id ? 'on' : ''}">${ico(i + (S.vista === id ? '' : '-outline'))}<span>${n}</span>${id === 'mensajes' ? '<em class="globo" id="globo" hidden></em>' : ''}</button>`).join('')}</nav>
    <main class="vista" id="vista"><div class="cargando"><span class="giro"></span></div></main>
  </div>`;
  $('.nav', app).onclick = e => { const x = e.target.closest('[data-v]'); if (x) { S.vista = x.dataset.v; panel(); } };
  $('#cambiar').onclick = menuBlogs;
  api(`/blogs/${b.id}/mensajes`).then(r => pintarGlobo(r.sinLeer)).catch(() => {});
  ({ entradas: () => vistaLista('entrada'), paginas: () => vistaLista('pagina'), mensajes: vistaMensajes, estadisticas: vistaEstadisticas, ingresos: vistaIngresos, tema: vistaTema, ajustes: vistaAjustes })[S.vista]();
}

function menuBlogs() {
  const c = hoja(`<h3>Tus blogs</h3><div class="opciones">
    ${S.blogs.map(b => `<button data-b="${h(b.id)}">${ico(b.id === S.blog.id ? 'radio-button-on' : 'radio-button-off')}<span>${h(b.titulo)}<small>/b/${h(b.direccion)}</small></span></button>`).join('')}
    ${S.blogs.length < S.maximo ? `<button data-nuevo>${ico('add-circle-outline')}<span>Crear otro blog</span></button>` : ''}</div>`);
  c.onclick = e => {
    const x = e.target.closest('button'); if (!x) return;
    cerrarHoja();
    if (x.dataset.nuevo !== undefined) return asistente(true);
    S.blog = S.blogs.find(b => b.id === x.dataset.b) || S.blog; S.vista = 'entradas'; panel();
  };
}

const ESTADOS = { borrador: ['Borrador', ''], publicada: ['Publicada', 'verde'], programada: ['Programada', 'cian'] };

async function vistaLista(tipo) {
  const v = $('#vista'), esPag = tipo === 'pagina';
  let lista;
  try { lista = (await api(`/blogs/${S.blog.id}/entradas?tipo=${tipo}`)).entradas; } catch (e) { v.innerHTML = `<div class="vacio"><b>No se pudo cargar</b>${h(e.message)}</div>`; return; }
  const aviso = S.blog.estado !== 'activo' ? `<div class="seccion glass" style="border-color:rgba(255,204,0,.4)"><h2>${ico('warning-outline')} Blog en revisión</h2><p>Tu blog recibió reportes y no se muestra al público hasta que el equipo de UpGames lo revise.</p></div>` : '';
  v.innerHTML = `<h1>${esPag ? 'Páginas' : 'Entradas'}</h1><p class="sub">${esPag ? 'Páginas fijas que salen en el menú de tu blog: «Sobre mí», «Contacto»…' : 'Lo que publicas en tu blog, de lo más nuevo a lo más antiguo.'}</p>${aviso}
    ${lista.length ? `<div class="lista">${lista.map(e => {
      const [txt, color] = e.estado === 'programada' && new Date(e.publicadaEn) <= new Date() ? ESTADOS.publicada : ESTADOS[e.estado];
      return `<div class="item glass" data-e="${h(e.id)}" role="button" tabindex="0">
        <div class="mini" ${e.portada ? `style="background-image:url('${h(mini(e.portada, 200))}')"` : ''}>${e.portada ? '' : h((e.titulo[0] || '?').toUpperCase())}</div>
        <div class="cuerpo"><b>${h(e.titulo)}</b><div class="datos"><span class="chip ${color}">${txt}</span><span>${h(fechaCorta(e.estado === 'borrador' ? e.actualizada : e.publicadaEn))}</span>${e.estado !== 'borrador' ? `<span>${ico('eye-outline')} ${num(e.vistas)}</span>` : ''}</div></div>
        <button class="ico" data-menu="${h(e.id)}" aria-label="Más opciones">${ico('ellipsis-vertical')}</button></div>`;
    }).join('')}</div>`
    : `<div class="vacio">${ico(esPag ? 'copy-outline' : 'document-text-outline')}<b>${esPag ? 'Aún no tienes páginas' : 'Escribe tu primera entrada'}</b>Toca el botón <b style="display:inline;color:var(--g)">+</b> para empezar.</div>`}
    <button class="fab" id="nueva" aria-label="${esPag ? 'Crear página' : 'Crear entrada'}">${ico('add')}</button>`;
  $('#nueva').onclick = () => editor(tipo);
  v.onclick = e => {
    const m = e.target.closest('[data-menu]');
    if (m) return menuEntrada(lista.find(x => x.id === m.dataset.menu), tipo);
    const it = e.target.closest('[data-e]'); if (it) editor(tipo, it.dataset.e);
  };
}

function menuEntrada(e, tipo) {
  const url = `${S.blog.url}${tipo === 'pagina' ? 'p' : 'e'}/${e.slug}`, publica = e.estado !== 'borrador';
  const c = hoja(`<h3>${h(e.titulo)}</h3><div class="opciones">
    <button data-a="editar">${ico('create-outline')}<span>Editar</span></button>
    <button data-a="duplicar">${ico('copy-outline')}<span>Duplicar<small>Crea una copia como borrador</small></span></button>
    ${publica ? `<button data-a="ver">${ico('open-outline')}<span>Ver en el blog</span></button><button data-a="copiar">${ico('link-outline')}<span>Copiar enlace</span></button>` : ''}
    ${publica && tipo === 'pagina' ? (S.blog.ajustes?.inicio === e.id ? `<button data-a="no-inicio">${ico('home')}<span>Quitar como inicio<small>Volverá a abrir con la lista de entradas</small></span></button>` : `<button data-a="inicio">${ico('home-outline')}<span>Usar como inicio del sitio<small>Será lo primero que vea quien entre</small></span></button>`) : ''}
    <button data-a="borrar" class="rojo">${ico('trash-outline')}<span>Borrar</span></button></div>`);
  c.onclick = async ev => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    cerrarHoja();
    if (a === 'editar') return editor(tipo, e.id);
    if (a === 'duplicar') { try { await api(`/blogs/${S.blog.id}/entradas/${e.id}/duplicar`, { metodo: 'POST' }); toast('Copia creada como borrador'); vistaLista(tipo); } catch (err) { toast(err.message, true); } return; }
    if (a === 'ver') return window.open(url, '_blank', 'noopener');
    if (a === 'copiar') return copiar(url);
    if (a === 'inicio' || a === 'no-inicio') { try { await guardarBlog({ ajustes: { inicio: a === 'inicio' ? e.id : '' } }, a === 'inicio' ? `«${e.titulo}» es ahora el inicio de tu sitio` : 'Inicio: lista de entradas'); } catch (err) { toast(err.message, true); } return; }
    if (!(await confirmar('¿Borrar?', `«${e.titulo}» se borrará para siempre.`, 'Borrar', true))) return;
    try { await api(`/blogs/${S.blog.id}/entradas/${e.id}`, { metodo: 'DELETE' }); toast('Borrada'); vistaLista(tipo); } catch (err) { toast(err.message, true); }
  };
}

function pintarGlobo(n) { const g = $('#globo'); if (g) { g.hidden = !n; g.textContent = n > 99 ? '99+' : n; } }
const DEC0 = new Set(['COP', 'CLP', 'ARS', 'PYG', 'VES', 'UYU', 'DOP', 'GTQ', 'BOB']);
const LOCAL_MONEDA = { COP: 'es-CO', MXN: 'es-MX', ARS: 'es-AR', CLP: 'es-CL', PEN: 'es-PE', USD: 'en-US', EUR: 'es-ES', BRL: 'pt-BR', UYU: 'es-UY', BOB: 'es-BO', GTQ: 'es-GT', DOP: 'es-DO', VES: 'es-VE' };
const dinero = (n, m) => { try { return new Intl.NumberFormat(LOCAL_MONEDA[m] || 'es', { style: 'currency', currency: m || 'COP', currencyDisplay: 'narrowSymbol', maximumFractionDigits: DEC0.has(m) ? 0 : 2 }).format(n); } catch (_) { return `${n} ${m || ''}`; } };
async function vistaMensajes() {
  const v = $('#vista');
  let r;
  try { r = await api(`/blogs/${S.blog.id}/mensajes`); } catch (e) { v.innerHTML = `<div class="vacio"><b>No se pudo cargar</b>${h(e.message)}</div>`; return; }
  let filtro = 'todos';
  const pintar = () => {
    const lista = r.mensajes.filter(m => filtro === 'todos' || m.tipo === filtro || (filtro === 'sinleer' && !m.leido));
    pintarGlobo(r.mensajes.filter(m => !m.leido).length);
    const wa = t => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 7 ? `https://wa.me/${d}` : ''; };
    v.innerHTML = `<h1>Mensajes</h1><p class="sub">Lo que te mandan desde tu sitio: mensajes del formulario de contacto y pedidos del catálogo.</p>
      <div class="seg rango">${[['todos', 'Todo'], ['sinleer', 'Sin leer'], ['mensaje', 'Mensajes'], ['pedido', 'Pedidos']].map(([k, n]) => `<button data-filtro="${k}" aria-pressed="${filtro === k}">${n}</button>`).join('')}</div>
      ${lista.length ? `<div class="bandeja">${lista.map(m => `<article class="msj glass${m.leido ? '' : ' nuevo'}" data-m="${h(m.id)}">
        <header>${ico(m.tipo === 'pedido' ? 'bag-handle' : 'mail')}<b>${m.tipo === 'pedido' ? `Pedido${m.nombre ? ` · ${h(m.nombre)}` : ''}` : h(m.nombre)}</b><small>${h(new Date(m.fecha).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }))}</small></header>
        ${m.tipo === 'pedido' ? `<ul class="msj-items">${m.items.map(i => `<li><span>${i.cantidad} × ${h(i.nombre)}</span><b>${i.precio ? h(dinero(i.precio * i.cantidad, m.moneda)) : ''}</b></li>`).join('')}</ul>${m.total ? `<p class="msj-total">Total: <b>${h(dinero(m.total, m.moneda))}</b></p>` : ''}<p class="msj-nota">${m.texto ? h(m.texto) : ''}<small>El cliente lo envió a tu WhatsApp: confírmalo allí.</small></p>`
          : `<p class="msj-texto">${h(m.texto)}</p>`}
        <div class="fila">${m.email ? `<a class="btn chico" href="mailto:${h(m.email)}">${ico('mail-outline')} Responder</a>` : ''}${wa(m.telefono) ? `<a class="btn chico" href="${h(wa(m.telefono))}" target="_blank" rel="noopener">${ico('logo-whatsapp')} WhatsApp</a>` : ''}${m.telefono && !wa(m.telefono) ? `<span class="chip">${h(m.telefono)}</span>` : ''}
          <span style="flex:1"></span><button class="btn chico" data-leido="${m.leido ? 0 : 1}">${m.leido ? 'Marcar sin leer' : 'Marcar leído'}</button><button class="ico" data-borrar-m aria-label="Borrar">${ico('trash-outline')}</button></div></article>`).join('')}</div>`
      : `<div class="vacio">${ico('mail-outline')}<b>${filtro === 'todos' ? 'Aún no tienes mensajes' : 'Nada por aquí'}</b>Añade a una página la sección «Formulario de contacto» o «Catálogo + pedido por WhatsApp» y lo que te envíen aparecerá aquí.</div>`}`;
  };
  v.onclick = async e => {
    const f = e.target.closest('[data-filtro]'); if (f) { filtro = f.dataset.filtro; return pintar(); }
    const art = e.target.closest('[data-m]'); if (!art) return;
    const m = r.mensajes.find(x => x.id === art.dataset.m);
    const l = e.target.closest('[data-leido]');
    if (l) { try { await api(`/blogs/${S.blog.id}/mensajes/${m.id}`, { metodo: 'PUT', cuerpo: { leido: l.dataset.leido === '1' } }); m.leido = l.dataset.leido === '1'; pintar(); } catch (err) { toast(err.message, true); } return; }
    if (e.target.closest('[data-borrar-m]')) {
      if (!(await confirmar('¿Borrar este mensaje?', 'No se puede deshacer.', 'Borrar', true))) return;
      try { await api(`/blogs/${S.blog.id}/mensajes/${m.id}`, { metodo: 'DELETE' }); r.mensajes = r.mensajes.filter(x => x !== m); pintar(); } catch (err) { toast(err.message, true); }
      return;
    }
    if (!m.leido && !e.target.closest('a,button')) { m.leido = true; pintar(); api(`/blogs/${S.blog.id}/mensajes/${m.id}`, { metodo: 'PUT', cuerpo: { leido: true } }).catch(() => {}); }
  };
  pintar();
}

let rangoStats = 30;
async function vistaEstadisticas() {
  const v = $('#vista');
  let d;
  try { d = await api(`/blogs/${S.blog.id}/estadisticas`); } catch (e) { v.innerHTML = `<div class="vacio"><b>No se pudo cargar</b>${h(e.message)}</div>`; return; }
  const pintar = () => {
    const R = rangoStats, act = d.serie90.slice(-R), ant = d.serie90.slice(-2 * R, -R);
    const suma = (l, k) => l.reduce((s, x) => s + (x[k] || 0), 0);
    const cambio = k => { if (ant.length < R) return '<em class="neutro">sin periodo anterior</em>'; const a = suma(act, k), b = suma(ant, k); if (!b) return a ? '<em class="sube">nuevo</em>' : ''; const p = Math.round((a - b) / b * 100); return `<em class="${p >= 0 ? 'sube' : 'baja'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</em>`; };
    const kpi = (k, n, icono, extra = '') => /* vs. los R días anteriores */ `<div class="cifra glass">${ico(icono)}<b>${num(suma(act, k))}</b><span>${n}</span>${extra || cambio(k)}</div>`;
    const max = Math.max(1, ...act.map(x => x.n));
    const barras = (pares, total) => pares.map(([n, x, col]) => `<div class="barra-h"><span>${n}</span><i><u style="width:${total ? Math.round(x / total * 100) : 0}%;background:${col}"></u></i><b>${total ? Math.round(x / total * 100) : 0}%</b></div>`).join('');
    const fu = [['Directo o guardado', suma(act, 'rd'), '#5CE1FF'], ['Buscadores (Google…)', suma(act, 'rb'), '#39FF88'], ['Redes sociales', suma(act, 'rs'), '#B8A6FF'], ['UpGames', suma(act, 'ru'), '#FFCC00'], ['Otros sitios', suma(act, 'ro'), '#FF8A65']];
    const tf = fu.reduce((s, x) => s + x[1], 0), mo = suma(act, 'mo'), pc = suma(act, 'pc');
    const contactos = suma(act, 'cw') + suma(act, 'cr') + suma(act, 'cb') + suma(act, 'fm') + suma(act, 'pe');
    const visitas = suma(act, 'n');
    v.innerHTML = `<h1>Estadísticas</h1><p class="sub">Cómo le va a tu sitio: visitas, de dónde llegan y qué hacen.</p>
      <div class="seg rango">${[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([n, t]) => `<button data-rango="${n}" aria-pressed="${R === n}">${t}</button>`).join('')}</div>
      <div class="cifras">${kpi('n', 'Visitas', 'eye-outline')}${kpi('u', 'Visitantes', 'people-outline')}
        <div class="cifra glass">${ico('today-outline')}<b>${num(d.hoy)}</b><span>Visitas hoy</span></div>
        <div class="cifra glass">${ico('trending-up-outline')}<b>${num(Math.round(visitas / R * 10) / 10)}</b><span>Media por día</span></div></div>
      <section class="seccion glass"><h2>${ico('stats-chart')} Visitas por día</h2>
        ${visitas ? `<div><div class="grafica${R > 30 ? ' fina' : ''}" role="img" aria-label="Visitas de los últimos ${R} días">${act.map(x => `<i class="${x.n ? '' : 'cero'}" style="height:${Math.max(3, Math.round(x.n / max * 100))}%" title="${h(fechaCorta(x.dia + 'T12:00:00'))}: ${x.n} visitas"></i>`).join('')}</div>
        <div class="eje"><span>${h(fechaCorta(act[0].dia + 'T12:00:00'))}</span><span>Hoy</span></div></div>` : '<p>Cuando lleguen visitas aparecerán aquí. Comparte tu enlace en tus redes para empezar. ✦</p>'}</section>
      <section class="seccion glass"><h2>${ico('flash')} Contactos y clics</h2>
        <div class="cifras mini">${[['cw', 'WhatsApp', 'logo-whatsapp'], ['cr', 'Redes', 'share-social-outline'], ['cb', 'Botones', 'hand-left-outline'], ['fm', 'Mensajes', 'mail-outline'], ['pe', 'Pedidos', 'bag-handle-outline']].map(([k, n, i]) => `<div class="cifra">${ico(i)}<b>${num(suma(act, k))}</b><span>${n}</span></div>`).join('')}</div>
        <p class="nota-stats">${visitas ? `Conversión: <b>${(contactos / visitas * 100).toFixed(1)}%</b> de las visitas terminaron en un contacto, clic o pedido.` : 'Aquí verás cuántas personas te escriben o tocan tus botones.'}</p></section>
      <div class="dos">
        <section class="seccion glass"><h2>${ico('navigate')} De dónde llegan</h2>${tf ? barras(fu, tf) : '<p>Aún no hay datos.</p>'}</section>
        <section class="seccion glass"><h2>${ico('phone-portrait')} Dispositivos</h2>${mo + pc ? barras([['Celular', mo, '#39FF88'], ['Computador', pc, '#5CE1FF']], mo + pc) : '<p>Aún no hay datos.</p>'}</section>
      </div>
      <section class="seccion glass"><h2>${ico('flame')} Lo más visto</h2>
        ${d.top.length ? `<div class="top">${d.top.map((t, k) => `<div><span class="pos">${k + 1}</span><b>${h(t.titulo)}</b><small>${t.tipo === 'pagina' ? 'Página' : 'Entrada'}</small><span>${num(t.vistas)}</span></div>`).join('')}</div>` : '<p>Cuando tus páginas reciban visitas aparecerán aquí.</p>'}
        <p class="nota-stats">${num(d.total)} visitas desde siempre · ${num(d.publicadas)} entradas publicadas. Los visitantes y las fuentes son aproximados.</p></section>
      ${consejoStats(act, fu, tf, visitas, contactos)}`;
    v.querySelectorAll('[data-rango]').forEach(b => { b.onclick = () => { rangoStats = +b.dataset.rango; pintar(); }; });
  };
  pintar();
}
/** ✦ Nexus lee tus números y te da un consejo concreto. */
function consejoStats(act, fu, tf, visitas, contactos) {
  let t;
  if (!visitas) t = 'Comparte tu enlace en WhatsApp, Instagram y TikTok: las primeras visitas casi siempre llegan desde tus propias redes.';
  else if (tf && fu[1][1] / tf < 0.1) t = 'Casi nadie te encuentra en Google. Usa ✦ «Título, resumen y etiquetas» en tus páginas y publica entradas útiles con frecuencia.';
  else if (contactos / visitas < 0.02) t = 'Te visitan, pero pocos te contactan. Añade una sección «Llamada a la acción» y el botón flotante de WhatsApp en tu página principal.';
  else if (tf && fu[2][1] / tf > 0.5) t = 'Tus redes te traen la mayoría de visitas. Pon el enlace de tu sitio en la biografía y en tus historias para mantener el ritmo.';
  else t = '¡Buen ritmo! Publica algo nuevo cada semana para que Google y tus seguidores vuelvan.';
  return `<section class="seccion glass nx-consejo"><h2>✦ Consejo de Nexus</h2><p>${t}</p></section>`;
}

async function vistaIngresos() {
  const v = $('#vista'), b = S.blog;
  let d;
  try { d = await api(`/blogs/${b.id}/estadisticas`); } catch (e) { v.innerHTML = `<div class="vacio"><b>No se pudo cargar</b>${h(e.message)}</div>`; return; }
  const usd = n => 'US$' + Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: Number(n) > 0 && Number(n) < 0.1 ? 4 : 2 });
  v.innerHTML = `<h1>Ingresos</h1><p class="sub">Tú decides si tu blog lleva publicidad. Si la activas, ganas dinero con cada anuncio que ven tus visitantes.</p>
    <section class="seccion glass"><h2>${ico('cash')} Monetizar con UpGames</h2>
      <label class="interruptor"><span><b>Mostrar publicidad en mi blog</b><br><small style="color:var(--txt3)">Un anuncio al final de cada entrada y del inicio. Además, el bloque «Descarga» abre el enlace final a través del acortador de anuncios Cuty.io (nunca a usuarios Premium). Tus otros enlaces y botones no cambian.</small></span><input type="checkbox" id="monetizar"${b.monetizar ? ' checked' : ''}></label>
      <p>Ganas <b style="color:var(--g)">${usd(d.cpm)}</b> por cada 1.000 anuncios vistos. Se suma a tu saldo de UpGames, el mismo de tus publicaciones, y lo retiras desde <a href="/">tu perfil → Economía</a>.</p>
      ${b.visibilidad !== 'publico' ? '<p style="color:var(--amber)">Tu blog está oculto: los anuncios solo se muestran en blogs públicos.</p>' : ''}
    </section>
    <div class="cifras"><div class="cifra glass"><b>${usd(d.ingresosMes)}</b><span>Últimos 30 días</span></div><div class="cifra glass"><b>${usd(d.ingresos)}</b><span>Desde siempre</span></div><div class="cifra glass"><b>${num(d.anunciosMes)}</b><span>Anuncios vistos (30 días)</span></div></div>
    <section class="seccion glass"><h2>${ico('download')} Descargas que generas</h2>
      <p>Cuando alguien pulsa un bloque <b>Descarga</b> de tus entradas y la descarga es válida, ganas <b style="color:var(--g)">${usd(d.cpmDescargas)}</b> por cada 1.000, <b>aunque tengas la publicidad apagada</b>. Es aparte de lo que cobra el autor del juego. No aplica a tus propios juegos.</p>
      <div class="cifras"><div class="cifra glass"><b>${usd(d.ingresosDescargasMes)}</b><span>Últimos 30 días</span></div><div class="cifra glass"><b>${usd(d.ingresosDescargas)}</b><span>Desde siempre</span></div><div class="cifra glass"><b>${num(d.descargas)}</b><span>Descargas pagadas</span></div></div>
    </section>
    <section class="seccion glass"><h2>${ico('heart')} Apoyos de tus lectores y afiliados</h2>
      <p>Añade a una página el bloque <b>«Apoyar al creador»</b>: tus lectores te apoyan con UpCoins desde UpGames y recibes tu parte como ganancia (50 %, retirable tras 7 días), igual que los apoyos a tus publicaciones. Te avisamos cada vez que alguien te apoya.</p>
      <p>Con el bloque <b>«Enlaces de afiliado»</b> recomiendas productos con tu enlace de Amazon u otras tiendas; la comisión te la paga la tienda, no UpGames. El aviso «Enlaces de afiliado» se muestra siempre.</p></section>
    <section class="seccion glass"><h2>${ico('shield-checkmark')} Cómo se cuenta</h2>
      <p>Un anuncio cuenta cuando una persona real lo tuvo a la vista unos segundos y no usa bloqueador. Cada visitante cuenta hasta 3 veces al día en tu blog. Las visitas falsas o hechas por ti mismo no pagan y pueden suspender la monetización.</p></section>`;
  $('#monetizar').onchange = async e => {
    const quiere = e.target.checked;
    if (quiere && !(await confirmar('¿Activar la publicidad?', 'Tus visitantes verán un anuncio al final de cada entrada y el bloque «Descarga» pasará por el acortador de anuncios Cuty.io (sin acortador para quien tiene Premium). Puedes quitarla cuando quieras.', 'Activar'))) { e.target.checked = false; return; }
    try { await guardarBlog({ monetizar: quiere }, quiere ? 'Publicidad activada' : 'Publicidad desactivada'); } catch (err) { e.target.checked = !quiere; toast(err.message, true); }
  };
}

async function guardarBlog(cambios, mensaje = 'Guardado') {
  const r = await api(`/blogs/${S.blog.id}`, { metodo: 'PUT', cuerpo: cambios });
  ponerBlog(r.blog); toast(mensaje);
}
function ponerBlog(nuevo) {
  const i = S.blogs.findIndex(b => b.id === nuevo.id);
  S.blog = S.blogs[i] = { ...S.blogs[i], ...nuevo };
}

function vistaTema() {
  const v = $('#vista'), b = S.blog, a = b.ajustes || {}, g = a.gadgets || {};
  const tema = S.temas.find(t => t.id === b.tema) || S.temas[0];
  const foto = (clave, titulo, nota) => `<div class="campo"><span>${titulo}</span><div class="fila">
    ${a[clave] ? `<img src="${h(mini(a[clave], 240))}" alt="" style="height:64px;max-width:150px;border-radius:12px;object-fit:cover">` : ''}
    <button class="btn chico" data-subir="${clave}">${ico('image-outline')} ${a[clave] ? 'Cambiar' : 'Subir imagen'}</button>${a[clave] ? `<button class="btn chico rojo" data-quitar="${clave}">Quitar</button>` : ''}</div><small>${nota}</small></div>`;
  v.innerHTML = `<h1>Tema</h1><p class="sub">Cambia el aspecto de tu blog. Tus entradas no se pierden al cambiar de tema.</p>
    <section class="seccion glass"><h2>${ico('brush')} Diseño</h2>${tarjetasTema(b.tema)}</section>
    <section class="seccion glass kit"><h2>${ico('diamond')} Kit de marca</h2><p>Tu logo, tus colores y tus letras en todo el sitio. Mira cómo queda antes de guardar.</p>
      ${foto('logo', 'Logo', 'Sale junto al nombre del blog y como icono de la pestaña.')}
      <div class="kit-colores">
        <label class="campo"><span>Color principal</span><input type="color" id="acento" value="${h(a.acento || tema.colores.acento)}"></label>
        <label class="campo"><span>Color secundario</span><input type="color" id="acento2" value="${h(a.acento2 || tema.colores.acento2 || tema.colores.acento)}"></label>
      </div>
      <div class="kit-colores">
        <label class="campo"><span>Letra de los títulos</span><select class="inp" id="fuente"><option value="">La del tema</option>${S.fuentes.map(f => `<option value="${h(f.id)}"${a.fuente === f.id ? ' selected' : ''}>${h(f.nombre)}</option>`).join('')}</select></label>
        <label class="campo"><span>Letra del texto</span><select class="inp" id="fuenteTexto"><option value="">Manrope (la de siempre)</option>${S.fuentes.filter(f => !['orbitron', 'mono', 'rajdhani'].includes(f.id)).map(f => `<option value="${h(f.id)}"${a.fuenteTexto === f.id ? ' selected' : ''}>${h(f.nombre)}</option>`).join('')}</select></label>
      </div>
      <div class="kit-vista" id="kit-vista"></div>
      <p class="kit-aviso" id="kit-aviso" hidden></p>
      <div class="fila"><button class="btn pri chico" id="kit-ok">${ico('checkmark')} Guardar kit de marca</button>${a.acento || a.acento2 || a.fuente || a.fuenteTexto ? '<button class="btn chico" id="kit-no">Volver al del tema</button>' : ''}<button class="btn chico nexus" id="kit-nx"><b>✦</b> Sugerir con Nexus</button></div>
    </section>
    <section class="seccion glass"><h2>${ico('color-fill')} Personalizar</h2>
      <label class="campo"><span>Fondo</span><select class="inp" data-aj="fondo"><option value="">El del tema</option>${S.fondos.map(f => `<option value="${h(f.id)}"${a.fondo === f.id ? ' selected' : ''}>${h(f.nombre)}</option>`).join('')}</select></label>
      <label class="campo"><span>Esquinas</span><select class="inp" data-aj="esquinas">${[['', 'Las del tema'], ['rectas', 'Rectas'], ['suaves', 'Suaves'], ['redondas', 'Muy redondas']].map(([k, n]) => `<option value="${k}"${(a.esquinas || '') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="campo"><span>Cómo se ven las entradas en el inicio</span><select class="inp" data-aj="portadaForma">${[['', 'Como el tema'], ['rejilla', 'Tarjetas en rejilla'], ['lista', 'Lista con foto al lado'], ['revista', 'Revista: la última en grande']].map(([k, n]) => `<option value="${k}"${(a.portadaForma || '') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      ${foto('portada', 'Foto de portada', 'Fondo grande de la parte de arriba del inicio.')}
    </section>
    <section class="seccion glass"><h2>${ico('grid')} Barra lateral</h2><p>Elige qué se muestra al lado de tus entradas.</p><div>
      ${[['perfil', 'Tu perfil de UpGames'], ['populares', 'Lo más leído'], ['etiquetas', 'Etiquetas']].map(([k, n]) => `<label class="interruptor"><span>${n}</span><input type="checkbox" data-gadget="${k}"${g[k] !== false ? ' checked' : ''}></label>`).join('')}</div>
    </section>
    <section class="seccion glass"><h2>${ico('link')} Enlaces</h2><p>Tus redes u otros sitios (hasta 6). Salen en la barra lateral.</p>
      <div id="enlaces" style="display:grid;gap:8px">${[...(a.enlaces || []), { texto: '', url: '' }].slice(0, 6).map(e => `<div class="fila"><input class="inp" style="flex:1;min-width:110px" placeholder="Nombre (YouTube)" maxlength="40" value="${h(e.texto)}"><input class="inp" style="flex:2;min-width:160px" placeholder="https://…" value="${h(e.url)}" inputmode="url"></div>`).join('')}</div>
      <button class="btn chico" id="enlaces-ok">Guardar enlaces</button></section>`;
  const aplicar = (cambios, msg) => guardarBlog(cambios, msg).then(vistaTema).catch(e => toast(e.message, true));
  v.onclick = async e => {
    const t = e.target.closest('[data-tema]'); if (t && S.temas.find(x => x.id === t.dataset.tema)?.premium && !S.premium) return toast('Ese tema es exclusivo de Premium. Lo activas en Creator Studio → Premium.', true); if (t && t.dataset.tema !== b.tema) return aplicar({ tema: t.dataset.tema }, 'Tema cambiado');
    const s = e.target.closest('[data-subir]');
    if (s) { const f = await elegirImagen(); if (!f) return; return ocupado(s, async () => { const url = await subirImagen(f); await aplicar({ ajustes: { [s.dataset.subir]: url } }); }); }
    const q = e.target.closest('[data-quitar]'); if (q) return aplicar({ ajustes: { [q.dataset.quitar]: '' } });
    if (e.target.closest('#kit-ok')) return aplicar({ ajustes: { acento: $('#acento').value, acento2: $('#acento2').value, fuente: $('#fuente').value, fuenteTexto: $('#fuenteTexto').value } }, 'Kit de marca guardado');
    if (e.target.closest('#kit-no')) return aplicar({ ajustes: { acento: '', acento2: '', fuente: '', fuenteTexto: '' } }, 'Volviste al estilo del tema');
    if (e.target.closest('#kit-nx')) return nexusColores(tema, p => { $('#acento').value = p.acento; if (p.acento2) $('#acento2').value = p.acento2; if (p.fuente) $('#fuente').value = p.fuente; if (p.fuenteTexto) $('#fuenteTexto').value = p.fuenteTexto; vistaKit(); toast('✦ Paleta puesta. Revísala y toca «Guardar kit de marca».'); });
    if (e.target.closest('#enlaces-ok')) {
      const enlaces = [...$('#enlaces').children].map(f => ({ texto: f.children[0].value.trim(), url: f.children[1].value.trim() })).filter(x => x.texto || x.url);
      if (enlaces.some(x => !x.texto || !/^https:\/\/\S+\.\S+/.test(x.url))) return toast('Cada enlace necesita un nombre y una dirección que empiece por https://', true);
      return aplicar({ ajustes: { enlaces } }, 'Enlaces guardados');
    }
  };
  // Vista previa en vivo del kit y aviso si el color principal se lee poco sobre el fondo del tema
  const vistaKit = () => {
    const c1 = $('#acento').value, c2 = $('#acento2').value, bg = tema.colores.bg, txt = tema.colores.txt;
    const ft = id => ({ manrope: 'Manrope', orbitron: 'Orbitron', rajdhani: 'Rajdhani', serif: 'Playfair Display', mono: 'Share Tech Mono', poppins: 'Poppins', montserrat: 'Montserrat', inter: 'Inter', grotesk: 'Space Grotesk', lora: 'Lora' })[id];
    const fTit = ft($('#fuente').value), fTxt = ft($('#fuenteTexto').value) || 'Manrope';
    const familias = [...new Set([fTit, fTxt].filter(Boolean))];
    if (familias.length && !document.getElementById('kit-fuentes-' + familias.join('-'))) document.head.insertAdjacentHTML('beforeend', `<link id="kit-fuentes-${familias.join('-')}" rel="stylesheet" href="https://fonts.googleapis.com/css2?${familias.map(f => `family=${f.replace(/ /g, '+')}:wght@400;700;800`).join('&')}&display=swap">`);
    $('#kit-vista').innerHTML = `<div style="background:${h(bg)};color:${h(txt)};border-radius:16px;padding:18px;font-family:'${h(fTxt)}',sans-serif">
      <div style="background:linear-gradient(135deg,${h(c1)}55,${h(c2)}22);border-radius:12px;padding:18px;text-align:center">
        <b style="display:block;font-family:'${h(fTit || fTxt)}',sans-serif;font-size:1.3rem;margin-bottom:6px">${h(b.titulo)}</b>
        <span style="opacity:.8;font-size:.9rem">Así se verán tus títulos, textos y botones.</span><br>
        <span style="display:inline-block;margin-top:12px;background:${h(c1)};color:${h(sobreColor(c1))};font-weight:800;padding:9px 20px;border-radius:99px;font-size:.88rem">Botón principal</span></div></div>`;
    const r = contraste(c1, bg), av = $('#kit-aviso');
    av.hidden = r >= 3; av.textContent = r < 3 ? `⚠ Tu color principal se lee poco sobre el fondo de este tema (contraste ${r.toFixed(1)}:1). Elige uno más ${luz(bg) < .4 ? 'claro o vivo' : 'oscuro'}.` : '';
  };
  ['acento', 'acento2', 'fuente', 'fuenteTexto'].forEach(id => $('#' + id).addEventListener('input', vistaKit));
  vistaKit();
  v.onchange = e => {
    if (['acento', 'acento2', 'fuente', 'fuenteTexto'].includes(e.target.id)) return;
    if (e.target.dataset.aj) return aplicar({ ajustes: { [e.target.dataset.aj]: e.target.value } }, 'Diseño actualizado');
    if (e.target.dataset.gadget) {
      const gadgets = Object.fromEntries([...v.querySelectorAll('[data-gadget]')].map(x => [x.dataset.gadget, x.checked]));
      guardarBlog({ ajustes: { gadgets } }).catch(err => toast(err.message, true));
    }
  };
}

function vistaAjustes() {
  const v = $('#vista'), b = S.blog, d = b.dominio;
  v.innerHTML = `<h1>Ajustes</h1><p class="sub">Los datos generales de tu blog.</p>
    <form class="seccion glass" id="f-datos"><h2>${ico('information-circle')} Datos</h2>
      <label class="campo"><span>Nombre del blog</span><input class="inp" name="titulo" maxlength="140" value="${h(b.titulo)}" required></label>
      <label class="campo"><span>Descripción</span><textarea class="inp" name="descripcion" maxlength="300">${h(b.descripcion)}</textarea><small>Sale en la portada y en Google.</small></label>
      <label class="campo"><span>Dirección</span><div class="prefijo"><b>…/b/</b><input class="inp" name="direccion" maxlength="30" value="${h(b.direccion)}" autocapitalize="off" spellcheck="false" required></div><small>Si la cambias, los enlaces que ya compartiste dejarán de funcionar.</small></label>
      <label class="campo"><span>Quién puede verlo</span><select class="inp" name="visibilidad"><option value="publico"${b.visibilidad === 'publico' ? ' selected' : ''}>Público: aparece en Google</option><option value="oculto"${b.visibilidad === 'oculto' ? ' selected' : ''}>Oculto: solo quien tenga el enlace</option></select></label>
      <label class="campo"><span>Idioma</span><select class="inp" name="idioma">${[['es', 'Español'], ['en', 'English'], ['pt', 'Português']].map(([k, n]) => `<option value="${k}"${(b.ajustes?.idioma || 'es') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <button class="btn pri" type="submit">Guardar cambios</button></form>
    <section class="seccion glass"><h2>${ico('home')} Página de inicio</h2><p>Lo primero que ve quien entra a tu sitio. Elige una página para tener una landing (tus entradas pasan a «Blog» en el menú).</p>
      <div class="fila"><select class="inp" id="inicio" style="flex:1;min-width:200px"><option value="">La lista de entradas (blog)</option></select><button class="btn chico" id="inicio-ok">Guardar</button></div>
      <small id="inicio-nota" style="color:var(--txt3)"></small></section>
    <section class="seccion glass"><h2>${ico('share-social')} Tu enlace</h2>
      <div class="fila"><code style="flex:1;min-width:0;word-break:break-all;color:var(--cy)">${h(b.url)}</code><button class="btn chico" id="copiar-url">${ico('copy-outline')} Copiar</button></div></section>
    <section class="seccion glass" id="s-dominio"><h2>${ico('globe')} Dominio propio ${d ? `<span class="chip ${d.verificado ? 'verde' : 'ambar'}">${d.verificado ? 'Conectado' : 'Pendiente'}</span>` : ''}</h2>
      ${d ? `<p>${d.verificado ? `Tu blog responde en <b>${h(d.nombre)}</b>.` : `Para conectar <b>${h(d.nombre)}</b>, entra al panel donde compraste tu dominio (Namecheap, GoDaddy, Cloudflare, Hostinger…), busca la sección <b>DNS</b> y crea estos dos registros:`}</p>
        <div class="dns">${d.registros.map(r => `<div class="reg"><div><span>Tipo</span><b>${h(r.tipo)}</b></div><div><span>Nombre</span><code>${h(r.nombre)}</code></div><div><span>Valor</span><code>${h(r.valor)}</code></div>${r.nota ? `<small>${h(r.nota)}</small>` : ''}</div>`).join('')}</div>
        <p id="dns-msj">${d.verificado ? '' : 'Los cambios de DNS pueden tardar desde unos minutos hasta 24 horas.'}</p>
        <div class="fila"><button class="btn pri chico" id="dns-ver">${ico('refresh')} ${d.verificado ? 'Volver a comprobar' : 'Comprobar conexión'}</button><button class="btn chico rojo" id="dns-quitar">Quitar dominio</button></div>`
      : `<p>¿Ya tienes un dominio? Conéctalo y tu blog se abrirá en él, por ejemplo <b>www.misitio.com</b>.</p>
        <form class="fila" id="f-dominio"><input class="inp" name="dominio" style="flex:1;min-width:180px" placeholder="www.misitio.com" autocapitalize="off" spellcheck="false" required><button class="btn pri" type="submit">Conectar</button></form>`}
    </section>
    <section class="seccion glass" style="border-color:rgba(255,90,90,.25)"><h2 style="color:var(--red)">${ico('trash')} Borrar el blog</h2><p>Se borran el blog y todas sus entradas. No se puede deshacer.</p><div><button class="btn rojo chico" id="borrar-blog">Borrar este blog</button></div></section>`;
  const fd = $('#f-datos');
  fd.onsubmit = e => {
    e.preventDefault();
    ocupado($('[type=submit]', fd), async () => {
      await guardarBlog({ titulo: fd.titulo.value, descripcion: fd.descripcion.value, direccion: fd.direccion.value.trim().toLowerCase(), visibilidad: fd.visibilidad.value, ajustes: { idioma: fd.idioma.value } });
      panel();
    });
  };
  $('#copiar-url').onclick = () => copiar(b.url);
  (async () => {
    const sel = $('#inicio'), nota = $('#inicio-nota');
    try {
      const pags = (await api(`/blogs/${b.id}/entradas?tipo=pagina`)).entradas;
      sel.insertAdjacentHTML('beforeend', pags.map(p => `<option value="${h(p.id)}"${b.ajustes?.inicio === p.id ? ' selected' : ''}${p.estado === 'borrador' ? ' disabled' : ''}>${h(p.titulo)}${p.estado === 'borrador' ? ' (borrador: publícala primero)' : ''}</option>`).join(''));
      if (!pags.length) nota.textContent = 'Aún no tienes páginas. Crea una en «Páginas» con la plantilla «Landing de negocio» o pídesela a ✦ Nexus.';
    } catch (_) {}
    $('#inicio-ok').onclick = e => ocupado(e.currentTarget, () => guardarBlog({ ajustes: { inicio: sel.value } }, sel.value ? 'Inicio cambiado: tu sitio abre con esa página' : 'Inicio: lista de entradas'));
  })();
  const fDom = $('#f-dominio');
  if (fDom) fDom.onsubmit = e => {
    e.preventDefault();
    ocupado($('[type=submit]', fDom), async () => { const r = await api(`/blogs/${b.id}/dominio`, { metodo: 'POST', cuerpo: { dominio: fDom.dominio.value } }); ponerBlog(r.blog); vistaAjustes(); $('#s-dominio').scrollIntoView({ behavior: 'smooth' }); });
  };
  const ver = $('#dns-ver');
  if (ver) ver.onclick = () => ocupado(ver, async () => {
    const r = await api(`/blogs/${b.id}/dominio/verificar`, { metodo: 'POST' });
    ponerBlog(r.blog);
    if (r.verificado) { vistaAjustes(); panelCabecera(); toast(r.mensaje); } else { $('#dns-msj').textContent = r.mensaje; toast('Todavía no está listo', true); }
  });
  const quitar = $('#dns-quitar');
  if (quitar) quitar.onclick = async () => {
    if (!(await confirmar('¿Quitar el dominio?', 'Tu blog volverá a abrirse solo en su dirección de UpGames.', 'Quitar', true))) return;
    try { const r = await api(`/blogs/${b.id}/dominio`, { metodo: 'DELETE' }); ponerBlog(r.blog); panel(); } catch (e) { toast(e.message, true); }
  };
  $('#borrar-blog').onclick = async () => {
    if (!(await confirmar(`¿Borrar «${b.titulo}»?`, 'Se borrarán el blog y todas sus entradas y páginas. Esto no se puede deshacer.', 'Sí, borrar todo', true))) return;
    try {
      await api(`/blogs/${b.id}`, { metodo: 'DELETE' });
      S.blogs = S.blogs.filter(x => x.id !== b.id); S.blog = S.blogs[0] || null; S.vista = 'entradas';
      S.blog ? panel() : asistente(false); toast('Blog borrado');
    } catch (e) { toast(e.message, true); }
  };
}
function panelCabecera() { const s = $('.barra .quien small'); if (s) s.textContent = S.blog.url.replace(/^https?:\/\//, ''); const a = $('.barra a.btn'); if (a) a.href = S.blog.url; }

// ── 4. EDITOR POR BLOQUES ───────────────────────────────────────────
// Texto con formato ↔ marcas sencillas (**negrita**, *cursiva*, `código`, [texto](https://…), listas con «- »).
// Es el mismo formato que entiende el servidor (modulos/blogs/render.js).
function enLinea(t) {
  let x = h(t); const cod = [];
  x = x.replace(/`([^`\n]+)`/g, (_, c) => { cod.push(c); return `\u0001${cod.length - 1}\u0001`; });
  x = x.replace(/\[([^\]\n]+)\]\((https:\/\/[^\s()]+)\)/g, '<a href="$2">$1</a>');
  x = x.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  return x.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${cod[+i]}</code>`);
}
function aHtml(md) {
  return String(md || '').split(/\n{2,}/).map(p => {
    const l = p.split('\n').filter(x => x.trim());
    if (!l.length) return '';
    if (l.every(x => /^\s*[-•]\s+/.test(x))) return `<ul>${l.map(x => `<li>${enLinea(x.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (l.every(x => /^\s*\d+[.)]\s+/.test(x))) return `<ol>${l.map(x => `<li>${enLinea(x.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${l.map(enLinea).join('<br>')}</p>`;
  }).join('');
}
function aMarcas(raiz) {
  const rec = n => {
    if (n.nodeType === 3) return n.nodeValue.replace(/\n/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName, dentro = () => [...n.childNodes].map(rec).join('');
    if (t === 'BR') return '\n';
    if (t === 'UL' || t === 'OL') return '\n\n' + [...n.children].filter(c => c.tagName === 'LI').map((li, i) => `${t === 'OL' ? `${i + 1}.` : '-'} ${rec(li).replace(/\n+/g, ' ').trim()}`).join('\n') + '\n\n';
    const x = dentro();
    if (!x.trim()) return /^(P|DIV)$/.test(t) ? '\n\n' : x;
    const envolver = (m) => { const [, a, c, z] = x.match(/^(\s*)([\s\S]*?)(\s*)$/); return `${a}${m}${c}${m}${z}`; };
    if (t === 'B' || t === 'STRONG') return envolver('**');
    if (t === 'I' || t === 'EM') return envolver('*');
    if (t === 'CODE') return envolver('`');
    if (t === 'A') { const u = n.getAttribute('href') || ''; return /^https:\/\/[^\s()]+$/.test(u) ? `[${x.replace(/[\[\]\n]/g, ' ')}](${u})` : x; }
    if (t === 'P' || t === 'DIV' || /^H\d$/.test(t)) return `\n\n${x}\n\n`;
    return x;
  };
  return rec(raiz).replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const crecer = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
const idYouTube = s => { s = String(s || '').trim(); if (/^[\w-]{11}$/.test(s)) return s; const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/); return m ? m[1] : ''; };

const TIPOS = [['texto', 'text', 'Texto'], ['titulo', 'reorder-two', 'Subtítulo'], ['imagen', 'image', 'Imagen'], ['galeria', 'images', 'Galería'], ['video', 'logo-youtube', 'Video'],
  ['cita', 'chatbox-ellipses', 'Cita'], ['aviso', 'alert-circle', 'Aviso'], ['ficha', 'list', 'Ficha / requisitos'], ['faq', 'help-circle', 'Preguntas'], ['audio', 'musical-notes', 'Spotify'], ['boton', 'radio-button-on', 'Botón'], ['redes', 'logo-whatsapp', 'Redes y contacto'],['juego', 'game-controller', 'Publicación de UpGames'], ['descarga', 'cloud-download-outline', 'Descarga'], ['codigo', 'code-slash', 'Código'], ['separador', 'remove', 'Separador']];
// Secciones de página (landing): ocupan todo el ancho y tienen estilo propio. Campo = [clave, ayuda, máximo, 1 = varias líneas | 'check']
const BOTON = [['bTexto', 'Texto del botón (ej.: Escríbenos)', 40], ['bUrl', 'Enlace del botón: https://… o wa.me/57300…', 600]];
const SEC = {
  heroe: { nombre: 'Héroe (portada)', ico: 'flash', campos: [['titulo', 'Título grande: qué ofreces', 120], ['texto', 'Una frase que explique por qué elegirte', 400, 1], ...BOTON, ['b2Texto', 'Segundo botón (opcional)', 40], ['b2Url', 'Enlace del segundo botón', 600]],
    imagen: true, variantes: [['centro', 'Centrado'], ['dividido', 'Imagen al lado'], ['fondo', 'Imagen de fondo']], idea: 'Ej.: barbería en Medellín, cortes modernos y reservas por WhatsApp' },
  columnas: { nombre: 'Columnas / servicios', ico: 'grid', campos: [['titulo', 'Título de la sección (ej.: Lo que hacemos)', 120], ['texto', 'Introducción corta (opcional)', 400, 1]],
    item: [['icono', 'Emoji', 4], ['titulo', 'Título', 80], ['texto', 'Descripción corta', 300, 1]], max: 6, nombreItem: 'Columna', otro: 'Añadir columna', nuevo: () => ({ icono: '⭐' }),
    inicio: () => [{ icono: '⚡' }, { icono: '🎯' }, { icono: '💬' }], variantes: [['3', '3 columnas'], ['2', '2 columnas']], idea: 'Ej.: los 3 servicios principales de mi tienda de mods' },
  precios: { nombre: 'Precios / planes', ico: 'pricetags', campos: [['titulo', 'Título (ej.: Planes y precios)', 120], ['texto', 'Introducción corta (opcional)', 400, 1]],
    item: [['nombre', 'Nombre del plan', 40], ['precio', 'Precio (ej.: $20.000)', 30], ['periodo', 'Periodo (ej.: al mes)', 20], ['items', 'Qué incluye (uno por línea)', 600, 1], ...BOTON, ['destacado', 'Destacar este plan', 0, 'check']],
    max: 4, nombreItem: 'Plan', otro: 'Añadir plan', nuevo: () => ({}), inicio: () => [{ nombre: 'Básico' }, { nombre: 'Pro', destacado: true }], idea: 'Ej.: 3 planes de clases de guitarra online' },
  testimonios: { nombre: 'Testimonios', ico: 'chatbubbles', campos: [['titulo', 'Título (ej.: Lo que dicen nuestros clientes)', 120]],
    item: [['texto', 'Lo que dijo (usa opiniones reales)', 500, 1], ['nombre', 'Nombre', 60], ['rol', 'Ciudad, cargo o red (opcional)', 60]], max: 6, nombreItem: 'Testimonio', otro: 'Añadir testimonio', nuevo: () => ({}), inicio: () => [{}, {}], idea: 'Ej.: opiniones de clientes de mi taller' },
  formulario: { nombre: 'Formulario de contacto', ico: 'mail', campos: [['titulo', 'Título (ej.: Escríbenos)', 120], ['texto', 'Frase corta (opcional): te respondemos en menos de 24 h', 400, 1], ['bTexto', 'Texto del botón (ej.: Enviar mensaje)', 40], ['exito', 'Mensaje de gracias (opcional)', 200], ['pideEmail', 'Pedir correo', 0, 'check'], ['pideTel', 'Pedir teléfono o WhatsApp', 0, 'check']],
    defecto: { pideEmail: true }, idea: 'Ej.: formulario para pedir cotizaciones de diseño de logos', ayuda: 'Los mensajes te llegan a «Mensajes» en este panel y te avisamos en UpGames.' },
  catalogo: { nombre: 'Catálogo + pedido por WhatsApp', ico: 'bag-handle', campos: [['titulo', 'Título (ej.: Nuestros productos)', 120], ['texto', 'Frase corta (opcional)', 400, 1], ['whatsapp', 'Tu WhatsApp con código de país: +57 300 123 4567', 30], ['moneda', 'Moneda', ['COP', 'USD', 'MXN', 'ARS', 'CLP', 'PEN', 'EUR', 'BRL', 'UYU', 'BOB', 'GTQ', 'DOP', 'VES'].map(m => [m, m]), 'sel']],
    item: [['imagen', 'Foto del producto', 0, 'img'], ['nombre', 'Nombre del producto', 80], ['precio', 'Precio: solo el número (ej.: 25000). Vacío = «Consultar»', 20], ['descripcion', 'Descripción corta (opcional)', 300, 1]],
    max: 30, nombreItem: 'Producto', otro: 'Añadir producto', nuevo: () => ({}), inicio: () => [{}, {}], defecto: { moneda: 'COP' }, idea: 'Ej.: 4 tortas de mi pastelería con su descripción',
    ayuda: 'El visitante elige cantidades y se abre WhatsApp con el pedido y el total ya escritos.' },
  apoyo: { nombre: 'Apoyar al creador', ico: 'heart', campos: [['titulo', 'Título (ej.: ¿Te gusta lo que hago?)', 120], ['texto', 'Frase corta (ej.: Tu apoyo me ayuda a seguir creando)', 400, 1], ['bTexto', 'Texto del botón (ej.: Apoyar con UpCoins)', 40]],
    defecto: { titulo: 'Apoya este blog', bTexto: 'Apoyar con UpCoins' }, sinNexus: true,
    ayuda: 'Tus lectores te apoyan con UpCoins desde UpGames. Recibes tu parte como ganancia (50 %, retirable tras 7 días), igual que los apoyos a tus publicaciones.' },
  afiliado: { nombre: 'Enlaces de afiliado', ico: 'pricetag', campos: [['titulo', 'Título (ej.: Mi setup gamer)', 120], ['texto', 'Frase corta (opcional)', 400, 1]],
    item: [['imagen', 'Foto del producto', 0, 'img'], ['nombre', 'Nombre del producto', 80], ['tienda', 'Tienda (ej.: Amazon)', 40], ['precio', 'Precio aproximado (opcional)', 30], ['url', 'Tu enlace de afiliado: https://…', 600]],
    max: 12, nombreItem: 'Producto', otro: 'Añadir producto', nuevo: () => ({}), inicio: () => [{}], sinNexus: true,
    ayuda: 'Se muestra siempre el aviso «Enlaces de afiliado» para tus lectores. Tú eres responsable de cumplir las reglas de cada programa de afiliados.' },
  cta: { nombre: 'Llamada a la acción', ico: 'megaphone', campos: [['titulo', 'Título (ej.: ¿Listo para empezar?)', 120], ['texto', 'Frase corta (opcional)', 300, 1], ...BOTON], idea: 'Ej.: invitar a escribir por WhatsApp para pedir una cotización' },
};
const FONDOS_SEC = [['', 'Sin fondo'], ['suave', 'Suave'], ['acento', 'Color del blog'], ['degradado', 'Degradado'], ['oscuro', 'Oscuro'], ['imagen', 'Imagen']];
const NOMBRE_TIPO = Object.fromEntries([...TIPOS.map(([id, , n]) => [id, n]), ...Object.entries(SEC).map(([id, s]) => [id, s.nombre])]);
const enlaceOk = u => !!window.UGRedes.https(u);
const hayCorchetes = v => /\[[^\]\n]{2,80}\]/.test(JSON.stringify(v).replace(/\]\(https:[^)]+\)/g, ''));

let sucio = false, urlPreviaInicial = '';
// «Escribir sobre esto» (desde la ficha de una publicación): blog.html?juego=<id>
let JUEGO_INICIAL = (new URLSearchParams(location.search).get('juego') || '').match(/^[a-f0-9]{24}$/i)?.[0].toLowerCase() || '';
const tomarJuegoInicial = () => { const j = JUEGO_INICIAL; JUEGO_INICIAL = ''; if (j) try { history.replaceState(null, '', location.pathname); } catch (_) {} return j; };
window.addEventListener('beforeunload', e => { if (sucio) { e.preventDefault(); e.returnValue = ''; } });

// Plantillas: un punto de partida para no empezar con la hoja en blanco
const PLANTILLAS = [
  ['blanco', 'document-outline', 'En blanco', 'Empieza desde cero', []],
  ['resena', 'star-outline', 'Reseña de juego', 'Opinión, ficha y nota final', [{ tipo: 'texto', texto: 'Cuenta en dos frases de qué va el juego y por qué lo probaste.', grande: true }, { tipo: 'imagen' }, { tipo: 'titulo', texto: 'Lo mejor' }, { tipo: 'texto', texto: '- Punto fuerte 1\n- Punto fuerte 2\n- Punto fuerte 3' }, { tipo: 'titulo', texto: 'Lo peor' }, { tipo: 'texto', texto: '- Punto débil 1\n- Punto débil 2' }, { tipo: 'ficha', titulo: 'Ficha', filas: [{ k: 'Género', v: 'Acción' }, { k: 'Plataforma', v: 'Android' }, { k: 'Peso', v: '1,2 GB' }] }, { tipo: 'aviso', estilo: 'exito', texto: '**Nota final: 8/10.** Recomendado si te gusta…' }]],
  ['guia', 'construct-outline', 'Guía de instalación', 'Requisitos y pasos numerados', [{ tipo: 'texto', texto: 'Qué vas a conseguir con esta guía y cuánto tiempo toma.' }, { tipo: 'ficha', titulo: 'Requisitos', filas: [{ k: 'Android', v: '10 o superior' }, { k: 'RAM', v: '4 GB' }, { k: 'Espacio libre', v: '3 GB' }] }, { tipo: 'titulo', texto: 'Paso a paso' }, { tipo: 'texto', texto: '1. Descarga los archivos.\n2. Instala la APK.\n3. Copia la carpeta OBB.\n4. Abre el juego.' }, { tipo: 'aviso', estilo: 'alerta', texto: 'Haz una copia de tu partida antes de empezar.' }, { tipo: 'video' }, { tipo: 'faq', items: [{ p: '¿Sirve en mi celular?', r: 'Funciona en la mayoría de equipos con…' }, { p: 'Me sale pantalla negra, ¿qué hago?', r: 'Prueba a…' }] }]],
  ['noticia', 'megaphone-outline', 'Noticia', 'Titular, imagen y lo importante', [{ tipo: 'texto', texto: 'Lo más importante de la noticia en una o dos frases.', grande: true }, { tipo: 'imagen' }, { tipo: 'texto', texto: 'Desarrolla la noticia: qué pasó, cuándo y qué significa.' }, { tipo: 'cita', texto: 'Una frase destacada de la fuente.', autor: 'Fuente' }]],
  ['top', 'trophy-outline', 'Top 5', 'Una lista con tus favoritos', [{ tipo: 'texto', texto: 'Explica cómo elegiste esta lista.' }, ...[5, 4, 3, 2, 1].flatMap(n => [{ tipo: 'titulo', texto: `${n}. Nombre` }, { tipo: 'texto', texto: 'Por qué está en la lista.' }]), { tipo: 'boton', texto: 'Ver más en UpGames', url: 'https://upgames.games' }]],
];
// Para páginas: landing de negocio, contacto o en blanco
const PLANTILLAS_PAGINA = [
  ['blanco', 'document-outline', 'En blanco', 'Empieza desde cero', []],
  ['landing', 'rocket-outline', 'Landing de negocio', 'Portada, servicios, opiniones y contacto', [{ tipo: 'heroe', fondo: 'degradado', espacio: 'amplio' }, { tipo: 'columnas' }, { tipo: 'testimonios', fondo: 'suave' }, { tipo: 'redes', items: [{ red: 'whatsapp', url: '' }] }, { tipo: 'cta', fondo: 'acento' }]],
  ['producto', 'pricetag-outline', 'Producto o servicio', 'Portada con imagen, beneficios, precios y dudas', [{ tipo: 'heroe', variante: 'dividido' }, { tipo: 'columnas', fondo: 'suave' }, { tipo: 'precios' }, { tipo: 'faq', items: [] }, { tipo: 'cta', fondo: 'degradado' }]],
  ['contacto', 'call-outline', 'Contacto', 'Tus redes, WhatsApp y una frase', [{ tipo: 'texto', texto: 'Escríbenos y te respondemos lo antes posible.', grande: true, centro: true }, { tipo: 'redes', items: [{ red: 'whatsapp', url: '' }, { red: 'instagram', url: '' }, { red: 'email', url: '' }] }]],
];
const PLANTILLA_NEXUS = ['nexus', 'sparkles', '✦ Que Nexus la cree', 'Cuéntale tu idea y arma la página por ti', null];
function elegirPlantilla(esPag) {
  return new Promise(ok => {
    const lista = [PLANTILLA_NEXUS, ...(esPag ? PLANTILLAS_PAGINA : [...PLANTILLAS, PLANTILLAS_PAGINA[1]])];
    const c = hoja(`<h3>¿Cómo quieres empezar?</h3><div class="opciones">${lista.map(([id, i, n, d]) => `<button data-p="${id}"${id === 'nexus' ? ' class="nx-op"' : ''}>${ico(i)}<span>${n}<small>${d}</small></span></button>`).join('')}</div>`);
    $('#hoja').onclick = e => { if (e.target.id === 'hoja') { cerrarHoja(); ok(null); } };
    c.onclick = e => { const x = e.target.closest('[data-p]'); if (!x) return; cerrarHoja(); const p = lista.find(p => p[0] === x.dataset.p); ok(p[0] === 'nexus' ? 'nexus' : p[4]); };
  });
}

// ── Vista previa en vivo (sin guardar), en celular o computador ──
let anchoPrevia = 'movil';
async function previaViva(datos, abrirPrivada) {
  const c = hoja(`<div class="previa-h"><h3>${ico('eye-outline')} Vista previa</h3><div class="seg">${[['movil', 'phone-portrait-outline', 'Celular'], ['pc', 'desktop-outline', 'Computador']].map(([k, i, n]) => `<button data-ancho="${k}" aria-pressed="${anchoPrevia === k}">${ico(i)} ${n}</button>`).join('')}</div></div>
    <div class="previa-marco" id="previa-marco"><div class="cargando"><span class="giro"></span></div></div>
    <div class="fila">${abrirPrivada ? `<button class="btn chico" data-privada>${ico('link-outline')} Enlace privado para compartir</button>` : ''}<span style="flex:1"></span><button class="btn pri chico" data-cerrar>Seguir editando</button></div>`);
  c.classList.add('caja-previa');
  let html = '';
  const pintar = () => {
    const marco = $('#previa-marco', c); if (!marco) return;
    const ancho = anchoPrevia === 'pc' ? 1280 : 390, esc = Math.min(1, (marco.clientWidth - 2) / ancho);
    marco.innerHTML = `<iframe title="Vista previa" sandbox="allow-popups allow-popups-to-escape-sandbox" style="width:${ancho}px;height:${Math.round((marco.clientHeight - 2) / esc)}px;transform:scale(${esc});transform-origin:0 0"></iframe>`;
    marco.firstElementChild.srcdoc = html;
  };
  c.onclick = e => {
    const a = e.target.closest('[data-ancho]'); if (a) { anchoPrevia = a.dataset.ancho; c.querySelectorAll('[data-ancho]').forEach(x => x.setAttribute('aria-pressed', x === a)); return pintar(); }
    if (e.target.closest('[data-cerrar]')) return cerrarHoja();
    if (e.target.closest('[data-privada]')) { cerrarHoja(); abrirPrivada(); }
  };
  try { html = (await api(`/blogs/${S.blog.id}/previa-viva`, { metodo: 'POST', cuerpo: datos })).html; pintar(); }
  catch (e) { const m = $('#previa-marco', c); if (m) m.innerHTML = `<div class="vacio">${h(e.message)}</div>`; }
}

/** Guarda un bloque en «Mis secciones» para reutilizarlo en cualquier página. */
function guardarMiSeccion(bloque, nombreTipo) {
  if (!bloque) return toast('Rellena el bloque antes de guardarlo.', true);
  const c = hoja(`<h3>${ico('bookmark-outline')} Guardar en Mis secciones</h3><p style="color:var(--txt2)">La tendrás en «Añadir bloque» para usarla en cualquier página de este blog.</p>
    <label class="campo"><span>Nombre</span><input class="inp" id="ms-nom" maxlength="60" value="${h(bloque.titulo || nombreTipo)}"></label><button class="btn pri ancho" id="ms-ok">Guardar</button>`);
  $('#ms-ok', c).onclick = ev => ocupado(ev.currentTarget, async () => { await api(`/blogs/${S.blog.id}/secciones`, { metodo: 'POST', cuerpo: { nombre: $('#ms-nom', c).value, bloque } }); cerrarHoja(); toast('Guardada en Mis secciones ★'); });
  setTimeout(() => $('#ms-nom', c)?.select(), 50);
}

// ── Color: luminancia y contraste (WCAG) para el kit de marca ──
const rgb = hex => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || '').trim()); return m ? m.slice(1).map(x => parseInt(x, 16) / 255) : null; };
const luz = hex => { const c = rgb(hex); if (!c) return 0; const [r, g, b] = c.map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const sobreColor = hex => contraste(hex, '#ffffff') >= contraste(hex, '#000000') ? '#ffffff' : '#0b0b0e';

/** ✦ Nexus propone 3 paletas para la marca; el creador elige una (y luego la guarda). */
function nexusColores(tema, aplicar) {
  const c = hoja(`<h3>✦ Nexus diseña tu marca</h3><label class="campo"><span>¿De qué es tu marca o negocio y qué quieres transmitir?</span><textarea class="inp" id="nc-idea" rows="3" maxlength="400" placeholder="Ej.: pastelería artesanal, cálida y familiar · tienda de mods, gamer y moderna · abogada, seria y confiable"></textarea></label><button class="btn pri ancho" id="nc-ok">${ico('color-palette-outline')} Proponer paletas</button>`);
  $('#nc-ok', c).onclick = ev => ocupado(ev.currentTarget, async () => {
    if (NX_CUPO) NX_CUPO.ultima = 'colores';
    const r = await api('/blogs/nexus/ayuda', { metodo: 'POST', cuerpo: { accion: 'colores', idea: $('#nc-idea', c).value, sitio: S.blog?.titulo || '', tema: S.blog?.tema } });
    c.innerHTML = `<h3>✦ Elige una paleta</h3><div class="paletas">${r.paletas.map((p, i) => `<button data-p="${i}"><span class="pal-col"><i style="background:${h(p.acento)}"></i><i style="background:${h(p.acento2 || p.acento)}"></i></span><span><b>${h(p.nombre)}</b><small>${h(p.porque)}</small>${contraste(p.acento, tema.colores.bg) < 3 ? '<small style="color:var(--amber)">⚠ Poco contraste con tu tema</small>' : ''}</span></button>`).join('')}</div>`;
    c.onclick = e => { const x = e.target.closest('[data-p]'); if (x) { cerrarHoja(); aplicar(r.paletas[+x.dataset.p]); } };
  });
  setTimeout(() => $('#nc-idea', c)?.focus(), 50);
}

// ── Ayudas del editor (✦ Nexus y estilo de secciones) ──
/** Estilo de una sección: fondo, imagen de fondo, espacio y alineación (opciones cerradas para que siempre se vea bien). */
function estiloSeccion(st, hecho) {
  const seg = (k, ops) => `<div class="seg">${ops.map(([v, n]) => `<button data-${k}="${v}" aria-pressed="${st[k] === v}">${n}</button>`).join('')}</div>`;
  const pintar = () => {
    const c = hoja(`<h3>Estilo de la sección</h3>
      <div class="campo"><span>Fondo</span><div class="fondos">${FONDOS_SEC.map(([v, n]) => `<button data-fondo="${v}" aria-pressed="${st.fondo === v}"><i class="f-${v || 'ninguno'}"></i>${n}</button>`).join('')}</div></div>
      ${st.fondo === 'imagen' ? `<div class="campo"><span>Imagen de fondo</span><div class="fila">${st.fondoImg ? `<img src="${h(mini(st.fondoImg, 240))}" alt="" style="height:56px;border-radius:10px">` : ''}<button class="btn chico" data-subir-fondo>${ico('image-outline')} ${st.fondoImg ? 'Cambiar' : 'Subir imagen'}</button></div><small>Se oscurece un poco para que el texto se lea bien.</small></div>` : ''}
      <div class="campo"><span>Espacio</span>${seg('espacio', [['compacto', 'Compacto'], ['normal', 'Normal'], ['amplio', 'Amplio']])}</div>
      <div class="campo"><span>Alineación</span>${seg('alinear', [['centro', 'Centrado'], ['izquierda', 'A la izquierda']])}</div>
      <button class="btn pri ancho" data-listo>Listo</button>`);
    c.onclick = async e => {
      const x = e.target.closest('button'); if (!x) return;
      if (x.dataset.listo !== undefined) { cerrarHoja(); return hecho(); }
      if (x.dataset.subirFondo !== undefined) { const f = await elegirImagen(); if (!f) return; await ocupado(x, async () => { st.fondoImg = await subirImagen(f); }); return pintar(); }
      for (const k of ['fondo', 'espacio', 'alinear']) if (x.dataset[k] !== undefined) { st[k] = x.dataset[k]; hecho(); return pintar(); }
    };
  };
  pintar();
}

/** ✦ Nexus escribe una sección a partir de una idea corta. */
async function nexusSeccion(tipo, spec, actual, aplicar) {
  const lleno = JSON.stringify(actual).replace(/"(icono|nombre|destacado)":("[^"]*"|true|false)/g, '').match(/"[^"]{3,}"/g)?.length > 1;
  if (lleno && !(await confirmar('¿Reemplazar el contenido?', 'Nexus sustituirá los textos de esta sección.', 'Continuar'))) return;
  const c = hoja(`<h3>✦ Nexus escribe: ${h(spec.nombre)}</h3><label class="campo"><span>¿De qué trata esta sección?</span><textarea class="inp" id="ns-idea" maxlength="500" rows="3" placeholder="${h(spec.idea)}"></textarea><small>Nexus no inventa precios ni opiniones: deja [corchetes] para que pongas los datos reales.</small></label><button class="btn pri ancho" id="ns-ok">${ico('sparkles-outline')} Escribir sección</button>`);
  $('#ns-ok', c).onclick = ev => {
    ocupado(ev.currentTarget, async () => {
      if (NX_CUPO) NX_CUPO.ultima = 'seccion';
      const r = await api('/blogs/nexus/ayuda', { metodo: 'POST', cuerpo: { accion: 'seccion', tipo, idea: $('#ns-idea', c).value, sitio: S.blog?.titulo || '', whatsapp: actual.whatsapp || '' } });
      cerrarHoja(); aplicar(r.bloque); toast('✦ Sección escrita. Revísala y complétala.');
    });
  };
  setTimeout(() => $('#ns-idea', c)?.focus(), 50);
}

/** ✦ Nexus mejora un texto: muestra la propuesta y el creador decide si la usa. */
const MODOS_TEXTO = [['mejorar', 'sparkles-outline', 'Mejorar redacción'], ['corto', 'contract-outline', 'Más corto'], ['largo', 'expand-outline', 'Desarrollar más'], ['vendedor', 'trending-up-outline', 'Más persuasivo'], ['cercano', 'happy-outline', 'Más cercano'], ['ortografia', 'checkmark-done-outline', 'Corregir ortografía']];
function nexusTexto(texto, aplicar) {
  if (!String(texto || '').trim()) return toast('Escribe algo primero y Nexus te ayuda a mejorarlo.', true);
  const c = hoja(`<h3>✦ ¿Qué hago con este texto?</h3><div class="tipos">${MODOS_TEXTO.map(([m, i, n]) => `<button data-modo="${m}">${ico(i)}<span>${n}</span></button>`).join('')}</div>`);
  c.onclick = async e => {
    const x = e.target.closest('[data-modo]'); if (!x) return;
    c.innerHTML = `<h3>✦ Nexus está escribiendo…</h3><div class="cargando" style="min-height:120px"><span class="giro"></span></div>`;
    try {
      if (NX_CUPO) NX_CUPO.ultima = 'texto';
      const r = await api('/blogs/nexus/ayuda', { metodo: 'POST', cuerpo: { accion: 'texto', modo: x.dataset.modo, texto } });
      c.innerHTML = `<h3>✦ Propuesta de Nexus</h3><div class="propuesta">${aHtml(r.texto)}</div><div class="fila"><button class="btn" data-otra style="flex:1">Probar otra</button><button class="btn pri" data-usar style="flex:1">Usar este texto</button></div>`;
      c.onclick = ev => {
        if (ev.target.closest('[data-usar]')) { cerrarHoja(); aplicar(r.texto); toast('✦ Texto actualizado'); }
        if (ev.target.closest('[data-otra]')) nexusTexto(texto, aplicar);
      };
    } catch (err) { cerrarHoja(); avisarError(err); }
  };
}

async function editor(tipo, id) {
  const esPag = tipo === 'pagina';
  let inicial = null;
  const juegoDesde = !id && !esPag ? tomarJuegoInicial() : '';
  let conNexus = false;
  if (!id) { inicial = juegoDesde ? [{ tipo: 'juego', id: juegoDesde }, { tipo: 'texto', texto: '' }] : await elegirPlantilla(esPag); if (inicial === null) return; if (inicial === 'nexus') { conNexus = true; inicial = []; } }
  let E = { titulo: '', bloques: inicial?.length ? inicial : [{ tipo: 'texto', texto: '' }], etiquetas: [], portadaPropia: '', resumenPropio: '', estado: 'borrador', publicadaEn: null };
  urlPreviaInicial = '';
  app.innerHTML = '<div class="cargando"><span class="giro"></span></div>';
  if (id) { try { const r = await api(`/blogs/${S.blog.id}/entradas/${id}`); E = r.entrada; urlPreviaInicial = r.previa || ''; } catch (e) { toast(e.message, true); return panel(); } }
  const meta = { tituloSeo: E.tituloSeo || '', noindex: !!E.noindex, etiquetas: (E.etiquetas || []).join(', '), portada: E.portadaPropia || '', resumen: E.resumenPropio || '', programar: E.estado === 'programada' && new Date(E.publicadaEn) > new Date() ? E.publicadaEn : '' };
  sucio = false;
  const publica = () => E.estado !== 'borrador';

  app.innerHTML = `<div class="editor">
    <header class="barra"><button class="ico" id="salir" aria-label="Volver">${ico('chevron-back')}</button><b>${id ? 'Editar' : 'Nueva'} ${esPag ? 'página' : 'entrada'}</b><span class="chip estado" id="estado"></span><button class="btn chico nexus" id="nexus" style="margin-left:8px" aria-label="Nexus escribe un borrador"><b>✦</b><span>Nexus</span></button><button class="btn chico" id="previa" style="margin-left:8px" aria-label="Vista previa">${ico('eye-outline')}<span>Vista previa</span></button></header>
    <div class="guardado" id="guardado" aria-live="polite"></div>
    <div class="lienzo">
      <textarea class="titulo-entrada" id="titulo" rows="1" maxlength="140" placeholder="${esPag ? 'Título de la página' : 'Título de la entrada'}">${h(E.titulo)}</textarea>
      <div id="bloques"></div>
      <button class="anadir" id="anadir">${ico('add-circle-outline')} Añadir bloque</button>
    </div>
    <footer class="pie-editor"><button class="ico" id="deshacer" aria-label="Deshacer" title="Deshacer (Ctrl+Z)" disabled>${ico('arrow-undo')}</button><button class="ico" id="rehacer" aria-label="Rehacer" title="Rehacer (Ctrl+Y)" disabled>${ico('arrow-redo')}</button><button class="ico" id="opciones" aria-label="Opciones de la entrada">${ico('options-outline')}</button><button class="btn" id="borrador">Guardar borrador</button><button class="btn pri" id="publicar"></button></footer>
  </div>`;
  const cont = $('#bloques'), tit = $('#titulo');
  const pintarEstado = () => {
    const [txt, color] = ESTADOS[E.estado];
    $('#estado').textContent = txt; $('#estado').className = `chip estado ${color}`;
    $('#publicar').innerHTML = meta.programar ? `${ico('time-outline')} Programar` : publica() ? `${ico('checkmark')} Actualizar` : `${ico('paper-plane-outline')} Publicar`;
    $('#borrador').textContent = publica() ? 'Pasar a borrador' : 'Guardar borrador';
  };
  pintarEstado();
  crecer(tit); tit.oninput = () => { tit.value = tit.value.replace(/\n/g, ' '); crecer(tit); sucio = true; };
  cont.addEventListener('input', () => { sucio = true; });

  // Cada bloque es un elemento con una función leer() que devuelve su JSON
  function crearBloque(b) {
    const el = document.createElement('div');
    el.className = `bloque b-${b.tipo}`;
    const barra = extra => `<div class="herr"><span class="tipo">${NOMBRE_TIPO[b.tipo]}</span>${extra || ''}<span class="sep"></span><button data-duplicar aria-label="Duplicar bloque" title="Duplicar">${ico('copy-outline')}</button>${SEC[b.tipo] || ['redes', 'faq', 'ficha', 'aviso', 'boton'].includes(b.tipo) ? `<button data-guardar-sec aria-label="Guardar en Mis secciones" title="Guardar en Mis secciones">${ico('bookmark-outline')}</button>` : ''}<button data-mover="-1" aria-label="Subir">${ico('arrow-up')}</button><button data-mover="1" aria-label="Bajar">${ico('arrow-down')}</button><button data-borrar aria-label="Borrar bloque">${ico('trash-outline')}</button></div>`;
    const subida = async (boton, hecho) => { const f = await elegirImagen(); if (!f) return; await ocupado(boton, async () => { hecho(await subirImagen(f)); sucio = true; }); };

    if (b.tipo === 'texto') {
      el.innerHTML = barra(`<button data-cmd="bold" aria-label="Negrita"><b>B</b></button><button data-cmd="italic" aria-label="Cursiva"><i>I</i></button><button data-cmd="link" aria-label="Enlace">${ico('link')}</button><button data-cmd="insertUnorderedList" aria-label="Lista">${ico('list')}</button><button data-op="centro" aria-label="Centrar">${ico('reorder-three')}</button><button data-op="grande" aria-label="Letra grande">${ico('text')}</button><button class="nx" data-nx aria-label="Mejorar con Nexus" title="Mejorar con Nexus">✦</button>`) + `<div class="rico" contenteditable="true" data-ph="Escribe aquí…"></div>`;
      const rico = $('.rico', el), op = { centro: !!b.centro, grande: !!b.grande };
      $('[data-nx]', el).onclick = () => nexusTexto(aMarcas(rico), nuevo => { rico.innerHTML = aHtml(nuevo); sucio = true; });
      const pintarOp = () => { rico.style.textAlign = op.centro ? 'center' : ''; rico.style.fontSize = op.grande ? '1.3rem' : ''; el.querySelectorAll('[data-op]').forEach(x => { x.style.color = op[x.dataset.op] ? 'var(--g)' : ''; }); };
      el.querySelectorAll('[data-op]').forEach(x => { x.onmousedown = e => e.preventDefault(); x.onclick = () => { op[x.dataset.op] = !op[x.dataset.op]; sucio = true; pintarOp(); }; });
      pintarOp();
      rico.innerHTML = aHtml(b.texto);
      rico.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
      el.querySelectorAll('[data-cmd]').forEach(x => {
        x.onmousedown = e => e.preventDefault();   // no perder la selección al tocar el botón
        x.onclick = () => {
          rico.focus();
          if (x.dataset.cmd === 'link') {
            const u = prompt('Pega el enlace (debe empezar por https://):', 'https://');
            if (!u) return;
            if (!/^https:\/\/[^\s()]+\.[^\s()]+$/.test(u.trim())) return toast('El enlace debe empezar por https://', true);
            document.execCommand('createLink', false, u.trim());
          } else document.execCommand(x.dataset.cmd, false);
          sucio = true;
        };
      });
      el.leer = () => ({ tipo: 'texto', texto: aMarcas(rico), centro: op.centro, grande: op.grande });
    } else if (b.tipo === 'titulo') {
      let nivel = b.nivel === 3 ? 3 : 2, centro = !!b.centro;
      el.innerHTML = barra(`<button data-nivel aria-label="Cambiar tamaño">${ico('text')}</button><button data-centro aria-label="Centrar">${ico('reorder-three')}</button>`) + `<input maxlength="160" placeholder="Subtítulo" value="${h(b.texto || '')}">`;
      el.classList.toggle('n3', nivel === 3);
      $('[data-nivel]', el).onclick = () => { nivel = nivel === 2 ? 3 : 2; el.classList.toggle('n3', nivel === 3); sucio = true; };
      const pintarC = () => { $('input', el).style.textAlign = centro ? 'center' : ''; $('[data-centro]', el).style.color = centro ? 'var(--g)' : ''; };
      $('[data-centro]', el).onclick = () => { centro = !centro; sucio = true; pintarC(); }; pintarC();
      el.leer = () => ({ tipo: 'titulo', texto: $('input', el).value, nivel, centro });
    } else if (b.tipo === 'imagen') {
      let url = b.url || '';
      const pintar = () => {
        el.innerHTML = barra(url ? `<button data-cambiar aria-label="Cambiar imagen">${ico('swap-horizontal')}</button>` : '') + (url ? `<img src="${h(mini(url, 1000))}" alt=""><input data-pie maxlength="200" placeholder="Pie de foto (opcional)" value="${h(b.pie || '')}"><input data-enlace placeholder="Enlace al tocar la imagen (opcional): https://…" value="${h(b.enlace || '')}" inputmode="url">` : `<button class="subiendo" data-cambiar style="width:100%">${ico('cloud-upload-outline')}<span>Toca para subir una imagen</span></button>`);
        el.querySelectorAll('[data-cambiar]').forEach(x => { x.onclick = () => subida(x, u => { b.pie = $('[data-pie]', el)?.value || b.pie; b.enlace = $('[data-enlace]', el)?.value || b.enlace; url = u; pintar(); }); });
      };
      pintar();
      el.leer = () => url ? { tipo: 'imagen', url, pie: $('[data-pie]', el)?.value || '', enlace: ($('[data-enlace]', el)?.value || '').trim() } : null;
    } else if (b.tipo === 'galeria') {
      const urls = [...(b.urls || [])];
      const pintar = () => {
        el.innerHTML = barra() + `<div class="rej">${urls.map((u, i) => `<div style="background-image:url('${h(mini(u, 300))}')"><button data-quitar="${i}" aria-label="Quitar">${ico('close')}</button></div>`).join('')}${urls.length < 12 ? `<button class="mas" data-mas aria-label="Añadir imagen">${ico('add')}</button>` : ''}</div>`;
        el.querySelectorAll('[data-quitar]').forEach(x => { x.onclick = () => { urls.splice(+x.dataset.quitar, 1); sucio = true; pintar(); }; });
        // Varias fotos de una vez: se suben en orden hasta llenar la galería
        const mas = $('[data-mas]', el); if (mas) mas.onclick = async () => {
          const fs = (await elegirImagenes()).slice(0, 12 - urls.length); if (!fs.length) return;
          await ocupado(mas, async () => { for (const f of fs) { urls.push(await subirImagen(f)); sucio = true; } });
          pintar();
        };
      };
      pintar();
      el.leer = () => urls.length ? { tipo: 'galeria', urls } : null;
    } else if (b.tipo === 'video') {
      el.innerHTML = barra() + `<div class="marco">${ico('logo-youtube')}</div><input placeholder="Pega el enlace del video de YouTube" value="${b.id ? `https://youtu.be/${h(b.id)}` : ''}" inputmode="url">`;
      const inp = $('input', el), marco = $('.marco', el);
      const ver = () => { const v = idYouTube(inp.value); marco.style.backgroundImage = v ? `url('https://i.ytimg.com/vi/${v}/hqdefault.jpg')` : ''; };
      inp.oninput = ver; ver();
      el.leer = () => { const v = idYouTube(inp.value); return v ? { tipo: 'video', id: v } : null; };
    } else if (b.tipo === 'cita') {
      el.innerHTML = barra() + `<textarea rows="1" maxlength="1200" placeholder="Escribe la cita…">${h(b.texto || '')}</textarea><input maxlength="80" placeholder="Autor (opcional)" value="${h(b.autor || '')}">`;
      const ta = $('textarea', el); ta.oninput = () => crecer(ta); setTimeout(() => crecer(ta));
      el.leer = () => ({ tipo: 'cita', texto: ta.value, autor: $('input', el).value });
    } else if (b.tipo === 'boton') {
      el.innerHTML = barra() + `<div class="centro" style="text-align:center"><span class="muestra" contenteditable="true">${h(b.texto || 'Descargar')}</span></div><input placeholder="https://… a dónde lleva el botón" value="${h(b.url || '')}" inputmode="url">`;
      $('.muestra', el).addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' ')); });
      el.leer = () => ({ tipo: 'boton', texto: $('.muestra', el).textContent.trim(), url: $('input', el).value.trim() });
    } else if (SEC[b.tipo]) {
      // Sección de landing: campos + elementos repetidos (columnas, planes, testimonios) + estilo + ✦ Nexus
      const spec = SEC[b.tipo];
      const st = { fondo: b.fondo || '', fondoImg: b.fondoImg || '', espacio: b.espacio || 'normal', alinear: b.alinear || 'centro', variante: b.variante || spec.variantes?.[0][0] || '', imagen: b.imagen || '' };
      const datos = Object.fromEntries(spec.campos.map(([k]) => [k, b[k] ?? spec.defecto?.[k] ?? '']));
      const items = spec.item ? (b.items?.length ? b.items.map(x => ({ ...x })) : spec.inicio()) : [];
      const campo = ([k, ph, max, t], v) => t === 'check' ? `<label class="sec-check"><input type="checkbox" data-k="${k}"${v ? ' checked' : ''}> ${h(ph)}</label>`
        : t === 'sel' ? `<label class="sec-sel"><span>${h(ph)}</span><select data-k="${k}">${max.map(([o, n]) => `<option value="${h(o)}"${o === v ? ' selected' : ''}>${h(n)}</option>`).join('')}</select></label>`
        : t === 'img' ? `<div class="sec-img sec-img-it"><input type="hidden" data-k="${k}" value="${h(v || '')}">${v ? `<img src="${h(mini(v, 300))}" alt="">` : ''}<button class="btn chico" data-it-img>${ico('image-outline')} ${v ? 'Cambiar foto' : 'Añadir foto'}</button></div>`
        : k === 'precio' ? `<input data-k="${k}" maxlength="${max}" placeholder="${h(ph)}" value="${h(v || '')}" inputmode="decimal">`
        : t === 1 ? `<textarea data-k="${k}" rows="2" maxlength="${max}" placeholder="${h(ph)}">${h(v || '')}</textarea>` : `<input data-k="${k}" maxlength="${max}" placeholder="${h(ph)}" value="${h(v || '')}"${k.endsWith('Url') || k === 'url' ? ' inputmode="url" autocapitalize="off" spellcheck="false"' : ''}>`;
      const leerDatos = () => {
        el.querySelectorAll('.sec-campos [data-k]').forEach(x => { datos[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value; });
        el.querySelectorAll('.sec-item').forEach((it, i) => it.querySelectorAll('[data-k]').forEach(x => { items[i][x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value; }));
      };
      const fondoVista = () => st.fondo === 'imagen' && (st.fondoImg || st.imagen) ? ` style="background-image:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.7)),url('${h(mini(st.fondoImg || st.imagen, 700))}')"` : '';
      const pintar = () => {
        el.innerHTML = barra(`${spec.sinNexus ? '' : '<button class="nx" data-sec-nx aria-label="Escribir esta sección con Nexus" title="Escribir con Nexus">✦</button>'}<button data-sec-estilo aria-label="Estilo de la sección" title="Fondo, espacio y alineación">${ico('color-palette-outline')}</button>`)
          + `<div class="sec-vista f-${st.fondo || 'ninguno'}${st.alinear === 'izquierda' ? ' a-izq' : ''}"${fondoVista()}>`
          + (spec.variantes ? `<div class="sec-var">${spec.variantes.map(([k, n]) => `<button data-var="${k}" aria-pressed="${st.variante === k}">${n}</button>`).join('')}</div>` : '')
          + (spec.ayuda ? `<p class="red-ayuda">${h(spec.ayuda)}</p>` : '')
          + `<div class="sec-campos">${spec.campos.map(c => campo(c, datos[c[0]])).join('')}</div>`
          + (spec.imagen ? `<div class="sec-img">${st.imagen ? `<img src="${h(mini(st.imagen, 500))}" alt="">` : ''}<button class="btn chico" data-sec-img>${ico('image-outline')} ${st.imagen ? 'Cambiar imagen' : 'Añadir imagen'}</button>${st.imagen ? '<button class="btn chico rojo" data-sec-img-no>Quitar</button>' : ''}</div>` : '')
          + (spec.item ? `<div class="sec-items">${items.map((it, i) => `<div class="sec-item"><div class="sec-item-h"><b>${spec.nombreItem} ${i + 1}</b><button data-item-fuera="${i}" aria-label="Quitar ${spec.nombreItem.toLowerCase()}">${ico('close')}</button></div>${spec.item.map(c => campo(c, it[c[0]])).join('')}</div>`).join('')}</div>`
            + (items.length < spec.max ? `<button class="btn chico" data-item-mas style="margin-top:8px">${ico('add')} ${spec.otro}</button>` : '') : '')
          + '</div>';
        el.querySelectorAll('[data-var]').forEach(x => { x.onclick = () => { leerDatos(); st.variante = x.dataset.var; sucio = true; pintar(); }; });
        el.querySelectorAll('[data-item-fuera]').forEach(x => { x.onclick = () => { leerDatos(); items.splice(+x.dataset.itemFuera, 1); sucio = true; pintar(); }; });
        const mas = $('[data-item-mas]', el); if (mas) mas.onclick = () => { leerDatos(); items.push(spec.nuevo()); sucio = true; pintar(); el.querySelectorAll('.sec-item')[items.length - 1]?.querySelector('input,textarea')?.focus(); };
        el.querySelectorAll('[data-it-img]').forEach(x => { x.onclick = () => { leerDatos(); const i = [...el.querySelectorAll('.sec-item')].indexOf(x.closest('.sec-item')), k = x.parentElement.querySelector('input').dataset.k; subida(x, u => { items[i][k] = u; pintar(); }); }; });
        const si = $('[data-sec-img]', el); if (si) si.onclick = () => { leerDatos(); subida(si, u => { st.imagen = u; pintar(); }); };
        const sn = $('[data-sec-img-no]', el); if (sn) sn.onclick = () => { leerDatos(); st.imagen = ''; sucio = true; pintar(); };
        $('[data-sec-estilo]', el).onclick = () => { leerDatos(); estiloSeccion(st, () => { sucio = true; pintar(); }); };
        if (!spec.sinNexus) $('[data-sec-nx]', el).onclick = () => { leerDatos(); nexusSeccion(b.tipo, spec, { ...datos, items }, nuevo => {
          spec.campos.forEach(([k]) => { if (nuevo[k] !== undefined) datos[k] = nuevo[k]; });
          if (spec.item) items.splice(0, items.length, ...(nuevo.items || []));
          if (nuevo.variante && spec.variantes?.some(([k]) => k === nuevo.variante)) st.variante = nuevo.variante;
          sucio = true; pintar();
        }); };
      };
      pintar();
      el.leer = () => {
        leerDatos();
        const o = { tipo: b.tipo, ...datos, fondo: st.fondo, espacio: st.espacio, alinear: st.alinear };
        if (st.fondo === 'imagen') o.fondoImg = st.fondoImg || st.imagen;
        if (spec.variantes) o.variante = st.variante;
        if (spec.imagen) o.imagen = st.imagen;
        if (spec.item) o.items = items;
        return o;
      };
    } else if (b.tipo === 'redes') {
      // Contacto y redes: cada fila = icono (se elige de la lista) + número, @usuario o enlace + texto opcional
      const R = window.UGRedes, ESTILO = { botones: ['Botones', 'apps-outline'], iconos: ['Solo iconos', 'ellipse-outline'], flotante: ['Flotante', 'chatbubble-ellipses-outline'] };
      let estilo = R.ESTILOS.includes(b.estilo) ? b.estilo : 'botones';
      const filas = (b.items || []).map(i => ({ ...i }));
      if (!filas.length) filas.push({ red: 'whatsapp', url: '', texto: '' });
      const leerFilas = () => el.querySelectorAll('.red-fila').forEach((f, i) => { filas[i].url = $('[data-url]', f).value; filas[i].texto = $('[data-texto]', f).value; });
      const nota = f => { const v = f.url.trim(); return !v ? '' : R.normalizar(f.red, v) ? '' : 'No reconocemos ese dato. Revisa el formato.'; };
      const pintar = () => {
        el.innerHTML = barra(Object.entries(ESTILO).map(([k, [n, i]]) => `<button data-estilo="${k}" aria-label="${n}" aria-pressed="${k === estilo}" title="${n}">${ico(i)}</button>`).join(''))
          + `<p class="red-ayuda">${estilo === 'flotante' ? 'Botón redondo fijo en la esquina de la página (usa el primero de la lista). Ideal para WhatsApp en una landing.' : estilo === 'iconos' ? 'Iconos redondos en fila, sin texto.' : 'Botones con icono y texto.'}</p>`
          + filas.map((f, i) => { const r = R.REDES[f.red] || R.REDES.web; return `<div class="red-fila${estilo === 'flotante' && i ? ' apagada' : ''}">
              <button class="red-ico" data-elegir="${i}" style="background:${r.color};color:${r.txt || '#fff'}" aria-label="Cambiar red: ${h(r.nombre)}">${R.svg(f.red)}</button>
              <div class="red-campos"><input data-url placeholder="${h(r.ayuda)}" value="${h(f.url)}" inputmode="${r.tipo === 'telefono' || r.tipo === 'whatsapp' ? 'tel' : r.tipo === 'email' ? 'email' : 'url'}" autocapitalize="off" spellcheck="false">
              ${estilo === 'botones' ? `<input data-texto maxlength="40" placeholder="Texto del botón (opcional): ${h(r.nombre)}" value="${h(f.texto || '')}">` : `<input data-texto type="hidden" value="${h(f.texto || '')}">`}
              <small class="red-nota">${h(nota(f))}</small></div>
              <button data-fuera="${i}" aria-label="Quitar">${ico('close')}</button></div>`; }).join('')
          + (filas.length < R.MAX ? `<button class="btn chico" data-otra style="margin-top:8px">${ico('add')} Añadir red o contacto</button>` : '');
        el.querySelectorAll('[data-estilo]').forEach(x => { x.onclick = () => { leerFilas(); estilo = x.dataset.estilo; sucio = true; pintar(); }; });
        el.querySelectorAll('[data-fuera]').forEach(x => { x.onclick = () => { leerFilas(); filas.splice(+x.dataset.fuera, 1); if (!filas.length) filas.push({ red: 'whatsapp', url: '', texto: '' }); sucio = true; pintar(); }; });
        el.querySelectorAll('[data-url]').forEach((x, i) => { x.onblur = () => { leerFilas(); x.closest('.red-fila').querySelector('.red-nota').textContent = nota(filas[i]); }; });
        el.querySelectorAll('[data-elegir]').forEach(x => { x.onclick = () => { leerFilas(); elegirRed(red => { filas[+x.dataset.elegir].red = red; sucio = true; pintar(); el.querySelectorAll('[data-url]')[+x.dataset.elegir]?.focus(); }); }; });
        const otra = $('[data-otra]', el); if (otra) otra.onclick = () => { leerFilas(); elegirRed(red => { filas.push({ red, url: '', texto: '' }); sucio = true; pintar(); [...el.querySelectorAll('[data-url]')].pop()?.focus(); }); };
      };
      const elegirRed = hecho => {
        const c = hoja(`<h3>Elige el icono</h3><div class="redes-elegir">${R.lista().map(r => `<button data-red="${r.id}"><i style="background:${r.color};color:${r.txt || '#fff'}">${R.svg(r.id)}</i><span>${h(r.nombre)}</span></button>`).join('')}</div>`);
        c.onclick = e => { const x = e.target.closest('[data-red]'); if (x) { cerrarHoja(); hecho(x.dataset.red); } };
      };
      pintar();
      el.leer = () => { leerFilas(); const items = filas.filter(f => f.url.trim()).map(f => ({ red: f.red, url: f.url.trim(), texto: (f.texto || '').trim() })); return items.length ? { tipo: 'redes', estilo, items } : null; };
    } else if (b.tipo === 'juego' || b.tipo === 'descarga') {
      el.innerHTML = barra() + `<div class="tarj" hidden></div><input placeholder="Pega el enlace de una publicación de UpGames" value="${b.id ? h(b.id) : ''}">`;
      const inp = $('input', el), tarj = $('.tarj', el);
      const sacar = () => (inp.value.match(/[a-f0-9]{24}/i) || [''])[0].toLowerCase();
      let t; const ver = () => { clearTimeout(t); const jid = sacar(); if (!jid) { tarj.hidden = true; return; } t = setTimeout(async () => {
        try { const r = await fetch(`${API}/items/${jid}`).then(x => x.json()); const j = r && r._id ? r : (r.item || r);   // la publicación trae un campo «juego» (texto): no confundirlo
          if (!j?.title) throw 0;
          tarj.innerHTML = `${j.image ? `<img src="${h(mini(j.image, 200))}" alt="">` : ''}<span><b>${h(j.title)}</b><small>por @${h(j.usuario)}</small></span>`; tarj.hidden = false;
        } catch (_) { tarj.innerHTML = '<small>No encontramos esa publicación. Revisa el enlace.</small>'; tarj.hidden = false; } }, 400); };
      inp.oninput = ver; ver();
      el.leer = () => { const jid = sacar(); return jid ? { tipo: b.tipo, id: jid } : null; };
    } else if (b.tipo === 'aviso') {
      let estilo = ['info', 'exito', 'alerta', 'peligro'].includes(b.estilo) ? b.estilo : 'info';
      const COL = { info: '#3B9EFF', exito: '#2FBF71', alerta: '#F5A524', peligro: '#F04438' };
      el.innerHTML = barra(Object.keys(COL).map(k => `<button data-est="${k}" aria-label="Color ${k}"><span style="width:16px;height:16px;border-radius:50%;background:${COL[k]};display:block"></span></button>`).join('')) + `<textarea rows="1" maxlength="1500" placeholder="Un aviso importante: versión, advertencia, consejo…">${h(b.texto || '')}</textarea>`;
      const ta = $('textarea', el);
      const pintarA = () => { ta.style.borderLeftColor = COL[estilo]; ta.style.background = COL[estilo] + '18'; };
      el.querySelectorAll('[data-est]').forEach(x => { x.onclick = () => { estilo = x.dataset.est; sucio = true; pintarA(); }; });
      ta.oninput = () => crecer(ta); setTimeout(() => crecer(ta)); pintarA();
      el.leer = () => ({ tipo: 'aviso', texto: ta.value, estilo });
    } else if (b.tipo === 'faq' || b.tipo === 'ficha') {
      // Listas de pares: pregunta/respuesta (faq) o dato/valor (ficha de requisitos)
      const esFaq = b.tipo === 'faq';
      const filas = (esFaq ? (b.items || []).map(i => [i.p, i.r]) : (b.filas || []).map(f => [f.k, f.v]));
      if (!filas.length) filas.push(...(esFaq ? [['', '']] : [['Sistema', ''], ['RAM', ''], ['Almacenamiento', '']]));
      const leerFilas = () => [...el.querySelectorAll('.par')].map(p => [p.children[0].value, p.children[1].value]);
      const pintar = () => {
        el.innerHTML = barra() + (esFaq ? '' : `<input data-tit maxlength="80" placeholder="Título de la ficha (ej.: Requisitos)" value="${h(b.titulo || '')}" style="font-weight:800">`)
          + filas.map(([k, v], i) => `<div class="par${esFaq ? ' par-faq' : ''}"><input maxlength="${esFaq ? 200 : 60}" placeholder="${esFaq ? 'Pregunta' : 'Dato'}" value="${h(k)}">${esFaq ? `<textarea rows="2" maxlength="1500" placeholder="Respuesta">${h(v)}</textarea>` : `<input maxlength="200" placeholder="Valor" value="${h(v)}">`}<button data-fuera="${i}" aria-label="Quitar">${ico('close')}</button></div>`).join('')
          + (filas.length < 20 ? `<button class="btn chico" data-otra style="margin-top:8px">${ico('add')} ${esFaq ? 'Otra pregunta' : 'Otro dato'}</button>` : '');
        el.querySelectorAll('[data-fuera]').forEach(x => { x.onclick = () => { const f = leerFilas(); b.titulo = $('[data-tit]', el)?.value; f.splice(+x.dataset.fuera, 1); filas.splice(0, filas.length, ...f); sucio = true; pintar(); }; });
        const otra = $('[data-otra]', el); if (otra) otra.onclick = () => { const f = leerFilas(); b.titulo = $('[data-tit]', el)?.value; filas.splice(0, filas.length, ...f, ['', '']); sucio = true; pintar(); el.querySelectorAll('.par')[filas.length - 1].children[0].focus(); };
      };
      pintar();
      el.leer = () => esFaq ? { tipo: 'faq', items: leerFilas().filter(([p, r]) => p.trim() && r.trim()).map(([p, r]) => ({ p, r })) }
        : { tipo: 'ficha', titulo: $('[data-tit]', el).value, filas: leerFilas().filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => ({ k, v })) };
    } else if (b.tipo === 'audio') {
      el.innerHTML = barra() + `<div class="marco" style="aspect-ratio:auto;height:84px;font-size:2.2rem;background:#1DB95422;color:#1DB954">${ico('musical-notes')}</div><input placeholder="Pega el enlace de Spotify (canción, álbum, lista o podcast)" value="${b.id ? `https://open.spotify.com/${h(b.clase)}/${h(b.id)}` : ''}" inputmode="url">`;
      const inp = $('input', el);
      const ok = () => /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/[A-Za-z0-9]{22}/.test(inp.value.trim());
      el.leer = () => ok() ? { tipo: 'audio', url: inp.value.trim() } : null;
    } else if (b.tipo === 'codigo') {
      el.innerHTML = barra() + `<textarea rows="4" maxlength="8000" spellcheck="false" placeholder="Pega aquí el código o los comandos">${h(b.texto || '')}</textarea>`;
      el.leer = () => ({ tipo: 'codigo', texto: $('textarea', el).value });
    } else {
      el.innerHTML = barra() + '<hr>';
      el.leer = () => ({ tipo: 'separador' });
    }
    // Activo también al recibir el foco (teclado): la barra del bloque no aparece y desaparece moviendo la página
    el.addEventListener('focusin', () => { cont.querySelectorAll('.bloque.activo').forEach(x => x !== el && x.classList.remove('activo')); el.classList.add('activo'); });
    el.addEventListener('click', e => {
      cont.querySelectorAll('.bloque.activo').forEach(x => x !== el && x.classList.remove('activo'));
      el.classList.add('activo');
      const mv = e.target.closest('[data-mover]');
      if (mv) { const otro = +mv.dataset.mover < 0 ? el.previousElementSibling : el.nextElementSibling; if (otro) { +mv.dataset.mover < 0 ? cont.insertBefore(el, otro) : cont.insertBefore(otro, el); sucio = true; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
      if (e.target.closest('[data-borrar]')) { el.remove(); sucio = true; }
      if (e.target.closest('[data-duplicar]')) { const copia = crearBloque(JSON.parse(JSON.stringify(el.leer() || { tipo: b.tipo }))); el.after(copia); copia.classList.add('activo'); el.classList.remove('activo'); sucio = true; toast('Bloque duplicado'); }
      if (e.target.closest('[data-guardar-sec]')) guardarMiSeccion(el.leer(), NOMBRE_TIPO[b.tipo]);
    });
    return el;
  }
  (E.bloques?.length ? E.bloques : [{ tipo: 'texto', texto: '' }]).forEach(b => cont.appendChild(crearBloque(b)));

  // ── Deshacer / Rehacer: instantáneas de lo que hay en el editor (título + bloques) ──
  const foto = () => JSON.stringify({ t: tit.value, b: [...cont.children].map(x => x.leer?.()) });
  const pila = [foto()]; let enPila = 0, tFoto, restaurando = false;
  const pintarPila = () => { $('#deshacer').disabled = enPila <= 0; $('#rehacer').disabled = enPila >= pila.length - 1; };
  const tomarFoto = () => {
    if (restaurando) return;
    clearTimeout(tFoto);
    tFoto = setTimeout(() => {
      const f = foto(); if (f === pila[enPila]) return;
      pila.splice(enPila + 1); pila.push(f); if (pila.length > 60) pila.shift(); enPila = pila.length - 1; pintarPila();
    }, 600);
  };
  const restaurar = f => {
    restaurando = true;
    const o = JSON.parse(f);
    tit.value = o.t; crecer(tit);
    cont.innerHTML = ''; o.b.forEach(x => cont.appendChild(crearBloque(x || { tipo: 'texto', texto: '' })));
    sucio = true; pintarPila();
    setTimeout(() => { restaurando = false; }, 50);
  };
  $('#deshacer').onclick = () => { clearTimeout(tFoto); if (enPila > 0) restaurar(pila[--enPila]); };
  $('#rehacer').onclick = () => { clearTimeout(tFoto); if (enPila < pila.length - 1) restaurar(pila[++enPila]); };
  new MutationObserver(tomarFoto).observe(cont, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'class', 'style'] });
  cont.addEventListener('input', tomarFoto); tit.addEventListener('input', tomarFoto); cont.addEventListener('change', tomarFoto);
  const atajos = e => {
    if (!document.body.contains(cont)) return document.removeEventListener('keydown', atajos);
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('input, textarea, [contenteditable="true"]')) return;   // dentro de un campo, el deshacer propio del navegador
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); $('#deshacer').click(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); $('#rehacer').click(); }
  };
  document.addEventListener('keydown', atajos);

  // ── Guardado automático ──
  // Borradores: se guardan solos en el servidor. Lo ya publicado NO (se publicaría): se guarda una copia
  // en este dispositivo para no perder cambios si se cierra la pestaña.
  const claveLocal = () => `ug_editor_${S.blog.id}_${id || 'nueva-' + tipo}`;
  const marcaGuardado = t => { const g = $('#guardado'); if (g) g.textContent = t; };
  const copiaLocal = () => { try { localStorage.setItem(claveLocal(), JSON.stringify({ t: Date.now(), titulo: tit.value, bloques: [...cont.children].map(x => x.leer?.()).filter(Boolean) })); } catch (_) {} };
  const borrarCopiaLocal = () => { try { localStorage.removeItem(claveLocal()); } catch (_) {} };
  let autoOcupado = false;
  const autoguardar = async () => {
    if (!sucio || autoOcupado || !document.body.contains(cont)) return;
    if (E.estado !== 'borrador' || !tit.value.trim()) { copiaLocal(); return marcaGuardado(publica() ? 'Cambios guardados en este dispositivo · toca «Actualizar» para publicarlos' : 'Copia guardada en este dispositivo'); }
    autoOcupado = true;
    try {
      const bloques = [...cont.children].map(x => x.leer()).filter(x => x && (x.tipo === 'separador' || x.tipo === 'formulario' || [x.texto, x.url, x.id, x.titulo].some(v => String(v || '').trim()) || [x.urls, x.items, x.filas].some(a => a?.length)));
      const r = await api(`/blogs/${S.blog.id}/entradas${id ? '/' + id : ''}`, { metodo: id ? 'PUT' : 'POST', cuerpo: { tipo, titulo: tit.value.trim(), bloques, etiquetas: meta.etiquetas, portada: meta.portada, resumen: meta.resumen, tituloSeo: meta.tituloSeo, noindex: meta.noindex, estado: 'borrador' } });
      const nueva = !id; E = r.entrada; id = E.id; urlPrevia = r.previa || urlPrevia; sucio = false; pintarEstado();
      if (nueva) try { localStorage.removeItem(`ug_editor_${S.blog.id}_nueva-${tipo}`); } catch (_) {}
      borrarCopiaLocal();
      marcaGuardado(`Guardado automáticamente · ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (_) { copiaLocal(); marcaGuardado('Sin conexión: copia guardada en este dispositivo'); }
    finally { autoOcupado = false; }
  };
  const tAuto = setInterval(() => { if (!document.body.contains(cont)) return clearInterval(tAuto); autoguardar(); }, 20000);
  // ¿Quedaron cambios sin guardar de la última vez?
  try {
    const l = JSON.parse(localStorage.getItem(claveLocal()) || 'null');
    if (l && l.bloques?.length && l.t > new Date(E.actualizada || 0).getTime() && JSON.stringify(l.bloques) !== JSON.stringify(E.bloques || [])) {
      setTimeout(async () => {
        if (await confirmar('¿Recuperar tus cambios?', `Tienes cambios sin guardar del ${new Date(l.t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}.`, 'Recuperar')) {
          tit.value = l.titulo || tit.value; crecer(tit); cont.innerHTML = ''; l.bloques.forEach(x => cont.appendChild(crearBloque(x))); sucio = true; toast('Cambios recuperados');
        } else borrarCopiaLocal();
      }, 400);
    }
  } catch (_) {}

  $('#anadir').onclick = () => {
    const c = hoja(`<h3>Añadir bloque</h3><div id="mis-sec"></div><p class="hoja-sub">Secciones de página <small>· para landings: ocupan todo el ancho</small></p><div class="tipos">${Object.entries(SEC).map(([t, s]) => `<button data-t="${t}" class="t-sec">${ico(s.ico)}<span>${s.nombre}</span></button>`).join('')}</div>
      <p class="hoja-sub">Contenido</p><div class="tipos">${TIPOS.map(([t, i, n]) => `<button data-t="${t}">${ico(i)}<span>${n}</span></button>`).join('')}</div>`);
    // «Mis secciones» guardadas
    api(`/blogs/${S.blog.id}/secciones`).then(r => {
      const caja = $('#mis-sec', c); if (!caja || !r.secciones.length) return;
      caja.innerHTML = `<p class="hoja-sub">Mis secciones</p><div class="tipos">${r.secciones.map(x => `<button data-mia="${h(x.id)}" class="t-mia">${ico(SEC[x.bloque.tipo]?.ico || TIPOS.find(t => t[0] === x.bloque.tipo)?.[1] || 'bookmark')}<span>${h(x.nombre)}</span><i data-quitar-mia="${h(x.id)}" aria-label="Quitar">×</i></button>`).join('')}</div>`;
      caja.onclick = async ev => {
        const q = ev.target.closest('[data-quitar-mia]');
        if (q) { ev.stopPropagation(); try { await api(`/blogs/${S.blog.id}/secciones/${q.dataset.quitarMia}`, { metodo: 'DELETE' }); q.closest('button').remove(); toast('Sección quitada de Mis secciones'); } catch (err) { toast(err.message, true); } return; }
        const m = ev.target.closest('[data-mia]'); if (!m) return;
        const x = r.secciones.find(y => y.id === m.dataset.mia);
        cerrarHoja();
        const el = crearBloque(JSON.parse(JSON.stringify(x.bloque))); cont.appendChild(el); sucio = true;
        el.classList.add('activo'); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      };
    }).catch(() => {});
    c.onclick = e => {
      const x = e.target.closest('[data-t]'); if (!x) return;
      cerrarHoja();
      if (cont.children.length >= 80) return toast('Llegaste al máximo de bloques de una entrada.', true);
      const el = crearBloque({ tipo: x.dataset.t });
      cont.appendChild(el); sucio = true;
      el.classList.add('activo'); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el.querySelector('.rico, input, textarea') || el).focus?.();
      if (x.dataset.t === 'imagen') $('[data-cambiar]', el)?.click();
    };
  };

  $('#opciones').onclick = () => {
    const local = d => { const f = new Date(d); return isNaN(f) ? '' : new Date(f.getTime() - f.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    const c = hoja(`<h3>Opciones de la ${esPag ? 'página' : 'entrada'}</h3>
      ${esPag ? '' : `<label class="campo"><span>Etiquetas</span><input class="inp" id="o-et" maxlength="260" placeholder="mods, android, guías" value="${h(meta.etiquetas)}"><small>Sepáralas con comas. Hasta 8.</small></label>`}
      <div class="campo"><span>Imagen de portada</span><div class="fila">${meta.portada ? `<img src="${h(mini(meta.portada, 240))}" alt="" style="height:60px;border-radius:10px">` : ''}<button class="btn chico" id="o-port">${ico('image-outline')} ${meta.portada ? 'Cambiar' : 'Subir'}</button>${meta.portada ? '<button class="btn chico rojo" id="o-port-no">Quitar</button>' : ''}</div><small>Si no subes una, se usa la primera imagen de la entrada.</small></div>
      <label class="campo"><span>Resumen</span><textarea class="inp" id="o-res" maxlength="300" placeholder="Una o dos frases. Si lo dejas vacío se toma del texto.">${h(meta.resumen)}</textarea></label>
      ${esPag ? '' : `<label class="campo"><span>Programar publicación</span><input class="inp" type="datetime-local" id="o-prog" value="${h(local(meta.programar))}"><small>Déjalo vacío para publicar al momento.</small></label>`}
      <div class="campo"><span>${ico('search-outline')} Google y redes</span>
        <input class="inp" id="o-seo" maxlength="90" placeholder="Título para Google (si lo dejas vacío, el de la ${esPag ? 'página' : 'entrada'})" value="${h(meta.tituloSeo)}"><small id="o-seo-n"></small>
        <div class="serp" id="o-serp"></div>
        <label class="sec-check"><input type="checkbox" id="o-noindex"${meta.noindex ? ' checked' : ''}> Ocultar de Google (sigue abierta para quien tenga el enlace)</label></div>
      ${id ? `<button class="btn ancho" id="o-hist">${ico('time-outline')} Historial de versiones${E.nVersiones ? ` (${E.nVersiones})` : ''}</button>` : ''}
      <button class="btn pri ancho" id="o-ok">Listo</button>`);
    // Vista previa de cómo sale en Google y al compartir
    const serp = () => {
      const t = $('#o-seo', c).value.trim() || tit.value.trim() || 'Sin título', d = $('#o-res', c).value.trim() || 'Escribe un resumen para que la gente sepa de qué trata antes de entrar.';
      const n = $('#o-seo', c).value.trim().length;
      $('#o-seo-n', c).textContent = n ? `${n}/60 caracteres${n > 60 ? ' · Google lo cortará' : ''}` : '';
      const img = meta.portada || [...cont.children].map(x => x.leer?.()).find(b => b?.tipo === 'imagen')?.url || '';
      $('#o-serp', c).innerHTML = `<small>Así se verá en Google</small><div class="serp-g"><span>${h(S.blog.url.replace(/^https?:\/\//, ''))}</span><b>${h(t.slice(0, 62))}${t.length > 62 ? '…' : ''} · ${h(S.blog.titulo)}</b><p>${h(d.slice(0, 158))}${d.length > 158 ? '…' : ''}</p></div>
        <small>Y al compartirla en WhatsApp</small><div class="serp-w">${img ? `<i style="background-image:url('${h(mini(img, 300))}')"></i>` : ''}<span><b>${h(t.slice(0, 70))}</b><p>${h(d.slice(0, 90))}</p></span></div>`;
    };
    ['o-seo', 'o-res'].forEach(k => $('#' + k, c).addEventListener('input', serp)); serp();
    const hist = $('#o-hist', c); if (hist) hist.onclick = () => { guardarCampos(); verHistorial(); };
    const guardarCampos = () => { if (!esPag) { meta.etiquetas = $('#o-et', c).value; const p = $('#o-prog', c).value; meta.programar = p ? new Date(p).toISOString() : ''; } meta.resumen = $('#o-res', c).value; meta.tituloSeo = $('#o-seo', c).value.trim(); meta.noindex = $('#o-noindex', c).checked; sucio = true; };
    $('#o-port', c).onclick = async ev => { const f = await elegirImagen(); if (!f) return; guardarCampos(); await ocupado(ev.currentTarget, async () => { meta.portada = await subirImagen(f); }); $('#opciones').click(); };
    const no = $('#o-port-no', c); if (no) no.onclick = () => { guardarCampos(); meta.portada = ''; $('#opciones').click(); };
    $('#o-ok', c).onclick = () => { guardarCampos(); cerrarHoja(); pintarEstado(); };
  };

  // ── Historial de versiones: ver y restaurar (lo restaurado queda en el editor hasta que guardes) ──
  async function verHistorial() {
    const c = hoja(`<h3>${ico('time-outline')} Historial de versiones</h3><div class="cargando" style="min-height:100px"><span class="giro"></span></div>`);
    let vs;
    try { vs = (await api(`/blogs/${S.blog.id}/entradas/${id}/versiones`)).versiones; } catch (e) { cerrarHoja(); return toast(e.message, true); }
    c.innerHTML = `<h3>${ico('time-outline')} Historial de versiones</h3><p style="color:var(--txt2)">Se guarda una versión cada vez que cambias algo (como mucho una cada 10 minutos) y al publicar. Hasta 15.</p>
      ${vs.length ? `<div class="opciones">${vs.map(v => `<div class="version"><span><b>${h(new Date(v.fecha).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }))}</b><small>${h(v.titulo)} · ${v.bloques.length} bloques · ${ESTADOS[v.estado]?.[0] || ''}</small></span><button class="btn chico" data-ver="${v.n}">${ico('eye-outline')}</button><button class="btn chico" data-rest="${v.n}">Restaurar</button></div>`).join('')}</div>`
        : '<div class="vacio" style="padding:24px">Aún no hay versiones anteriores. Aparecerán cuando hagas cambios.</div>'}`;
    c.onclick = async e => {
      const ver = e.target.closest('[data-ver]'), rest = e.target.closest('[data-rest]');
      if (ver) { const v = vs[+ver.dataset.ver]; return previaViva({ tipo, titulo: v.titulo, bloques: v.bloques, etiquetas: meta.etiquetas, portada: meta.portada, resumen: meta.resumen }); }
      if (rest) {
        const v = vs[+rest.dataset.rest];
        cerrarHoja();
        if (!(await confirmar('¿Restaurar esta versión?', 'Reemplaza lo que tienes en el editor. Podrás deshacerlo con ↶ y no se publica hasta que guardes.', 'Restaurar'))) return;
        tit.value = v.titulo; crecer(tit); cont.innerHTML = ''; v.bloques.forEach(b => cont.appendChild(crearBloque(b))); sucio = true;
        toast('Versión restaurada. Revisa y guarda para conservarla.');
      }
    };
  }

  // ✦ Nexus: el centro de ayuda del editor
  const leerTodo = () => [...cont.children].map(x => x.leer?.()).filter(Boolean);
  const hayContenido = () => leerTodo().some(b => [b.texto, b.titulo, b.url, b.id].some(v => String(v || '').trim()) || (b.urls || []).length);
  $('#nexus').onclick = () => {
    const ops = [
      ['landing', 'rocket-outline', 'Crear una landing con IA', 'Cuéntale tu negocio y arma portada, servicios, precios, dudas y contacto'],
      ...(esPag ? [] : [['publicacion', 'game-controller-outline', 'Escribir sobre una publicación', 'Reseña, guía o noticia de un juego de UpGames']]),
      ['revisar', 'checkmark-done-outline', 'Revisar mi página', 'Consejos para que se vea profesional y la encuentren'],
      ['seo', 'search-outline', 'Título, resumen y etiquetas', 'Para Google y para cuando la compartan'],
    ];
    const c = hoja(`<h3>✦ Nexus</h3><p class="hoja-sub" style="margin:0">Tu asistente: escribe, revisa y mejora contigo. Tú decides qué usar.</p><div class="opciones">${ops.map(([id, i, n, d]) => `<button data-nx-op="${id}">${ico(i)}<span>${n}<small>${d}</small></span></button>`).join('')}</div>
      <p class="hoja-sub" style="margin:0">También tienes ✦ en cada bloque de texto y en cada sección.</p><div id="nx-cupo">${lineaCupo()}</div>`);
    nexusCupo().then(() => { const x = $('#nx-cupo', c); if (x) x.innerHTML = lineaCupo(); });
    c.onclick = e => { const x = e.target.closest('[data-nx-op]'); if (!x) return; cerrarHoja(); ({ landing: nexusLanding, publicacion: nexusPublicacion, revisar: nexusRevisar, seo: nexusSeo })[x.dataset.nxOp](); };
  };

  async function nexusLanding() {
    if (hayContenido() && !(await confirmar('¿Reemplazar lo que tienes?', 'La landing de Nexus sustituirá los bloques actuales.', 'Continuar', true))) return;
    const c = hoja(`<h3>✦ Nexus crea tu landing</h3><p style="color:var(--txt2)">Describe tu negocio o proyecto. Nexus arma la página con secciones; tú completas lo que va entre [corchetes] y la publicas.</p>
      <label class="campo"><span>¿Qué ofreces y para quién?</span><textarea class="inp" id="nl-idea" maxlength="800" rows="3" placeholder="Ej.: Soy barbero en Medellín, hago cortes modernos y diseño de barba para jóvenes. Atiendo con cita."></textarea></label>
      <label class="campo"><span>¿Qué quieres que haga el visitante?</span><select class="inp" id="nl-obj"><option>Escribirme por WhatsApp</option><option>Comprar o pedir un producto</option><option>Reservar una cita</option><option>Seguirme en redes</option><option>Conocer mi trabajo (portafolio)</option><option>Descargar mis mods o juegos</option></select></label>
      <label class="campo"><span>WhatsApp (opcional)</span><input class="inp" id="nl-wa" inputmode="tel" placeholder="+57 300 123 4567"><small>Los botones principales llevarán a tu WhatsApp y se añade el botón flotante.</small></label>
      <button class="btn pri ancho" id="nl-ok">${ico('sparkles-outline')} Crear mi landing</button>`);
    $('#nl-ok', c).onclick = async ev => {
      const idea = $('#nl-idea', c).value.trim(), wa = $('#nl-wa', c).value.trim();
      if (idea.length < 10) return toast('Cuéntale a Nexus un poco más: qué ofreces y para quién.', true);
      if (wa && !window.UGRedes.normalizar('whatsapp', wa)) return toast('Ese número de WhatsApp no es válido. Escríbelo con el código de país.', true);
      await ocupado(ev.currentTarget, async () => {
        if (NX_CUPO) NX_CUPO.ultima = 'landing';
        const r = await api('/blogs/nexus/ayuda', { metodo: 'POST', cuerpo: { accion: 'landing', idea, objetivo: $('#nl-obj', c).value, whatsapp: wa, sitio: S.blog?.titulo || '' } });
        cerrarHoja();
        cont.innerHTML = ''; r.bloques.forEach(b => cont.appendChild(crearBloque(b)));
        if (!tit.value.trim()) { tit.value = r.titulo; crecer(tit); }
        if (r.resumen && !meta.resumen) meta.resumen = r.resumen;
        sucio = true; window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('✦ Landing lista. Completa lo que va entre [corchetes] y sube tus imágenes.');
      });
    };
    setTimeout(() => $('#nl-idea', c)?.focus(), 50);
  }

  function nexusRevisar() {
    const bl = leerTodo(), sec = bl.filter(b => SEC[b.tipo]);
    const texto = JSON.stringify(bl.map(b => [b.texto, b.titulo, ...(b.items || []).map(i => [i.texto, i.titulo])]));
    const conImagen = meta.portada || bl.some(b => b.tipo === 'imagen' || b.tipo === 'galeria' || b.imagen);
    const contacto = bl.some(b => b.tipo === 'redes' || b.tipo === 'boton' || (SEC[b.tipo] && b.bUrl));
    const sinEnlace = bl.filter(b => SEC[b.tipo]).flatMap(b => [[b.bTexto, b.bUrl], ...(b.items || []).map(i => [i.bTexto, i.bUrl])]).some(([t, u]) => String(t || '').trim() && !String(u || '').trim());
    const c = [
      [!!tit.value.trim() && tit.value.trim().length <= 70, tit.value.trim() ? (tit.value.trim().length > 70 ? 'El título es largo: en Google se corta a unos 65 caracteres.' : 'Tiene un título claro.') : 'Falta el título.'],
      [!hayCorchetes(bl), hayCorchetes(bl) ? 'Hay textos entre [corchetes] por completar con tus datos reales.' : 'No quedan textos de ejemplo por completar.'],
      [conImagen, conImagen ? 'Tiene imágenes.' : 'Añade al menos una imagen: las páginas con fotos se ven más profesionales y se comparten mejor.'],
      [contacto, contacto ? 'El visitante tiene cómo contactarte o actuar.' : 'Añade un botón o el bloque «Redes y contacto» para que el visitante pueda escribirte.'],
      [!sinEnlace, sinEnlace ? 'Hay botones sin enlace: no se mostrarán hasta que les pongas uno.' : 'Todos los botones llevan a algún sitio.'],
      [!!meta.resumen, meta.resumen ? 'Tiene resumen para Google y redes.' : 'Falta el resumen: toca ✦ «Título, resumen y etiquetas».'],
      ...(esPag && sec.length ? [[sec[0] === bl[0] && bl[0].tipo === 'heroe', bl[0]?.tipo === 'heroe' ? 'Empieza con una sección Héroe: buena primera impresión.' : 'Empieza la página con una sección «Héroe» para causar buena primera impresión.']] : []),
      ...(esPag ? [] : [[texto.length > 900, texto.length > 900 ? 'Tiene contenido suficiente.' : 'El texto es corto: las entradas de más de 300 palabras posicionan mejor.'], [!!meta.etiquetas.trim(), meta.etiquetas.trim() ? 'Tiene etiquetas.' : 'Añade etiquetas para que te encuentren dentro de tu blog.']]),
    ];
    const bien = c.filter(x => x[0]).length;
    hoja(`<h3>✦ Revisión de Nexus</h3><p style="color:var(--txt2)">${bien === c.length ? '¡Todo listo! Tu página se ve profesional. 🎉' : `Vas bien: ${bien} de ${c.length}. Te sugiero:`}</p>
      <div class="revision">${c.sort((a, b) => a[0] - b[0]).map(([ok, t]) => `<div class="${ok ? 'ok' : 'falta'}">${ico(ok ? 'checkmark-circle' : 'alert-circle')}<span>${h(t)}</span></div>`).join('')}</div><button class="btn pri ancho" data-cerrar>Entendido</button>`).querySelector('[data-cerrar]').onclick = cerrarHoja;
  }

  async function nexusSeo() {
    const texto = leerTodo().map(b => [b.titulo, b.texto, ...(b.items || []).flatMap(i => [i.titulo, i.texto, i.p, i.r])].filter(Boolean).join('\n')).join('\n').replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1');
    if (texto.trim().length < 40) return toast('Escribe un poco más de contenido para que Nexus sugiera el SEO.', true);
    const c = hoja(`<h3>✦ Título, resumen y etiquetas</h3><div class="cargando" style="min-height:120px"><span class="giro"></span></div>`);
    try {
      if (NX_CUPO) NX_CUPO.ultima = 'seo';
      const r = await api('/blogs/nexus/ayuda', { metodo: 'POST', cuerpo: { accion: 'seo', titulo: tit.value, texto } });
      c.innerHTML = `<h3>✦ Propuesta de Nexus</h3>
        ${r.titulo ? `<label class="campo"><span>Título para buscadores</span><input class="inp" id="s-tit" maxlength="140" value="${h(r.titulo)}"></label>` : ''}
        <label class="campo"><span>Resumen (Google y redes)</span><textarea class="inp" id="s-res" maxlength="300">${h(r.resumen)}</textarea></label>
        ${esPag ? '' : `<label class="campo"><span>Etiquetas</span><input class="inp" id="s-et" value="${h(r.etiquetas.join(', '))}"></label>`}
        <div class="fila"><button class="btn" data-no style="flex:1">Cancelar</button><button class="btn pri" data-si style="flex:1">Usar</button></div>`;
      $('[data-no]', c).onclick = cerrarHoja;
      $('[data-si]', c).onclick = () => {
        const nt = $('#s-tit', c)?.value.trim(); if (nt) { tit.value = nt; crecer(tit); }
        meta.resumen = $('#s-res', c).value.trim(); if (!esPag) meta.etiquetas = $('#s-et', c).value;
        sucio = true; cerrarHoja(); toast('✦ Listo. Puedes cambiarlo en Opciones.');
      };
    } catch (e) { cerrarHoja(); avisarError(e); }
  }

  // ✦ Nexus escritor: arma el borrador con bloques a partir de una publicación de UpGames
  function nexusPublicacion() {
    const actual = [...cont.children].map(x => x.leer?.()).find(b => b && (b.tipo === 'juego' || b.tipo === 'descarga'))?.id || juegoDesde || '';
    const c = hoja(`<h3>✦ Nexus escribe por ti</h3><p style="color:var(--txt2)">Elige la publicación y qué quieres escribir. Nexus arma un borrador con bloques; tú lo revisas, lo completas con tu experiencia y lo publicas.</p>
      <label class="campo"><span>Publicación de UpGames</span><input class="inp" id="n-id" placeholder="Pega el enlace de la publicación" value="${h(actual)}"></label>
      <label class="campo"><span>Qué escribir</span><select class="inp" id="n-tipo"><option value="resena">Reseña</option><option value="guia">Guía de instalación</option><option value="noticia">Noticia</option></select></label>
      <label class="campo"><span>Enfoque (opcional)</span><input class="inp" id="n-nota" maxlength="200" placeholder="Ej.: rendimiento en celulares de gama baja"></label>
      <button class="btn pri ancho" id="n-ok">${ico('sparkles-outline')} Escribir borrador</button>`);
    $('#n-ok', c).onclick = async ev => {
      const jid = ($('#n-id', c).value.match(/[a-f0-9]{24}/i) || [''])[0].toLowerCase();
      if (!jid) return toast('Pega el enlace de una publicación de UpGames.', true);
      const hayTexto = [...cont.children].some(x => { const b = x.leer?.(); return b && b.tipo === 'texto' && String(b.texto || '').trim(); });
      if (hayTexto && !(await confirmar('¿Reemplazar lo escrito?', 'El borrador de Nexus sustituirá los bloques que ya tienes.', 'Reemplazar', true))) return;
      try {
        await ocupado(ev.currentTarget, async () => {
          const r = await api('/blogs/nexus/escribir', { metodo: 'POST', cuerpo: { juegoId: jid, tipo: $('#n-tipo', c).value, nota: $('#n-nota', c).value } });
          cerrarHoja();
          cont.innerHTML = ''; r.bloques.forEach(b => cont.appendChild(crearBloque(b)));
          if (!tit.value.trim()) { tit.value = r.titulo; crecer(tit); }
          meta.etiquetas = (r.etiquetas || []).join(', '); meta.resumen = r.resumen || ''; sucio = true;
          toast('Borrador listo. Revísalo y complétalo con tu experiencia ✦');
        });
      } catch (e) { toast(e.message, true); }
    };
  }
  if (juegoDesde) setTimeout(nexusPublicacion, 350);
  else if (conNexus) setTimeout(nexusLanding, 200);

  let urlPrevia = urlPreviaInicial;
  async function guardar(estado, boton, callado) {
    const bloques = [...cont.children].map(el => el.leer()).filter(b => b && (b.tipo === 'separador' || b.tipo === 'formulario' || [b.texto, b.url, b.id, b.titulo].some(v => String(v || '').trim()) || [b.urls, b.items, b.filas].some(a => a?.length)));
    const titulo = tit.value.trim();
    if (!titulo) { tit.focus(); return toast('Ponle un título.', true); }
    if (estado !== 'borrador' && !bloques.length) return toast('La entrada está vacía. Escribe algo antes de publicar.', true);
    const malBoton = bloques.find(b => b.tipo === 'boton' && !/^https:\/\/\S+\.\S+/.test(b.url));
    if (malBoton) return toast('El botón necesita un enlace que empiece por https://', true);
    const enlacesSec = bloques.flatMap(b => SEC[b.tipo] ? [[b.bTexto, b.bUrl], [b.b2Texto, b.b2Url], ...(b.items || []).map(i => [i.bTexto, i.bUrl])] : []);
    const malEnlace = enlacesSec.find(([t, u]) => String(u || '').trim() && !enlaceOk(u));
    if (malEnlace) return toast(`El enlace del botón «${malEnlace[0] || 'sin texto'}» no es válido. Usa https://… o wa.me/57300…`, true);
    if (estado !== 'borrador') {
      const pend = [hayCorchetes(bloques) && 'hay textos entre [corchetes] sin completar', enlacesSec.some(([t, u]) => String(t || '').trim() && !String(u || '').trim()) && 'hay botones sin enlace (no se mostrarán)'].filter(Boolean);
      if (pend.length && !(await confirmar('¿Publicar así?', `Nexus te avisa: ${pend.join(' y ')}.`, 'Publicar igual'))) return;
    }
    const afil = bloques.flatMap(b => b.tipo === 'afiliado' ? (b.items || []) : []).find(i => String(i.nombre || '').trim() && !/^https:\/\/\S+\.\S+/.test(String(i.url || '').trim()));
    if (afil) return toast(`El producto «${afil.nombre}» necesita su enlace de afiliado (https://…).`, true);
    const cat = bloques.find(b => b.tipo === 'catalogo' && (!window.UGRedes.normalizar('whatsapp', b.whatsapp) || !(b.items || []).some(i => String(i.nombre || '').trim())));
    if (cat) return toast('El catálogo necesita tu WhatsApp (con código de país) y al menos un producto con nombre.', true);
    const malRed = bloques.flatMap(b => b.tipo === 'redes' ? b.items : []).find(i => !window.UGRedes.normalizar(i.red, i.url));
    if (malRed) return toast(`Revisa el dato de ${window.UGRedes.REDES[malRed.red]?.nombre || 'la red'}: «${malRed.url}» no es válido.`, true);
    const programar = estado !== 'borrador' && meta.programar && new Date(meta.programar) > new Date();
    const cuerpo = { tipo, titulo, bloques, etiquetas: meta.etiquetas, portada: meta.portada, resumen: meta.resumen, tituloSeo: meta.tituloSeo, noindex: meta.noindex, estado: programar ? 'programada' : estado, publicadaEn: programar ? meta.programar : undefined };
    await ocupado(boton, async () => {
      const r = await api(`/blogs/${S.blog.id}/entradas${id ? '/' + id : ''}`, { metodo: id ? 'PUT' : 'POST', cuerpo });
      const antes = E.estado;
      E = r.entrada; id = E.id; urlPrevia = r.previa || ''; sucio = false; pintarEstado();
      try { localStorage.removeItem(`ug_editor_${S.blog.id}_${E.id}`); localStorage.removeItem(`ug_editor_${S.blog.id}_nueva-${tipo}`); } catch (_) {}
      marcaGuardado('');
      if (callado) return;
      if (E.estado === 'publicada' && antes !== 'publicada') {
        const c = hoja(`<h3>¡Publicada! 🎉</h3><p>Tu ${esPag ? 'página' : 'entrada'} ya está en internet.</p><code style="word-break:break-all;color:var(--cy);font-size:.86rem">${h(r.url)}</code>
          <div class="fila"><button class="btn" data-c style="flex:1">${ico('copy-outline')} Copiar enlace</button><a class="btn pri" style="flex:1" href="${h(r.url)}" target="_blank" rel="noopener">${ico('open-outline')} Verla</a></div><button class="btn ancho" data-l>Volver a la lista</button>`);
        if (esPag && !S.blog.ajustes?.inicio && SEC[E.bloques?.[0]?.tipo]) {
          $('[data-l]', c).insertAdjacentHTML('beforebegin', `<button class="btn ancho nx-op" data-ini>${ico('home-outline')} ✦ Usar esta landing como inicio de mi sitio</button>`);
          $('[data-ini]', c).onclick = ev => ocupado(ev.currentTarget, async () => { await guardarBlog({ ajustes: { inicio: E.id } }, '¡Listo! Tu sitio abre con esta landing'); ev.currentTarget?.remove(); });
        }
        $('[data-c]', c).onclick = () => copiar(r.url);
        $('[data-l]', c).onclick = () => { cerrarHoja(); panel(); };
      } else toast(E.estado === 'programada' ? `Programada para el ${new Date(E.publicadaEn).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}` : E.estado === 'borrador' ? 'Borrador guardado' : 'Cambios publicados');
    });
  }
  $('#publicar').onclick = e => guardar('publicada', e.currentTarget);
  // Vista previa en vivo: lo que hay en el editor, sin guardar, en celular o computador
  $('#previa').onclick = () => previaViva({ tipo, titulo: tit.value, bloques: [...cont.children].map(x => x.leer?.()).filter(Boolean), etiquetas: meta.etiquetas, portada: meta.portada, resumen: meta.resumen }, () => abrirPreviaPrivada());
  // Enlace privado (lo último guardado): para compartirlo antes de publicar
  const abrirPreviaPrivada = async e => {
    const boton = $('#previa'), w = window.open('', '_blank');
    // Un borrador se guarda antes de verlo. Lo ya publicado no: guardarlo publicaría los cambios.
    if (E.estado === 'borrador') await guardar('borrador', boton, true);
    else if (sucio) toast('Se muestra lo último guardado. Toca «Actualizar» para ver tus cambios.');
    if (urlPrevia && (E.estado !== 'borrador' || !sucio)) { if (w) w.location = urlPrevia; else location.href = urlPrevia; } else w?.close();
  };
  $('#borrador').onclick = async e => {
    const boton = e.currentTarget;
    if (publica() && !(await confirmar('¿Pasar a borrador?', 'Dejará de verse en tu blog hasta que la publiques otra vez.', 'Pasar a borrador'))) return;
    guardar('borrador', boton);
  };
  $('#salir').onclick = async () => {
    if (sucio && E.estado === 'borrador' && tit.value.trim()) await autoguardar();   // un borrador se guarda solo al salir
    if (sucio && !(await confirmar('¿Salir sin guardar?', 'Hay cambios que no has guardado. Quedará una copia en este dispositivo.', 'Salir', true))) return;
    if (sucio) copiaLocal();
    sucio = false; clearInterval(tAuto); S.vista = esPag ? 'paginas' : 'entradas'; panel();
  };
  if (!id) tit.focus();
}

// ── ARRANQUE ────────────────────────────────────────────────────────
(async function iniciar() {
  const q = new URLSearchParams(location.search);
  const rep = (q.get('reportar') || '').toLowerCase();
  if (/^[a-z0-9-]{3,30}$/.test(rep)) return reporte(rep);
  if (!TOKEN || !YO) return bienvenida();
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}
  try {
    const [t, m] = await Promise.all([api('/blogs/temas', { publico: true }), api('/blogs/mios')]);
    S.temas = t.temas; S.fuentes = t.fuentes; S.fondos = t.fondos || []; S.cpm = t.cpm || 0; S.blogs = m.blogs; S.maximo = m.maximo; S.premium = !!m.premium;
    S.blog = S.blogs[0] || null;
    S.blog ? (JUEGO_INICIAL ? editor('entrada') : panel()) : asistente(false);
  } catch (e) {
    app.innerHTML = `<div class="portal">${LOGO}<div class="vacio" style="margin-top:40px"><b>No se pudo cargar</b>${h(e.message)}<br><br><button class="btn" onclick="location.reload()">Reintentar</button></div></div>`;
  }
})();
})();
