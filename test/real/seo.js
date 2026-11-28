#!/usr/bin/env node
/**
 * SEO de extremo a extremo (sin tocar producción):
 *  - <head> de las páginas públicas clave: título y descripción únicos, canónica propia, sin noindex donde no toca,
 *    Open Graph / X completos, imagen de vista previa real de 1200×630, JSON-LD válido y un solo <h1>
 *  - portada (https://lurveta.com/ = la landing): título, descripción, JSON-LD con FAQPage, H1, palabras clave y enlaces SEO;
 *    el puente /public/biblioteca.html solo apunta (canónica) a la portada
 *  - todos los enlaces internos de la portada existen
 *  - sitemap: el del servidor real y el publicado (public/sitemap.xml) con la portada primero, sin biblioteca.html
 *    ni URLs no canónicas (?id=); limpiarSitemap() repara uno viejo y es idempotente
 *  (los parámetros, el puente y el service worker se prueban en migracion.js)
 *  - móvil y escritorio sin desborde
 * Uso: node test/real/seo.js   (CAPTURAS=dir)
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { spawn } = require('child_process');
const { navegador, contador, requerir, esErrorSandboxPlaywright } = require('./util');
const REPO = path.join(__dirname, '..', '..');
const espera = ms => new Promise(r => setTimeout(r, ms));
const CAPT = process.env.CAPTURAS;

function servirRepo() {
  const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml' };
  return new Promise(ok => { const s = http.createServer((req, res) => {
    let f = path.join(REPO, path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  }); s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, cerrar: () => s.close() })); });
}
const meta = (h, re) => (h.match(re) || [])[1] || '';
function cabecera(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  return {
    title: meta(head, /<title>([^<]*)<\/title>/), desc: meta(head, /<meta name="description" content="([^"]*)"/),
    canon: meta(head, /<link rel="canonical" href="([^"]*)"/), robots: meta(head, /<meta name="robots" content="([^"]*)"/),
    ogTitle: meta(head, /<meta property="og:title"\s+content="([^"]*)"/), ogDesc: meta(head, /<meta property="og:description"\s+content="([^"]*)"/),
    ogImg: meta(head, /<meta property="og:image"\s+content="([^"]*)"/), ogUrl: meta(head, /<meta property="og:url"\s+content="([^"]*)"/),
    tw: meta(head, /<meta name="twitter:card"\s+content="([^"]*)"/),
    ld: [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]),
    h1: (html.match(/<h1[\s>]/g) || []).length,
  };
}
function tamPng(buf) { return buf.slice(1, 4).toString() === 'PNG' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null; }
function tamJpg(buf) { let i = 2; while (i < buf.length) { if (buf[i] !== 0xFF) return null; const m = buf[i + 1], L = buf.readUInt16BE(i + 2); if (m >= 0xC0 && m <= 0xC3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + L; } return null; }

(async () => {
  const C = contador('SEO: portada, metadatos, datos estructurados, vistas previas y sitemap');
  const pick = dir => fs.readdirSync(path.join(REPO, 'public', dir)).filter(f => f.endsWith('.html') && !/^[a-f\d]{24}\.html$/.test(f))[0];
  const PAGINAS = [
    ['portada', 'index.html', 'https://lurveta.com/'],
    ['publicación', `public/p/${pick('p')}`, null], ['tema', `public/j/${pick('j')}`, null], ['creador', `public/u/${pick('u')}`, null],
    ['guía de blogs', 'public/blogs-guia.html', 'https://lurveta.com/public/blogs-guia.html'],
  ];
  C.seccion('Metadatos en el HTML (lo que leen Google, WhatsApp, Facebook, Discord, Telegram y X)');
  const vistos = { title: new Map(), desc: new Map() };
  for (const [n, f, canonEsperada] of PAGINAS) {
    const h = cabecera(fs.readFileSync(path.join(REPO, f), 'utf8'));
    const canon = canonEsperada || 'https://lurveta.com/' + f;
    const ldOk = h.ld.every(j => { try { JSON.parse(j); return true; } catch (_) { return false; } });
    C.prueba(`${n}: título (${h.title.length} car.) y descripción (${h.desc.length} car.)`, h.title && h.title.length <= 75 && h.desc.length >= 50 && h.desc.length <= 170, `${h.title} · ${h.desc}`);
    C.prueba(`${n}: canónica propia, indexable`, h.canon === canon && !/noindex/.test(h.robots), `${h.canon} · ${h.robots}`);
    C.prueba(`${n}: Open Graph y X completos`, h.ogTitle && h.ogDesc && /^https:\/\//.test(h.ogImg) && h.ogUrl === canon && h.tw === 'summary_large_image', JSON.stringify({ og: h.ogUrl, img: h.ogImg, tw: h.tw }));
    C.prueba(`${n}: JSON-LD válido y un solo <h1>`, h.ld.length > 0 && ldOk && h.h1 === 1, `ld ${h.ld.length} · válido ${ldOk} · h1 ${h.h1}`);
    for (const k of ['title', 'desc']) { if (vistos[k].has(h[k])) C.prueba(`${n}: ${k} distinto del de ${vistos[k].get(h[k])}`, false, h[k]); vistos[k].set(h[k], n); }
  }
  C.prueba('títulos y descripciones distintos en todas las páginas', vistos.title.size === PAGINAS.length && vistos.desc.size === PAGINAS.length);
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const raiz = cabecera(html);
  const grafo = JSON.parse(raiz.ld[0])['@graph'] || [];
  C.prueba('portada: Organization + WebSite (buscador en /?q=) + WebPage + FAQPage', ['Organization', 'WebSite', 'WebPage', 'FAQPage'].every(t => grafo.some(x => x['@type'] === t)) && grafo.find(x => x['@type'] === 'WebSite').potentialAction?.target?.urlTemplate === 'https://lurveta.com/?q={search_term_string}' && grafo.every(x => !/biblioteca\.html/.test(JSON.stringify(x))), JSON.stringify(grafo.map(x => x['@type'])));
  const faqLd = (grafo.find(x => x['@type'] === 'FAQPage')?.mainEntity || []).map(q => q.name), faqHtml = [...html.matchAll(/<summary[^>]*>([^<]+)<\/summary>/g)].map(m => m[1].trim());
  C.prueba(`FAQPage = las preguntas visibles de la portada (${faqLd.length})`, faqLd.length >= 4 && faqLd.every(q => faqHtml.includes(q)), JSON.stringify({ faqLd, faqHtml }));
  C.prueba('título y descripción de la portada con las palabras clave', /^Lurveta \| /.test(raiz.title) && ['juegos', 'mods', 'apps', 'creadores independientes'].every(k => raiz.title.toLowerCase().includes(k)) && ['juegos', 'mods', 'apps', 'pc', 'android', 'blog'].every(k => raiz.desc.toLowerCase().includes(k)), `${raiz.title} · ${raiz.desc}`);
  const h1 = ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const visible = html.slice(html.indexOf('<body')).replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<!--SEO:ENLACES-->[\s\S]*?<!--\/SEO:ENLACES-->/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();   // texto propio de la portada, sin la lista de enlaces generada
  C.prueba('H1 con la propuesta de valor', h1 === 'Todo lo que creas, en un solo lugar.', h1);
  const claves = ['juegos', 'mods', 'aplicaciones', 'descargas', 'desarrolladores independientes', 'creadores de contenido', 'creadores independientes', 'blog', 'directos', 'monetizar'].filter(k => !visible.includes(k));
  C.prueba(`palabras clave en el texto visible (${visible.split(' ').length} palabras)`, !claves.length && visible.split(' ').length >= 600, 'faltan: ' + claves.join(', '));
  C.prueba('la lista de enlaces SEO generada sigue en la portada (pie «Explora Lurveta»)', /<nav class="ug-explora[^"]*"[\s\S]*<!--SEO:ENLACES-->[\s\S]*<!--\/SEO:ENLACES-->[\s\S]*<\/nav>/.test(html));
  C.prueba('un solo H1 y sin estilos en línea (la CSP no los permite)', (html.match(/<h1[\s>]/g) || []).length === 1 && !/\sstyle="/.test(html.slice(html.indexOf('<body'))));
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])), anclas = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
  C.prueba(`anclas del menú llevan a secciones que existen (${anclas.length})`, !/<base\s/i.test(html) && anclas.every(a => ids.has(a)), anclas.filter(a => !ids.has(a)).join(' '));
  C.prueba('la portada enlaza a la biblioteca', /href="public\/biblioteca\.html"/.test(html));
  const puente = cabecera(fs.readFileSync(path.join(REPO, 'public/biblioteca.html'), 'utf8'));
  C.prueba('biblioteca: canónica a la portada e indexación permitida', puente.canon === 'https://lurveta.com/' && !/\bnoindex\b/i.test(puente.robots || ''), JSON.stringify(puente));
  const otras = ['public/p', 'public/j', 'public/u'].flatMap(d => fs.readdirSync(path.join(REPO, d)).filter(f => f.endsWith('.html')).map(f => cabecera(fs.readFileSync(path.join(REPO, d, f), 'utf8')).canon));
  C.prueba(`las páginas generadas no se canonizan todas a la portada (${otras.filter(c => c === 'https://lurveta.com/').length}/${otras.length})`, otras.length > 0 && !otras.includes('https://lurveta.com/'));
  const jpg = fs.readFileSync(path.join(REPO, 'public/og-upgames.jpg')), dims = tamJpg(jpg);
  C.prueba(`imagen de vista previa real de 1200×630 y liviana (${Math.round(jpg.length / 1024)} KB)`, dims && dims[0] === 1200 && dims[1] === 630 && jpg.length < 300 * 1024, JSON.stringify(dims));
  C.prueba('raíz /sitemap.xml: índice que apunta al sitemap real', /<sitemapindex[\s\S]*https:\/\/lurveta\.com\/public\/sitemap\.xml/.test(fs.readFileSync(path.join(REPO, 'sitemap.xml'), 'utf8')));
  const robots = fs.readFileSync(path.join(REPO, 'robots.txt'), 'utf8');
  C.prueba('robots.txt deja rastrear la portada y la biblioteca y declara el sitemap', /User-agent: \*[\s\S]*Allow: \//.test(robots) && !/^Disallow: \/\s*$/m.test(robots.split('User-agent: PetalBot')[0]) && /Sitemap: https:\/\/lurveta\.com\/public\/sitemap\.xml/.test(robots));
  // sin <base>: los relativos y los absolutos cuelgan de la raíz
  const hrefs = [...html.matchAll(/href="([^"#:?]+)[^"]*"/g)].map(m => m[1]).filter(h => !/^\/\/|\.css$|^\/$/.test(h) && /\.html$/.test(h));
  const rotos = hrefs.filter(h => !fs.existsSync(path.join(REPO, h.startsWith('/') ? h.slice(1) : h.replace(/^\.\//, ''))));
  C.prueba(`enlaces internos de la portada existen (${hrefs.length})`, hrefs.length > 10 && rotos.length === 0, rotos.join(', '));
  const enlaces = (html.match(/<!--SEO:ENLACES-->([\s\S]*?)<!--\/SEO:ENLACES-->/) || [])[1] || '';
  C.prueba('la portada enlaza temas y secciones rastreables (absolutos)', (enlaces.match(/href="\/public\/j\//g) || []).length >= 3 && !/href="\.\//.test(enlaces), enlaces.slice(0, 200));
  C.seccion('Sitemap publicado (public/sitemap.xml) y su saneado');
  const Seo = require(path.join(REPO, 'modulos/seo.js'));
  const pub = fs.readFileSync(path.join(REPO, 'public/sitemap.xml'), 'utf8'), locsPub = [...pub.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
  C.prueba('public/sitemap.xml: la portada primero, sin biblioteca.html ni ?id=', locsPub[0] === 'https://lurveta.com/' && !locsPub.some(l => /biblioteca\.html|\?id=/.test(l)) && locsPub.filter(l => l === 'https://lurveta.com/').length === 1, locsPub.slice(0, 3).join(' · '));
  const viejo = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://upgames.games/public/biblioteca.html</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>\n<url><loc>https://upgames.games/public/blogs-guia.html</loc></url>\n</urlset>\n';
  const limpio = Seo.limpiarSitemap(viejo), locsL = [...limpio.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
  C.prueba('limpiarSitemap(): quita biblioteca.html y pone la portada primero', locsL[0] === 'https://lurveta.com/' && !locsL.some(l => /biblioteca/.test(l)) && locsL.includes('https://lurveta.com/public/blogs-guia.html'), locsL.join(' · '));
  C.prueba('limpiarSitemap() es idempotente', Seo.limpiarSitemap(limpio) === limpio && Seo.limpiarSitemap(pub) === pub);

  C.seccion('Portada en el navegador (primera visita = lo que ve Google)');
  const web = await servirRepo(), b = await navegador();
  try {
    for (const [n, vp] of [['móvil estrecho', { width: 320, height: 700 }], ['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]]) {
      const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' }); await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com|railway\.app/, r => r.abort());
      const p = await ctx.newPage(); const err = []; p.on('pageerror', e => { if (!esErrorSandboxPlaywright(e)) err.push(e.message); });
      await p.goto(web.url + '/', { waitUntil: 'load' }); await espera(700);
      const r = await p.evaluate(() => {
        const h = document.querySelector('h1'), hr = h?.getBoundingClientRect();
        return { url: location.pathname, h1: h?.innerText.replace(/\s+/g, ' ').trim(), h1Visible: !!hr && hr.width > 100 && hr.height > 10 && hr.top < innerHeight,
          lib: !!document.getElementById('main-view'), sobra: document.documentElement.scrollWidth - innerWidth,
          ctas: [...document.querySelectorAll('a[href="login.html?registro=1"]')].filter(a => a.getBoundingClientRect().width > 0).length,
          tira: document.querySelectorAll('#lp-tira a[href]').length, faq: document.querySelectorAll('#preguntas details').length };
      });
      C.prueba(`${n}: portada independiente en / con H1 visible al cargar`, r.url === '/' && r.h1Visible && r.h1 === 'Todo lo que creas, en un solo lugar.' && !r.lib, JSON.stringify(r));
      C.prueba(`${n}: llamadas a crear cuenta, proyectos reales y preguntas (sin API también)`, r.ctas >= 2 && r.tira >= 6 && r.faq >= 4, JSON.stringify(r));
      const explorar = p.locator('#ug-explorar-biblioteca');
      await explorar.focus();
      await Promise.all([p.waitForURL('**/public/biblioteca.html', { waitUntil: 'domcontentloaded' }), p.keyboard.press('Enter')]);
      C.prueba(`${n}: Explorar abre la biblioteca`, await p.locator('#main-view').count() === 1);
      const malos = err.filter(e => e !== 'undefined');   // rechazo sin motivo sin API: conocido, también antes de la migración (ver navegacion.js)
      C.prueba(`${n}: sin desborde horizontal ni errores`, r.sobra <= 1 && !malos.length, `${r.sobra}px ${malos.join(' | ')}`);
      if (CAPT) await p.screenshot({ path: path.join(CAPT, `portada-${n}.png`), fullPage: n === 'móvil' });
      await ctx.close();
    }
    const nav = async (ruta, prep) => { const ctx = await b.newContext({ serviceWorkers: 'block' }); await ctx.route(/fonts\.|unpkg\.com|railway\.app/, r => r.abort());
      if (prep) await ctx.addInitScript(prep); const p = await ctx.newPage(); await p.goto(web.url + ruta).catch(() => {}); await espera(1200);
      const out = { url: new URL(p.url()).pathname + new URL(p.url()).search + new URL(p.url()).hash, ref: await p.evaluate(() => localStorage.getItem('ug_ref')).catch(() => null) }; await ctx.close(); return out; };
    let r = await nav('/', () => { if (location.pathname === '/') localStorage.setItem('ug_entro', '1'); });
    C.prueba('quien ya usó Lurveta también se queda en / (sin salto a otra URL)', r.url === '/', r.url);
    r = await nav('/?ref=amigo_123');
    C.prueba('enlace de invitación ?ref= se guarda (y la portada se muestra)', r.url === '/?ref=amigo_123' && /amigo_123/.test(r.ref || ''), JSON.stringify(r));
    { const ctx = await b.newContext({ serviceWorkers: 'block' }); await ctx.route(/fonts\.|unpkg\.com|railway\.app/, r => r.abort());
      const p = await ctx.newPage(), pedidas = []; p.on('request', q => { if (q.isNavigationRequest()) pedidas.push(new URL(q.url()).pathname + new URL(q.url()).search); });
      await p.goto(web.url + '/?reset_token=abc').catch(() => {}); await espera(1200); await ctx.close();
      // login.html lee el token y luego lo borra de la barra de direcciones: se comprueba la petición
      C.prueba('enlace del correo (?reset_token=) sigue llegando al login con su token', pedidas.includes('/login.html?reset_token=abc'), pedidas.join(' → ')); }
    r = await nav('/#favoritos');
    C.prueba('#sección se queda en la portada', r.url === '/#favoritos', r.url);
  } finally { await b.close(); web.cerrar(); }

  C.seccion('Sitemap del servidor real (/seo/sitemap.xml)');
  const { MongoMemoryServer } = requerir('mongodb-memory-server');
  const m = await MongoMemoryServer.create();
  const PORT = 5900 + Math.floor(Math.random() * 90);
  const srv = spawn('node', ['index.js'], { cwd: REPO, env: { ...process.env, MONGODB_URI: m.getUri('upg'), JWT_SECRET: 's'.repeat(40), PORT: String(PORT), NODE_ENV: 'development' } });
  try {
    let xml = '';
    for (let i = 0; i < 60 && !xml; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/seo/sitemap.xml`); if (r.ok) xml = await r.text(); } catch (_) {} if (!xml) await espera(500); }
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
    C.prueba('la portada es la primera URL del sitemap', locs[0] === 'https://lurveta.com/', locs.slice(0, 3).join(' · '));
    C.prueba('sin URLs no canónicas (?id=) ni el puente biblioteca.html en el sitemap', !locs.some(l => /\?id=|biblioteca\.html/.test(l)), locs.filter(l => /\?|biblioteca/.test(l)).join(' · '));
  } finally { srv.kill(); await m.stop(); }
  process.exit(C.fin() ? 1 : 0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
