/**
 * Retiros de los creadores: procesar, reconciliar y recuperar pagos a medias, sin
 * transacciones de MongoDB (el despliegue no garantiza un replica set).
 *
 * Estados del Pago:
 *   pendiente ─(reclamo atómico)→ procesado ─→ completado
 *                                     └─(PayPal dijo NO con certeza / el admin anula)→ pendiente
 * `procesado` con `revision: 'incierto'` = se envió a PayPal y no se sabe si llegó. NUNCA se
 * marca como fallido ni se devuelve a la cola sola: un admin lo reconcilia.
 *
 * Idempotencia del descuento: el usuario guarda los ids de los retiros ya descontados
 * (`retirosAplicados`). Descontar y completar son dos escrituras; si el servidor cae entre
 * ambas, reconciliar repite el proceso y el descuento no se aplica dos veces.
 */
'use strict';

const MARCAS = 20;              // últimos retiros recordados por usuario (solo puede haber uno abierto a la vez)
const ATASCADO_MS = 10 * 60e3;  // un `procesado` sin terminar tras 10 min se considera a medias

function modelo(mongoose) {
    if (mongoose.models.Pago) return mongoose.models.Pago;
    const s = new mongoose.Schema({
        usuario:    { type: String, required: true, index: true },
        monto:      { type: Number, required: true, min: 0 },
        paypalEmail:{ type: String, default: '' },
        metodo:     { type: String, default: 'paypal' },   // paypal | mercadopago
        resumen:    { type: String, default: '' },         // método enmascarado (lo ve el usuario)
        datosCobro: { type: String, default: '' },         // datos completos cifrados (solo el admin al pagar)
        referencia: { type: String, default: '' },         // comprobante de la transferencia
        estado:     { type: String, enum: ['pendiente', 'procesado', 'completado', 'rechazado'], default: 'pendiente', index: true },
        fecha:      { type: Date, default: Date.now },
        notas:      { type: String, default: '' },
        procesadoEn:   { type: Date },                     // cuándo se reclamó para pagar
        revision:      { type: String, default: '' },      // 'incierto' = resultado de PayPal desconocido
        payoutBatchId: { type: String, default: '' },
        // Intento de PayPal: forma parte del sender_batch_id. Solo sube cuando un admin ANULA tras verificar
        // que el dinero no salió (PayPal no acepta reusar un sender_batch_id ya creado, aunque terminara rechazado).
        intentoPayout: { type: Number, default: 0 },
        // Lo último que PayPal dijo de este payout (consulta, barrido o webhook). Solo informa: nunca mueve dinero.
        paypal: {
            itemId: String, estado: String, batchEstado: String, error: String, procesado: String,
            actualizado: Date, fuente: String,   // consulta | barrido | webhook | cancelacion
        },
        // Incidencia de un payout ya completado (devuelto, no reclamado, fallido…): la resuelve un admin
        incidencia: {
            tipo: String, estado: String,          // estado: abierta | resuelta
            abierta: Date, fuente: String, motivo: String, evidencia: String, abiertaPor: String,
            resolucion: String,                    // saldo_devuelto | reenviado | cerrada
            reenvioPagoId: String, resueltaEn: Date, resueltaPor: String, nota: String,
        },
        historial: { type: [{ _id: false, fecha: Date, accion: String, por: String, detalle: String }], default: undefined },
    }, { timestamps: true });
    return mongoose.model('Pago', s);
}

const fallo = (codigo, error, extra = {}) => ({ codigo, error, ...extra });

/** Descuenta el retiro del saldo UNA sola vez y libera la marca de solicitud pendiente. */
async function descontar(Usuario, pago) {
    const id = String(pago._id);
    const r = await Usuario.updateOne({ usuario: pago.usuario, retirosAplicados: { $ne: id } }, [{ $set: {
        saldo: { $max: [0, { $subtract: [{ $ifNull: ['$saldo', 0] }, pago.monto] }] },
        solicitudPagoPendiente: false,
        retirosAplicados: { $slice: [{ $concatArrays: [{ $ifNull: ['$retirosAplicados', []] }, [id]] }, -MARCAS] },
    } }]);
    return r.modifiedCount > 0;
}
const yaDescontado = (Usuario, pago) => Usuario.exists({ usuario: pago.usuario, retirosAplicados: String(pago._id) });

