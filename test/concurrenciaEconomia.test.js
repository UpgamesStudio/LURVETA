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
            retirosAplicados: { type: [String], default: undefined }, planHasta: Date,
        }));
        const Juego = mongoose.model('Juego', new mongoose.Schema({
            usuario: String, status: String, link: String, title: String, category: String, descargasEfectivas: { type: Number, default: 0 }, pagoPausado: Boolean,
        }));
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
        require('../rutas/economia')({
            AUTHOR_PERCENTAGE: PARTE, CPM_VALUE: CPM, DescargaIP, EMAIL_NORMALIZE_OPTS: {}, JWT_SECRET: SECRETO, Juego,
            Limites: { permitir: async () => true, MIN: 60e3 }, MAX_DOWNLOADS_PER_IP_PER_DAY: MAX_IP, MIN_WITHDRAWAL: 10, Moderacion: {}, Pago, Referidos: {},
            StatsItems: { sumar() {} }, Usuario, app, body, calcularScoreRecomendacion: async () => {}, crearNotif() {},
            fraudDetector: { analyzeDownloadBehavior: async () => fraude, autoFlagUser: async (U, u) => { await U.updateOne({ usuario: u }, { $set: { listaNegraAdmin: true } }); return true; } },
            gamification: { onDescarga: async () => {}, onItemViral: async () => {} }, logger: silencio, mongoose,
            recommendations: { invalidateItemCache() {} }, usuarioOpcional: () => null, validationResult, verificarAdmin: pasar, verificarToken: pasar,
        });
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
    } finally {
        http?.close();
        await mongoose.disconnect();
        await servidor.stop();
    }
    console.log(`\nconcurrenciaEconomia: ${passed} pruebas OK`);
})().catch(e => { console.error(e); process.exit(1); });
