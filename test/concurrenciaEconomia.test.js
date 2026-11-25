/**
 * Integridad del dinero bajo concurrencia, contra un MongoDB REAL en memoria
 * (mongodb-memory-server): las operaciones atómicas, los índices únicos y la
 * idempotencia solo se pueden probar de verdad con el motor real.
 *
 *  - validar-descarga (ruta real de rutas/economia.js): tope por IP con un ticket reenviado
 *    en paralelo, y saldo correcto mientras a la vez se paga un retiro o se gastan UpCoins.
 *  - Retiros (modulos/retiros.js): doble clic, PayPal con resultado desconocido, rechazo
 *    seguro, caída a medias y reconciliación idempotente.
 *  - Payouts de PayPal (modulos/paypal.js): lote estable y clasificación de errores.
 *  - Webhook de Mercado Pago: monto validado contra lo cobrado, no contra el precio de hoy.
 * Autónomo: `node test/concurrenciaEconomia.test.js` (o `npm test`).
 */
'use strict';

const assert = require('assert');
const mongoose = require('mongoose');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas-concurrencia';
const SECRETO = process.env.JWT_SECRET;
const TicketPuente = require('../modulos/ticketPuente');
const ContadorIP = require('../modulos/descargaIP');
const Retiros = require('../modulos/retiros');
const PayPal = require('../modulos/paypal');
const UC = require('../modulos/upcoins');
const { montoMPValido } = require('../rutas/tienda');