/** Dinero confirmado como enviado: descontar (idempotente) y luego cerrar el Pago. */
async function finalizar({ Pago, Usuario }, pago, set = {}, por = '') {
    const descontado = await descontar(Usuario, pago);
    if (!descontado) await Usuario.updateOne({ usuario: pago.usuario }, { $set: { solicitudPagoPendiente: false } });   // ya descontado antes: igual se libera la marca
    const p = await Pago.findOneAndUpdate({ _id: pago._id, estado: 'procesado' }, { $set: { estado: 'completado', revision: '', ...set },
        $push: pushHist(evento('completado', por, set.payoutBatchId ? `PayPal · lote ${set.payoutBatchId}` : (set.notas || ''))) }, { new: true });
    return { codigo: 200, pago: p || pago, descontado };
}

/**
 * Procesa un retiro pendiente. `enviar(pago)` paga por PayPal (null = transferencia manual
 * hecha por el admin). Devuelve { codigo, ... }.
 */
async function procesar({ Pago, Usuario }, id, { enviar = null, notas = '', referencia = '', por = '' } = {}) {
    const pago = await Pago.findOneAndUpdate({ _id: id, estado: 'pendiente' },
        { $set: { estado: 'procesado', procesadoEn: new Date(), revision: '' }, $push: pushHist(evento('procesando', por, enviar ? 'PayPal automático' : 'manual')) }, { new: true });
    if (!pago) {
        const existe = await Pago.exists({ _id: id });
        return fallo(existe ? 409 : 404, existe ? 'Este pago ya fue procesado (o se está procesando)' : 'Pago no encontrado');
    }
    const ref = referencia ? String(referencia).slice(0, 120) : undefined;
    if (!enviar) return finalizar({ Pago, Usuario }, pago, { notas: notas || `Pago procesado manualmente el ${new Date().toLocaleString('es-ES')}`, ...(ref ? { referencia: ref } : {}) }, por);

    let r;
    try { r = await enviar(pago); }
    catch (e) {
        if (e.definitivo) {
            await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { estado: 'pendiente', revision: '' }, $push: pushHist(evento('rechazado_por_paypal', por, e.message)) });
            return fallo(502, `El pago no se pudo enviar vía PayPal: ${e.message}`, { detalle: 'PayPal lo rechazó: no se envió dinero y el saldo del usuario NO fue modificado.' });
        }
        await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { revision: 'incierto', notas: `Resultado desconocido de PayPal (${new Date().toISOString()}): ${String(e.message).slice(0, 200)}` }, $push: pushHist(evento('incierto', por, e.message)) });
        return fallo(504, 'PayPal no confirmó el envío: el resultado es DESCONOCIDO. No lo pagues otra vez; reconcílialo en "Pagos en revisión".', { incierto: true });
    }
    return finalizar({ Pago, Usuario }, pago, {
        payoutBatchId: r.batchId || '',
        notas: notas || `Pago automático vía PayPal Payouts el ${new Date().toLocaleString('es-ES')}. Batch ID: ${r.batchId || 'N/A'}`,
        ...(ref ? { referencia: ref } : {}),
    }, por);
}

/** Identificador del lote de PayPal para este retiro: estable entre reintentos, nuevo solo tras una anulación verificada. */
const idLote = pago => (pago.intentoPayout ? `${pago._id}_${pago.intentoPayout}` : String(pago._id));

