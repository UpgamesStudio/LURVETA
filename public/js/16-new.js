// ═══════════════════════════════════════════════════════════
// NEW — lecturas de la comunidad (entradas de UpGames Blogs)
// Datos: GET /blogs/descubrir (rutas/blogs.js · modulos/blogs/descubrir.js).
// Cada entrada es una tarjeta suelta (portada, título, resumen, creador, fecha,
// lecturas y comentarios); al tocarla se abre el artículo completo en su blog.
// ═══════════════════════════════════════════════════════════
(function () {
  const cuerpo = () => document.getElementById('ugn-cuerpo');
  let datos = null, pedido = null, pedidoEn = 0, filtro = 'todo';

  const img = src => (/^https:\/\//.test(src || '') ? (typeof cldOpt === 'function' ? cldOpt(src, 'c_limit,w_720,q_auto,f_auto') : src) : '');
  const nf = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n); };
  function hace(f) {
    const s = (Date.now() - new Date(f)) / 1000;
    if (!(s >= 0)) return '';
    if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    if (s < 7 * 86400) return `hace ${Math.round(s / 86400)} d`;
    return new Date(f).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  }

  function tarjeta(e, { grande = false, etiqueta = '' } = {}) {
    const portada = img(e.portada);
    const perfil = `./perfil-publico.html?usuario=${encodeURIComponent(e.usuario)}`;
    const avatar = img(e.avatar);
    return `<article class="ugn-card${grande ? ' ugn-card--grande' : ''}${portada ? '' : ' ugn-card--sin-img'}">
      <a class="ugn-card-link" href="${escH(e.url)}" target="_blank" rel="noopener" aria-label="Leer: ${escH(e.titulo)}">
        ${portada ? `<span class="ugn-card-img" style="background-image:url('${escH(portada)}')"></span>` : ''}
        <span class="ugn-card-txt">
          ${etiqueta ? `<span class="ugn-chip">${escH(etiqueta)}</span>` : ''}
          <b class="ugn-card-t">${escH(e.titulo)}</b>
          ${e.resumen ? `<span class="ugn-card-r">${escH(e.resumen)}</span>` : ''}
        </span>
      </a>
      <footer class="ugn-card-pie">
        <a class="ugn-autor" href="${perfil}">
          <span class="ugn-av"${avatar ? ` style="background-image:url('${escH(avatar)}')"` : ''}>${avatar ? '' : escH((e.usuario || '?')[0].toUpperCase())}</span>
          <span><b>@${escH(e.usuario)}</b><small>${escH(e.blog)}</small></span>
        </a>
        <span class="ugn-meta"><time datetime="${escH(e.fecha)}">${hace(e.fecha)}</time>${e.vistas ? ` · <ion-icon name="eye-outline"></ion-icon>${nf(e.vistas)}` : ''}${e.comentarios ? ` · <ion-icon name="chatbubble-outline"></ion-icon>${nf(e.comentarios)}` : ''}</span>
      </footer>
    </article>`;
  }
  const seccion = (titulo, sub, lista, op = {}) => !lista?.length ? '' : `<section class="ugn-sec">
      <div class="ugn-sec-h"><h2>${titulo}</h2>${sub ? `<small>${sub}</small>` : ''}</div>
      <div class="ugn-grid">${lista.map(e => tarjeta(e, op)).join('')}</div></section>`;
  const vacio = (icono, t, p, accion = '') => `<div class="ugn-vacio"><ion-icon name="${icono}"></ion-icon><h3>${t}</h3><p>${p}</p>${accion}</div>`;

  function pintar() {
    const el = cuerpo(); if (!el) return;
    document.querySelectorAll('#new-view [data-ugn]').forEach(b => { const on = b.dataset.ugn === filtro; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    if (!datos) return;
    const s = datos.secciones || {};
    const algo = ['nexus', 'destacadas', 'populares', 'recientes'].some(k => s[k]?.length);
    if (!algo) { el.innerHTML = vacio('newspaper-outline', 'Todavía no hay lecturas', 'Cuando los creadores publiquen en sus blogs, aparecerán aquí.', '<a class="ugn-btn" href="./blog.html">Crea tu blog</a>'); return; }
    if (filtro === 'siguiendo') {
      el.innerHTML = !datos.conSesion
        ? vacio('people-outline', 'Lo de tus creadores, aquí', 'Inicia sesión para ver las entradas de quienes sigues.', `<a class="ugn-btn" href="${typeof ugUrlLogin === 'function' ? ugUrlLogin(true) : '../login.html'}">Iniciar sesión</a>`)
        : s.siguiendo?.length ? `<div class="ugn-grid">${s.siguiendo.map(e => tarjeta(e)).join('')}</div>`
        : vacio('people-outline', 'Aún no hay entradas de quienes sigues', 'Sigue a creadores desde su perfil y sus nuevas entradas aparecerán aquí.');
      return;
    }
    if (filtro === 'populares') { el.innerHTML = s.populares?.length ? `<div class="ugn-grid">${s.populares.map(e => tarjeta(e)).join('')}</div>` : vacio('flame-outline', 'Sin populares este mes', 'Vuelve pronto.'); return; }
    if (filtro === 'recientes') { el.innerHTML = `<div class="ugn-grid">${(s.recientes || []).map(e => tarjeta(e)).join('')}</div>`; return; }
    const [primera, ...resto] = s.nexus || [];
    el.innerHTML = (primera ? `<section class="ugn-sec ugn-sec--nexus"><div class="ugn-sec-h"><h2><ion-icon name="sparkles"></ion-icon> Recomendado por Nexus</h2></div>
        ${tarjeta(primera, { grande: true })}<div class="ugn-grid">${resto.map(e => tarjeta(e)).join('')}</div></section>` : '')
      + seccion('Destacadas', 'De creadores Premium', s.destacadas, { etiqueta: 'Destacado' })
      + (datos.conSesion ? seccion('De quienes sigues', '', (s.siguiendo || []).slice(0, 4)) : '')
      + seccion('Populares', 'Lo más leído del mes', (s.populares || []).slice(0, 6))
      + seccion('Recientes', 'Lo último publicado', (s.recientes || []).slice(0, 8));
  }

  async function cargar(forzar) {
    if (pedido) return pedido;
    if (datos && !forzar && Date.now() - pedidoEn < 120e3) return datos;
    const el = cuerpo();
    if (!datos && el) el.innerHTML = '<div class="ugn-carga"><span></span><span></span><span></span></div>';
    const token = LS.get('token');
    pedido = fetch(`${API_URL}/blogs/descubrir`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(d => { if (!d.success) throw new Error('sin datos'); datos = d; pedidoEn = Date.now(); pintar(); return d; })
      .catch(() => { if (!datos && cuerpo()) cuerpo().innerHTML = vacio('cloud-offline-outline', 'No se pudieron cargar las lecturas', 'Revisa tu conexión e inténtalo de nuevo.', '<button type="button" class="ugn-btn" data-ugn-reintentar>Reintentar</button>'); })
      .finally(() => { pedido = null; });
    return pedido;
  }

  document.getElementById('new-view')?.addEventListener('click', e => {
    const b = e.target.closest('[data-ugn]');
    if (b) { filtro = b.dataset.ugn; pintar(); scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (e.target.closest('[data-ugn-reintentar]')) cargar(true);
  });

  window.UGNew = { abrir: () => { pintar(); cargar(); } };
})();
