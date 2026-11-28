(function () {
  'use strict';
  const raiz = document.getElementById('new-view');
  if (!raiz) return;
  const $ = sel => raiz.querySelector(sel);
  const cuerpo = $('#ugn-cuerpo'), compositor = $('#editorial-composer');
  const lector = $('#editorial-reader'), secundario = $('#editorial-action');
  const lectorCuerpo = $('#editorial-reader-body'), accionCuerpo = $('#editorial-action-body');
  const filtros = { todo: 'Para ti', siguiendo: 'Siguiendo', explorar: 'Explorar', populares: 'Tendencias', recientes: 'Recientes', guardados: 'Guardados' };
  const estados = new Map(), entradas = new Map();
  const params = new URLSearchParams(location.search);
  let filtro = Object.hasOwn(filtros, params.get('vista')) ? params.get('vista') : 'todo';
  let tema = params.get('tema') || '', consulta = params.get('qEditorial') || '', sitios = null, tematicas = [], recomendaciones, lecturaActual;
  let abierto = false, secuencia = 0, respondido = null, perfilActual, volverA;
  const cabeza = n => `<ion-icon name="${n}" aria-hidden="true"></ion-icon>`;
  const yo = () => LS.get('user_admin').toLowerCase();
  const clave = () => `${filtro}:${tema}:${consulta}`;
  const nuevoEstado = () => ({ ids: [], siguiente: null, cargado: false, cargando: false, error: '' });
  const estado = () => { if (!estados.has(clave())) estados.set(clave(), nuevoEstado()); return estados.get(clave()); };
  const esc = escH;
  let avisoTimer;
  function aviso(texto) {
    const el = $('#editorial-toast');
    el.textContent = texto; el.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function segura(v) {
    try {
      const url = new URL(v);
      return (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) ? url.href : '';
    } catch (_) { return ''; }
  }
  const etiqueta = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fecha = v => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)) : '';
  const numero = n => new Intl.NumberFormat('es', { notation: 'compact' }).format(n || 0);
  const enlaceComunidad = (tipo, id) => {
    const url = new URL('/public/biblioteca.html', location.origin);
    url.searchParams.set('tab', 'new');
    url.searchParams.set(tipo, id);
    return url.href;
  };
  const avatar = (usuario, src) => segura(src) ? `<img class="editorial-avatar" src="${esc(segura(src))}" alt="" loading="lazy">`
    : `<span class="editorial-avatar" aria-hidden="true">${esc((usuario || '?').split(/[ _-]/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase())}</span>`;
  const imagen = (src, clase = '', alt = '') => segura(src) ? `<img class="${clase}" src="${esc(segura(src))}" alt="${esc(alt)}" loading="lazy" decoding="async">` : '';
  const foto = (src, clase = '') => imagen(src, clase);
  const boton = (accion, label, icono, atributos = '') => `<button type="button" data-editorial="${accion}" aria-label="${esc(label)}" title="${esc(label)}" ${atributos}>${cabeza(icono)}</button>`;

  async function api(ruta, metodo = 'GET', data) {
    const token = LS.get('token');
    const r = await fetch(API_URL + ruta, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const d = await r.json();
    if (!r.ok || d.success === false) throw new Error(d.error || 'No se pudo completar. Inténtalo de nuevo.');
    return d;
  }

  function adjuntos(e, videoActivo) {
    return (e.media || []).map(m => {
      if (m.tipo === 'imagen') return foto(m.url, 'editorial-photo');
      if (m.tipo === 'galeria') return `<div class="editorial-gallery">${m.urls.map(u => foto(u, 'editorial-photo')).join('')}</div>`;
      if (m.tipo !== 'video' || !/^[\w-]{11}$/.test(m.id)) return '';
      return videoActivo
        ? `<iframe class="editorial-video" src="https://www.youtube-nocookie.com/embed/${m.id}" title="Vídeo de YouTube" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : `<button type="button" class="editorial-video-link" data-editorial="leer" data-id="${e.id}">${cabeza('play-circle-outline')} Ver vídeo de YouTube</button>`;
    }).join('');
  }

  function tarjetaEnlace(e) {
    const link = e.enlace, url = segura(link?.url);
    if (!url) return '';
    const host = new URL(url).hostname;
    return `<a class="editorial-link-card" href="${esc(url)}" target="_blank" rel="ugc nofollow noopener noreferrer">
      ${foto(link.imagen, 'editorial-link-image')}<span><small>${esc(host)}</small><strong>${esc(link.titulo || host)}</strong>
      ${link.descripcion ? `<span>${esc(link.descripcion)}</span>` : ''}</span>${cabeza('open-outline')}</a>`;
  }

  function articulo(e, lectura) {
    const titulo = esc(e.titulo);
    const cuerpo = `<h${lectura ? 1 : 3}>${titulo}</h${lectura ? 1 : 3}>
      ${e.resumen ? `<p>${esc(e.resumen)}</p>` : ''}`;
    const portada = foto(e.portada, 'editorial-cover');
    if (lectura) return `<div class="editorial-article-title">${cuerpo}</div>${portada}`;
    return `<a class="editorial-article-link${portada ? ' con-portada' : ''}" href="${esc(enlaceComunidad('publicacion', e.id))}" data-editorial="leer" data-id="${e.id}">${portada}<div class="editorial-article-title">${cuerpo}</div></a>`;
  }

  function controles(e) {
    const datos = `data-id="${e.id}"`;
    return `<footer class="editorial-controls">
      <button type="button" data-editorial="gusta" ${datos} aria-pressed="${e.meGusta}" aria-label="Me gusta">${cabeza(e.meGusta ? 'heart' : 'heart-outline')}<span>${numero(e.gusta)}</span></button>
      <button type="button" data-editorial="conversar" ${datos} aria-label="Comentarios">${cabeza('chatbubble-outline')}<span>${numero(e.comentarios)}</span></button>
      <button type="button" data-editorial="republicar" ${datos} aria-label="Republicar">${cabeza('repeat-outline')}<span>${numero(e.republicaciones)}</span></button>
      ${boton('guardar', 'Guardar', e.guardada ? 'bookmark' : 'bookmark-outline', `${datos} aria-pressed="${e.guardada}"`)}
      ${boton('compartir', 'Compartir', 'share-outline', datos)}
      <details class="editorial-menu"><summary aria-label="Más acciones">${cabeza('ellipsis-horizontal')}</summary>
        <div><button type="button" data-editorial="copiar" ${datos}>Copiar enlace</button>${e.propia ? `${e.tipo !== 'entrada' ? `<button type="button" data-editorial="borrar" ${datos}>Eliminar</button>` : ''}`
          : `<button type="button" data-editorial="reportar" ${datos}>Reportar</button><button type="button" data-editorial="silenciar" ${datos}>Silenciar autor</button><button type="button" data-editorial="bloquear" ${datos}>Bloquear autor</button>`}</div>
      </details>
    </footer>`;
  }

  function presentacion(e, lectura = false, cita = false) {
    const esArticulo = e.tipo === 'entrada';
    const destacado = e.destacada || !!recomendaciones?.destacadas?.some(x => x.id === e.id);
    const perfil = enlaceComunidad('perfilBlog', e.blogId);
    return `<article class="editorial-post ${esArticulo ? 'editorial-article' : 'editorial-note'}${destacado ? ' editorial-featured' : ''}" data-publicacion="${e.id}">
      <div class="editorial-byline">
        <a class="editorial-who" href="${esc(perfil)}" data-editorial="perfil" data-id="${e.blogId}">${avatar(e.blog, e.avatar)}
          <span><strong>${esc(e.blog)}</strong><small>@${esc(e.usuario)} · <time>${esc(fecha(e.fecha))}</time></small></span></a>
        ${!cita && !e.propia ? `<button type="button" class="editorial-follow" data-editorial="seguir-blog" data-id="${e.blogId}" aria-pressed="${e.sigoBlog}">${e.sigoBlog ? 'Siguiendo' : 'Seguir blog'}</button>` : ''}
      </div>
      ${e.tipo === 'republicacion' ? '<small class="editorial-type">Republicación</small>' : ''}
      ${esArticulo ? articulo(e, lectura) : `${e.texto ? `<p class="editorial-note-text">${esc(e.texto)}</p>` : ''}${adjuntos(e, lectura)}${tarjetaEnlace(e)}`}
      ${e.original ? `<div class="editorial-original">${presentacion(e.original, false, true)}
        <button type="button" class="editorial-inline" data-editorial="leer" data-id="${e.original.id}">Abrir publicación original</button></div>` : ''}
      <div class="editorial-post-meta">
        ${destacado ? '<span>Destacado</span>' : ''}${esArticulo ? `<span>${e.lectura} min de lectura</span>` : ''}
        ${(e.temas?.slice(0, 1) || []).map(t => `<button type="button" data-editorial="tema" data-tema="${etiqueta(t)}">${esc(t)}</button>`).join('')}
        ${(e.etiquetas || []).slice(0, 2).map(t => `<button type="button" data-editorial="tema" data-tema="${etiqueta(t)}">#${esc(t)}</button>`).join('')}
      </div>
      ${cita ? '' : controles(e)}
    </article>`;
  }

  function guardarEntrada(e) {
    if (e.original) guardarEntrada(e.original);
    entradas.set(e.id, e);
    return e.id;
  }

  function aside() {
    const lista = estado().ids.map(id => entradas.get(id));
    const blogs = [...new Map(lista.filter(e => !e.propia && !e.sigoBlog).map(e => [e.blogId, e])).values()].slice(0, 4);
    const temas = [...new Set(lista.flatMap(e => e.temas))].slice(0, 7);
    const destacados = recomendaciones?.destacadas?.length ? recomendaciones.destacadas : recomendaciones?.populares || [];
    const sugeridas = (destacados.length ? destacados : recomendaciones?.nexus || []).slice(0, 3);
    $('#editorial-aside').innerHTML = (blogs.length ? `<section><h2>Blogs para seguir</h2>${blogs.map(e => `<div class="editorial-aside-person"><a href="${esc(enlaceComunidad('perfilBlog', e.blogId))}" data-editorial="perfil" data-id="${e.blogId}">${avatar(e.blog, e.avatar)}<span><b>${esc(e.blog)}</b><small>@${esc(e.usuario)}</small></span></a><button type="button" data-editorial="seguir-blog" data-id="${e.blogId}" class="editorial-follow">Seguir</button></div>`).join('')}</section>` : '')
      + (temas.length ? `<section><h2>Temáticas</h2><div class="editorial-tags">${temas.map(t => `<button type="button" data-editorial="tema" data-tema="${etiqueta(t)}">${esc(t)}</button>`).join('')}</div></section>` : '')
      + (destacados.length ? `<section><h2>Lecturas destacadas</h2>${destacados.map(e => `<a class="editorial-aside-article" href="${esc(segura(e.url))}" data-editorial="leer" data-id="${e.id}"><b>${esc(e.titulo)}</b><small>${esc(e.blog)}</small></a>`).join('')}</section>` : '');
  }

  const requiereSesion = () => ['guardados', 'siguiendo'].includes(filtro) && !ugSesion();
  function pintar() {
    const s = estado();
    raiz.querySelectorAll('[data-ugn]').forEach(b => {
      if (b.dataset.ugn === filtro) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#editorial-current').textContent = consulta ? `Resultados para «${consulta}»` : filtros[filtro];
    $('#editorial-progress').textContent = s.cargando ? 'Cargando…' : s.error;
    const el = $('#editorial-topics');
    el.hidden = filtro !== 'explorar' && !tema;
    el.innerHTML = el.hidden ? '' : `<div class="editorial-tags"><button type="button" data-editorial="tema" data-tema="" aria-pressed="${!tema}">Todas</button>${tematicas.map(t => `<button type="button" data-editorial="tema" data-tema="${etiqueta(t)}" aria-pressed="${etiqueta(t) === tema}">${esc(t)}</button>`).join('')}</div>`;
    const mas = $('#editorial-more');
    mas.hidden = !(s.siguiente || s.error); mas.disabled = s.cargando;
    mas.textContent = s.error ? 'Reintentar' : 'Cargar más';
    if (requiereSesion()) {
      cuerpo.innerHTML = `<div class="editorial-empty"><p>Inicia sesión para ver ${filtro === 'guardados' ? 'tus publicaciones guardadas' : 'los blogs y autores que sigues'}.</p><a class="editorial-secondary" href="${esc(ugUrlLogin(false))}">Iniciar sesión</a></div>`;
    } else if (!s.ids.length) {
      cuerpo.innerHTML = s.cargando ? '<div class="editorial-skeleton" aria-hidden="true"></div>'
        : s.cargado ? '<div class="editorial-empty">Todavía no hay publicaciones en esta sección.</div>' : '';
    } else {
      cuerpo.innerHTML = s.ids.map(id => presentacion(entradas.get(id))).join('');
    }
    aside();
  }

  async function cargar({ reiniciar = false } = {}) {
    if (requiereSesion()) return pintar();
    if (reiniciar) estados.set(clave(), nuevoEstado());
    const k = clave(), s = estado();
    if (s.cargando || (s.cargado && !s.siguiente && !s.error)) return pintar();
    s.cargando = true; s.error = '';
    pintar();
    try {
      const q = new URLSearchParams({ vista: filtro, ...(tema ? { tema } : {}), ...(consulta ? { q: consulta } : {}), ...(s.siguiente ? { cursor: s.siguiente } : {}) });
      const d = await api('/blogs/descubrir?' + q);
      s.ids = [...new Set([...s.ids, ...d.entradas.map(guardarEntrada)])];
      s.siguiente = d.siguiente; s.cargado = true;
    } catch (e) { s.error = e.message || 'No se pudo cargar el feed.'; }
    finally { s.cargando = false; if (clave() === k) pintar(); }
  }

  async function autorizar(peticion) {
    if (!ugSesion()) {
      if (lector.open) miniFormulario('Inicia sesión para participar', `<p><a class="editorial-primary" href="${esc(ugUrlLogin(false))}">Iniciar sesión</a></p>`, 'Volver', async () => {});
      else ugPedirSesion(peticion);
      return false;
    }
    return true;
  }

  async function misSitios() {
    if (!ugSesion()) return [];
    if (!sitios) {
      const d = await api('/blogs/mios');
      sitios = d.blogs.filter(b => b.estado === 'activo' && b.visibilidad === 'publico');
    }
    const eleccion = compositor.elements.blog.value;
    compositor.elements.blog.innerHTML = sitios.length ? sitios.map(b => `<option value="${b.id}">${esc(b.titulo)}</option>`).join('')
      : '<option value="">Crea un sitio público</option>';
    if (sitios.some(b => b.id === eleccion)) compositor.elements.blog.value = eleccion;
    return sitios;
  }

  function mensajeCompositor(t, crear) {
    const el = $('#editorial-compose-status');
    el.textContent = t; el.hidden = !t;
    if (crear) el.insertAdjacentHTML('beforeend', ' <a href="./blog.html?crear=1">Crear sitio</a>');
  }
  compositor.elements.archivos.addEventListener('change', async ev => {
    const campo = ev.currentTarget;
    const archivos = [...campo.files].slice(0, 4);
    if (!archivos.length || !(await autorizar('adjuntar imágenes'))) { campo.value = ''; return; }
    const publicar = compositor.querySelector('[type=submit]');
    if (publicar.disabled) return;
    campo.disabled = publicar.disabled = true;
    mensajeCompositor('Subiendo imágenes…');
    try {
      const urls = compositor.elements.imagenes.value.split('\n').map(v => v.trim()).filter(Boolean);
      for (const archivo of archivos.slice(0, Math.max(0, 4 - urls.length))) {
        urls.push(await window.UGBlogSubirImagen(archivo, () => api('/upload/sign?folder=covers')));
        compositor.elements.imagenes.value = urls.join('\n');
      }
      mensajeCompositor('Imágenes adjuntas.');
    } catch (err) { mensajeCompositor(err.message); }
    finally { campo.value = ''; campo.disabled = publicar.disabled = false; }
  });
  compositor.addEventListener('submit', async e => {
    e.preventDefault();
    if (!(await autorizar('publicar una nota'))) return;
    const publicar = compositor.querySelector('[type=submit]');
    if (publicar.disabled) return;
    publicar.disabled = true; mensajeCompositor('');
    try {
      if (!(await misSitios()).length) return mensajeCompositor('Necesitas un sitio público como identidad editorial.', true);
      const f = Object.fromEntries(new FormData(compositor));
      const imagenes = f.imagenes.split('\n').map(x => x.trim()).filter(Boolean);
      const enlace = f.url ? { url: f.url, titulo: f.titulo, descripcion: f.descripcion, imagen: f.imagen } : null;
      await api('/blogs/comunidad/notas', 'POST', { blog: f.blog, texto: f.texto, imagenes, video: f.video.trim(), enlace, etiquetas: f.etiquetas, alcance: f.alcance });
      compositor.reset();
      estados.clear();
      elegir('recientes', '');
      mensajeCompositor('Nota publicada.');
    } catch (err) { mensajeCompositor(err.message); }
    finally { publicar.disabled = false; }
  });

  const buscador = document.getElementById('editorial-search');
  buscador.elements.q.value = consulta;
  buscador.addEventListener('submit', e => {
    e.preventDefault();
    elegir('explorar', '', buscador.elements.q.value.trim());
  });

  function elegir(nueva, etiquetaTema = '', busqueda = '') {
    ocultarLectura();
    filtro = nueva; tema = etiquetaTema; consulta = busqueda; buscador.elements.q.value = busqueda;
    const u = new URL(location.href);
    u.searchParams.set('tab', 'new'); u.searchParams.set('vista', filtro);
    if (tema) u.searchParams.set('tema', tema); else u.searchParams.delete('tema');
    if (consulta) u.searchParams.set('qEditorial', consulta); else u.searchParams.delete('qEditorial');
    history.replaceState(history.state, '', u);
    if (estado().cargado) pintar(); else cargar();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function abrirDialogo(tipo, id, desdeHistorial) {
    if (!lector.open) {
      volverA = document.activeElement;
      lector.showModal();
    }
    if (!desdeHistorial) {
      const u = new URL(location.href);
      u.searchParams.set('tab', 'new');
      u.searchParams.delete('perfilBlog'); u.searchParams.delete('publicacion');
      u.searchParams.set(tipo, id);
      const previo = history.state?.blogReader;
      history[previo ? 'replaceState' : 'pushState']({ ...history.state, blogReader: true }, '', u);
    }
    $('#editorial-reader-title').textContent = tipo === 'perfilBlog' ? 'Perfil editorial' : 'Lectura';
    lectorCuerpo.innerHTML = '<div class="editorial-empty">Cargando…</div>';
    lector.scrollTop = 0;
    return ++secuencia;
  }

  function ocultarLectura() {
    if (!lector.open) return;
    secuencia++; lecturaActual = null; perfilActual = null; respondido = null;
    lector.close();
    volverA?.focus({ preventScroll: true });
  }

  function cerrarLectura() {
    ocultarLectura();
    if (history.state?.blogReader) history.back();
    else {
      const url = new URL(location.href);
      url.searchParams.delete('perfilBlog'); url.searchParams.delete('publicacion');
      history.replaceState(history.state, '', url);
    }
  }
  lector.addEventListener('cancel', e => { e.preventDefault(); cerrarLectura(); });

  async function leer(id, conversar = false, desdeHistorial = false) {
    const n = abrirDialogo('publicacion', id, desdeHistorial);
    lecturaActual = null; perfilActual = null; respondido = null;
    try {
      const d = await api('/blogs/comunidad/publicaciones/' + id);
      if (n !== secuencia) return;
      const e = d.entrada;
      guardarEntrada(e); lecturaActual = e.id;
      lectorCuerpo.innerHTML = presentacion(e, true)
        + (d.contenido ? `<div class="editorial-reading-text">${d.contenido}</div>` : '')
        + (e.tipo === 'entrada' || e.url !== enlaceComunidad('publicacion', id) ? `<p class="editorial-original-link"><a href="${esc(segura(e.url))}" ${d.externa ? 'target="_blank" rel="noopener noreferrer"' : ''}>${d.externa ? 'Leer en el dominio original' : e.tipo === 'entrada' ? 'Ir al artículo original' : 'Ver en el sitio'} ${cabeza('open-outline')}</a></p>` : '')
        + `<section id="editorial-conversation"><h2>Conversación</h2><div role="status" id="editorial-comments-status"></div><div id="editorial-comments"></div>
          <form id="editorial-comment-form"><span id="editorial-reply" hidden></span><textarea name="texto" required maxlength="500" rows="2" aria-label="Comentario" placeholder="Escribe un comentario"></textarea><button type="submit" class="editorial-primary">Comentar</button></form></section>`;
      cargarComentarios(id);
      if (conversar) $('#editorial-conversation').scrollIntoView({ block: 'start' });
    } catch (e) {
      if (n === secuencia) lectorCuerpo.textContent = e.message;
    }
  }

  async function cargarComentarios(id) {
    try {
      const d = await api('/blogs/comentarios/' + id);
      if (lecturaActual !== id) return;
      const porId = new Map(d.comentarios.map(c => [c.id, c]));
      $('#editorial-comments-status').textContent = '';
      $('#editorial-comments').innerHTML = d.comentarios.length ? d.comentarios.map(c =>
        `<div class="editorial-comment${c.padre ? ' editorial-reply' : ''}">${avatar(c.usuario, c.avatar)}<div><b>@${esc(c.usuario)}</b><small> · ${esc(fecha(c.fecha))}</small>
          ${c.padre && porId.get(c.padre) ? `<small class="editorial-reply-to">En respuesta a @${esc(porId.get(c.padre).usuario)}</small>` : ''}<p>${esc(c.texto)}</p>
          <button type="button" class="editorial-inline" data-editorial="responder" data-id="${c.id}" data-autor="${esc(c.usuario)}">Responder</button>
          ${yo() === c.usuario || yo() === d.dueno ? `<button type="button" class="editorial-inline" data-editorial="borrar-comentario" data-id="${c.id}">Eliminar</button>` : ''}</div></div>`).join('')
        : '<p class="editorial-muted">Empieza la conversación.</p>';
    } catch (e) {
      if (lecturaActual !== id) return;
      $('#editorial-comments-status').innerHTML = `${esc(e.message)} <button class="editorial-inline" type="button" data-editorial="comentarios">Reintentar</button>`;
    }
  }

  async function perfil(id, desdeHistorial = false) {
    const n = abrirDialogo('perfilBlog', id, desdeHistorial);
    lecturaActual = null;
    try {
      const [{ perfil: p }, d] = await Promise.all([api('/blogs/comunidad/perfiles/' + id), api('/blogs/comunidad/feed?vista=perfil&blog=' + id)]);
      if (n !== secuencia) return;
      perfilActual = { ...p, siguiente: d.siguiente };
      lectorCuerpo.innerHTML = `<div class="editorial-profile">${foto(p.portada, 'editorial-profile-cover')}
        ${avatar(p.titulo, p.avatar)}<h1>${esc(p.titulo)}</h1><p>@${esc(p.usuario)} · ${numero(p.seguidores)} seguidores del blog · ${numero(p.seguidoresAutor)} del autor</p>
        ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
        <div class="editorial-profile-actions"><a class="editorial-secondary" href="${esc(segura(p.url))}">Visitar sitio ${cabeza('open-outline')}</a>
        ${p.propia ? '' : `<button class="editorial-primary" type="button" data-editorial="seguir-blog" data-id="${p.id}" aria-pressed="${p.sigoBlog}">${p.sigoBlog ? 'Siguiendo blog' : 'Seguir blog'}</button>
        <button class="editorial-secondary" type="button" data-editorial="seguir-autor" data-autor="${esc(p.usuario)}" aria-pressed="${p.sigoAutor}">${p.sigoAutor ? 'Siguiendo autor' : 'Seguir autor'}</button>
        ${p.sigoBlog ? `<label>Avisos <select id="editorial-frecuencia"><option value="cada-articulo">Cada artículo</option><option value="sin-avisos"${p.frecuencia === 'sin-avisos' ? ' selected' : ''}>Sin avisos</option></select></label>` : ''}`}
        </div><div class="editorial-tags">${p.temas.map(t => `<button data-editorial="tema" data-tema="${etiqueta(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="editorial-profile-links">${p.enlaces.filter(a => segura(a.url)).map(a => `<a href="${esc(segura(a.url))}" rel="ugc noopener">${esc(a.texto)}</a>`).join('')}</div>
        </div>${p.destacadas?.length ? `<div class="editorial-profile-pinned"><h2>Destacadas</h2>${p.destacadas.map(e => `<a href="${esc(enlaceComunidad('publicacion', e.id))}" class="editorial-aside-article" data-editorial="leer" data-id="${e.id}">${esc(e.titulo)}</a>`).join('')}</div>` : ''}
        <h2 class="editorial-profile-publicaciones">Publicaciones</h2><div id="editorial-profile-feed">${d.entradas.length ? d.entradas.map(e => presentacion(entradas.get(guardarEntrada(e)))).join('') : '<p class="editorial-empty">Este sitio todavía no tiene publicaciones en la comunidad.</p>'}</div>
        <button class="editorial-secondary" type="button" data-editorial="mas-perfil" ${d.siguiente ? '' : 'hidden'}>Cargar más</button>`;
    } catch (e) {
      if (n === secuencia) lectorCuerpo.textContent = e.message;
    }
  }

  function abrirDesdeUrl(inicial = false) {
    const u = new URL(location.href);
    const tipo = ['publicacion', 'perfilBlog'].find(k => /^[a-f0-9]{24}$/.test(u.searchParams.get(k) || ''));
    if (!tipo) return ocultarLectura();
    const id = u.searchParams.get(tipo);
    const crearHistorial = inicial && !history.state?.blogReader;
    if (crearHistorial) {
      u.searchParams.delete('publicacion'); u.searchParams.delete('perfilBlog');
      history.replaceState(history.state, '', u);
    }
    return tipo === 'publicacion' ? leer(id, false, !crearHistorial) : perfil(id, !crearHistorial);
  }
  window.addEventListener('popstate', () => { if (raiz.classList.contains('active')) abrirDesdeUrl(); });

  function actualizarEntrada(e) {
    entradas.set(e.id, e);
    for (const el of raiz.querySelectorAll(`[data-publicacion="${e.id}"]`)) {
      const pie = el.querySelector(':scope > .editorial-controls');
      if (pie) pie.outerHTML = controles(e);
    }
  }

  function miniFormulario(titulo, campos, etiquetaBoton, fn) {
    accionCuerpo.innerHTML = `<form><h2>${esc(titulo)}</h2>${campos}<p role="status" class="editorial-muted"></p><div><button class="editorial-secondary" type="button" data-editorial="cancelar">Cancelar</button><button class="editorial-primary" type="submit">${esc(etiquetaBoton)}</button></div></form>`;
    secundario.showModal();
    const f = accionCuerpo.querySelector('form');
    f.onsubmit = async e => {
      e.preventDefault();
      const b = f.querySelector('[type=submit]'); b.disabled = true;
      try { await fn(Object.fromEntries(new FormData(f))); secundario.close(); }
      catch (err) { f.querySelector('[role=status]').textContent = err.message; }
      finally { b.disabled = false; }
    };
  }

  async function accion(a, b) {
    const id = b.dataset.id, e = entradas.get(id);
    if (a === 'adjuntos') {
      const campos = $('#editorial-attachments');
      campos.hidden = !campos.hidden;
      b.setAttribute('aria-expanded', String(!campos.hidden));
      if (!campos.hidden) compositor.elements.imagenes.focus();
      return;
    }
    if (a === 'tema') return elegir('explorar', b.dataset.tema);
    if (a === 'mas') return cargar();
    if (a === 'leer' || a === 'conversar') {
      if (a === 'conversar' && lecturaActual === id) return $('#editorial-conversation').scrollIntoView();
      return leer(id, a === 'conversar');
    }
    if (a === 'perfil') return perfil(id);
    if (a === 'volver') return cerrarLectura();
    if (a === 'cancelar') return secundario.close();
    if (a === 'comentarios') return cargarComentarios(lecturaActual);
    if (a === 'mas-perfil') {
      const p = perfilActual;
      const d = await api(`/blogs/comunidad/feed?vista=perfil&blog=${p.id}&cursor=${encodeURIComponent(p.siguiente)}`);
      if (perfilActual !== p) return;
      $('#editorial-profile-feed').insertAdjacentHTML('beforeend', d.entradas.map(x => presentacion(entradas.get(guardarEntrada(x)))).join(''));
      p.siguiente = d.siguiente; b.hidden = !p.siguiente;
      return;
    }
    if (a === 'compartir' || a === 'copiar') {
      const url = segura(e.url) || enlaceComunidad('publicacion', id);
      if (a === 'compartir' && navigator.share) {
        try { await navigator.share({ title: e.titulo || e.blog, url }); return; }
        catch (err) { if (err.name === 'AbortError') return; }
      }
      if (navigator.clipboard) { await navigator.clipboard.writeText(url); return aviso('Enlace copiado.'); }
      return miniFormulario('Compartir publicación', `<input value="${esc(url)}" readonly aria-label="Enlace para copiar">`, 'Cerrar', async () => {});
    }
    if (!(await autorizar('interactuar con la comunidad'))) return;
    if (a === 'responder') {
      respondido = id;
      const msg = $('#editorial-reply'); msg.hidden = false;
      msg.innerHTML = `Respondiendo a @${esc(b.dataset.autor)} <button type="button" class="editorial-inline" data-editorial="cancelar-respuesta">Cancelar</button>`;
      $('#editorial-comment-form textarea').focus();
      return;
    }
    if (a === 'cancelar-respuesta') { respondido = null; $('#editorial-reply').hidden = true; return; }
    if (a === 'borrar-comentario') {
      const idLectura = lecturaActual;
      await api(`/blogs/comentarios/${idLectura}/${id}`, 'DELETE');
      const publicacion = entradas.get(idLectura);
      if (publicacion) actualizarEntrada({ ...publicacion, comentarios: Math.max(0, publicacion.comentarios - 1) });
      return cargarComentarios(idLectura);
    }
    if (a === 'gusta' || a === 'guardar') {
      const d = await api(`/blogs/comunidad/publicaciones/${id}/interaccion`, 'PUT', { tipo: a, activo: a === 'gusta' ? !e.meGusta : !e.guardada });
      actualizarEntrada({ ...entradas.get(id), gusta: d.gusta, ...(a === 'gusta' ? { meGusta: d.activo } : { guardada: d.activo }) });
      if (a === 'guardar') {
        for (const k of estados.keys()) if (k.startsWith('guardados:')) estados.delete(k);
        if (filtro === 'guardados') cargar();
      }
      return;
    }
    if (a === 'seguir-blog') {
      const activo = b.getAttribute('aria-pressed') !== 'true';
      const d = await api(`/blogs/comunidad/perfiles/${id}/seguir`, 'PUT', { activo });
      for (const x of entradas.values()) if (x.blogId === id) x.sigoBlog = d.activo;
      for (const btn of raiz.querySelectorAll(`[data-editorial="seguir-blog"][data-id="${id}"]`)) {
        btn.setAttribute('aria-pressed', String(d.activo)); btn.textContent = d.activo ? 'Siguiendo' : 'Seguir blog';
      }
      for (const k of estados.keys()) if (k.startsWith('siguiendo:')) estados.delete(k);
      aside();
      if (perfilActual?.id === id) await perfil(id, true);
      return;
    }
    if (a === 'seguir-autor') {
      const d = await api(`/usuarios/toggle-seguir/${encodeURIComponent(yo())}/${encodeURIComponent(b.dataset.autor)}`, 'PUT');
      b.setAttribute('aria-pressed', String(!!d.siguiendo));
      b.textContent = d.siguiendo ? 'Siguiendo autor' : 'Seguir autor';
      for (const k of estados.keys()) if (k.startsWith('siguiendo:')) estados.delete(k);
      return;
    }
    if (a === 'republicar') {
      const mios = await misSitios();
      if (!mios.length) { mensajeCompositor('Crea un sitio público para republicar.', true); return aviso('Elige una identidad editorial en Mis blogs.'); }
      return miniFormulario('Republicar', `<label>Publicar como <select name="blog">${mios.map(b => `<option value="${b.id}">${esc(b.titulo)}</option>`).join('')}</select></label>
        <label>Comentario opcional <textarea name="texto" maxlength="500" rows="3"></textarea></label>`, 'Republicar', async f => {
        await api(`/blogs/comunidad/publicaciones/${e.original?.id || id}/republicar`, 'POST', f);
        estados.clear(); elegir('recientes'); aviso('Publicación compartida.');
      });
    }
    if (a === 'reportar') return miniFormulario('Reportar publicación', '<label>Motivo <select name="motivo"><option>Spam</option><option>Estafa</option><option>Acoso</option><option>Contenido inapropiado</option><option>Otro</option></select></label><label>Detalles <textarea name="detalle" maxlength="300"></textarea></label>', 'Enviar reporte', async f => {
      await api(`/blogs/comunidad/publicaciones/${id}/reportar`, 'POST', f); aviso('Reporte recibido.');
    });
    if (a === 'silenciar' || a === 'bloquear') return miniFormulario(`${a === 'silenciar' ? 'Silenciar' : 'Bloquear'} @${e.usuario}`, '<p>Las publicaciones de esta persona se ocultarán en tu feed.</p>', a === 'silenciar' ? 'Silenciar' : 'Bloquear', async () => {
      const usuario = encodeURIComponent(e.usuario);
      if (a === 'silenciar') await api(`/blogs/comunidad/autores/${usuario}/silenciar`, 'PUT', { activo: true });
      else await api(`/chat/bloqueo/${usuario}`, 'POST');
      if (lector.open) cerrarLectura();
      estados.clear(); cargar(); aviso('Preferencia guardada.');
    });
    if (a === 'silenciados') {
      const { autores } = await api('/blogs/comunidad/silenciados');
      return miniFormulario('Autores silenciados', autores.length ? `<label>Volver a mostrar <select name="autor">${autores.map(u => `<option>${esc(u)}</option>`).join('')}</select></label>` : '<p>No tienes autores silenciados.</p>', autores.length ? 'Mostrar' : 'Cerrar', async f => {
        if (!f.autor) return;
        await api(`/blogs/comunidad/autores/${encodeURIComponent(f.autor)}/silenciar`, 'PUT', { activo: false });
        estados.clear(); cargar();
      });
    }
    if (a === 'borrar') return miniFormulario('Eliminar publicación', '<p>Se retirará de la comunidad y del sitio.</p>', 'Eliminar', async () => {
      await api(`/blogs/comunidad/publicaciones/${id}`, 'DELETE');
      if (lector.open) cerrarLectura();
      estados.clear(); cargar(); aviso('Publicación eliminada.');
    });
  }

  raiz.addEventListener('click', async ev => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const f = ev.target.closest('[data-ugn]');
    if (f) return elegir(f.dataset.ugn);
    const b = ev.target.closest('[data-editorial]');
    if (!b || b.dataset.ocupado) return;
    ev.preventDefault(); b.dataset.ocupado = 'true';
    try { await accion(b.dataset.editorial, b); }
    catch (e) { aviso(e.message); }
    finally { delete b.dataset.ocupado; }
  });

  lectorCuerpo.addEventListener('submit', async ev => {
    if (ev.target.id !== 'editorial-comment-form') return;
    ev.preventDefault();
    if (!(await autorizar('comentar'))) return;
    const f = ev.target, b = f.querySelector('button[type=submit]'), id = lecturaActual;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await api('/blogs/comentarios/' + id, 'POST', { texto: f.elements.texto.value, padre: respondido });
      const e = entradas.get(id);
      if (e) actualizarEntrada({ ...e, comentarios: e.comentarios + 1 });
      if (lecturaActual === id) {
        f.reset(); respondido = null; $('#editorial-reply').hidden = true;
        await cargarComentarios(id);
      }
    } catch (e) { aviso(e.message); }
    finally { b.disabled = false; }
  });

  lectorCuerpo.addEventListener('change', async e => {
    if (e.target.id !== 'editorial-frecuencia' || !perfilActual) return;
    const p = perfilActual, anterior = p.frecuencia, valor = e.target.value;
    try {
      const d = await api(`/blogs/comunidad/perfiles/${p.id}/seguir`, 'PUT', { activo: true, frecuencia: valor });
      p.frecuencia = d.frecuencia; aviso('Preferencia de avisos guardada.');
    } catch (err) { e.target.value = anterior; aviso(err.message); }
  });

  const mas = $('#editorial-more');
  if ('IntersectionObserver' in window) new IntersectionObserver(([v]) => {
    const s = estado();
    if (v.isIntersecting && !s.cargando && s.siguiente && !s.error) cargar();
  }, { rootMargin: '120px' }).observe(mas);

  window.UGNew = { abrir() {
    if (!abierto) {
      abierto = true;
      $('#editorial-muted').hidden = !ugSesion();
      $('#editorial-demo').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
      misSitios().then(l => { if (ugSesion() && !l.length) mensajeCompositor('Crea un sitio para publicar como autor.', true); }).catch(e => mensajeCompositor(e.message));
      api('/blogs/temas').then(d => { tematicas = d.TEMATICAS || []; pintar(); }).catch(() => {});
      api('/blogs/descubrir').then(d => { recomendaciones = d.secciones; pintar(); }).catch(() => {});
      abrirDesdeUrl(true);
    }
    if (estado().cargado) pintar(); else cargar();
  } };
})();