/** Retiros a medias: resultado incierto o `procesado` desde hace más de 10 min. */
function enRevision(Pago, ahora = Date.now()) {
    return Pago.find({ estado: 'procesado', $or: [{ revision: 'incierto' }, { procesadoEn: { $lt: new Date(ahora - ATASCADO_MS) } }, { procesadoEn: { $exists: false } }] })
        .sort({ fecha: 1 }).lean();
}

/**
 * Reconciliar un retiro en `procesado`:
 *   consultar  → pregunta a PayPal por el lote; si está pagado, lo completa
 *   reintentar → reenvía con el MISMO lote (PayPal no paga dos veces el mismo sender_batch_id)
 *   confirmar  → el admin verificó que el dinero llegó: completar
 *   anular     → el admin verificó que NO se envió: vuelve a la cola de pendientes
 */
async function reconciliar({ Pago, Usuario }, id, accion, { enviar = null, consultar = null, referencia = '', notas = '', por = '' } = {}) {
    const pago = await Pago.findOne({ _id: id, estado: 'procesado' });
    if (!pago) return fallo((await Pago.exists({ _id: id })) ? 409 : 404, 'Este pago no está en revisión');
    const ref = referencia ? { referencia: String(referencia).slice(0, 120) } : {};
    const nota = n => ({ notas: notas || `${n} el ${new Date().toLocaleString('es-ES')}` });

    if (accion === 'confirmar') return finalizar({ Pago, Usuario }, pago, { ...ref, ...nota('Reconciliado: el admin confirmó el envío') }, por);
    if (accion === 'anular') {
        if (await yaDescontado(Usuario, pago)) return fallo(409, 'El saldo de este retiro ya se descontó: no se puede anular. Confírmalo.');
        const r = await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { estado: 'pendiente', revision: '', payoutBatchId: '' }, $inc: { intentoPayout: 1 }, $push: pushHist(evento('anulado', por, 'el admin verificó que no salió')) });
        return r.modifiedCount ? { codigo: 200, anulado: true } : fallo(409, 'El pago cambió mientras tanto');
    }
    if (accion === 'consultar') {
        if (!consultar || !pago.payoutBatchId) return fallo(409, 'No hay lote de PayPal para consultar: usa "reintentar" (no paga dos veces) o verifica en PayPal y confirma/anula.');
        const r = await consultar(pago.payoutBatchId);
        if (r.estado === 'SUCCESS' && (!r.item || r.item === 'SUCCESS')) return finalizar({ Pago, Usuario }, pago, nota('Reconciliado: PayPal confirmó el pago'), por);
        return { codigo: 200, sinCambios: true, paypal: r };
    }
    if (accion === 'reintentar') {
        if (!enviar) return fallo(409, 'Este retiro no se paga por PayPal automático');
        try {
            const r = await enviar(pago);
            return finalizar({ Pago, Usuario }, pago, { payoutBatchId: r.batchId || '', ...nota(`Reintento aceptado por PayPal. Batch ID: ${r.batchId || 'N/A'}`) }, por);
        } catch (e) {
            // Aunque PayPal responda error, el primer envío pudo llegar: el retiro sigue en revisión
            await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { revision: 'incierto' } });
            return fallo(504, `PayPal: ${e.message}. Sigue en revisión: verifica en PayPal y confirma o anula.`, { incierto: true });
        }
    }
    return fallo(400, 'Acción no válida');
}

// ═══════════════ Incidencias de payouts de PayPal (después de completar) ═══════════════
// Estados reales de un ítem de PayPal Payouts (transaction_status).
const TIPO = { FAILED: 'fallido', RETURNED: 'devuelto', UNCLAIMED: 'no_reclamado', BLOCKED: 'bloqueado', REFUNDED: 'reembolsado',
    REVERSED: 'revertido', ONHOLD: 'retenido', DENIED: 'rechazado' };
// El dinero está de vuelta en la cuenta de UpGames: solo entonces se puede devolver el saldo o reenviar
const DINERO_DEVUELTO = new Set(['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED']);
const MARCAS_DEV = 50;
const evento = (accion, por, detalle = '') => ({ fecha: new Date(), accion, por: String(por || 'sistema').slice(0, 40), detalle: String(detalle).slice(0, 400) });
const pushHist = e => ({ historial: { $each: [e], $slice: -100 } });

