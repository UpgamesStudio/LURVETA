#!/usr/bin/env node
/**
 * SEO de extremo a extremo (sin tocar producción):
 *  - <head> de las páginas públicas clave: título y descripción únicos, canónica propia, sin noindex donde no toca,
 *    Open Graph / X completos, imagen de vista previa real de 1200×630, JSON-LD válido y un solo <h1>
 *  - portada: indexable y con contenido para quien llega por primera vez (y para Google); quien ya usa UpGames
 *    entra directo; ?ref= se guarda; los enlaces de los correos van al login; #sección va a la biblioteca
 *  - todos los enlaces internos de la portada existen
 *  - /seo/sitemap.xml del servidor real: la portada primero y ninguna URL no canónica (?id=)
 *  - móvil y escritorio sin desborde
 * Uso: node test/real/seo.js   (CAPTURAS=dir)
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { spawn } = require('child_process');
const { navegador, contador, requerir } = require('./util');
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
    ['portada', 'index.html', 'https://upgames.games/'],
    ['biblioteca', 'public/biblioteca.html', 'https://upgames.games/public/biblioteca.html'],
    ['publicación', `public/p/${pick('p')}`, null], ['tema', `public/j/${pick('j')}`, null], ['creador', `public/u/${pick('u')}`, null],
    ['guía de blogs', 'public/blogs-guia.html', 'https://upgames.games/public/blogs-guia.html'],
  ];
  C.seccion('Metadatos en el HTML (lo que leen Google, WhatsApp, Facebook, Discord, Telegram y X)');
  const vistos = { title: new Map(), desc: new Map() };
  for (const [n, f, canonEsperada] of PAGINAS) {
    const h = cabecera(fs.readFileSync(path.join(REPO, f), 'utf8'));
    const canon = canonEsperada || 'https://upgames.games/' + f;
    const ldOk = h.ld.every(j => { try { JSON.parse(j); return true; } catch (_) { return false; } });
    C.prueba(`${n}: título (${h.title.length} car.) y descripción (${h.desc.length} car.)`, h.title && h.title.length <= 75 && h.desc.length >= 50 && h.desc.length <= 170, `${h.title} · ${h.desc}`);
    C.prueba(`${n}: canónica propia, indexable`, h.canon === canon && !/noindex/.test(h.robots), `${h.canon} · ${h.robots}`);
    C.prueba(`${n}: Open Graph y X completos`, h.ogTitle && h.ogDesc && /^https:\/\//.test(h.ogImg) && h.ogUrl === canon && h.tw === 'summary_large_image', JSON.stringify({ og: h.ogUrl, img: h.ogImg, tw: h.tw }));
    C.prueba(`${n}: JSON-LD válido y un solo <h1>`, h.ld.length > 0 && ldOk && h.h1 === 1, `ld ${h.ld.length} · válido ${ldOk} · h1 ${h.h1}`);
    for (const k of ['title', 'desc']) { if (vistos[k].has(h[k])) C.prueba(`${n}: ${k} distinto del de ${vistos[k].get(h[k])}`, false, h[k]); vistos[k].set(h[k], n); }
  }
  C.prueba('títulos y descripciones distintos en todas las páginas', vistos.title.size === PAGINAS.length && vistos.desc.size === PAGINAS.length);
  const raiz = cabecera(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
  const grafo = JSON.parse(raiz.ld[0])['@graph'] || [];
  C.prueba('portada: Organization + WebSite (con buscador) + WebPage, mismas @id', ['Organization', 'WebSite', 'WebPage'].every(t => grafo.some(x => x['@type'] === t)) && grafo.find(x => x['@type'] === 'WebSite').potentialAction?.target?.urlTemplate?.includes('{search_term_string}'), JSON.stringify(grafo.map(x => x['@type'])));
  C.prueba('el posicionamiento nuevo está en título, descripción y vista previa', /gamers, creadores y desarrolladores/.test(raiz.title + raiz.ogTitle) && /desarrolladores independientes/.test(raiz.desc), raiz.title);
  C.prueba('ya no dice solo «descargar juegos gratis»', !/descarga juegos, mods, apps y software gratis|sin registrarte<\/title>/i.test(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8') + fs.readFileSync(path.join(REPO, 'public/biblioteca.html'), 'utf8')));
  const jpg = fs.readFileSync(path.join(REPO, 'public/og-upgames.jpg')), dims = tamJpg(jpg);
  C.prueba(`imagen de vista previa real de 1200×630 y liviana (${Math.round(jpg.length / 1024)} KB)`, dims && dims[0] === 1200 && dims[1] === 630 && jpg.length < 300 * 1024, JSON.stringify(dims));
  C.prueba('raíz /sitemap.xml: índice que apunta al sitemap real', /<sitemapindex[\s\S]*https:\/\/upgames\.games\/public\/sitemap\.xml/.test(fs.readFileSync(path.join(REPO, 'sitemap.xml'), 'utf8')));
  const robots = fs.readFileSync(path.join(REPO, 'robots.txt'), 'utf8');
  C.prueba('robots.txt deja rastrear la portada y la biblioteca y declara el sitemap', /User-agent: \*[\s\S]*Allow: \//.test(robots) && !/^Disallow: \/\s*$/m.test(robots.split('User-agent: PetalBot')[0]) && /Sitemap: https:\/\/upgames\.games\/public\/sitemap\.xml/.test(robots));
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const rotos = [...html.matchAll(/href="\.\/(public\/[^"?#]+)/g)].map(m => m[1]).filter(r => !fs.existsSync(path.join(REPO, r)));
  C.prueba(`enlaces internos de la portada existen (${[...html.matchAll(/href="\.\/public\//g)].length})`, rotos.length === 0, rotos.join(', '));

  C.seccion('Portada en el navegador (primera visita = lo que ve Google)');
  const web = await servirRepo(), b = await navegador();
  try {
    for (const [n, vp] of [['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]]) {
      const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' }); await ctx.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com|railway\.app/, r => r.abort());
      const p = await ctx.newPage(); const err = []; p.on('pageerror', e => err.push(e.message));
      await p.goto(web.url + '/', { waitUntil: 'load' }); await espera(700);
      const r = await p.evaluate(() => ({ url: location.pathname, h1: document.querySelector('h1')?.innerText, palabras: document.body.innerText.split(/\s+/).length, sobra: document.documentElement.scrollWidth - innerWidth }));
      C.prueba(`${n}: primera visita se queda en la portada, con contenido (${r.palabras} palabras)`, r.url === '/' && /desarrolladores independientes/.test(r.h1) && r.palabras > 400, JSON.stringify(r));
      C.prueba(`${n}: sin desborde horizontal ni errores`, r.sobra <= 1 && !err.length, `${r.sobra}px ${err.join(' | ')}`);
      if (CAPT) await p.screenshot({ path: path.join(CAPT, `portada-${n}.png`), fullPage: n === 'móvil' });
      await ctx.close();
    }
    const nav = async (ruta, prep) => { const ctx = await b.newContext({ serviceWorkers: 'block' }); await ctx.route(/fonts\.|unpkg\.com|railway\.app/, r => r.abort());
      if (prep) await ctx.addInitScript(prep); const p = await ctx.newPage(); await p.goto(web.url + ruta).catch(() => {}); await espera(1200);
      const out = { url: new URL(p.url()).pathname + new URL(p.url()).search + new URL(p.url()).hash, ref: await p.evaluate(() => localStorage.getItem('ug_ref')).catch(() => null) }; await ctx.close(); return out; };
    let r = await nav('/', () => { if (location.pathname === '/') localStorage.setItem('ug_entro', '1'); });
    C.prueba('quien ya usó UpGames entra directo a la biblioteca', r.url.startsWith('/public/biblioteca.html'), r.url);
    r = await nav('/?inicio=1', () => { if (location.pathname === '/') localStorage.setItem('ug_entro', '1'); });
    C.prueba('?inicio=1 muestra la portada aunque ya la haya usado', r.url === '/?inicio=1', r.url);
    r = await nav('/?ref=amigo_123');
    C.prueba('enlace de invitación ?ref= se guarda (y la portada se muestra)', r.url === '/?ref=amigo_123' && /amigo_123/.test(r.ref || ''), JSON.stringify(r));
    { const ctx = await b.newContext({ serviceWorkers: 'block' }); await ctx.route(/fonts\.|unpkg\.com|railway\.app/, r => r.abort());
      const p = await ctx.newPage(), pedidas = []; p.on('request', q => { if (q.isNavigationRequest()) pedidas.push(new URL(q.url()).pathname + new URL(q.url()).search); });
      await p.goto(web.url + '/?reset_token=abc').catch(() => {}); await espera(1200); await ctx.close();
      // login.html lee el token y luego lo borra de la barra de direcciones: se comprueba la petición
      C.prueba('enlace del correo (?reset_token=) sigue llegando al login con su token', pedidas.includes('/login.html?reset_token=abc'), pedidas.join(' → ')); }
    r = await nav('/#favoritos');
    C.prueba('enlace viejo con #sección va a la biblioteca', r.url === '/public/biblioteca.html#favoritos', r.url);
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
    C.prueba('la portada es la primera URL del sitemap', locs[0] === 'https://upgames.games/', locs.slice(0, 3).join(' · '));
    C.prueba('sin URLs no canónicas (?id=) en el sitemap', !locs.some(l => /\?id=/.test(l)), locs.filter(l => /\?/.test(l)).join(' · '));
  } finally { srv.kill(); await m.stop(); }
  process.exit(C.fin() ? 1 : 0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
