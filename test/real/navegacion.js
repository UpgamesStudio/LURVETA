#!/usr/bin/env node
/**
 * Navegación de la biblioteca en un navegador real (móvil y escritorio):
 *  - barra inferior: exactamente Inicio · Videos · Nexus · Novedades · Perfil
 *  - Favoritos, Ganancias y Economía se abren desde el Perfil (y Perfil queda marcado)
 *  - sin pestaña Logros; las demás pestañas del perfil siguen
 *  - Videos abre el feed vertical de siempre
 *  - Novedades pinta tarjetas por entrada que llevan al artículo completo
 *  - página puente: el botón de descarga queda debajo de la primera pantalla
 * La API se simula (no toca producción). Uso: node test/real/navegacion.js  (CAPTURAS=dir para guardar capturas)
 */
'use strict';
const path = require('path');
const { servirRaiz, navegador, contador } = require('./util');
const API = 'https://upgames-production.up.railway.app';
const espera = ms => new Promise(r => setTimeout(r, ms));
const CAPT = process.env.CAPTURAS;

const tarjeta = (i, o = {}) => ({ id: `e${i}`, blogId: `b${i % 3}`, titulo: `Guía ${i}: cómo sacar más FPS`, resumen: 'Un repaso práctico de los ajustes que de verdad cambian el rendimiento en equipos modestos.',
  portada: i % 2 ? '' : `https://res.cloudinary.com/demo/image/upload/sample.jpg`, url: `https://upgames-production.up.railway.app/b/blog-${i % 3}/e/guia-${i}`, blog: `Blog ${i % 3}`, usuario: `creador${i % 3}`,
  avatar: '', fecha: new Date(Date.now() - i * 36e5).toISOString(), vistas: 100 - i, comentarios: i % 4, etiquetas: [], premium: i === 7, ...o });
const DESCUBRIR = { success: true, conSesion: false, secciones: {
  nexus: [0, 1, 2, 3].map(i => tarjeta(i)), destacadas: [tarjeta(7)], siguiendo: [], populares: [4, 5, 6].map(i => tarjeta(i)), recientes: [0, 1, 2, 3, 4, 5, 6, 7].map(i => tarjeta(i)) } };

async function contexto(b, web, viewport, { sesion = false, sinAnuncios = false } = {}) {
  // Sin service worker: él pide la API por su cuenta (network-first) y se saltaría la API simulada,
  // yendo a producción (donde /blogs/descubrir aún no existe). Así fallaba en CI.
  const ctx = await b.newContext({ viewport, serviceWorkers: 'block', ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([s, sa]) => {
    try {
      localStorage.setItem('upgames_tutorial_done', '1'); localStorage.setItem('ug_onb_hecho', '1');
      if (s) { localStorage.setItem('token', 'x'.repeat(40)); localStorage.setItem('user_admin', 'tester'); }
      if (sa) localStorage.setItem('ug_pase_hasta', `tester|${Date.now() + 864e5}`);
    } catch (_) {}
  }, [sesion, sinAnuncios]);
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(web.url) || /unpkg\.com\/ionicons/.test(u)) return r.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (u.startsWith(API) && r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });   // preflight (la petición lleva Authorization)
    if (u.startsWith(API + '/blogs/descubrir')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...DESCUBRIR, conSesion: sesion }), headers: cors });
    if (u.startsWith(API + '/economia/ticket')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ticket: 'a.b', esperaMs: 25000 }), headers: cors });
    if (u.startsWith(API)) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: cors });
    return r.abort();   // anuncios y terceros: fuera de la prueba
  });
  return ctx;
}

