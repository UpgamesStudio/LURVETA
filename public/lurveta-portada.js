/* Lurveta · Portada: la tira «Proyectos reales» se actualiza con los más descargados
   del catálogo. El HTML ya trae una versión estática (sin JS o si la API falla, se queda esa). */
(() => {
  'use strict';
  const tira = document.getElementById('lp-tira');
  if (!tira || !window.fetch) return;
  const API = 'https://upgames-production.up.railway.app';
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
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
  fetch(API + '/items', { signal: ctl.signal })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      const items = (Array.isArray(d) ? d : d.items || [])
        .filter(it => it && it._id && it.title && it.category !== 'Video' && /^https:\/\//.test(it.image || '') && !/\.(mp4|webm|mov)(\?|$)/i.test(it.image))
        .sort((x, y) => (y.descargasEfectivas || 0) - (x.descargasEfectivas || 0))
        .slice(0, 10);
      if (items.length < 4) return;
      const f = document.createDocumentFragment();
      items.forEach(it => f.append(tarjeta(it, false)));
      items.forEach(it => f.append(tarjeta(it, true)));
      tira.replaceChildren(f);
    })
    .catch(() => {});
})();
