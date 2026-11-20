#!/usr/bin/env node
/**
 * Panel de administración de extremo a extremo: el servidor REAL (index.js) contra MongoDB en memoria y el
 * panel real (admin/index.html?api=…) en un navegador, en móvil y escritorio.
 *  - navegación: 6 áreas, todas las secciones del dueño, migas, filtro del menú, barra inferior, sin desbordes
 *  - cada sección abre sin errores de JavaScript
 *  - Pagos: pendientes, «En revisión» e «Incidencias PayPal» con datos sembrados; «Devolver al saldo» desde la
 *    interfaz exige el monto exacto y acredita UNA vez (repetir por la API → 409); reportar una incidencia de
 *    un pago manual desde «Historial»
 *  - las rutas nuevas de finanzas exigen sesión de admin
 * Sin PayPal real: los payouts sembrados ya tienen su estado. Uso: node test/real/admin.js  (CAPTURAS=dir)
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { spawn } = require('child_process');
const { navegador, contador, requerir } = require('./util');
const { MongoMemoryServer } = requerir('mongodb-memory-server');
const { MongoClient, ObjectId } = requerir('mongodb');
const REPO = path.join(__dirname, '..', '..');
const espera = ms => new Promise(r => setTimeout(r, ms));
const CAPT = process.env.CAPTURAS;
const PIN = 'llave-de-prueba-123456';

function servirRepo() {   // admin/ usa ../public/: se sirve la raíz del repositorio
  const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return new Promise(ok => { const s = http.createServer((req, res) => {
    const f = path.join(REPO, path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  }); s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, cerrar: () => s.close() })); });
}

(async () => {
  const C = contador('Panel de administración · navegación, rediseño y conciliación de PayPal');
  const m = await MongoMemoryServer.create(); const uri = m.getUri('upgames');
  const web = await servirRepo();
  const PORT = 5600 + Math.floor(Math.random() * 300), A = `http://127.0.0.1:${PORT}`;
  const srv = spawn('node', ['index.js'], { cwd: REPO, env: { ...process.env, MONGODB_URI: uri, JWT_SECRET: 's'.repeat(40), PORT: String(PORT), NODE_ENV: 'development', ADMIN_PIN: PIN, CORS_ORIGINS: web.url } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  for (let i = 0; i < 80; i++) { try { await fetch(A + '/salud'); break; } catch (_) { await espera(500); } }
  const cli = await MongoClient.connect(m.getUri()); const db = cli.db('upgames');
  const b = await navegador();
  const errores = [];
  try {
    // ── Datos: un retiro de cada tipo ──
    const mk = (u, saldo = 0) => db.collection('usuarios').insertOne({ usuario: u, email: `${u}@t.test`, password: 'x', saldo, emailVerificado: true, paypalEmail: `${u}@pp.test`, cobro: { tipo: 'paypal', resumen: `PayPal · ${u}•••@pp.test`, cifrado: '' }, createdAt: new Date() });
    for (const u of ['ana', 'beto', 'caro', 'dani', 'eva']) await mk(u);
    const ahora = new Date();
    const pagos = db.collection('pagos');
    const P = {
      pend: (await pagos.insertOne({ usuario: 'ana', monto: 11, metodo: 'paypal', paypalEmail: 'ana@pp.test', resumen: 'PayPal · ana', estado: 'pendiente', fecha: ahora })).insertedId,
      revi: (await pagos.insertOne({ usuario: 'beto', monto: 12, metodo: 'paypal', paypalEmail: 'beto@pp.test', resumen: 'PayPal · beto', estado: 'procesado', revision: 'incierto', procesadoEn: ahora, payoutBatchId: 'LOTEBETO1', fecha: ahora, historial: [{ fecha: ahora, accion: 'incierto', por: 'llave-maestra', detalle: 'PayPal no respondió a tiempo' }] })).insertedId,
      dev: (await pagos.insertOne({ usuario: 'caro', monto: 13, metodo: 'paypal', paypalEmail: 'caro@pp.test', resumen: 'PayPal · caro', estado: 'completado', payoutBatchId: 'LOTECARO1', fecha: ahora,
        paypal: { estado: 'RETURNED', itemId: 'ITEMCARO1', error: 'RECEIVER_UNREGISTERED', actualizado: ahora, fuente: 'webhook' },
        incidencia: { tipo: 'devuelto', estado: 'abierta', abierta: ahora, fuente: 'webhook', motivo: 'PayPal: RETURNED' }, historial: [{ fecha: ahora, accion: 'paypal:RETURNED', por: 'sistema', detalle: 'webhook' }] })).insertedId,
      noRec: (await pagos.insertOne({ usuario: 'dani', monto: 14, metodo: 'paypal', paypalEmail: 'dani@pp.test', resumen: 'PayPal · dani', estado: 'completado', payoutBatchId: 'LOTEDANI1', fecha: ahora,
        paypal: { estado: 'UNCLAIMED', itemId: 'ITEMDANI1', actualizado: ahora, fuente: 'barrido' }, incidencia: { tipo: 'no_reclamado', estado: 'abierta', abierta: ahora, fuente: 'barrido', motivo: 'PayPal: UNCLAIMED' } })).insertedId,
      manual: (await pagos.insertOne({ usuario: 'eva', monto: 15, metodo: 'mercadopago', resumen: 'Mercado Pago · eva', estado: 'completado', fecha: ahora })).insertedId,
    };

    C.seccion('Seguridad de las rutas nuevas');
    for (const [mt, r] of [['GET', '/admin/finanzas/incidencias'], ['POST', `/admin/finanzas/pagos/${P.dev}/resolver`], ['POST', `/admin/finanzas/pagos/${P.manual}/incidencia`], ['GET', `/admin/finanzas/pagos/${P.dev}`]]) {
      const s = (await fetch(A + r, { method: mt, headers: { 'Content-Type': 'application/json' }, body: mt === 'POST' ? '{"accion":"restaurar","confirmo":13}' : undefined })).status;
      C.prueba(`${mt} ${r.replace(/[a-f0-9]{24}/, ':id')} sin sesión → 401`, s === 401, s);
    }

    for (const [nombre, vp] of [['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1440, height: 900 }]]) {
      C.seccion(`Panel · ${nombre}`);
      const ctx = await b.newContext({ viewport: vp, ...(vp.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // íconos y fuentes externas: no hacen falta
      const p = await ctx.newPage();
      p.on('pageerror', e => errores.push(`${nombre}: ${e.message}`));
      p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'devuelto' : undefined));
      await p.goto(`${web.url}/admin/index.html?api=${encodeURIComponent(A)}`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(() => togglePin());
      await p.fill('#lgPin', PIN); await p.click('#lgBtn');
      await p.waitForSelector('#app.on', { timeout: 15000 }).catch(() => {});
      await espera(2500);
      C.prueba('entra con la llave maestra', await p.evaluate(() => document.getElementById('app').classList.contains('on')));

      const nav = await p.evaluate(() => ({ grupos: [...document.querySelectorAll('#nav .nav-g span:not(.nbadge)')].map(x => x.textContent), secciones: [...document.querySelectorAll('#nav .nav-i')].map(x => x.dataset.v) }));
      C.prueba('6 áreas en orden', JSON.stringify(nav.grupos) === JSON.stringify(['Resumen', 'Finanzas', 'Comunidad y moderación', 'Contenido', 'Plataforma', 'Sistema y seguridad']), JSON.stringify(nav.grupos));
      C.prueba('las 23 secciones siguen (ninguna se perdió)', nav.secciones.length === 23 && new Set(nav.secciones).size === 23, nav.secciones.join(','));

      // Cada sección abre, con migas y sin desbordar el ancho
      const malas = [];
      for (const id of nav.secciones) {
        await p.evaluate(v => go(v), id); await espera(id === 'api' || id === 'nxbus' ? 600 : 250);
        const r = await p.evaluate(v => ({ on: document.getElementById('v-' + v)?.classList.contains('on'), migas: document.getElementById('topT').innerText, sobra: document.documentElement.scrollWidth - innerWidth }), id);
        if (!r.on || !r.migas.trim() || r.sobra > 2) malas.push(`${id} (${JSON.stringify(r)})`);
      }
      C.prueba('cada sección abre, con área › sección y sin desborde horizontal', malas.length === 0, malas.join(' · '));
      await p.evaluate(() => go('pays')); await espera(600);
      const migas = await p.evaluate(() => document.getElementById('topT').innerText.replace(/\s+/g, ' ').trim());
      C.prueba('migas de Pagos: «Finanzas › Pagos y retiros»', /Finanzas/.test(migas) && /Pagos y retiros/.test(migas), migas);

      if (vp.width < 600) {
        C.prueba('barra inferior con 4 secciones + Menú', (await p.$$eval('#bnav .bn', x => x.length)) === 5);
        C.prueba('el menú lateral está oculto hasta abrirlo', await p.evaluate(() => getComputedStyle(document.getElementById('side')).transform !== 'none' && !document.getElementById('side').classList.contains('open')));
        await p.click('#bnav .bn:last-child'); await espera(400);
        await p.fill('#navQ', 'incid'); await espera(150);
        const vis = await p.$$eval('#nav .nav-i', x => x.filter(b => b.style.display !== 'none').map(b => b.dataset.v));
        await p.fill('#navQ', 'audit'); await espera(150);
        const vis2 = await p.$$eval('#nav .nav-i', x => x.filter(b => b.style.display !== 'none').map(b => b.dataset.v));
        C.prueba('el filtro del menú encuentra secciones (aunque su grupo esté plegado)', vis2.includes('audit') && vis2.length === 1, JSON.stringify({ vis, vis2 }));
        await p.click('#nav .nav-i[data-v="pays"]'); await espera(500);
        C.prueba('tocar una sección cierra el menú', await p.evaluate(() => !document.getElementById('side').classList.contains('open')));
        await p.click('.q-btn'); await espera(200);
        C.prueba('la lupa abre el filtro de la sección', await p.evaluate(() => document.querySelector('.top').classList.contains('buscando') && document.activeElement?.id === 'q'));
        await p.evaluate(() => { document.getElementById('q').blur(); });
      } else {
        C.prueba('menú lateral siempre visible en escritorio', await p.evaluate(() => getComputedStyle(document.getElementById('side')).transform === 'none' || getComputedStyle(document.getElementById('side')).transform === 'matrix(1, 0, 0, 1, 0, 0)'));
        C.prueba('barra inferior oculta en escritorio', await p.evaluate(() => getComputedStyle(document.getElementById('bnav')).display === 'none'));
      }

      // ── Pagos ──
      await p.evaluate(() => go('pays')); await espera(800);
      const cuentas = await p.evaluate(() => ({ pend: document.getElementById('pfC-pend').textContent, revi: document.getElementById('pfC-revi').textContent, inci: document.getElementById('pfC-inci').textContent }));
      C.prueba('pestañas con su número: 1 pendiente · 1 en revisión · 2 incidencias', cuentas.pend === '1' && cuentas.revi === '1' && cuentas.inci === '2', JSON.stringify(cuentas));
      await p.click('#pF [data-f="revi"]'); await espera(600);
      const rev = await p.evaluate(() => ({ txt: document.getElementById('payList').innerText, acciones: [...document.querySelectorAll('#payList .fin-acts .btn')].map(x => x.innerText.trim()) }));
      C.prueba('«En revisión»: @beto, resultado desconocido, lote y acciones de conciliación', /@beto/.test(rev.txt) && /Resultado desconocido/.test(rev.txt) && /LOTEBETO1/.test(rev.txt) && rev.acciones.some(a => /Consultar PayPal/.test(a)) && rev.acciones.some(a => /no salió/.test(a)), JSON.stringify(rev.acciones));
      await p.click('#pF [data-f="inci"]'); await espera(600);
      await p.evaluate(() => document.querySelectorAll('#payList details.mas').forEach(d => { d.open = true; }));
      const inc = await p.evaluate(() => [...document.querySelectorAll('#payList .fin-c')].map(c => ({ u: c.querySelector('.fin-u').textContent, abierta: c.classList.contains('fin-ab'), txt: c.innerText, acts: [...c.querySelectorAll('.fin-acts .btn')].map(x => x.innerText.trim()) })));
      const caro = inc.find(x => x.u === '@caro'), dani = inc.find(x => x.u === '@dani');
      C.prueba('incidencia DEVUELTA: estado, motivo, lote, ítem, fechas e historial a la vista', caro && /Devuelto/.test(caro.txt) && /RECEIVER_UNREGISTERED/.test(caro.txt) && /LOTECARO1/.test(caro.txt) && /ITEMCARO1/.test(caro.txt) && /Historial/.test(caro.txt), caro && caro.txt.slice(0, 300));
      if (nombre === 'móvil') C.prueba('DEVUELTA ofrece devolver saldo y reenviar', caro?.abierta && caro.acts.some(a => /Devolver al saldo/.test(a)) && caro.acts.some(a => /Reenviar/.test(a)), JSON.stringify(caro?.acts));
      else C.prueba('ya resuelta (en el móvil): pasa a «Resueltas», sin acciones de dinero y con quién la resolvió', caro && !caro.abierta && /Saldo devuelto al creador/.test(caro.txt) && /llave-maestra/.test(caro.txt) && !caro.acts.length, caro && caro.txt.slice(0, 300));
      C.prueba('NO RECLAMADA: solo cancelar en PayPal (no devolver ni reenviar)', dani && dani.acts.some(a => /Cancelar en PayPal/.test(a)) && !dani.acts.some(a => /Devolver al saldo|Reenviar/.test(a)), JSON.stringify(dani?.acts));
      if (CAPT) await p.screenshot({ path: path.join(CAPT, `admin-incidencias-${nombre}.png`), fullPage: false });

      if (nombre === 'móvil') {
        // Devolver al saldo desde la interfaz: con monto equivocado no pasa; con el exacto, acredita una vez
        await p.locator('.fin-c', { hasText: '@caro' }).locator('button', { hasText: 'Devolver al saldo' }).click(); await espera(300);
        await p.fill('#mtNum', '12'); await p.click('#mtOk'); await espera(700);
        C.prueba('monto equivocado → no se acredita', (await db.collection('usuarios').findOne({ usuario: 'caro' })).saldo === 0);
        await p.fill('#mtNum', '13'); await p.fill('#mtV', 'PayPal: RETURNED (cuenta inexistente)'); await p.click('#mtOk'); await espera(1200);
        const caroDb = await db.collection('usuarios').findOne({ usuario: 'caro' }), pagoDb = await pagos.findOne({ _id: P.dev });
        C.prueba('con el monto exacto: +13 USD al saldo y la incidencia queda resuelta (con quién y cuándo)', caroDb.saldo === 13 && pagoDb.incidencia.estado === 'resuelta' && pagoDb.incidencia.resolucion === 'saldo_devuelto' && pagoDb.incidencia.resueltaPor === 'llave-maestra', JSON.stringify({ saldo: caroDb.saldo, inc: pagoDb.incidencia }));
        const tok = await p.evaluate(() => S.token);
        const otra = await fetch(`${A}/admin/finanzas/pagos/${P.dev}/resolver`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': tok }, body: JSON.stringify({ accion: 'restaurar', confirmo: 13 }) });
        C.prueba('repetir la acción por la API → 409 y el saldo no cambia', otra.status === 409 && (await db.collection('usuarios').findOne({ usuario: 'caro' })).saldo === 13, otra.status);
        const aud = await fetch(`${A}/admin/auditoria?limite=20&soloCambios=1`, { headers: { 'x-admin-token': tok } }).then(r => r.json());
        C.prueba('la acción quedó en la auditoría del panel', (aud.logs || []).some(l => /resolver/.test(l.accion)), JSON.stringify((aud.logs || []).map(l => l.accion)));
        // Reportar una incidencia de un pago manual desde «Historial»
        await p.click('#pF [data-f="hist"]'); await espera(900);
        await p.locator('.fin-row', { hasText: '@eva' }).locator('button[title^="Reportar"]').click(); await espera(300);
        await p.fill('#mtV', 'Mercado Pago devolvió la transferencia: cuenta cerrada'); await p.click('#mtOk'); await espera(1200);
        const eva = await pagos.findOne({ _id: P.manual });
        C.prueba('reportar desde Historial abre la incidencia con la evidencia (sin mover dinero)', eva.incidencia?.estado === 'abierta' && eva.incidencia.fuente === 'admin' && /cuenta cerrada/.test(eva.incidencia.evidencia) && (await db.collection('usuarios').findOne({ usuario: 'eva' })).saldo === 0, JSON.stringify(eva.incidencia));
      }
      // Panel de inicio: lo urgente primero
      await p.evaluate(() => go('dash')); await espera(1200);
      const al = await p.evaluate(() => [...document.querySelectorAll('#dAlerts .alert')].slice(0, 3).map(a => a.innerText.replace(/\s+/g, ' ').trim()));
      C.prueba('inicio: lo pendiente de finanzas aparece primero', al.length && /incidencias|revisión|por pagar/.test(al[0]), JSON.stringify(al));
      if (CAPT) { await p.screenshot({ path: path.join(CAPT, `admin-inicio-${nombre}.png`) }); }
      await ctx.close();
    }
    C.seccion('Salud general');
    C.prueba('sin errores de JavaScript en el panel', errores.length === 0, errores.slice(0, 5).join('\n'));
  } finally {
    await b.close(); srv.kill(); await cli.close(); await m.stop(); web.cerrar();
  }
  const mal = C.fin();
  if (mal) console.log(log.split('\n').filter(l => /error/i.test(l)).slice(-8).join('\n'));
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