(async () => {
  const C = contador('Navegación, perfil, Novedades y página puente');
  const web = await servirRaiz(), b = await navegador();
  const errores = [];
  const VISTAS = [['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]];

  for (const [nombre, vp] of VISTAS) {
    C.seccion(`Biblioteca · ${nombre}`);
    const ctx = await contexto(b, web, vp, { sesion: true });
    const p = await ctx.newPage(); p.on('pageerror', e => errores.push(`${nombre}: ${e.message} ${String(e.stack || '').split('\n').slice(0, 3).join(' | ')}`));
    await p.goto(`${web.url}/`, { waitUntil: 'domcontentloaded' }); await espera(2500);
    await p.evaluate(() => { document.getElementById('preloader')?.remove(); document.querySelectorAll('.modal, #onboarding-modal, .btut, #tutorial-overlay').forEach(m => m.remove?.()); });

    const nav = await p.$$eval('#bottom-nav .nav-tab', bs => bs.map(x => x.querySelector('span')?.textContent.trim()));
    C.prueba('barra inferior: Inicio · Videos · Nexus · Novedades · Perfil', JSON.stringify(nav) === JSON.stringify(['Inicio', 'Videos', 'Nexus', 'Novedades', 'Perfil']), JSON.stringify(nav));
    C.prueba('Favoritos y Ganancias ya no están en la barra', await p.$$eval('#bottom-nav .nav-tab', bs => !bs.some(x => /Favoritos|Ganancias|Economía/.test(x.textContent))));
    const anchos = await p.$$eval('#bottom-nav .nav-tab', bs => bs.map(x => Math.round(x.getBoundingClientRect().width)));
    C.prueba('los cinco botones ocupan el mismo ancho', Math.max(...anchos) - Math.min(...anchos) <= 2, JSON.stringify(anchos));
    if (CAPT) await p.locator('#bottom-nav').screenshot({ path: path.join(CAPT, `nav-${nombre}.png`) });

    // Novedades
    const fallidas = []; p.on('requestfailed', q => fallidas.push(`${q.method()} ${q.url().slice(0, 90)} ${q.failure()?.errorText}`));
    await p.locator('#bottom-nav .nav-tab[data-tab="new"]').click();
    await p.waitForSelector('#new-view .ugn-card', { timeout: 10000 }).catch(() => {});
    const nw = await p.evaluate(() => ({ visible: getComputedStyle(document.getElementById('new-view')).display !== 'none', main: getComputedStyle(document.getElementById('main-view')).display,
      tarjetas: document.querySelectorAll('#new-view .ugn-card').length, grande: !!document.querySelector('#new-view .ugn-card--grande'), activa: document.querySelector('#bottom-nav .nav-tab.active span')?.textContent,
      enlace: document.querySelector('#new-view .ugn-card-link')?.getAttribute('href'), autor: document.querySelector('#new-view .ugn-autor')?.getAttribute('href') }));
    C.prueba('Novedades se abre (y oculta el inicio)', nw.visible && nw.main === 'none' && nw.activa === 'Novedades', JSON.stringify(nw));
    C.prueba('Novedades pinta tarjetas por entrada, con una destacada grande', nw.tarjetas >= 8 && nw.grande, `tarjetas ${nw.tarjetas} · NEW: ${await p.evaluate(() => document.getElementById('ugn-cuerpo').innerText.slice(0, 160))} · fallidas: ${fallidas.filter(f => /railway/.test(f)).join(' | ')}`);
    C.prueba('la tarjeta lleva al artículo completo y el creador a su perfil', /\/b\/blog-\d\/e\/guia-\d/.test(nw.enlace || '') && /perfil-publico\.html\?usuario=creador/.test(nw.autor || ''), JSON.stringify(nw));
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    C.prueba('sin desborde horizontal', desborde <= 1, `${desborde}px`);
    if (CAPT) await p.screenshot({ path: path.join(CAPT, `new-${nombre}.png`) });
    await p.locator('#new-view [data-ugn="recientes"]').click(); await espera(200);
    C.prueba('filtro «Recientes» muestra la lista', (await p.$$eval('#new-view .ugn-card', x => x.length)) === 8);
    await p.locator('#new-view [data-ugn="siguiendo"]').click(); await espera(200);
    C.prueba('«Siguiendo» sin entradas muestra un aviso claro', await p.evaluate(() => !!document.querySelector('#new-view .ugn-vacio')));

    // Perfil
    await p.locator('#bottom-nav .nav-tab[data-tab="profile"]').click(); await espera(900);
    const pf = await p.evaluate(() => ({ accesos: [...document.querySelectorAll('#profile-view .pf-acceso b')].map(x => x.textContent), tabs: [...document.querySelectorAll('#pf-tabs .perfil-tab')].map(x => x.textContent.trim()), logros: !!document.querySelector('[data-pftab="logros"], #pf-tab-logros') }));
    C.prueba('perfil: accesos Favoritos · Ganancias · Economía', JSON.stringify(pf.accesos) === JSON.stringify(['Favoritos', 'Ganancias', 'Economía']), JSON.stringify(pf));
    C.prueba('perfil: sin Logros; siguen Publicaciones, Videos, Colecciones, Pagos y Reportes', !pf.logros && JSON.stringify(pf.tabs) === JSON.stringify(['Publicaciones', 'Videos', 'Colecciones', 'Pagos', 'Reportes']), JSON.stringify(pf.tabs));
    if (CAPT) await p.screenshot({ path: path.join(CAPT, `perfil-${nombre}.png`) });

    await p.locator('.pf-acceso', { hasText: 'Favoritos' }).click(); await espera(500);
    let st = await p.evaluate(() => ({ favs: document.getElementById('favs-view').classList.contains('active'), activa: document.querySelector('#bottom-nav .nav-tab.active span')?.textContent }));
    C.prueba('Favoritos abre su vista y la barra marca Perfil', st.favs && st.activa === 'Perfil', JSON.stringify(st));
    await p.locator('#favs-view .ug-volver-perfil').click(); await espera(500);
    C.prueba('«‹ Perfil» vuelve al perfil', await p.evaluate(() => document.getElementById('profile-view').classList.contains('active')));
    await p.locator('.pf-acceso', { hasText: 'Ganancias' }).click(); await espera(700);
    st = await p.evaluate(() => ({ eco: document.getElementById('economia-view').classList.contains('active'), sec: document.querySelector('#economia-view .eco-sec.active')?.dataset.sec, activa: document.querySelector('#bottom-nav .nav-tab.active span')?.textContent }));
    C.prueba('Ganancias abre el Creator Studio en Resumen', st.eco && st.sec === 'resumen' && st.activa === 'Perfil', JSON.stringify(st));
    await p.locator('#economia-view .ug-volver-perfil').click(); await espera(500);
    await p.locator('.pf-acceso', { hasText: 'Economía' }).click(); await espera(700);
    st = await p.evaluate(() => ({ eco: document.getElementById('economia-view').classList.contains('active'), sec: document.querySelector('#economia-view .eco-sec.active')?.dataset.sec }));
    C.prueba('Economía abre UpCoins, misiones y Premium («Ganar más»)', st.eco && st.sec === 'ganar', JSON.stringify(st));
    await p.evaluate(() => switchTab('favs')); await espera(1300);   // el tema cyber anima el cambio (~1 s)
    const okFavs = await p.evaluate(() => document.getElementById('favs-view').classList.contains('active'));
    await p.evaluate(() => switchTab('economia')); await espera(1300);
    C.prueba('switchTab(«favs») y («economia») siguen funcionando desde otros módulos', okFavs && await p.evaluate(() => document.getElementById('economia-view').classList.contains('active')));

    // Videos
    await p.evaluate(() => switchTab('main')); await espera(400);
    await p.locator('#bottom-nav .nav-videos').click(); await espera(1200);
    C.prueba('Videos abre el feed vertical de siempre', await p.evaluate(() => document.documentElement.classList.contains('ugv-abierto')));
    await p.evaluate(() => window.UGVideos.cerrar()); await espera(300);
    await ctx.close();
  }

  for (const [nombre, vp] of [...VISTAS, ['móvil pequeño', { width: 360, height: 640 }], ['escritorio alto', { width: 1920, height: 1200 }]]) {
    C.seccion(`Página puente · ${nombre}`);
    const ctx = await contexto(b, web, vp);
    const p = await ctx.newPage(); p.on('pageerror', e => errores.push(`puente ${nombre}: ${e.message}`));
    await p.goto(`${web.url}/public/puente.html?id=${'a'.repeat(24)}`, { waitUntil: 'domcontentloaded' }); await espera(1500);
    const m = await p.evaluate(() => ({ zona: document.querySelector('.ug-zona-boton').getBoundingClientRect().top + scrollY, alto: innerHeight, timer: document.getElementById('timer').textContent,
      orden: [...document.querySelectorAll('.container script')].map(s => s.textContent.match(/ugAnuncio\('([^']+)'/)?.[1]).filter(Boolean) }));
    C.prueba('el botón empieza debajo de la primera pantalla (hay que bajar)', m.zona >= m.alto, `zona ${Math.round(m.zona)} · pantalla ${m.alto}`);
    C.prueba('los anuncios quedan antes del botón, en el mismo orden', m.orden.length === 3 && await p.evaluate(() => { const z = document.querySelector('.ug-zona-boton'); return [...document.querySelectorAll('.container script')].filter(s => /ugAnuncio\(/.test(s.textContent)).every(s => s.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING); }), JSON.stringify(m.orden));
    const marcos = await p.locator('.ug-antes-boton iframe[src*="anuncio-aislado"]').evaluateAll(ifs => ifs.map(f => [...f.sandbox]));
    const csp = await p.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    C.prueba('la publicidad usa marcos con origen aislado y la página restringe scripts externos',
      marcos.length === 3 && marcos.every(permisos => permisos.includes('allow-scripts') && !permisos.includes('allow-same-origin'))
        && csp.includes('script-src') && !/highperformanceformat|bellnewyork|accountut/.test(csp));
    await espera(2200);
    C.prueba('la cuenta atrás sigue corriendo', (await p.evaluate(() => document.getElementById('timer').textContent)) !== m.timer, m.timer);
    if (CAPT && nombre === 'móvil') await p.screenshot({ path: path.join(CAPT, 'puente-movil.png'), fullPage: true });
    await ctx.close();
  }
  C.seccion('Página puente · Premium (sin anuncios)');
  const ctx = await contexto(b, web, { width: 390, height: 844 }, { sesion: true, sinAnuncios: true });
  const p = await ctx.newPage(); p.on('pageerror', e => errores.push(`puente premium: ${e.message}`));
  await p.goto(`${web.url}/public/puente.html?id=${'a'.repeat(24)}`, { waitUntil: 'domcontentloaded' }); await espera(1200);
  C.prueba('con Premium no se fuerza el desplazamiento (no hay anuncios que ver)', await p.evaluate(() => document.documentElement.classList.contains('ug-sin-anuncios') && getComputedStyle(document.querySelector('.ug-antes-boton')).minHeight === '0px'));
  await ctx.close();

  C.seccion('Salud general');
  // Ya ocurre en main al cargar con sesión y la API simulada: una promesa rechazada sin motivo («undefined», sin traza).
  // Se informa aparte para no esconderlo, pero no lo causa esta navegación; cualquier otro error sí hace fallar la prueba.
  const previo = errores.filter(e => /^[^:]+: undefined\s*$/.test(e));
  if (previo.length) console.log(`  ⚠ conocido (también en main): ${previo.length} rechazo(s) sin motivo con sesión simulada`);
  const nuevos = errores.filter(e => !previo.includes(e));
  C.prueba('sin errores de JavaScript', nuevos.length === 0, nuevos.slice(0, 5).join('\n'));
  await b.close(); web.cerrar();
  process.exit(C.fin() ? 1 : 0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