let passed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.stack || e.message}`); process.exitCode = 1; }
}
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const CPM = 1.5, PARTE = 0.5, GANANCIA = CPM * PARTE / 1000, MAX_IP = 5;
const silencio = { info() {}, warn() {}, error() {} };

(async () => {
    const servidor = await MongoMemoryServer.create();
    await mongoose.connect(servidor.getUri());
    let http;
    try {
        // Latencia de red simulada (~5 ms por consulta, como una base de datos remota): sin ella el
        // motor en memoria responde tan rápido que las carreras de leer→guardar casi nunca se ven
        const espera = () => new Promise(r => setTimeout(r, 5));
        mongoose.plugin(sch => sch.pre(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'countDocuments'], espera).pre('save', espera));

        // ── Migración del índice viejo (no único) con duplicados ANTES de crear el modelo ──
        const raw = mongoose.connection.db.collection('descargaips');
        const jViejo = new mongoose.Types.ObjectId();
        await raw.createIndex({ juegoId: 1, ip: 1 });
        await raw.insertMany([{ juegoId: jViejo, ip: '9.9.9.9', contadorHoy: 2, fecha: new Date() }, { juegoId: jViejo, ip: '9.9.9.9', contadorHoy: 4, fecha: new Date() }]);

        const DescargaIP = ContadorIP.modelo(mongoose);
        const Pago = Retiros.modelo(mongoose);
        const Usuario = mongoose.model('Usuario', new mongoose.Schema({
            usuario: { type: String, unique: true }, saldo: { type: Number, default: 0 }, monedas: { type: Number, default: 0 },
            descargasTotales: { type: Number, default: 0 }, listaNegraAdmin: Boolean, solicitudPagoPendiente: Boolean,
            // mismos campos (y select: false) que el esquema real de index.js
            retirosAplicados: { type: [String], default: undefined, select: false }, comprasAplicadas: { type: [String], default: undefined, select: false }, retirosDevueltos: { type: [String], default: undefined, select: false },
            planHasta: Date, planId: String, planAvisadoHasta: Date, paseFondoUsd: Number, iaCreditos: Number,
            isVerificado: Boolean, verificadoNivel: Number, emailVerificado: Boolean, paypalEmail: String, cobro: mongoose.Schema.Types.Mixed,
        }));
        const Juego = mongoose.model('Juego', new mongoose.Schema({
            usuario: String, status: String, link: String, title: String, category: String, descargasEfectivas: { type: Number, default: 0 }, pagoPausado: Boolean,
            destacadoHasta: Date, promoUCDia: Number, promoNivel: String, comprasAplicadas: { type: [String], default: undefined, select: false },
        }));
        require('../rutas/live');   // crea el modelo real LiveTx (ref única)
        const LiveTx = mongoose.model('LiveTx');
        await LiveTx.init();
        DescargaIP.init().catch(() => {});   // el índice lo garantiza asegurarIndice (abajo)

        await test('migración: borra duplicados y deja el índice {juegoId, ip} ÚNICO', async () => {
            assert.strictEqual(await ContadorIP.asegurarIndice(DescargaIP, silencio), true);
            const idx = (await raw.indexes()).find(i => i.key.juegoId === 1 && i.key.ip === 1);
            assert.ok(idx?.unique, 'el índice debe ser único');
            const quedan = await raw.find({ juegoId: jViejo }).toArray();
            assert.strictEqual(quedan.length, 1);
            assert.strictEqual(quedan[0].contadorHoy, 4, 'conserva el registro con más descargas');
            assert.strictEqual(await ContadorIP.asegurarIndice(DescargaIP, silencio), true, 'idempotente');
        });

        // ── App real con rutas/economia.js ──
        let fraude = { suspicious: false };
        const app = express();
        app.set('trust proxy', true);   // la IP de cada petición sale de X-Forwarded-For
        app.use(express.json());
        const pasar = (req, res, next) => next();
        const conUsuario = (req, res, next) => { req.usuario = req.headers['x-usuario']; req.usuario ? next() : res.status(401).json({ success: false }); };
        const eco = require('../rutas/economia')({
            AUTHOR_PERCENTAGE: PARTE, CPM_VALUE: CPM, DescargaIP, EMAIL_NORMALIZE_OPTS: {}, JWT_SECRET: SECRETO, Juego,
            Limites: { permitir: async () => true, MIN: 60e3 }, MAX_DOWNLOADS_PER_IP_PER_DAY: MAX_IP, MIN_WITHDRAWAL: 10, Moderacion: {}, Pago, Referidos: {},
            StatsItems: { sumar() {} }, Usuario, app, body, calcularScoreRecomendacion: async () => {}, crearNotif() {},
            fraudDetector: { analyzeDownloadBehavior: async () => fraude, autoFlagUser: async (U, u) => { await U.updateOne({ usuario: u }, { $set: { listaNegraAdmin: true } }); return true; } },
            gamification: { onDescarga: async () => {}, onItemViral: async () => {} }, logger: silencio, mongoose,
            recommendations: { invalidateItemCache() {} }, usuarioOpcional: () => null, validationResult, verificarAdmin: pasar, verificarToken: conUsuario,
        });
        eco.vincularTarde({ cobros: { metodoDe: u => ({ tipo: 'paypal', resumen: 'PayPal · x', cifrado: 'c' }), esperaHasta: () => null }, live: { tieneIngresosLive: async () => true } });
        // Tienda real (rutas/tienda.js) con Mercado Pago simulado: COP a 4.000 por dólar, cambiable en la prueba
        const MP = require('../modulos/mercadopago');
        const mpPagos = new Map();
        const mpEnv = { MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-x', MERCADOPAGO_PUBLIC_KEY: 'APP_USR-pk', MERCADOPAGO_TASA_USD: '4000', MERCADOPAGO_WEBHOOK_SECRET: 'secreto-webhook-de-prueba' };
        let consultasPago = 0;
        const mp = MP.crear({ env: mpEnv, transporte: async (m, ruta) => {
            if (ruta === '/users/me') return { status: 200, data: { site_id: 'MCO' } };
            consultasPago++;
            const pg = mpPagos.get(ruta.split('/').pop());
            return pg ? { status: 200, data: pg } : { status: 404, data: {} };
        } });
        await mp.verificar();
        const Tienda = require('../rutas/tienda');
        Tienda.registrar(app, { verificarToken: conUsuario, Usuario, LiveTx, Notificacion: null, paypal: { activo: () => false }, acceso: {}, logger: silencio, apiUrlSelf: '', Juego, mp });
        http = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const url = `http://127.0.0.1:${http.address().port}/economia/validar-descarga`;
        const ticketPara = (juegoId, ip) => TicketPuente.emitir(SECRETO, String(juegoId), ip, Date.now() - TicketPuente.ESPERA_MS - 1000).ticket;
        // node:http, un socket por petición. En ráfaga: primero se conectan TODOS los sockets y luego
        // se envían todos los cuerpos en el mismo tick, para que el servidor los procese a la vez.
        const preparar = (juegoId, ip, ticket = ticketPara(juegoId, ip)) => {
            const datos = JSON.stringify({ juegoId: String(juegoId), ticket });
            let r;
            const respuesta = new Promise((ok, mal) => {
                r = require('http').request(url, { method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos), 'X-Forwarded-For': ip } }, res => {
                    let t = ''; res.on('data', c => t += c); res.on('end', () => { try { ok(JSON.parse(t)); } catch (e) { mal(e); } });
                });
                r.on('error', mal);
            });
            const conectado = new Promise(ok => r.on('socket', so => so.connecting ? so.once('connect', ok) : ok()));
            r.flushHeaders();
            return { conectado, enviar: () => r.end(datos), respuesta };
        };
        const rafaga = async peticiones => {
            await Promise.all(peticiones.map(p => p.conectado));
            peticiones.forEach(p => p.enviar());
            return Promise.all(peticiones.map(p => p.respuesta));
        };
        const descargar = (...a) => rafaga([preparar(...a)]).then(r => r[0]);
        const nuevoAutor = async (nombre, extra = {}) => {
            await Usuario.create({ usuario: nombre, saldo: 0, ...extra });
            return Juego.create({ usuario: nombre, status: 'aprobado', link: 'https://ejemplo.test/x', title: 'T', category: 'Juego' });
        };
        const saldo = async u => (await Usuario.findOne({ usuario: u }).lean()).saldo;

        await test('exploit: 60 peticiones simultáneas con el MISMO ticket cuentan solo el tope diario', async () => {
            const j = await nuevoAutor('ana');
            const ip = '10.0.0.1', ticket = ticketPara(j._id, ip);
            const r = await rafaga(Array.from({ length: 60 }, () => preparar(j._id, ip, ticket)));
            assert.ok(r.every(x => x.success && x.link), 'todas reciben el enlace (comportamiento actual)');
            assert.strictEqual(r.filter(x => x.descargaContada).length, MAX_IP);
            assert.strictEqual(r.filter(x => x.limiteAlcanzado).length, 60 - MAX_IP);
            assert.strictEqual((await DescargaIP.findOne({ juegoId: j._id, ip }).lean()).contadorHoy, MAX_IP);
            assert.strictEqual(await DescargaIP.countDocuments({ juegoId: j._id, ip }), 1, 'un solo registro por IP');
            const a = await Usuario.findOne({ usuario: 'ana' }).lean();
            cerca(a.saldo, MAX_IP * GANANCIA, 'saldo');
            assert.strictEqual(a.descargasTotales, MAX_IP);
            assert.strictEqual((await Juego.findById(j._id).lean()).descargasEfectivas, MAX_IP);
        });

        await test('primera descarga simultánea de una IP nueva: el choque del índice no se pierde ni se duplica', async () => {
            const j = await nuevoAutor('bea');
            const r = await rafaga(Array.from({ length: 2 }, () => preparar(j._id, '10.0.0.2')));
            assert.strictEqual(r.filter(x => x.descargaContada).length, 2, 'ambas bajo el tope cuentan');
            assert.strictEqual((await DescargaIP.findOne({ juegoId: j._id, ip: '10.0.0.2' }).lean()).contadorHoy, 2);
        });

        await test('ticket inválido o de otra IP: no cuenta ni paga', async () => {
            const j = await nuevoAutor('cris');
            const r1 = await descargar(j._id, '10.0.0.3', ticketPara(j._id, '10.0.0.99'));
            const r2 = await descargar(j._id, '10.0.0.3', 'zzz.falso');
            assert.ok(!r1.descargaContada && !r2.descargaContada);
            assert.strictEqual(await saldo('cris'), 0);
        });

        await test('descargas pagadas MIENTRAS se procesa el retiro: el pago no se “devuelve” y no se pierde ninguna ganancia', async () => {
            const j = await nuevoAutor('dani', { saldo: 10, solicitudPagoPendiente: true });
            const pago = await Pago.create({ usuario: 'dani', monto: 10, metodo: 'mercadopago' });
            const N = 40;
            const [rPago] = await Promise.all([
                Retiros.procesar({ Pago, Usuario }, pago._id, {}),
                ...Array.from({ length: N }, (_, i) => descargar(j._id, `10.1.0.${i}`)),
            ]);
            assert.strictEqual(rPago.codigo, 200);
            const d = await Usuario.findOne({ usuario: 'dani' }).lean();
            cerca(d.saldo, N * GANANCIA, 'saldo = ganancias nuevas (los US$10 ya pagados no vuelven)');
            assert.strictEqual(d.descargasTotales, N);
            assert.strictEqual(d.solicitudPagoPendiente, false);
        });

        await test('descargas pagadas MIENTRAS el autor gasta UpCoins ganados: el gasto no se deshace', async () => {
            const j = await nuevoAutor('eli', { saldo: 1 });
            const N = 30;
            const [cobro] = await Promise.all([UC.cobrar(Usuario, 'eli', 25), ...Array.from({ length: N }, (_, i) => descargar(j._id, `10.2.0.${i}`))]);
            assert.ok(cobro, 'el cobro de 25 UC se aplicó');
            cerca(await saldo('eli'), 1 - 25 * UC.UC_USD + N * GANANCIA, 'saldo');
        });

        await test('fraude auto-detectado: no se acredita ganancia pero sí cuenta la descarga', async () => {
            const j = await nuevoAutor('fran');
            fraude = { suspicious: true, autoFlag: true, reasons: ['prueba'] };
            try { await descargar(j._id, '10.3.0.1'); } finally { fraude = { suspicious: false }; }
            const f = await Usuario.findOne({ usuario: 'fran' }).lean();
            assert.strictEqual(f.saldo, 0);
            assert.strictEqual(f.descargasTotales, 1);
            assert.strictEqual(f.listaNegraAdmin, true);
        });

        // ── Retiros ──
        const retiro = async (u, monto, extra = {}) => {
            await Usuario.create({ usuario: u, saldo: monto, solicitudPagoPendiente: true });
            return Pago.create({ usuario: u, monto, metodo: 'paypal', paypalEmail: `${u}@pp.test`, ...extra });
        };

        await test('doble clic / dos admins: un retiro manual se procesa y descuenta UNA vez', async () => {
            const p = await retiro('gabi', 20);
            const r = await Promise.all(Array.from({ length: 10 }, () => Retiros.procesar({ Pago, Usuario }, p._id, {})));
            assert.strictEqual(r.filter(x => x.codigo === 200).length, 1);
            assert.strictEqual(r.filter(x => x.codigo === 409).length, 9);
            assert.strictEqual(await saldo('gabi'), 0);
            assert.strictEqual((await Pago.findById(p._id).lean()).estado, 'completado');
        });

        await test('PayPal con resultado DESCONOCIDO: no se marca fallido, no vuelve a la cola y el saldo no cambia', async () => {
            const p = await retiro('hugo', 15);
            const r = await Retiros.procesar({ Pago, Usuario }, p._id, { enviar: async () => { throw Object.assign(new Error('timeout'), { definitivo: false }); } });
            assert.strictEqual(r.codigo, 504); assert.ok(r.incierto);
            const doc = await Pago.findById(p._id).lean();
            assert.strictEqual(doc.estado, 'procesado'); assert.strictEqual(doc.revision, 'incierto');
            assert.strictEqual(await saldo('hugo'), 15);
            assert.strictEqual((await Retiros.procesar({ Pago, Usuario }, p._id, {})).codigo, 409, 'no se puede volver a pagar desde la cola');
            assert.ok((await Retiros.enRevision(Pago)).some(x => String(x._id) === String(p._id)), 'aparece en revisión');
        });

        await test('reconciliar “reintentar” reusa el MISMO lote de PayPal y descuenta una vez', async () => {
            const p = await retiro('ines', 12);
            const lotes = [];
            const pp = PayPal.crear({}, async () => 'tok', { transporte: async (m, path, b) => {
                lotes.push(b.sender_batch_header.sender_batch_id);
                if (lotes.length === 1) throw new Error('PayPal no respondió a tiempo');
                return { status: 201, data: { batch_header: { payout_batch_id: 'LOTE123ABC', batch_status: 'PENDING' } } };
            } });
            const enviar = x => pp.enviarPayout({ email: x.paypalEmail, monto: x.monto, pagoId: String(x._id) });
            assert.strictEqual((await Retiros.procesar({ Pago, Usuario }, p._id, { enviar })).codigo, 504);
            const r = await Retiros.reconciliar({ Pago, Usuario }, p._id, 'reintentar', { enviar });
            assert.strictEqual(r.codigo, 200);
            assert.deepStrictEqual(lotes, [`UPGAMES_${p._id}`, `UPGAMES_${p._id}`]);
            assert.strictEqual(await saldo('ines'), 0);
            const doc = await Pago.findById(p._id).lean();
            assert.strictEqual(doc.estado, 'completado'); assert.strictEqual(doc.payoutBatchId, 'LOTE123ABC');
        });

        await test('reintento que PayPal rechaza por lote repetido: sigue en revisión, sin descontar', async () => {
            const p = await retiro('jose', 11, { estado: 'procesado', revision: 'incierto', procesadoEn: new Date() });
            const r = await Retiros.reconciliar({ Pago, Usuario }, p._id, 'reintentar', { enviar: async () => { throw Object.assign(new Error('DUPLICATE'), { definitivo: false }); } });
            assert.strictEqual(r.codigo, 504);
            assert.strictEqual((await Pago.findById(p._id).lean()).estado, 'procesado');
            assert.strictEqual(await saldo('jose'), 11);
        });

        await test('rechazo DEFINITIVO de PayPal: vuelve a pendiente sin tocar el saldo y se puede procesar luego', async () => {
            const p = await retiro('kai', 9);
            const r = await Retiros.procesar({ Pago, Usuario }, p._id, { enviar: async () => { throw Object.assign(new Error('422'), { definitivo: true }); } });
            assert.strictEqual(r.codigo, 502);
            assert.strictEqual((await Pago.findById(p._id).lean()).estado, 'pendiente');
            assert.strictEqual(await saldo('kai'), 9);
            assert.strictEqual((await Retiros.procesar({ Pago, Usuario }, p._id, {})).codigo, 200);
            assert.strictEqual(await saldo('kai'), 0);
        });

        await test('caída entre descontar y completar: reconciliar (×10 en paralelo) completa sin descontar dos veces', async () => {
            const p = await retiro('lia', 30);
            await Usuario.updateOne({ usuario: 'lia' }, { $inc: { saldo: 5 } });   // ganó más mientras tanto
            await Pago.updateOne({ _id: p._id }, { $set: { estado: 'procesado', procesadoEn: new Date(Date.now() - Retiros.ATASCADO_MS - 1000) } });
            await Retiros.descontar(Usuario, p);   // …y el servidor “cae” aquí
            assert.ok((await Retiros.enRevision(Pago)).some(x => String(x._id) === String(p._id)), 'atascado → en revisión');
            assert.strictEqual((await Retiros.reconciliar({ Pago, Usuario }, p._id, 'anular')).codigo, 409, 'no se puede anular lo ya descontado');
            const r = await Promise.all(Array.from({ length: 10 }, () => Retiros.reconciliar({ Pago, Usuario }, p._id, 'confirmar')));
            assert.ok(r.some(x => x.codigo === 200));
            assert.strictEqual(await saldo('lia'), 5, 'solo se descontaron los US$30 una vez');
            assert.strictEqual((await Pago.findById(p._id).lean()).estado, 'completado');
        });

        await test('anular (el admin verificó que no salió): vuelve a la cola con el saldo intacto', async () => {
            const p = await retiro('mia', 14, { estado: 'procesado', revision: 'incierto', procesadoEn: new Date() });
            assert.strictEqual((await Retiros.reconciliar({ Pago, Usuario }, p._id, 'anular')).codigo, 200);
            assert.strictEqual((await Pago.findById(p._id).lean()).estado, 'pendiente');
            assert.strictEqual(await saldo('mia'), 14);
        });

        await test('consultar: completa solo si PayPal confirma SUCCESS', async () => {
            const p = await retiro('noa', 8, { estado: 'procesado', revision: 'incierto', procesadoEn: new Date(), payoutBatchId: 'LOTEX1' });
            let estado = { estado: 'PENDING', item: 'PENDING' };
            const consultar = async () => estado;
            assert.ok((await Retiros.reconciliar({ Pago, Usuario }, p._id, 'consultar', { consultar })).sinCambios);
            assert.strictEqual(await saldo('noa'), 8);
            estado = { estado: 'SUCCESS', item: 'SUCCESS' };
            assert.strictEqual((await Retiros.reconciliar({ Pago, Usuario }, p._id, 'consultar', { consultar })).codigo, 200);
            assert.strictEqual(await saldo('noa'), 0);
        });

        // ── PayPal Payouts: clasificación de errores ──
        await test('enviarPayout: solo es "definitivo" cuando es seguro que PayPal no creó el lote', async () => {
            const con = resp => PayPal.crear({}, async () => 't', { transporte: async () => { if (resp instanceof Error) throw resp; return resp; } });
            const enviar = pp => pp.enviarPayout({ email: 'a@b.c', monto: 1, pagoId: 'X' }).then(() => 'ok', e => e.definitivo);
            assert.strictEqual(await enviar(con({ status: 201, data: { batch_header: { payout_batch_id: 'B' } } })), 'ok');
            assert.strictEqual(await enviar(con({ status: 422, data: { name: 'INSUFFICIENT_FUNDS' } })), true);
            assert.strictEqual(await enviar(con({ status: 400, data: { name: 'USER_BUSINESS_ERROR', message: 'Batch with given sender_batch_id already exists' } })), false);
            assert.strictEqual(await enviar(con({ status: 500, data: {} })), false);
            assert.strictEqual(await enviar(con(new Error('socket hang up'))), false);
            const sinToken = PayPal.crear({}, async () => { throw new Error('invalid_client'); });
            assert.strictEqual(await enviar(sinToken), true, 'sin token no salió nada');
        });

        // ── Mercado Pago: pagos aprobados tarde ──
        await test('webhook MP: valida contra el monto COBRADO aunque la tasa o el precio cambien después', () => {
            const actual = () => ({ monto: 4500, usd: 1.1 });   // precio/tasa de hoy (cambiaron)
            assert.deepStrictEqual(montoMPValido({ monto: 4000, moneda: 'COP' }, { montoRef: '4000', usdRef: '1', moneda: 'COP', actual }), { ok: true, esperado: 4000, usd: 1 });
            assert.strictEqual(montoMPValido({ monto: 3000, moneda: 'COP' }, { montoRef: '4000', usdRef: '1', moneda: 'COP', actual }).ok, false, 'cobró menos');
            assert.strictEqual(montoMPValido({ monto: 4000, moneda: 'USD' }, { montoRef: '4000', usdRef: '1', moneda: 'COP', actual }).ok, false, 'otra moneda');
            assert.strictEqual(montoMPValido({ monto: 4500, moneda: 'COP' }, { montoRef: undefined, usdRef: undefined, moneda: 'COP', actual }).ok, true, 'referencia antigua: precio actual');
            assert.strictEqual(montoMPValido({ monto: 4000, moneda: 'COP' }, { montoRef: undefined, usdRef: undefined, moneda: 'COP', actual }).ok, false);
        });

        // ── Auditoría: carreras y entregas a medias encontradas después ──
        const Limites = require('../modulos/limites');
        const base = `http://127.0.0.1:${http.address().port}`;
        const postJSON = (ruta, cuerpo, usuario) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(usuario ? { 'x-usuario': usuario } : {}) }, body: JSON.stringify(cuerpo || {}) })
            .then(async r => ({ s: r.status, d: await r.json().catch(() => null) }));

        await test('Limites.permitir: 50 peticiones simultáneas no pasan del tope (antes leía y luego sumaba)', async () => {
            const r = await Promise.all(Array.from({ length: 50 }, () => Limites.permitir('prueba:tope', [[Limites.MIN, 5]])));
            assert.strictEqual(r.filter(Boolean).length, 5);
            assert.strictEqual(await Limites.leer('prueba:tope', Limites.MIN), 5, 'las denegadas no quedan contadas');
        });
        await test('Limites.permitir con dos reglas: lo denegado se deshace en ambas', async () => {
            const r = await Promise.all(Array.from({ length: 20 }, () => Limites.permitir('prueba:dos', [[Limites.MIN, 100], [Limites.HORA, 3]])));
            assert.strictEqual(r.filter(Boolean).length, 3);
            assert.strictEqual(await Limites.leer('prueba:dos', Limites.MIN), 3);
            assert.strictEqual(await Limites.leer('prueba:dos', Limites.HORA), 3);
        });
        await test('Limites.reservar: 30 intentos de contraseña a la vez → solo 5 se prueban', async () => {
            const r = await Promise.all(Array.from({ length: 30 }, () => Limites.reservar('prueba:clave', 15 * Limites.MIN, 5)));
            assert.strictEqual(r.filter(Boolean).length, 5);
        });

        await test('exploit: pedir el retiro y gastar UpCoins ganados a la vez nunca deja un monto mayor que el saldo', async () => {
            const N = 15;
            // US$15 ganados: con o sin el gasto de US$5 queda por encima del mínimo (US$10), así el retiro siempre se pide
            for (let i = 0; i < N; i++) await Usuario.create({ usuario: `ret${i}`, saldo: 15, isVerificado: true, verificadoNivel: 1, emailVerificado: true });
            await Promise.all(Array.from({ length: N }, (_, i) => Promise.all([
                postJSON('/economia/solicitar-pago', {}, `ret${i}`),
                // el gasto llega escalonado (0–42 ms) para caer en distintos puntos de la solicitud
                new Promise(r => setTimeout(r, i * 3)).then(() => UC.cobrar(Usuario, `ret${i}`, 250)),   // 250 UC = US$5 de lo ganado
            ])));
            for (let i = 0; i < N; i++) {
                const u = await Usuario.findOne({ usuario: `ret${i}` }).lean(), p = await Pago.findOne({ usuario: `ret${i}` }).lean();
                assert.ok(p, `ret${i}: el retiro se creó`);
                assert.ok(p.monto <= u.saldo + 1e-9, `ret${i}: retiro de US$${p.monto} con solo US$${u.saldo} de saldo (el gasto ya salió de ahí)`);
            }
            assert.ok(await Pago.countDocuments({ usuario: /^ret/ }) > 0, 'al menos algunos retiros se crearon');
        });

        await test('retiro anulado tras verificar que no salió: el siguiente envío usa un lote NUEVO; reintentar uno incierto, el MISMO', async () => {
            const p = await retiro('olga', 7);
            const lotes = [];
            const enviar = x => { lotes.push(Retiros.idLote(x)); return Promise.reject(Object.assign(new Error('timeout'), { definitivo: false })); };
            await Retiros.procesar({ Pago, Usuario }, p._id, { enviar });
            await Retiros.reconciliar({ Pago, Usuario }, p._id, 'reintentar', { enviar });
            assert.strictEqual(lotes[0], lotes[1], 'reintento = mismo lote');
            assert.strictEqual((await Retiros.reconciliar({ Pago, Usuario }, p._id, 'anular')).codigo, 200);
            const ok2 = await Retiros.procesar({ Pago, Usuario }, p._id, { enviar: async x => { lotes.push(Retiros.idLote(x)); return { batchId: 'LOTEN1' }; } });
            assert.strictEqual(ok2.codigo, 200);
            assert.notStrictEqual(lotes[2], lotes[0], 'tras anular, lote nuevo');
            assert.strictEqual(lotes[2], `${p._id}_1`);
            assert.strictEqual(await saldo('olga'), 0);
        });

        await test('compra: si la suma al usuario falla a medias, el reintento la termina y nunca acredita dos veces', async () => {
            await Usuario.create({ usuario: 'pia', monedas: 0 });
            const datos = { tipo: 'compra', usuario: 'pia', monedas: 500, usd: 10, ref: 'mp:9990001', estado: 'completada' };
            const aplicar = doc => Usuario.updateOne({ usuario: 'pia', ...UC.filtroCompra(datos.ref) }, { $inc: { monedas: doc.monedas }, $push: UC.pushCompra(datos.ref) });
            await assert.rejects(UC.entregarUnaVez(LiveTx, datos, () => { throw new Error('la base se cayó'); }));
            assert.strictEqual((await Usuario.findOne({ usuario: 'pia' }).lean()).monedas, 0);
            const r = await Promise.all(Array.from({ length: 10 }, () => UC.entregarUnaVez(LiveTx, datos, aplicar)));
            assert.strictEqual((await Usuario.findOne({ usuario: 'pia' }).lean()).monedas, 500, 'acreditada una sola vez');
            assert.ok(r.some(x => !x.repetida));
            assert.strictEqual((await LiveTx.findOne({ ref: datos.ref }).lean()).acreditada, true);
            const otra = await UC.entregarUnaVez(LiveTx, { ...datos, usuario: 'intruso' }, aplicar);
            assert.ok(otra.repetida, 'otra cuenta no puede reclamar la misma ref');
        });
        await test('compra registrada antes de este cambio (sin «acreditada»): se considera entregada, no se repite', async () => {
            await Usuario.create({ usuario: 'quim', monedas: 300 });
            await LiveTx.collection.insertOne({ tipo: 'compra', usuario: 'quim', monedas: 300, usd: 6, ref: 'paypal:VIEJA1', estado: 'completada', fecha: new Date() });
            const r = await UC.entregarUnaVez(LiveTx, { tipo: 'compra', usuario: 'quim', monedas: 300, usd: 6, ref: 'paypal:VIEJA1' }, () => Usuario.updateOne({ usuario: 'quim' }, { $inc: { monedas: 300 } }));
            assert.ok(r.repetida);
            assert.strictEqual((await Usuario.findOne({ usuario: 'quim' }).lean()).monedas, 300);
        });

        // Webhook de Mercado Pago contra las rutas reales de la tienda
        const webhook = (id, { enviarFirma = true, idCuerpo = id, idFirmado = id } = {}) => {
            const ts = String(Math.floor(Date.now() / 1000));
            const requestId = 'aviso-de-prueba';
            const v1 = require('node:crypto').createHmac('sha256', mpEnv.MERCADOPAGO_WEBHOOK_SECRET)
                .update(`id:${idFirmado};request-id:${requestId};ts:${ts};`).digest('hex');
            return fetch(`${base}/pagos/mercadopago/webhook?data.id=${id}&type=payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(enviarFirma ? { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` } : {}) },
                body: JSON.stringify({ type: 'payment', data: { id: idCuerpo } }),
            }).then(r => r.status);
        };
        await test('Mercado Pago rechaza antes de consultar si falta la firma o el ID firmado difiere', async () => {
            const antes = consultasPago;
            assert.strictEqual(await webhook('55500011', { enviarFirma: false }), 401);
            assert.strictEqual(await webhook('55500011', { idFirmado: '55500012' }), 401);
            assert.strictEqual(consultasPago, antes);
        });
        await test('Mercado Pago aprobado TARDE con otra tasa: se entrega lo cobrado, una sola vez aunque el aviso se repita', async () => {
            await Usuario.create({ usuario: 'rosa', monedas: 0 });
            const p = Tienda.parsear('monedas:p500'), usd = Tienda.precioUsd(p, 'tarjeta_mp');
            const cobrado = Math.ceil(usd * 4000 / 100) * 100;   // monto con la tasa del momento del pago
            mpEnv.MERCADOPAGO_TASA_USD = '4400';                 // la tasa cambió antes de que el banco aprobara
            mpPagos.set('55500011', { id: 55500011, status: 'approved', transaction_amount: cobrado, currency_id: 'COP', external_reference: `rosa|${p.id}|${cobrado}|${usd}` });
            const estados = await Promise.all([webhook('55500011', { idCuerpo: '55599999' }), webhook('55500011'), webhook('55500011')]);
            assert.deepStrictEqual(estados, [200, 200, 200]);
            assert.strictEqual((await Usuario.findOne({ usuario: 'rosa' }).lean()).monedas, p.paquete.monedas);
            mpEnv.MERCADOPAGO_TASA_USD = '4000';
        });
        await test('Mercado Pago: monto que no coincide con lo cobrado → no se entrega', async () => {
            await Usuario.create({ usuario: 'saul', monedas: 0 });
            const p = Tienda.parsear('monedas:p500'), usd = Tienda.precioUsd(p, 'tarjeta_mp');
            mpPagos.set('55500012', { id: 55500012, status: 'approved', transaction_amount: 100, currency_id: 'COP', external_reference: `saul|${p.id}|${Math.ceil(usd * 4000 / 100) * 100}|${usd}` });
            assert.strictEqual(await webhook('55500012'), 200);
            assert.strictEqual((await Usuario.findOne({ usuario: 'saul' }).lean()).monedas, 0);
        });
        await test('Mercado Pago: si la base falla al entregar, responde 500 (Mercado Pago reintenta) y el reintento entrega una vez', async () => {
            await Usuario.create({ usuario: 'tea', monedas: 0 });
            const p = Tienda.parsear('monedas:p500'), usd = Tienda.precioUsd(p, 'tarjeta_mp'), cobrado = Math.ceil(usd * 4000 / 100) * 100;
            mpPagos.set('55500013', { id: 55500013, status: 'approved', transaction_amount: cobrado, currency_id: 'COP', external_reference: `tea|${p.id}|${cobrado}|${usd}` });
            const orig = Usuario.updateOne;
            let fallar = true;
            Usuario.updateOne = function (...a) { if (fallar && a[0]?.usuario === 'tea') { fallar = false; return Promise.reject(new Error('Mongo no responde')); } return orig.apply(this, a); };
            try { assert.strictEqual(await webhook('55500013'), 500); }
            finally { Usuario.updateOne = orig; }
            assert.strictEqual((await Usuario.findOne({ usuario: 'tea' }).lean()).monedas, 0, 'a medias: aún sin entregar');
            assert.strictEqual(await webhook('55500013'), 200);
            assert.strictEqual(await webhook('55500013'), 200);
            assert.strictEqual((await Usuario.findOne({ usuario: 'tea' }).lean()).monedas, p.paquete.monedas, 'entregada una vez');
        });
        await test('rutas de dinero exigen sesión (401 sin usuario)', async () => {
            assert.strictEqual((await postJSON('/economia/solicitar-pago', {})).s, 401);
            assert.strictEqual((await postJSON('/tienda/pagar', { producto: 'monedas:p500', metodo: 'upcoins', clave: 'abcdefgh1' })).s, 401);
        });

        // ── Incidencias de payouts de PayPal ya completados (devuelto, no reclamado, rechazado…) ──
        const completado = async (u, monto, extra = {}) => {
            await Usuario.create({ usuario: u, saldo: 0, cobro: { tipo: 'paypal', resumen: 'PayPal · n•••@x', cifrado: 'c' }, paypalEmail: `${u}@pp.test` });
            return Pago.create({ usuario: u, monto, metodo: 'paypal', paypalEmail: `${u}@pp.test`, estado: 'completado', ...extra });
        };
        const metodo = { tipo: 'paypal', resumen: 'PayPal · nuevo', cifrado: 'c', paypalEmail: 'nuevo@pp.test' };

        await test('webhook repetido (×5 a la vez): una sola incidencia y un solo apunte en el historial', async () => {
            const p = await completado('ua', 20, { payoutBatchId: 'LOTEUA1' });
            await Promise.all(Array.from({ length: 5 }, () => Retiros.registrarEstadoPayPal(Pago, { batchId: 'LOTEUA1' }, { item: 'UNCLAIMED', itemId: 'ITEMUA1' }, { fuente: 'webhook' })));
            const d = await Pago.findById(p._id).lean();
            assert.strictEqual(d.incidencia.tipo, 'no_reclamado'); assert.strictEqual(d.incidencia.estado, 'abierta');
            assert.strictEqual(d.historial.filter(h => h.accion === 'paypal:UNCLAIMED').length, 1);
            assert.strictEqual(d.historial.filter(h => h.accion === 'incidencia:abierta').length, 1);
            assert.strictEqual(await saldo('ua'), 0, 'anotar nunca mueve dinero');
        });
        await test('NO RECLAMADO (resultado aún abierto): no se puede devolver el saldo ni reenviar', async () => {
            const p = await Pago.findOne({ usuario: 'ua' });
            for (const a of ['restaurar', 'reenviar']) assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, a, { confirmo: 20, metodo, por: 'adm' })).codigo, 409, a);
            assert.strictEqual(await saldo('ua'), 0);
            assert.strictEqual(await Pago.countDocuments({ usuario: 'ua' }), 1, 'no se creó un segundo pago');
        });
        await test('DEVUELTO: «devolver saldo» ×10 a la vez acredita una sola vez; repetir después → 409', async () => {
            const p = await Pago.findOne({ usuario: 'ua' });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'RETURNED', itemId: 'ITEMUA1' }, { fuente: 'consulta' });
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 19, por: 'adm' })).codigo, 400, 'confirmación con monto equivocado');
            const r = await Promise.all(Array.from({ length: 10 }, () => Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 20, por: 'adm' })));
            assert.ok(r.some(x => x.codigo === 200));
            assert.strictEqual(await saldo('ua'), 20, 'acreditado una vez');
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 20 })).codigo, 409);
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'reenviar', { confirmo: 20, metodo })).codigo, 409, 'devolver y reenviar son exclusivos');
            const d = await Pago.findById(p._id).lean();
            assert.strictEqual(d.incidencia.estado, 'resuelta'); assert.strictEqual(d.incidencia.resolucion, 'saldo_devuelto'); assert.strictEqual(d.incidencia.resueltaPor, 'adm');
        });
        await test('FALLIDO → «reenviar» ×5 a la vez: un solo retiro nuevo, saldo devuelto una vez y pagarlo lo vuelve a descontar', async () => {
            const p = await completado('ub', 15, { payoutBatchId: 'LOTEUB1' });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'FAILED', error: 'RECEIVER_UNREGISTERED: cuenta inexistente' }, { fuente: 'barrido' });
            const r = await Promise.all(Array.from({ length: 5 }, () => Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'reenviar', { confirmo: 15, metodo, por: 'adm' })));
            assert.ok(r.some(x => x.codigo === 200), JSON.stringify(r.map(x => x.error || x.codigo)));
            const nuevos = await Pago.find({ usuario: 'ub', estado: 'pendiente' }).lean();
            assert.strictEqual(nuevos.length, 1, 'un solo retiro nuevo');
            assert.strictEqual(nuevos[0].paypalEmail, 'nuevo@pp.test', 'usa el método de cobro actual');
            let u = await Usuario.findOne({ usuario: 'ub' }).lean();
            assert.strictEqual(u.saldo, 15); assert.strictEqual(u.solicitudPagoPendiente, true, 'el saldo queda reservado para el reenvío');
            assert.strictEqual(await UC.cobrar(Usuario, 'ub', 100), null, 'no puede gastar lo que se va a reenviar');
            assert.strictEqual((await Retiros.procesar({ Pago, Usuario }, nuevos[0]._id, {})).codigo, 200);
            u = await Usuario.findOne({ usuario: 'ub' }).lean();
            assert.strictEqual(u.saldo, 0); assert.strictEqual(u.solicitudPagoPendiente, false);
        });
        await test('reenviar con otro retiro ya pendiente → 409 y nada cambia; devolver el saldo sí funciona', async () => {
            const p = await completado('uc', 12, { payoutBatchId: 'LOTEUC1' });
            await Usuario.updateOne({ usuario: 'uc' }, { $set: { solicitudPagoPendiente: true } });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'REFUNDED' }, {});
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'reenviar', { confirmo: 12, metodo })).codigo, 409);
            assert.strictEqual(await saldo('uc'), 0);
            assert.ok(!(await Pago.findById(p._id).lean()).incidencia.resolucion, 'el reclamo se deshizo');
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 12 })).codigo, 200);
            assert.strictEqual(await saldo('uc'), 12);
        });
        await test('caída a medias al devolver el saldo: repetir termina sin acreditar dos veces', async () => {
            const p = await completado('ud', 9, { payoutBatchId: 'LOTEUD1' });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'REVERSED' }, {});
            // pasos 1 y 2 hechos (reclamo + saldo), el 3 (cerrar) no
            await Pago.updateOne({ _id: p._id }, { $set: { 'incidencia.resolucion': 'saldo_devuelto' } });
            await Usuario.updateOne({ usuario: 'ud' }, { $inc: { saldo: 9 }, $push: { retirosDevueltos: String(p._id) } });
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 9 })).codigo, 200);
            assert.strictEqual(await saldo('ud'), 9);
            assert.strictEqual((await Pago.findById(p._id).lean()).incidencia.estado, 'resuelta');
        });
        await test('pago MANUAL devuelto por el banco: incidencia a mano con evidencia; sin evidencia no', async () => {
            const p = await completado('ue', 30);
            assert.strictEqual((await Retiros.abrirIncidencia(Pago, p._id, { tipo: 'devuelto', evidencia: 'corto', por: 'adm' })).codigo, 400);
            assert.strictEqual((await Retiros.abrirIncidencia(Pago, p._id, { tipo: 'inventado', evidencia: 'Correo del banco del 20/11: transferencia devuelta', por: 'adm' })).codigo, 400);
            assert.strictEqual((await Retiros.abrirIncidencia(Pago, p._id, { tipo: 'devuelto', evidencia: 'Correo del banco del 20/11: transferencia devuelta', por: 'adm' })).codigo, 200);
            assert.strictEqual((await Retiros.abrirIncidencia(Pago, p._id, { tipo: 'devuelto', evidencia: 'Correo del banco del 20/11: transferencia devuelta', por: 'adm' })).codigo, 409, 'no se abre dos veces');
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 30, por: 'adm' })).codigo, 200);
            assert.strictEqual(await saldo('ue'), 30);
        });
        await test('cerrar sin mover dinero exige explicación; un payout automático con PayPal en SUCCESS no admite incidencia manual de dinero', async () => {
            const p = await completado('uf', 8, { payoutBatchId: 'LOTEUF1' });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'SUCCESS' }, {});
            assert.ok(!(await Pago.findById(p._id).lean()).incidencia, 'SUCCESS no abre incidencia');
            await Retiros.abrirIncidencia(Pago, p._id, { tipo: 'devuelto', evidencia: 'El creador dice que no le llegó el dinero', por: 'adm' });
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'restaurar', { confirmo: 8 })).codigo, 409, 'PayPal dice SUCCESS: sin evidencia de devolución');
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'cerrar', { nota: 'ok' })).codigo, 400);
            assert.strictEqual((await Retiros.resolverIncidencia({ Pago, Usuario }, p._id, 'cerrar', { nota: 'PayPal confirma que se cobró el 21/11', por: 'adm' })).codigo, 200);
            assert.strictEqual(await saldo('uf'), 0);
        });
        await test('retiro en revisión (incierto): la consulta anota el estado de PayPal pero no abre incidencia ni lo reenvía', async () => {
            const p = await retiro('ug', 6, { estado: 'procesado', revision: 'incierto', procesadoEn: new Date(), payoutBatchId: 'LOTEUG1' });
            await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, { item: 'UNCLAIMED' }, {});
            const d = await Pago.findById(p._id).lean();
            assert.strictEqual(d.paypal.estado, 'UNCLAIMED'); assert.ok(!d.incidencia); assert.strictEqual(d.estado, 'procesado');
        });
    } finally {
        http?.close();
        await mongoose.disconnect();
        await servidor.stop();
    }
    console.log(`\nconcurrenciaEconomia: ${passed} pruebas OK`);
})().catch(e => { console.error(e); process.exit(1); });
