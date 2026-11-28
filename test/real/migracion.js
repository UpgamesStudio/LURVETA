#!/usr/bin/env node
/**
 * Migración de la portada: la biblioteca pasó de /public/biblioteca.html a https://lurveta.com/
 *  - el puente /public/biblioteca.html conserva query string y fragmento (codificados, varios parámetros, ID real)
 *  - cada parámetro (?id ?tab=perfil ?plan=1 ?verificar=1 ?q ?ref ?reset_token ?verif ?volver ?login ?registro)
 *    se atiende igual entrando por / o por el puente, sin bucles de redirección
 *  - las fichas /public/p/<id>.html van directo a https://lurveta.com/?id=<id>
 *  - la portada no pide recursos inexistentes
 *  - service worker: instalación limpia en / y ACTUALIZACIÓN desde la versión en producción (6bc94d3, último main antes de la migración), cachés
 *    viejas de Lurveta borradas, las de los juegos conservadas, funciona sin conexión
 * Uso: node test/real/migracion.js   (VERSION_ANTERIOR=<commit> para otra versión de partida)
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), { execSync } = require('child_process');
const { servirRaiz, navegador, contador, esErrorSandboxPlaywright } = require('./util');
const REPO = path.join(__dirname, '..', '..');
const API = 'https://upgames-production.up.railway.app';
const dirP = path.join(REPO, 'public/p');
const fichas = fs.readdirSync(dirP).sort();
const slug = fichas.find(nombre => {
  const id = nombre.match(/-([a-f\d]{24})\.html$/)?.[1];
  return id && fichas.includes(`${id}.html`);
});
if (!slug) throw new Error('No hay fichas generadas con un slug y un puente por ID');
const ID = slug.slice(-29, -5);
const ANTERIOR = process.env.VERSION_ANTERIOR || '6bc94d36d696f462aa473165474e97015cc05433';   // último main antes de la migración
const espera = ms => new Promise(r => setTimeout(r, ms));
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: cors });
const FICHA = { _id: ID, title: 'Publicación de prueba', description: 'Ficha de prueba', image: '', category: 'Mod', usuario: 'creador', status: 'aprobado', link: 'https://example.com/x' };

async function contexto(b, web, { sesion = false, vp = { width: 390, height: 844 }, js = true } = {}) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block', javaScriptEnabled: js });
  await ctx.addInitScript(s => { try {
    localStorage.setItem('upgames_tutorial_done', '1'); localStorage.setItem('ug_onb_hecho', '1');
    if (s) { localStorage.setItem('token', 'x'.repeat(40)); localStorage.setItem('user_admin', 'tester'); }
  } catch (_) {} }, sesion);
  await ctx.route('**/*', async r => {
    const u = r.request().url(), m = r.request().method();
    // https://lurveta.com/… (adonde van las fichas) se sirve desde esta copia del repo
    if (u.startsWith('https://lurveta.com/')) { const resp = await r.fetch({ url: web.url + u.slice('https://lurveta.com'.length) }); return r.fulfill({ response: resp }); }
    if (u.startsWith(web.url) || /unpkg\.com\/ionicons/.test(u)) return r.continue();
    if (u.startsWith(API) && m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.startsWith(`${API}/items/${ID}`) && m === 'GET') return json(r, FICHA);
    if (u.startsWith(`${API}/auth/email-estado`)) return json(r, { success: true, verificado: false, email: 'tester@example.com' });
    if (u.startsWith(API)) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: cors });
    return r.abort();
  });
  return ctx;
}

/** Abre `ruta` y devuelve la cadena de navegaciones (documentos pedidos y URLs del marco, con #) y la página. */
async function abrir(ctx, web, ruta, ms = 2500) {
  const p = await ctx.newPage(), pedidas = [], marcos = [], errores = [];
  const rel = u => { const x = new URL(u); return (x.origin === web.url ? '' : x.origin) + x.pathname + x.search + x.hash; };
  p.on('request', q => { if (q.isNavigationRequest() && q.frame() === p.mainFrame()) pedidas.push(rel(q.url())); });
  p.on('framenavigated', f => { if (f === p.mainFrame()) marcos.push(rel(f.url())); });
  p.on('pageerror', e => { if (!esErrorSandboxPlaywright(e)) errores.push(e.message); });
  await p.goto(web.url + ruta).catch(() => {}); await espera(ms);
  return { p, pedidas, marcos, errores, url: rel(p.url()) };
}