/**
 * Anota lo que PayPal dice de un payout (por id del Pago o por payoutBatchId) y, si es un problema, abre
 * la incidencia (una sola vez). Idempotente: el mismo estado repetido (webhook duplicado) no cambia nada.
 * NUNCA mueve dinero. → { cambiado, incidenciaAbierta }
 */
async function registrarEstadoPayPal(Pago, { pagoId, batchId }, info, { fuente = 'consulta', por = 'sistema' } = {}) {
    const item = String(info.item || info.estado || '').toUpperCase();
    const batch = String(info.estado || '').toUpperCase();
    const estadoFinal = item || batch;
    if (!estadoFinal) return { cambiado: false };
    const filtro = pagoId ? { _id: pagoId } : { payoutBatchId: batchId };
    if (!pagoId && !batchId) return { cambiado: false };
    const r = await Pago.updateOne({ ...filtro, 'paypal.estado': { $ne: estadoFinal } }, {
        $set: { 'paypal.estado': estadoFinal, 'paypal.batchEstado': batch, 'paypal.itemId': info.itemId || '', 'paypal.error': info.error || '',
            'paypal.procesado': info.procesado || '', 'paypal.actualizado': new Date(), 'paypal.fuente': fuente },
        $push: pushHist(evento(`paypal:${estadoFinal}`, por, `${fuente}${info.error ? ' · ' + info.error : ''}`)),
    });
    let incidenciaAbierta = false;
    const tipo = TIPO[estadoFinal] || (batch === 'DENIED' ? 'rechazado' : '');
    if (tipo) {
        const a = await Pago.updateOne({ ...filtro, estado: 'completado', 'incidencia.estado': { $exists: false } }, {
            $set: { incidencia: { tipo, estado: 'abierta', abierta: new Date(), fuente, motivo: info.error || `PayPal: ${estadoFinal}` } },
            $push: pushHist(evento('incidencia:abierta', por, `${tipo} (${fuente})`)),
        });
        incidenciaAbierta = a.modifiedCount > 0;
    }
    return { cambiado: r.modifiedCount > 0, incidenciaAbierta };
}

/** Abre una incidencia a mano (p. ej. pago manual que el banco devolvió). Exige evidencia. */
async function abrirIncidencia(Pago, id, { tipo, evidencia, por }) {
    if (!Object.values(TIPO).includes(tipo)) return fallo(400, 'Tipo de incidencia no válido');
    if (String(evidencia || '').trim().length < 10) return fallo(400, 'Describe la evidencia (mínimo 10 caracteres): comprobante, correo de PayPal o del banco…');
    const p = await Pago.findOneAndUpdate({ _id: id, estado: 'completado', 'incidencia.estado': { $exists: false } }, {
        $set: { incidencia: { tipo, estado: 'abierta', abierta: new Date(), fuente: 'admin', motivo: 'Abierta por un administrador', evidencia: String(evidencia).trim().slice(0, 600), abiertaPor: por } },
        $push: pushHist(evento('incidencia:abierta', por, `${tipo} · ${String(evidencia).trim().slice(0, 200)}`)),
    }, { new: true }).lean();
    if (!p) return fallo((await Pago.exists({ _id: id })) ? 409 : 404, 'Solo un retiro completado y sin incidencia puede abrir una');
    return { codigo: 200, pago: p };
}

/**
 * ¿Se puede mover dinero en esta incidencia? Solo con evidencia de que el dinero volvió:
 *  - payout automático: PayPal dice FAILED/RETURNED/BLOCKED/REFUNDED/REVERSED/DENIED
 *  - pago manual (sin lote de PayPal): incidencia abierta por un admin con evidencia
 * Con UNCLAIMED, ONHOLD o PENDING el resultado aún está abierto: NO (primero cancelar o esperar).
 */
