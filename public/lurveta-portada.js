/* Lurveta · Portada: la tira «Proyectos reales» se actualiza con los más descargados
   del catálogo. El HTML ya trae una versión estática (sin JS o si la API falla, se queda esa). */
(() => {
  'use strict';
  const tira = document.getElementById('lp-tira');
  if (!tira || !window.fetch) return;
  const API = (window.UG_CONFIG && window.UG_CONFIG.API_URL) || 'https://upgames-production.up.railway.app';   // misma fuente que el resto de páginas
  // Portada de Cloudinary recortada al tamaño de la tarjeta (otras URLs se usan tal cual)
  const portada = u => /res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u) ? u.replace('/image/upload/', '/image/upload/c_fill,w_500,h_300,g_auto,q_auto,f_auto/') : u;
  const etiqueta = { Ajustes: 'Herramientas', Optimizacion: 'Optimización', Apps: 'App' };
  function tarjeta(it, copia) {
    const a = document.createElement('a');
    a.className = 'lp-proy'; a.href = '/?id=' + encodeURIComponent(it._id);
    if (copia) { a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1; }
    const img = document.createElement('img');
    img.src = portada(it.image); img.alt = copia ? '' : it.title; img.loading = 'lazy'; img.decoding = 'async'; img.width = 250; img.height = 150;
    const t = document.createElement('span'), b = document.createElement('b');
    b.textContent = it.title; t.append(b, ' · ' + (etiqueta[it.category] || it.category || 'General'));
    a.append(img, t);
    return a;
  }
  // Si la API falla, la tira estática se queda y el visitante no ve nada técnico; el equipo recibe UN aviso con la causa
  // (tiempo agotado, HTTP, respuesta inválida o catálogo vacío) en las alertas del panel. Sin conexión no se avisa.
  const fallo = (causa, detalle) => {
    try {
      if (!navigator.onLine) return;
      console.info('[portada] catálogo no disponible:', causa, detalle || '');
      const cuerpo = JSON.stringify({ mensaje: `Portada: tira de proyectos sin datos (${causa})`, stack: String(detalle || '').slice(0, 300), pagina: location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/errores/cliente', new Blob([cuerpo], { type: 'application/json' }));
    } catch (_) {}
  };
  const ctl = new AbortController(); let agotado = false; setTimeout(() => { agotado = true; ctl.abort(); }, 8000);
  fetch(API + '/items', { signal: ctl.signal })
    .then(r => r.ok ? r.json().catch(() => Promise.reject({ causa: 'respuesta inválida' })) : Promise.reject({ causa: `HTTP ${r.status}` }))
    .then(d => {
      if (!d || (typeof d !== 'object')) return fallo('respuesta inválida');
      const items = (Array.isArray(d) ? d : d.items || [])
        .filter(it => it && it._id && it.title && it.category !== 'Video' && /^https:\/\//.test(it.image || '') && !/\.(mp4|webm|mov)(\?|$)/i.test(it.image))
        .sort((x, y) => (y.descargasEfectivas || 0) - (x.descargasEfectivas || 0))
        .slice(0, 10);
      if (items.length < 4) return fallo(items.length ? 'catálogo con menos de 4 proyectos con portada' : 'catálogo vacío');
      const f = document.createDocumentFragment();
      items.forEach(it => f.append(tarjeta(it, false)));
      items.forEach(it => f.append(tarjeta(it, true)));
      tira.replaceChildren(f);
    })
    .catch(e => fallo(agotado ? 'tiempo agotado (8 s)' : e && e.causa ? e.causa : navigator.onLine ? 'error de red o CORS' : 'sin conexión', e && e.message));
})();