const fichaAbierta = p => p.waitForFunction(() => document.getElementById('detail-sheet')?.classList.contains('open'), null, { timeout: 15000 }).catch(() => {});

function versionAnterior() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-anterior-'));
  const sh = c => execSync(c, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  try { sh(`git cat-file -e ${ANTERIOR}^{commit}`); } catch (_) { sh(`git fetch --depth=1 origin ${ANTERIOR}`); }
  sh(`git archive ${ANTERIOR} index.html login.html public | tar -x -C "${dir}"`);
  return dir;
}

(async () => {
  const C = contador('Migración de la portada: puente, parámetros, fichas y service worker');
  const web = await servirRaiz(), b = await navegador();
  try {
    C.seccion('Portada independiente y enlaces heredados');
    let ctx = await contexto(b, web);
    let r = await abrir(ctx, web, '/');
    C.prueba('la bienvenida abre antes de la biblioteca', r.url === '/' && await r.p.locator('#ug-explorar-biblioteca').count() === 1);
    await Promise.all([r.p.waitForURL('**/public/biblioteca.html', { waitUntil: 'domcontentloaded' }), r.p.locator('#ug-explorar-biblioteca').click()]);
    C.prueba('Explorar abre la aplicación', await r.p.locator('#main-view').count() === 1);
    await r.p.close();

    const complejo = `?q=mods%20de%20%C3%B1and%C3%BA&ref=amigo_1&x=a%26b%3Dc#seccion-2`;
    r = await abrir(ctx, web, '/' + complejo);
    C.prueba('la URL antigua conserva parámetros y fragmento', r.url === '/public/biblioteca.html' + complejo, r.url);
    await ctx.close();

    C.seccion('Parámetros desde la raíz y la biblioteca');
    const CASOS = [
      ['?tab=perfil abre el perfil', '?tab=perfil', true, async x => (await x.p.evaluate(() => currentTab)) === 'profile'],
      ['?plan=1 abre Mi plan', '?plan=1', true, async x => (await x.p.evaluate(() => currentTab)) === 'economia', 3500],
      ['?verificar=1 muestra el aviso de verificación', '?verificar=1', true, async x => x.p.evaluate(() => !document.getElementById('ug-verif')?.hidden), 3500],
      ['?q= rellena el buscador', '?q=winlator%20gta', false, async x => (await x.p.evaluate(() => document.getElementById('buscador')?.value)) === 'winlator gta'],
      ['?ref= guarda la invitación', '?ref=amigo_123', false, async x => /"c":"amigo_123"/.test(await x.p.evaluate(() => localStorage.getItem('ug_ref')) || '')],
      ['?reset_token= llega al login con su token', '?reset_token=abc123', false, async x => x.pedidas.includes('/login.html?reset_token=abc123') && x.p.evaluate(() => getComputedStyle(document.getElementById('reset-panel')).display !== 'none')],
      ['?verif=ok llega al login y avisa', '?verif=ok&u=pepe', false, async x => x.pedidas.includes('/login.html?verif=ok&u=pepe') && /Email verificado/.test(await x.p.evaluate(() => document.body.innerText))],
      ['?volver= llega al login y recuerda adónde volver', '?volver=.%2Fpublic%2Fchats.html', false, async x => (await x.p.evaluate(() => window.UG_VOLVER)) === './public/chats.html'],
      ['?login abre el login', '?login', false, async x => x.url.startsWith('/login.html?login') && (await x.p.evaluate(() => isLoginMode)) === true],
      ['?registro=1 abre el login en modo registro', '?registro=1', false, async x => x.url.startsWith('/login.html') && (await x.p.evaluate(() => isLoginMode)) === false],
    ];
    for (const [nombre, q, sesion, ok, ms] of CASOS) {
      for (const desde of ['/', '/public/biblioteca.html']) {
        const c = await contexto(b, web, { sesion });
        const x = await abrir(c, web, desde + q, ms || 2500);
        let bien = false; try { bien = !!(await ok(x)); } catch (e) { x.errores.push(e.message); }
        C.prueba(`${nombre} (${desde === '/' ? 'portada' : 'biblioteca'})`, bien && x.pedidas.length <= 3, JSON.stringify({ url: x.url, pedidas: x.pedidas, errores: x.errores.slice(0, 2) }));
        await c.close();
      }
    }

    C.seccion('Sin bucles de redirección (con sesión iniciada)');
    for (const q of ['?login', '?registro=1', '?volver=.%2F', '?volver=.%2F%3Fvolver%3D.%252F', '?verif=ok', '?volver=.%2Fpublic%2Fbiblioteca.html%3Ftab%3Dperfil']) {
      const c = await contexto(b, web, { sesion: true });
      const x = await abrir(c, web, '/public/biblioteca.html' + q, 4500);
      const fin = new URL(x.p.url());
      C.prueba(`${q} termina en una página estable (${x.pedidas.length} documentos)`, x.pedidas.length <= 4 && ['/', '/login.html', '/public/chats.html', '/public/biblioteca.html'].includes(fin.pathname), x.pedidas.join(' → '));
      await c.close();
    }

    C.seccion('Fichas generadas (/public/p/)');
    const porId = fichas.filter(f => /^[a-f\d]{24}\.html$/.test(f));
    const malas = porId.filter(f => !fs.readFileSync(path.join(dirP, f), 'utf8').includes(`location.replace("https://lurveta.com/?id=${f.slice(0, 24)}")`));
    C.prueba(`las ${porId.length} fichas por ID van a https://lurveta.com/?id=<su id>`, porId.length > 0 && !malas.length, malas.slice(0, 5).join(', '));
    const conViejo = ['p', 'j', 'u'].flatMap(d => fs.readdirSync(path.join(REPO, 'public', d)).map(f => `${d}/${f}`)).filter(f => fs.readFileSync(path.join(REPO, 'public', f), 'utf8').includes('biblioteca.html'));
    C.prueba('ninguna página generada enlaza a biblioteca.html', !conViejo.length, conViejo.slice(0, 5).join(', '));
    C.prueba('la ficha indexable lleva a la ficha completa en la portada', slug && fs.readFileSync(path.join(dirP, slug), 'utf8').includes(`href="https://lurveta.com/?id=${ID}"`), slug);
    ctx = await contexto(b, web);
    r = await abrir(ctx, web, `/public/p/${ID}.html`, 1500);
    await fichaAbierta(r.p);
    const f2 = await r.p.evaluate(() => !!document.getElementById('detail-sheet')?.classList.contains('open')).catch(() => false);
    C.prueba('/public/p/<id>.html → https://lurveta.com/?id=<id> directo (sin pasar por el puente) y abre la ficha',
      r.pedidas[1] === `https://lurveta.com/?id=${ID}` && r.pedidas[2] === `/public/biblioteca.html?id=${ID}` && f2, JSON.stringify({ pedidas: r.pedidas, f2 }));
    await ctx.close();

    C.seccion('Recursos de la portada');
    for (const [n, vp] of [['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]]) {
      const c = await contexto(b, web, { vp }), p = await c.newPage(), rotos = [], err = [];
      p.on('response', x => { if (x.url().startsWith(web.url) && x.status() >= 400) rotos.push(`${x.status()} ${x.url().slice(web.url.length)}`); });
      p.on('pageerror', e => { if (!esErrorSandboxPlaywright(e)) err.push(e.message); });
      await p.goto(web.url + '/'); await espera(3000);
      const v = await p.evaluate(() => ({ base: document.baseURI, landing: !!document.querySelector('body.lp-body') && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)', explorar: !!document.getElementById('ug-explorar-biblioteca'), sobra: document.documentElement.scrollWidth - innerWidth }));
      const conocidos = err.filter(e => e === 'undefined');   // rechazo sin motivo con la API simulada: igual en ${ANTERIOR} (ver navegacion.js)
      if (conocidos.length) console.log(`  ⚠ conocido (también en ${ANTERIOR.slice(0, 7)}): ${conocidos.length} rechazo(s) sin motivo con la API simulada`);
      C.prueba(`${n}: sin recursos 404 ni errores de JavaScript`, !rotos.length && err.length === conocidos.length && v.landing && v.explorar && !v.base.endsWith('/public/'), JSON.stringify({ rotos, err: err.slice(0, 3), v }));
      C.prueba(`${n}: sin desborde horizontal`, v.sobra <= 1, `${v.sobra}px`);
      await c.close();
    }
  } finally { await b.close(); }

  C.seccion('Service worker y PWA (navegador sin red externa)');
  const bsw = await navegador({ sinRed: true });
  const regs = p => p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname).sort());
  const cachés = p => p.evaluate(() => caches.keys());
  const listo = p => p.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(r => r.active?.scriptURL), new Promise(ok => setTimeout(ok, 15000))])).catch(() => null);
  const ctl = p => p.evaluate(() => navigator.serviceWorker.controller?.scriptURL || null).catch(() => null);
  try {
    // Instalación limpia
    let ctx = await bsw.newContext(), p = await ctx.newPage();
    await p.goto(web.url + '/'); await listo(p); await p.reload(); await espera(1500);
    C.prueba('instalación limpia: /service-worker.js controla / con alcance /', (await ctl(p)) === `${web.url}/service-worker.js` && JSON.stringify(await regs(p)) === '["/"]', JSON.stringify({ ctl: await ctl(p), regs: await regs(p) }));
    const man = await p.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); return { href: new URL(l.href).pathname, start: m.start_url, scope: m.scope }; });
    C.prueba('manifest: start_url / y scope /', man.start === '/' && man.scope === '/', JSON.stringify(man));
    await ctx.setOffline(true); await p.reload().catch(() => {}); await espera(1500);
    C.prueba('sin conexión la portada abre desde la caché', await p.evaluate(() => !!document.getElementById('ug-explorar-biblioteca') && /Lurveta/.test(document.title)).catch(() => false));
    await ctx.close();

    // Actualización desde la versión anterior
    const viejo = versionAnterior();
    const instalarViejo = async (ruta = '/public/biblioteca.html') => {
      web.usar(viejo);
      const c = await bsw.newContext(), q = await c.newPage();
      await q.goto(web.url + ruta); await listo(q); await q.reload(); await espera(1500);
      await q.evaluate(async () => { for (const n of ['apexgp-prueba', 'studio-prueba']) await (await caches.open(n)).put('/x', new Response('juego')); });
      return { c, q };
    };
    let v = await instalarViejo();
    const antes = { ctl: await ctl(v.q), regs: await regs(v.q), cachés: await cachés(v.q) };
    C.prueba(`versión ${ANTERIOR.slice(0, 7)} instalada: su SW de /public/ controla la biblioteca`, antes.ctl === `${web.url}/public/service-worker.js` && antes.cachés.some(n => /^upgames-v7/.test(n)), JSON.stringify(antes));

    // A) Ventana abierta y el navegador busca la actualización del SW (lo que hace solo cada ~24 h o al navegar)
    await v.q.goto(web.url + '/public/biblioteca.html?q=winlator'); await espera(1500);
    web.usar(REPO);
    await v.q.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update())).catch(() => {});
    await v.q.reload();
    await listo(v.q); await espera(2500);
    let d = { url: v.q.url(), ctl: await ctl(v.q), regs: await regs(v.q), cachés: await cachés(v.q) };
    C.prueba('A) la biblioteca permanece abierta con su búsqueda', new URL(d.url).pathname === '/public/biblioteca.html' && new URL(d.url).search === '?q=winlator', d.url);
    C.prueba('A) queda solo el SW raíz (alcance /), sin el de /public/', JSON.stringify(d.regs) === '["/"]', JSON.stringify(d.regs));
    C.prueba('A) cachés viejas de Lurveta borradas; las de los juegos intactas', !d.cachés.some(n => /^upgames-v7/.test(n)) && ['apexgp-prueba', 'studio-prueba'].every(n => d.cachés.includes(n)), JSON.stringify(d.cachés));
    await v.q.reload(); await espera(1500);
    const sw = fs.readFileSync(path.join(REPO, 'service-worker.js'), 'utf8');
    const cacheVersion = sw.match(/const CACHE_VERSION = ['"]([^'"]+)['"]/)?.[1];
    C.prueba('A) tras recargar, /service-worker.js controla la portada y llena su caché nueva', (await ctl(v.q)) === `${web.url}/service-worker.js` && (await cachés(v.q)).includes(`${cacheVersion}-static`), JSON.stringify({ ctl: await ctl(v.q), c: await cachés(v.q) }));
    await v.c.close();

    // B) Tras el despliegue abre un marcador / la app instalada vieja (/public/biblioteca.html?…)
    v = await instalarViejo();
    web.usar(REPO);
    await v.q.goto(`${web.url}/public/biblioteca.html?id=${ID}#comentarios`).catch(() => {});
    await listo(v.q); await espera(3000);
    d = { url: v.q.url(), regs: await regs(v.q), cachés: await cachés(v.q) };
    C.prueba('B) marcador viejo con ?id= y #: conserva su destino y fragmento', d.url === `${web.url}/public/biblioteca.html?id=${ID}#comentarios`, d.url);
    C.prueba('B) el SW de /public/ se da de baja y el raíz toma su lugar', JSON.stringify(d.regs) === '["/"]', JSON.stringify(d.regs));
    C.prueba('B) cachés viejas de Lurveta borradas; las de los juegos intactas', !d.cachés.some(n => /^upgames-v7/.test(n)) && ['apexgp-prueba', 'studio-prueba'].every(n => d.cachés.includes(n)), JSON.stringify(d.cachés));
    await v.q.reload(); await espera(1500);
    await v.c.setOffline(true);
    await v.q.goto(web.url + '/').catch(() => {}); await espera(1500);
    C.prueba('B) después de actualizar, sin conexión la portada abre', await v.q.evaluate(() => !!document.getElementById('ug-explorar-biblioteca')).catch(() => false));
    await v.q.goto(web.url + '/public/biblioteca.html?tab=perfil').catch(() => {}); await espera(2000);
    C.prueba('B) sin conexión, la biblioteca abre desde el marcador', new URL(v.q.url()).pathname === '/public/biblioteca.html' && await v.q.evaluate(() => !!document.getElementById('main-view')).catch(() => false), v.q.url());
    await v.c.close();

    // C) El SW viejo se actualiza sin que nadie abra la portada (otra página de /public/, o un aviso push que
    //    dispara la comprobación del navegador): su registro NO se da de baja (la suscripción push vive en él)
    v = await instalarViejo('/public/perfil-publico.html?usuario=upgames');   // (chats.html sin sesión lleva al login, fuera de /public/)
    web.usar(REPO);
    await v.q.goto(web.url + '/public/perfil-publico.html?usuario=upgames').catch(() => {}); await espera(1500);
    await v.q.evaluate(() => navigator.serviceWorker.getRegistration('/public/').then(r => r && r.update())).catch(() => {});
    await espera(3000); await v.q.reload().catch(() => {}); await espera(2000);
    d = { regs: await regs(v.q), ctl: await ctl(v.q), cachés: await cachés(v.q), script: await v.q.evaluate(async () => (await navigator.serviceWorker.getRegistration('/public/'))?.active?.scriptURL) };
    C.prueba('C) sin pasar por la portada, el registro de /public/ sigue (con el SW nuevo) y no pierde su suscripción', d.regs.includes('/public/') && d.script === `${web.url}/public/service-worker.js` && d.ctl === d.script, JSON.stringify(d));
    C.prueba('C) aun así borra las cachés viejas de Lurveta y conserva las de los juegos', !d.cachés.some(n => /^upgames-v7/.test(n)) && ['apexgp-prueba', 'studio-prueba'].every(n => d.cachés.includes(n)), JSON.stringify(d.cachés));
    await v.c.setOffline(true); await v.q.reload().catch(() => {}); await espera(1500);
    C.prueba('C) y sirve sin conexión con el código del SW raíz', await v.q.evaluate(() => location.pathname === '/public/perfil-publico.html' && /Lurveta/.test(document.title) && !/Sin conexión/.test(document.body.innerText.slice(0, 200))).catch(() => false));
    await v.c.close();

    // D) Avisos push: con suscripción en el registro viejo, la portada lo da de baja solo cuando el de la raíz
    //    ya tiene la suya (la crea ugnSuscribir al abrir la app). Push real no existe en Chromium sin red:
    //    se simula pushManager.getSubscription() en la página.
    v = await instalarViejo();
    web.usar(REPO);
    await v.c.addInitScript(() => {
      try { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' }); } catch (_) {}   // headless no concede el permiso
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get() {
        const viejo = new URL(this.scope).pathname === '/public/';
        return { getSubscription: async () => viejo ? { endpoint: 'https://push.example/viejo' } : (window.__subRaiz || null), subscribe: async () => { throw new Error('sin servicio push'); } };
      } });
    });
    await v.q.goto(web.url + '/').catch(() => {}); await listo(v.q); await espera(4000);
    const esperando = await regs(v.q);
    C.prueba('D) mientras la raíz no tiene suscripción, el registro viejo (con la suya) se conserva', JSON.stringify(esperando) === '["/","/public/"]', JSON.stringify(esperando));
    await v.q.evaluate(() => { window.__subRaiz = { endpoint: 'https://push.example/nuevo' }; });
    await espera(9000);
    C.prueba('D) cuando la raíz ya tiene su suscripción, el viejo se da de baja', JSON.stringify(await regs(v.q)) === '["/"]', JSON.stringify(await regs(v.q)));
    await v.c.close();
    fs.rmSync(viejo, { recursive: true, force: true });
  } finally { await bsw.close(); web.cerrar(); }
  process.exit(C.fin() ? 1 : 0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