function dineroDevuelto(p) {
    if (p.payoutBatchId) return DINERO_DEVUELTO.has(String(p.paypal?.estado || '').toUpperCase());
    return p.incidencia?.fuente === 'admin' && !!p.incidencia?.evidencia;
}

/**
 * Resolver una incidencia abierta. Acciones (exclusivas entre sí; repetirlas termina lo que faltó y nunca
 * duplica dinero):
 *   restaurar → devuelve el monto al saldo del creador (una sola vez: marca `retirosDevueltos`)
 *   reenviar  → devuelve el saldo y crea un retiro PENDIENTE nuevo (método de cobro actual) que se paga por
 *               el flujo normal, con su propio lote de PayPal; si se rechaza, el saldo queda con el creador
 *   cerrar    → sin mover dinero (el creador confirmó que lo recibió, PayPal lo completó después…)
 * `confirmo` debe ser el monto exacto para restaurar/reenviar (confirmación del lado del servidor).
 */
async function resolverIncidencia({ Pago, Usuario }, id, accion, { por = '', nota = '', confirmo, metodo = null, nuevoId } = {}) {
    const p = await Pago.findOne({ _id: id }).lean();
    if (!p) return fallo(404, 'Pago no encontrado');
    if (p.estado !== 'completado' || p.incidencia?.estado !== 'abierta') return fallo(409, p.incidencia?.estado === 'resuelta' ? `Esta incidencia ya se resolvió (${p.incidencia.resolucion})` : 'Este retiro no tiene una incidencia abierta');
    const resol = { restaurar: 'saldo_devuelto', reenviar: 'reenviado', cerrar: 'cerrada' }[accion];
    if (!resol) return fallo(400, 'Acción no válida');
    if (p.incidencia.resolucion && p.incidencia.resolucion !== resol) return fallo(409, `La incidencia ya se está resolviendo como «${p.incidencia.resolucion}»`);
    if (accion === 'cerrar') {
        if (String(nota || '').trim().length < 10) return fallo(400, 'Explica por qué se cierra sin mover dinero (mínimo 10 caracteres)');
        const r = await Pago.updateOne({ _id: id, 'incidencia.estado': 'abierta', 'incidencia.resolucion': { $in: [null, 'cerrada'] } }, {
            $set: { 'incidencia.resolucion': 'cerrada', 'incidencia.estado': 'resuelta', 'incidencia.resueltaEn': new Date(), 'incidencia.resueltaPor': por, 'incidencia.nota': String(nota).trim().slice(0, 400) },
            $push: pushHist(evento('incidencia:cerrada', por, String(nota).trim())) });
        return r.modifiedCount ? { codigo: 200, resolucion: 'cerrada' } : fallo(409, 'La incidencia cambió mientras tanto');
    }
    if (!dineroDevuelto(p)) return fallo(409, p.payoutBatchId
        ? `PayPal no confirma que el dinero volvió (estado: ${p.paypal?.estado || 'desconocido'}). Consulta PayPal; si está NO RECLAMADO, cancélalo primero.`
        : 'Falta evidencia de que el dinero volvió');
    if (Math.abs(Number(confirmo) - p.monto) > 1e-6) return fallo(400, `Para confirmar escribe el monto exacto: ${p.monto}`);
    if (accion === 'reenviar' && !metodo) return fallo(409, 'El creador no tiene método de cobro configurado: devuelve el saldo en su lugar');
    nuevoId = String(nuevoId || new (require('mongoose').Types.ObjectId)());
    const sid = String(p._id);

    // 1) Reclamo (exclusivo con las otras acciones). En reenviar, el id del retiro nuevo se fija aquí una sola vez.
    const claim = await Pago.findOneAndUpdate({ _id: id, 'incidencia.estado': 'abierta', 'incidencia.resolucion': { $in: [null, resol] } },
        [{ $set: { 'incidencia.resolucion': resol, ...(accion === 'reenviar' ? { 'incidencia.reenvioPagoId': { $ifNull: ['$incidencia.reenvioPagoId', String(nuevoId)] } } : {}) } }], { new: true }).lean();
    if (!claim) return fallo(409, 'La incidencia cambió mientras tanto');

    // 2) Devolver el saldo UNA vez (marca en el usuario). Reenviar además pone la marca de retiro pendiente
    //    en la misma operación, para que el creador no gaste ese saldo mientras se paga el reenvío.
    const yaDevuelto = await Usuario.exists({ usuario: p.usuario, retirosDevueltos: sid });
    if (!yaDevuelto) {
        const filtro = { usuario: p.usuario, retirosDevueltos: { $ne: sid }, ...(accion === 'reenviar' ? { solicitudPagoPendiente: { $ne: true } } : {}) };
        const u = await Usuario.updateOne(filtro, { $inc: { saldo: p.monto }, ...(accion === 'reenviar' ? { $set: { solicitudPagoPendiente: true } } : {}),
            $push: { retirosDevueltos: { $each: [sid], $slice: -MARCAS_DEV } } });
        if (!u.modifiedCount && !(await Usuario.exists({ usuario: p.usuario, retirosDevueltos: sid }))) {
            await Pago.updateOne({ _id: id, 'incidencia.resolucion': resol, 'incidencia.estado': 'abierta' }, { $unset: { 'incidencia.resolucion': 1, 'incidencia.reenvioPagoId': 1 } });
            return fallo(409, accion === 'reenviar' ? 'El creador ya tiene otro retiro pendiente: devuelve el saldo en su lugar o espera a que se procese' : 'No se encontró la cuenta del creador');
        }
    }

    // 3) Reenviar: retiro pendiente nuevo (id fijo: repetir no crea otro)
    if (accion === 'reenviar') {
        const nid = claim.incidencia.reenvioPagoId;
        try {
            await Pago.create({ _id: nid, usuario: p.usuario, monto: p.monto, metodo: metodo.tipo, resumen: metodo.resumen, datosCobro: metodo.cifrado,
                paypalEmail: metodo.tipo === 'paypal' ? (metodo.paypalEmail || '') : '', estado: 'pendiente',
                notas: `Reenvío del retiro ${sid} (${p.incidencia.tipo})`, historial: [evento('creado:reenvio', por, `del retiro ${sid}`)] });
        } catch (e) { if (e.code !== 11000) throw e; }
    }

    // 4) Cerrar la incidencia
    await Pago.updateOne({ _id: id, 'incidencia.estado': 'abierta' }, {
        $set: { 'incidencia.estado': 'resuelta', 'incidencia.resueltaEn': new Date(), 'incidencia.resueltaPor': por, 'incidencia.nota': String(nota || '').trim().slice(0, 400) },
        $push: pushHist(evento(`incidencia:${resol}`, por, `${p.monto} USD${accion === 'reenviar' ? ' · nuevo retiro ' + claim.incidencia.reenvioPagoId : ''}${nota ? ' · ' + String(nota).trim() : ''}`)) });
    return { codigo: 200, resolucion: resol, reenvioPagoId: claim.incidencia?.reenvioPagoId || null, saldoDevuelto: !yaDevuelto };
}

/** Incidencias para el panel (abiertas primero) + estado de PayPal. */
function incidencias(Pago, { soloAbiertas = false } = {}) {
    return Pago.find(soloAbiertas ? { 'incidencia.estado': 'abierta' } : { 'incidencia.estado': { $exists: true } })
        .sort({ 'incidencia.estado': 1, 'incidencia.abierta': -1 }).limit(200).select('-datosCobro').lean();
}

module.exports = { modelo, procesar, reconciliar, enRevision, descontar, finalizar, idLote, ATASCADO_MS,
    registrarEstadoPayPal, abrirIncidencia, resolverIncidencia, incidencias, dineroDevuelto, TIPO, DINERO_DEVUELTO };
