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
async function finalizar({ Pago, Usuario }, pago, set = {}) {
    const descontado = await descontar(Usuario, pago);
    const p = await Pago.findOneAndUpdate({ _id: pago._id, estado: 'procesado' }, { $set: { estado: 'completado', revision: '', ...set } }, { new: true });
    return { codigo: 200, pago: p || pago, descontado };
}

/**
 * Procesa un retiro pendiente. `enviar(pago)` paga por PayPal (null = transferencia manual
 * hecha por el admin). Devuelve { codigo, ... }.
 */
async function procesar({ Pago, Usuario }, id, { enviar = null, notas = '', referencia = '' } = {}) {
    const pago = await Pago.findOneAndUpdate({ _id: id, estado: 'pendiente' },
        { $set: { estado: 'procesado', procesadoEn: new Date(), revision: '' } }, { new: true });
    if (!pago) {
        const existe = await Pago.exists({ _id: id });
        return fallo(existe ? 409 : 404, existe ? 'Este pago ya fue procesado (o se está procesando)' : 'Pago no encontrado');
    }
    const ref = referencia ? String(referencia).slice(0, 120) : undefined;
    if (!enviar) return finalizar({ Pago, Usuario }, pago, { notas: notas || `Pago procesado manualmente el ${new Date().toLocaleString('es-ES')}`, ...(ref ? { referencia: ref } : {}) });

    let r;
    try { r = await enviar(pago); }
    catch (e) {
        if (e.definitivo) {
            await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { estado: 'pendiente', revision: '' } });
            return fallo(502, `El pago no se pudo enviar vía PayPal: ${e.message}`, { detalle: 'PayPal lo rechazó: no se envió dinero y el saldo del usuario NO fue modificado.' });
        }
        await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { revision: 'incierto', notas: `Resultado desconocido de PayPal (${new Date().toISOString()}): ${String(e.message).slice(0, 200)}` } });
        return fallo(504, 'PayPal no confirmó el envío: el resultado es DESCONOCIDO. No lo pagues otra vez; reconcílialo en "Pagos en revisión".', { incierto: true });
    }
    return finalizar({ Pago, Usuario }, pago, {
        payoutBatchId: r.batchId || '',
        notas: notas || `Pago automático vía PayPal Payouts el ${new Date().toLocaleString('es-ES')}. Batch ID: ${r.batchId || 'N/A'}`,
        ...(ref ? { referencia: ref } : {}),
    });
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
async function reconciliar({ Pago, Usuario }, id, accion, { enviar = null, consultar = null, referencia = '', notas = '' } = {}) {
    const pago = await Pago.findOne({ _id: id, estado: 'procesado' });
    if (!pago) return fallo((await Pago.exists({ _id: id })) ? 409 : 404, 'Este pago no está en revisión');
    const ref = referencia ? { referencia: String(referencia).slice(0, 120) } : {};
    const nota = n => ({ notas: notas || `${n} el ${new Date().toLocaleString('es-ES')}` });

    if (accion === 'confirmar') return finalizar({ Pago, Usuario }, pago, { ...ref, ...nota('Reconciliado: el admin confirmó el envío') });
    if (accion === 'anular') {
        if (await yaDescontado(Usuario, pago)) return fallo(409, 'El saldo de este retiro ya se descontó: no se puede anular. Confírmalo.');
        const r = await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { estado: 'pendiente', revision: '', payoutBatchId: '' }, $inc: { intentoPayout: 1 } });
        return r.modifiedCount ? { codigo: 200, anulado: true } : fallo(409, 'El pago cambió mientras tanto');
    }
    if (accion === 'consultar') {
        if (!consultar || !pago.payoutBatchId) return fallo(409, 'No hay lote de PayPal para consultar: usa "reintentar" (no paga dos veces) o verifica en PayPal y confirma/anula.');
        const r = await consultar(pago.payoutBatchId);
        if (r.estado === 'SUCCESS' && (!r.item || r.item === 'SUCCESS')) return finalizar({ Pago, Usuario }, pago, nota('Reconciliado: PayPal confirmó el pago'));
        return { codigo: 200, sinCambios: true, paypal: r };
    }
    if (accion === 'reintentar') {
        if (!enviar) return fallo(409, 'Este retiro no se paga por PayPal automático');
        try {
            const r = await enviar(pago);
            return finalizar({ Pago, Usuario }, pago, { payoutBatchId: r.batchId || '', ...nota(`Reintento aceptado por PayPal. Batch ID: ${r.batchId || 'N/A'}`) });
        } catch (e) {
            // Aunque PayPal responda error, el primer envío pudo llegar: el retiro sigue en revisión
            await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { revision: 'incierto' } });
            return fallo(504, `PayPal: ${e.message}. Sigue en revisión: verifica en PayPal y confirma o anula.`, { incierto: true });
        }
    }
    return fallo(400, 'Acción no válida');
}

module.exports = { modelo, procesar, reconciliar, enRevision, descontar, finalizar, idLote, ATASCADO_MS };
