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
 *  - Modo turno: no se abre solo para el dueño; junta revisión, reportes y retiros; los pasos deciden la acción
 *    (aprobar, marcar caído) y se guarda en la base; «Ver todo el panel» vuelve al panel
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

    // ── Datos del modo turno: una publicación prioritaria, una normal y una reportada ──
    const juegos = db.collection('juegos'), hace = h => new Date(Date.now() - h * 3600e3);
    const base = { category: 'Mod', link: 'https://example.com/descarga', image: 'https://example.com/portada.jpg', description: 'Mod de prueba', descargasEfectivas: 0 };
    const J = {
      prio: (await juegos.insertOne({ ...base, usuario: 'ana', title: 'Mod prioritario de prueba', status: 'pendiente', linkStatus: 'revision', prioridadDesde: hace(2), createdAt: hace(3), updatedAt: hace(3) })).insertedId,
      normal: (await juegos.insertOne({ ...base, usuario: 'beto', title: 'Mod normal de prueba', status: 'pendiente', linkStatus: 'revision', createdAt: hace(30), updatedAt: hace(30) })).insertedId,
      rep: (await juegos.insertOne({ ...base, usuario: 'caro', title: 'Mod reportado de prueba', status: 'aprobado', linkStatus: 'online', reportes: 2, reportesDesglose: { caido: 2 }, createdAt: hace(200), updatedAt: hace(200) })).insertedId,
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

      // ── Modo turno ──
      C.prueba('turno: no se abre solo para el dueño', await p.evaluate(() => document.getElementById('turno').hidden));
      const btn = await p.evaluate(() => ({ visible: !document.getElementById('tnBtn').hidden, n: document.getElementById('tnBtnN').textContent }));
      C.prueba('turno: botón «Modo turno» en el menú con sus tareas (2 revisión + 1 reporte + 1 retiro)', btn.visible && btn.n === '4', JSON.stringify(btn));
      await p.evaluate(() => tnAbrir()); await espera(1200);
      const t0 = await p.evaluate(() => ({ abierto: !document.getElementById('turno').hidden, h1: document.querySelector('#turno h1')?.innerText, eti: document.querySelector('#turno .tn-eti')?.innerText,
        ok: document.getElementById('tnOk')?.disabled, sobra: document.getElementById('turno').scrollWidth - innerWidth, colas: [...document.querySelectorAll('#turno .tn-cola b')].map(b => b.innerText) }));
      C.prueba('turno: abre con la prioritaria primero y «Aprobar» bloqueado hasta responder los pasos', t0.abierto && /4 tareas/.test(t0.h1) && /Prioritaria/i.test(t0.eti) && t0.ok === true, JSON.stringify(t0));
      C.prueba('turno: colas de revisión, reportes, verificación y retiros, sin desborde', t0.colas.length === 4 && t0.sobra <= 1, JSON.stringify(t0));
      if (CAPT) await p.screenshot({ path: path.join(CAPT, `admin-turno-${nombre}.png`), fullPage: false });
      if (nombre === 'escritorio') {
        for (let i = 0; i < 4; i++) { await p.click('#turno .tn-si'); await espera(150); }
        const listo = await p.evaluate(() => ({ off: document.getElementById('tnOk').disabled, txt: document.getElementById('tnOk').innerText }));
        C.prueba('turno: con los 4 «Sí» se habilita «Aprobar y pasar a la siguiente»', !listo.off && /Aprobar/.test(listo.txt), JSON.stringify(listo));
        await p.click('#tnOk'); await espera(1500);
        const prio = await juegos.findOne({ _id: J.prio });
        const t1 = await p.evaluate(() => ({ prog: document.querySelector('#turno .tn-prog span')?.innerText, eti: document.querySelector('#turno .tn-eti')?.innerText }));
        C.prueba('turno: aprobó en la base y pasó a la siguiente (el reporte)', prio.status === 'aprobado' && prio.linkStatus === 'online' && t1.prog === '1 de 4' && /REPORTES/.test(t1.eti), JSON.stringify({ st: prio.status, ...t1 }));
        await p.click('#turno .tn-si'); await espera(150); await p.click('#turno .tn-no'); await espera(150);
        const caida = await p.evaluate(() => document.getElementById('tnOk').innerText);
        C.prueba('turno: «No» en un paso cambia la decisión (marcar caído)', /caído/.test(caida), caida);
        await p.click('#tnOk'); await espera(1500);
        C.prueba('turno: el enlace reportado quedó caído en la base', (await juegos.findOne({ _id: J.rep })).linkStatus === 'caido');
        const antes = await p.evaluate(() => document.querySelector('#turno .tn-tit')?.innerText);
        await p.click('#turno .tn-salta'); await espera(400);
        const despues = await p.evaluate(() => document.querySelector('#turno .tn-tit')?.innerText);
        C.prueba('turno: «Saltar por ahora» pasa a otra tarea', antes && despues && antes !== despues, JSON.stringify({ antes, despues }));
      }
      await p.click('#turno .tn-pausa'); await espera(400);
      C.prueba('turno: «Pausar turno» vuelve al panel', await p.evaluate(() => document.getElementById('turno').hidden && document.getElementById('app').classList.contains('on')));
      await ctx.close();
    }
    C.seccion('Turno: reglas en el servidor (pagos, reportes, verificación y conflictos)');
    const tok = (await (await fetch(A + '/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: PIN }) })).json()).adminToken;
    const adm = async (mt, r, body) => { const x = await fetch(A + r, { method: mt, headers: { 'Content-Type': 'application/json', 'x-admin-token': tok }, body: body ? JSON.stringify(body) : undefined }); return { s: x.status, d: await x.json().catch(() => ({})) }; };
    const sol = (await adm('GET', '/admin/finanzas/solicitudes-pendientes')).d.solicitudes || [];
    C.prueba('la cola dice si el retiro se paga solo (sin PayPal configurado: manual)', sol.find(x => String(x._id) === String(P.pend))?.automatico === false, JSON.stringify(sol.map(x => x.automatico)));
    let r = await adm('POST', `/admin/finanzas/procesar-pago/${P.pend}`, { modo: 'automatico' });
    C.prueba('un panel que cree que es automático no registra un pago manual (409 MODO_CAMBIO)', r.s === 409 && r.d.code === 'MODO_CAMBIO', JSON.stringify(r));
    r = await adm('POST', `/admin/finanzas/procesar-pago/${P.pend}`, { modo: 'manual', referencia: '  ' });
    C.prueba('pago manual sin comprobante → 400 y el retiro sigue pendiente', r.s === 400 && r.d.code === 'REFERENCIA_REQUERIDA' && (await pagos.findOne({ _id: P.pend })).estado === 'pendiente', JSON.stringify(r));
    await pagos.insertOne({ usuario: 'eva', monto: 3, metodo: 'paypal', referencia: 'TRX-REPETIDA-1', estado: 'completado', fecha: ahora });
    r = await adm('POST', `/admin/finanzas/procesar-pago/${P.pend}`, { modo: 'manual', referencia: 'TRX-REPETIDA-1' });
    C.prueba('una referencia ya usada en otro retiro → 409', r.s === 409 && r.d.code === 'REFERENCIA_DUPLICADA', JSON.stringify(r));
    const mp = (await pagos.insertOne({ usuario: 'dani', monto: 5, metodo: 'mercadopago', datosCobro: 'cifrado', resumen: 'MP · dani', estado: 'pendiente', fecha: ahora })).insertedId;
    r = await adm('POST', `/admin/finanzas/procesar-pago/${mp}`, { modo: 'manual', referencia: 'MP-7788' });
    C.prueba('pago manual sin haber visto los datos de cobro → 409', r.s === 409 && r.d.code === 'DATOS_SIN_VER', JSON.stringify(r));
    r = await adm('POST', `/admin/finanzas/procesar-pago/${P.pend}`, { modo: 'manual', referencia: 'TRX-998877' });
    const pagado = await pagos.findOne({ _id: P.pend });
    C.prueba('con comprobante se registra una vez, con referencia y responsable en el historial', r.s === 200 && pagado.estado === 'completado' && pagado.referencia === 'TRX-998877' && (pagado.historial || []).some(h => h.accion === 'completado' && h.por), JSON.stringify({ s: r.s, e: pagado.estado }));
    r = await adm('POST', `/admin/finanzas/procesar-pago/${P.pend}`, { modo: 'manual', referencia: 'TRX-998877' });
    C.prueba('el mismo pago no se registra dos veces (409)', r.s === 409, r.s);

    const rep = await juegos.findOne({ _id: J.rep });
    C.prueba('marcar caído cerró la tarea de reportes sin borrar los reportes', rep.revisionReportes?.estado === 'resuelta' && rep.revisionReportes.reportes === rep.reportes && rep.reportes === 2, JSON.stringify(rep.revisionReportes));
    await juegos.updateOne({ _id: J.rep }, { $inc: { reportes: 1, 'reportesDesglose.malware': 1 } });
    r = await adm('PUT', `/admin/items/${J.rep}`, { linkStatus: 'online', esperado: { reportes: 2 } });
    C.prueba('una decisión sobre datos viejos no pisa un reporte nuevo (409 CONFLICTO)', r.s === 409 && r.d.code === 'CONFLICTO', JSON.stringify(r.d));
    r = await adm('PUT', `/admin/items/${J.rep}/reset-reports`, {});
    C.prueba('un reporte de malware nuevo no se limpia solo porque el enlace funcione (422)', r.s === 422 && r.d.code === 'MALWARE_SIN_REVISAR', JSON.stringify(r.d));
    r = await adm('PUT', `/admin/items/${J.normal}`, { status: 'aprobado', comprobaciones: [true, false, true, true] });
    C.prueba('aprobar con una comprobación en «No» → 422 CONTRADICCION', r.s === 422 && r.d.code === 'CONTRADICCION' && (await juegos.findOne({ _id: J.normal })).status === 'pendiente', JSON.stringify(r.d));
    const sos = (await juegos.insertOne({ ...base, usuario: 'eva', title: 'Juego completo dudoso', status: 'aprobado', pagoPausado: true, sospecha: { juego: 'X', desde: ahora } })).insertedId;
    r = await adm('POST', `/admin/items/${sos}/sospecha`, { decision: 'ok' });
    C.prueba('volver a pagar sin verificar el enlace → 422', r.s === 422 && r.d.code === 'ENLACE_SIN_VERIFICAR' && (await juegos.findOne({ _id: sos })).pagoPausado === true, JSON.stringify(r.d));
    r = await adm('POST', `/admin/items/${sos}/sospecha`, { decision: 'mantener', esperado: { revision: '' } });
    const r2 = await adm('POST', `/admin/items/${sos}/sospecha`, { decision: 'ok', enlaceVerificado: true, esperado: { revision: '' } });
    C.prueba('dos admins a la vez: la segunda decisión sobre la misma versión → 409 y gana la primera', r.s === 200 && r2.s === 409 && (await juegos.findOne({ _id: sos })).sospecha.revision === 'mantener', JSON.stringify([r.s, r2.s]));

    C.seccion('Turno: un error del servidor no es «Todo al día»');
    {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
      await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, x => x.abort());
      await ctx.route(/\/admin\/(items(\?|\/sospechosas)|finanzas\/solicitudes-pendientes)/, x => x.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' }));
      const p = await ctx.newPage(); p.on('pageerror', e => errores.push(`error-500: ${e.message}`));
      await p.goto(`${web.url}/admin/index.html?api=${encodeURIComponent(A)}`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(() => togglePin()); await p.fill('#lgPin', PIN); await p.click('#lgBtn');
      await p.waitForSelector('#app.on', { timeout: 15000 }).catch(() => {}); await espera(2500);
      await p.evaluate(() => tnAbrir()); await espera(800);
      const t = await p.evaluate(() => ({ h1: document.querySelector('#turno h1')?.innerText, alerta: document.querySelector('#turno [role=alert]')?.innerText || '', vacio: document.querySelector('#turno .tn-vacio h2')?.innerText }));
      C.prueba('con la API en 500 el turno dice que no pudo comprobar (nunca «Todo al día»)', !/Todo al día/.test(t.h1) && /No se pudieron comprobar/.test(t.alerta) && /error del servidor/.test(t.alerta), JSON.stringify(t));
      await p.evaluate(() => logout('Sesión cerrada en la prueba')); await p.waitForLoadState('domcontentloaded'); await espera(800);
      const fuera = await p.evaluate(() => ({ login: !document.getElementById('login').classList.contains('hide'), turno: document.getElementById('turno').innerHTML, msg: document.getElementById('lgErr').textContent, ses: sessionStorage.getItem('ugAdmin') || localStorage.getItem('ugAdmin') }));
      C.prueba('cerrar sesión recarga limpio: login visible, sin datos del turno ni sesión guardada, con el motivo', fuera.login && !fuera.turno && !fuera.ses && /prueba/.test(fuera.msg), JSON.stringify(fuera));
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
