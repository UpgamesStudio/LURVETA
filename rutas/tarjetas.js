/**
 * Tarjetas de pago guardadas y procesamiento de retiros (finanzas)
 *
 * Tarjetas del usuario (listar, eliminar, principal), su gestión en el panel admin y
 * la cola de solicitudes de retiro: procesar o rechazar pagos a los creadores.
 * Extraído de index.js: recibe sus dependencias explícitas (ver la llamada en index.js).
 */
module.exports = function tarjetas({ Juego, Pago, Usuario, app, body, config, paypalPayouts, gamification, logger, mongoose, param, validationResult, verificarAdmin, verificarToken }) {
app.get('/economia/mis-tarjetas', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario }).select('tarjetas').lean();
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, tarjetas: usuario.tarjetas || [] });
    } catch (error) {
        logger.error(`Error en mis-tarjetas: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener tarjetas' });
    }
});

// POST /economia/agregar-tarjeta — RETIRADO: con los últimos 4 dígitos no se puede pagar a nadie.
// Los creadores configuran dónde cobrar en /economia/metodo-cobro (rutas/cobros.js).
app.post('/economia/agregar-tarjeta', verificarToken, (req, res) => res.status(410).json({ success: false, error: 'Ya no se registran tarjetas. Configura tu método de cobro (PayPal o Mercado Pago) en Economía.' }));

// DELETE /economia/eliminar-tarjeta/:tarjetaId — eliminar una tarjeta
app.delete('/economia/eliminar-tarjeta/:tarjetaId', verificarToken, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const result = await Usuario.updateOne(
            { usuario: req.usuario },
            { $pull: { tarjetas: { _id: new mongoose.Types.ObjectId(tarjetaId) } } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
        logger.info(`Tarjeta eliminada - @${req.usuario} | id: ${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta eliminada' });
    } catch (error) {
        logger.error(`Error en eliminar-tarjeta: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al eliminar tarjeta' });
    }
});

// PUT /economia/tarjeta-principal/:tarjetaId — establecer tarjeta como principal
app.put('/economia/tarjeta-principal/:tarjetaId', verificarToken, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const usuario = await Usuario.findOne({ usuario: req.usuario }).select('tarjetas');
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });

        const existe = (usuario.tarjetas || []).some(t => t._id.toString() === tarjetaId);
        if (!existe) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });

        // Quitar principal de todas, poner en la seleccionada
        usuario.tarjetas.forEach(t => { t.esPrincipal = t._id.toString() === tarjetaId; });
        await usuario.save();
        res.json({ success: true, mensaje: 'Tarjeta principal actualizada' });
    } catch (error) {
        logger.error(`Error en tarjeta-principal: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar tarjeta principal' });
    }
});

// ── ADMIN TARJETAS ────────────────────────────────────────────────────────────

// GET /admin/finanzas/tarjetas — todas las tarjetas de todos los usuarios (admin)
app.get('/admin/finanzas/tarjetas', verificarAdmin, async (req, res) => {
    try {
        const usuarios = await Usuario.find({ 'tarjetas.0': { $exists: true } })
            .select('usuario tarjetas')
            .lean();
        // Aplanar: cada tarjeta lleva el campo usuario
        const tarjetas = [];
        for (const u of usuarios) {
            for (const t of u.tarjetas || []) {
                tarjetas.push({ ...t, usuario: u.usuario });
            }
        }
        tarjetas.sort((a, b) => new Date(b.fechaAgregada) - new Date(a.fechaAgregada));
        res.json({ success: true, tarjetas, total: tarjetas.length });
    } catch (error) {
        logger.error(`Error en admin/tarjetas: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener tarjetas' });
    }
});

// DELETE /admin/finanzas/tarjetas/:tarjetaId — eliminar tarjeta de cualquier usuario (admin)
app.delete('/admin/finanzas/tarjetas/:tarjetaId', verificarAdmin, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const result = await Usuario.updateOne(
            { 'tarjetas._id': new mongoose.Types.ObjectId(tarjetaId) },
            { $pull: { tarjetas: { _id: new mongoose.Types.ObjectId(tarjetaId) } } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
        logger.info(`Admin eliminó tarjeta id:${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta eliminada por admin' });
    } catch (error) {
        logger.error(`Error en admin/eliminar-tarjeta: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al eliminar tarjeta' });
    }
});

// PUT /admin/finanzas/tarjetas/:tarjetaId/principal — cambiar tarjeta principal (admin)
app.put('/admin/finanzas/tarjetas/:tarjetaId/principal', verificarAdmin, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const { usuario } = req.body;
        if (!usuario) return res.status(400).json({ success: false, error: 'Se requiere el campo usuario' });
        const u = await Usuario.findOne({ usuario });
        if (!u) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const existe = (u.tarjetas || []).some(t => t._id.toString() === tarjetaId);
        if (!existe) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada para este usuario' });
        u.tarjetas.forEach(t => { t.esPrincipal = t._id.toString() === tarjetaId; });
        await u.save();
        logger.info(`Admin cambió tarjeta principal de @${usuario} → ${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta principal actualizada por admin' });
    } catch (error) {
        logger.error(`Error en admin/tarjeta-principal: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar tarjeta principal' });
    }
});

app.get('/admin/finanzas/solicitudes-pendientes', verificarAdmin, async (req, res) => {
    try {
        const solicitudes = await Pago.find({ estado: 'pendiente' }).sort({ fecha: -1 }).lean();
        const usernames = solicitudes.map(s => s.usuario);
        const [usuariosData, juegosAgg] = await Promise.all([
            Usuario.find({ usuario: { $in: usernames } }).select('usuario email verificadoNivel isVerificado descargasTotales').lean(),
            Juego.aggregate([{ $match: { usuario: { $in: usernames }, descargasEfectivas: { $gt: 0 } } }, { $group: { _id: '$usuario', count: { $sum: 1 } } }])
        ]);
        const usuarioMap = Object.fromEntries(usuariosData.map(u => [u.usuario, u]));
        const juegosMap  = Object.fromEntries(juegosAgg.map(j => [j._id, j.count]));
        const solicitudesEnriquecidas = solicitudes.map(s => ({ ...s, datosUsuario: { email: usuarioMap[s.usuario]?.email || '', verificadoNivel: usuarioMap[s.usuario]?.verificadoNivel || 0, isVerificado: usuarioMap[s.usuario]?.isVerificado || false, descargasTotales: usuarioMap[s.usuario]?.descargasTotales || 0, juegosElegibles: juegosMap[s.usuario] || 0 } }));
        const enRevision = await Pago.countDocuments({ estado: 'procesado' }).catch(() => 0);   // a medias o inciertos: GET /admin/finanzas/pagos-en-revision
        res.json({ success: true, solicitudes: solicitudesEnriquecidas, total: solicitudesEnriquecidas.length, enRevision });
    } catch (error) {
        logger.error(`Error en solicitudes-pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar solicitudes" });
    }
});

// Retiros: reclamo atómico, envío idempotente a PayPal y recuperación de pagos a medias (modulos/retiros.js)
const Retiros = require('../modulos/retiros');
const esAutomatico = p => config.FEATURES.ENABLE_AUTO_PAYMENTS && (p.metodo || 'paypal') === 'paypal' && !!p.paypalEmail;
const enviarPayPal = p => paypalPayouts.enviarPayout({ email: p.paypalEmail, monto: p.monto, pagoId: Retiros.idLote(p) });
const resumenPago = p => ({ usuario: p.usuario, monto: p.monto, paypalEmail: p.paypalEmail, fecha: p.fecha });

app.post('/admin/finanzas/procesar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('notas').optional().trim(), body('referencia').optional().trim().isLength({ max: 120 })], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID inválido" });
        const { id } = req.params;
        // Payouts automáticos solo existen para PayPal; Mercado Pago lo transfiere el admin
        const previo = await Pago.findById(id).select('metodo paypalEmail').lean();
        const automatico = !!previo && esAutomatico(previo);
        const r = await Retiros.procesar({ Pago, Usuario }, id, { enviar: automatico ? enviarPayPal : null, notas: req.body.notas, referencia: req.body.referencia, por: req.admin?.usuario || '' });
        if (r.codigo !== 200) {
            logger[r.incierto ? 'error' : 'warn'](`procesar-pago ${id}: ${r.error}`);
            const { codigo, ...resto } = r;
            return res.status(codigo).json({ success: false, ...resto });
        }
        const pago = r.pago;
        if (r.descontado) gamification.onPagoRecibido(pago.usuario, pago.monto).catch(() => {});
        logger.info(`Pago procesado [${automatico ? `paypal_auto (batch: ${pago.payoutBatchId})` : 'manual'}] - @${pago.usuario}, Monto: $${pago.monto.toFixed(2)}`);
        res.json({ success: true, mensaje: automatico ? `Pago enviado automáticamente vía PayPal a ${pago.paypalEmail}` : "Pago marcado como procesado manualmente", metodo: automatico ? 'paypal_automatico' : 'manual', paypalBatchId: pago.payoutBatchId || null, pago: resumenPago(pago) });
    } catch (error) {
        logger.error(`Error en procesar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar pago" });
    }
});

// Pagos a medias o con resultado desconocido de PayPal: listar y reconciliar
app.get('/admin/finanzas/pagos-en-revision', verificarAdmin, async (req, res) => {
    try { const lista = await Retiros.enRevision(Pago); res.json({ success: true, pagos: lista, total: lista.length }); }
    catch (e) { logger.error(`pagos-en-revision: ${e.message}`); res.status(500).json({ success: false, error: 'Error al cargar' }); }
});
app.post('/admin/finanzas/reconciliar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('accion').isIn(['consultar', 'reintentar', 'confirmar', 'anular']), body('referencia').optional().trim().isLength({ max: 120 }), body('notas').optional().trim()], async (req, res) => {
    try {
        if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const previo = await Pago.findById(req.params.id).select('metodo paypalEmail').lean();
        const automatico = !!previo && esAutomatico(previo);
        const r = await Retiros.reconciliar({ Pago, Usuario }, req.params.id, req.body.accion, {
            enviar: automatico ? enviarPayPal : null,
            consultar: automatico ? async b => { const r = await paypalPayouts.consultarPayout(b); await Retiros.registrarEstadoPayPal(Pago, { pagoId: req.params.id }, r, { fuente: 'consulta', por: quien(req) }); return r; } : null,
            referencia: req.body.referencia, notas: req.body.notas, por: req.admin?.usuario || '',
        });
        const { codigo, pago, ...resto } = r;
        if (codigo !== 200) return res.status(codigo).json({ success: false, ...resto });
        if (r.descontado) gamification.onPagoRecibido(pago.usuario, pago.monto).catch(() => {});
        logger.warn(`[retiros] reconciliar ${req.params.id} (${req.body.accion}) por @${req.admin?.usuario || '?'}: ${pago?.estado || (r.anulado ? 'pendiente' : 'sin cambios')}`);
        res.json({ success: true, ...resto, ...(pago ? { estado: pago.estado, pago: resumenPago(pago) } : {}) });
    } catch (e) {
        logger.error(`reconciliar-pago: ${e.message}`);
        res.status(e.status || 500).json({ success: false, error: e.status ? e.message : 'Error al reconciliar' });
    }
});

// ── Incidencias de payouts ya completados: devueltos, no reclamados, fallidos, revertidos… ──
// Detección con datos REALES de PayPal (consulta del lote, barrido periódico y webhook PAYMENT.PAYOUTS-ITEM.*);
// el dinero solo se mueve con una acción de un admin, con evidencia y confirmando el monto (modulos/retiros.js).
const quien = req => req.admin?.usuario || 'admin';
const paypalListo = () => !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
const enviarRes = (res, r, extra = {}) => { const { codigo, ...resto } = r; res.status(codigo).json({ success: codigo === 200, ...resto, ...extra }); };
const idValido = [param('id').isMongoId()];

app.get('/admin/finanzas/incidencias', verificarAdmin, async (req, res) => {
    try {
        const lista = await Retiros.incidencias(Pago, { soloAbiertas: req.query.abiertas === '1' });
        const users = await Usuario.find({ usuario: { $in: [...new Set(lista.map(p => p.usuario))] } }).select('usuario email paypalEmail cobro.resumen saldo solicitudPagoPendiente').lean();
        const porU = Object.fromEntries(users.map(u => [u.usuario, { email: u.email, metodoActual: u.cobro?.resumen || (u.paypalEmail ? 'PayPal · ' + u.paypalEmail : ''), saldo: u.saldo || 0, retiroPendiente: !!u.solicitudPagoPendiente }]));
        res.json({ success: true, incidencias: lista.map(p => ({ ...p, datosUsuario: porU[p.usuario] || {}, dineroDevuelto: Retiros.dineroDevuelto(p) })),
            paypalAutomatico: !!config.FEATURES.ENABLE_AUTO_PAYMENTS && paypalListo() });
    } catch (e) { logger.error(`incidencias: ${e.message}`); res.status(500).json({ success: false, error: 'Error al cargar' }); }
});

// Ficha de un retiro con su historial (para revisar antes de actuar)
app.get('/admin/finanzas/pagos/:id', verificarAdmin, idValido, async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
    const p = await Pago.findById(req.params.id).select('-datosCobro').lean().catch(() => null);
    if (!p) return res.status(404).json({ success: false, error: 'Pago no encontrado' });
    res.json({ success: true, pago: { ...p, dineroDevuelto: Retiros.dineroDevuelto(p) } });
});

// Preguntar a PayPal el estado real del payout (solo anota; abre incidencia si es un problema)
app.post('/admin/finanzas/pagos/:id/paypal-estado', verificarAdmin, idValido, async (req, res) => {
    try {
        if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
        const p = await Pago.findById(req.params.id).select('payoutBatchId estado').lean();
        if (!p) return res.status(404).json({ success: false, error: 'Pago no encontrado' });
        if (!p.payoutBatchId) return res.status(409).json({ success: false, error: 'Este retiro no se pagó por PayPal automático: no hay lote que consultar. Si el dinero volvió, abre la incidencia con la evidencia.' });
        if (!paypalListo()) return res.status(503).json({ success: false, error: 'PayPal no está configurado' });
        const r = await paypalPayouts.consultarPayout(p.payoutBatchId);
        const reg = await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, r, { fuente: 'consulta', por: quien(req) });
        res.json({ success: true, paypal: r, ...reg });
    } catch (e) { logger.error(`paypal-estado: ${e.message}`); res.status(e.status || 500).json({ success: false, error: e.status ? e.message : 'Error al consultar PayPal' }); }
});

// Cancelar un payout NO RECLAMADO: PayPal devuelve el dinero a UpGames (luego se puede devolver el saldo o reenviar)
app.post('/admin/finanzas/pagos/:id/paypal-cancelar', verificarAdmin, idValido, async (req, res) => {
    try {
        if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
        const p = await Pago.findById(req.params.id).select('monto paypal estado').lean();
        if (!p) return res.status(404).json({ success: false, error: 'Pago no encontrado' });
        if (p.paypal?.estado !== 'UNCLAIMED' || !p.paypal?.itemId) return res.status(409).json({ success: false, error: 'Solo se puede cancelar un payout que PayPal marca como NO RECLAMADO (consulta su estado primero)' });
        if (Math.abs(Number(req.body?.confirmo) - p.monto) > 1e-6) return res.status(400).json({ success: false, error: `Para confirmar escribe el monto exacto: ${p.monto}` });
        const r = await paypalPayouts.cancelarItemPayout(p.paypal.itemId);
        const reg = await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, r, { fuente: 'cancelacion', por: quien(req) });
        logger.warn(`[retiros] @${quien(req)} canceló en PayPal el payout no reclamado ${p._id} → ${r.item}`);
        res.json({ success: true, paypal: r, ...reg });
    } catch (e) { logger.error(`paypal-cancelar: ${e.message}`); res.status(e.status || 500).json({ success: false, error: e.status ? e.message : 'Error al cancelar en PayPal' }); }
});

// Abrir una incidencia a mano (p. ej. una transferencia manual que el banco devolvió)
app.post('/admin/finanzas/pagos/:id/incidencia', verificarAdmin, [...idValido, body('tipo').isString(), body('evidencia').isString().isLength({ max: 600 })], async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
    try { enviarRes(res, await Retiros.abrirIncidencia(Pago, req.params.id, { tipo: req.body.tipo, evidencia: req.body.evidencia, por: quien(req) })); }
    catch (e) { logger.error(`incidencia: ${e.message}`); res.status(500).json({ success: false, error: 'Error al abrir la incidencia' }); }
});

// Resolver: restaurar saldo · reenviar (retiro pendiente nuevo) · cerrar sin mover dinero
app.post('/admin/finanzas/pagos/:id/resolver', verificarAdmin, [...idValido, body('accion').isIn(['restaurar', 'reenviar', 'cerrar']), body('nota').optional().isString().isLength({ max: 400 })], async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
    try {
        let metodo = null;
        if (req.body.accion === 'reenviar') {
            const p = await Pago.findById(req.params.id).select('usuario').lean();
            const u = p && await Usuario.findOne({ usuario: p.usuario }).select('cobro paypalEmail').lean();
            const m = u && require('./cobros').metodoDe(u);
            metodo = m ? { ...m, paypalEmail: u.paypalEmail || '' } : null;
        }
        const r = await Retiros.resolverIncidencia({ Pago, Usuario }, req.params.id, req.body.accion, { por: quien(req), nota: req.body.nota, confirmo: req.body.confirmo, metodo });
        if (r.codigo === 200) logger.warn(`[retiros] @${quien(req)} resolvió la incidencia del retiro ${req.params.id}: ${r.resolucion}`);
        enviarRes(res, r);
    } catch (e) { logger.error(`resolver incidencia: ${e.message}`); res.status(500).json({ success: false, error: 'Error al resolver' }); }
});

// Barrido: cada 6 h revisa en PayPal los payouts automáticos recientes que aún pueden cambiar
// (no reclamados, retenidos, pendientes o completados hace menos de 3 días). Solo anota estados.
async function barridoPayPal() {
    if (!config.FEATURES.ENABLE_AUTO_PAYMENTS || !paypalListo() || mongoose.connection.readyState !== 1) return;
    try {
        const ahora = Date.now();
        const lista = await Pago.find({ estado: 'completado', payoutBatchId: { $nin: ['', null] }, fecha: { $gte: new Date(ahora - 45 * 864e5) },
            $or: [{ 'paypal.estado': { $in: [null, '', 'PENDING', 'UNCLAIMED', 'ONHOLD', 'NEW', 'PROCESSING'] } }, { 'paypal.estado': 'SUCCESS', updatedAt: { $gte: new Date(ahora - 3 * 864e5) } }] })
            .select('payoutBatchId').limit(40).lean();
        let n = 0;
        for (const p of lista) {
            try { const r = await paypalPayouts.consultarPayout(p.payoutBatchId); if ((await Retiros.registrarEstadoPayPal(Pago, { pagoId: p._id }, r, { fuente: 'barrido' })).incidenciaAbierta) n++; }
            catch (e) { logger.warn(`[retiros] barrido ${p._id}: ${e.message}`); }
        }
        if (n) logger.warn(`[retiros] Barrido de PayPal: ${n} incidencia(s) nueva(s) en payouts`);
    } catch (e) { logger.warn(`[retiros] barrido: ${e.message}`); }
}
setTimeout(barridoPayPal, 5 * 60e3).unref();
setInterval(barridoPayPal, 6 * 3600e3).unref();

app.post('/admin/finanzas/rechazar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('motivo').optional().trim()], async (req, res) => {
    try {
        const pago = await Pago.findOneAndUpdate({ _id: req.params.id, estado: 'pendiente' },
            { $set: { estado: 'rechazado', notas: req.body.motivo || 'Rechazado por el administrador' }, $push: { historial: { $each: [{ fecha: new Date(), accion: 'rechazado', por: req.admin?.usuario || 'admin', detalle: String(req.body.motivo || '').slice(0, 300) }], $slice: -100 } } }, { new: true });
        if (!pago) {
            const existe = await Pago.exists({ _id: req.params.id });
            return res.status(existe ? 409 : 404).json({ success: false, error: existe ? "El pago ya fue procesado" : "Pago no encontrado" });
        }
        await Usuario.updateOne({ usuario: pago.usuario }, { $set: { solicitudPagoPendiente: false } });
        logger.warn(`Pago rechazado - @${pago.usuario}`);
        res.json({ success: true, mensaje: "Pago rechazado", pago: { usuario: pago.usuario, monto: pago.monto, motivo: pago.notas } });
    } catch (error) {
        logger.error(`Error en rechazar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al rechazar pago" });
    }
});

app.get('/admin/finanzas/historial', verificarAdmin, async (req, res) => {
    try {
        const { estado, usuario, limite = 50 } = req.query;
        const filtro = {};
        if (estado) filtro.estado = estado;
        if (usuario) filtro.usuario = usuario.toLowerCase();
        const historial = await Pago.find(filtro).sort({ fecha: -1 }).limit(parseInt(limite)).lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        logger.error(`Error en historial: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar historial" });
    }
});

// GET /economia/historial-pagos — historial de retiros del creador autenticado
app.get('/economia/historial-pagos', verificarToken, async (req, res) => {
    try {
        const historial = await Pago.find({ usuario: req.usuario })
            .sort({ fecha: -1 })
            .limit(50)
            .select('monto paypalEmail metodo resumen referencia estado fecha notas')
            .lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        logger.error(`Error en historial-pagos: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al cargar historial' });
    }
});

app.get('/admin/finanzas/estadisticas', verificarAdmin, async (req, res) => {
    try {
        const [totalSolicitado, totalPagado, totalUsuariosConSaldo, totalUsuariosVerificados, solicitudesPendientes] = await Promise.all([
            Pago.aggregate([{ $match: { estado: 'pendiente' } }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
            Pago.aggregate([{ $match: { estado: 'completado' } }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
            Usuario.countDocuments({ saldo: { $gt: 0 } }),
            Usuario.countDocuments({ isVerificado: true }),
            Pago.countDocuments({ estado: 'pendiente' })
        ]);
        res.json({ success: true, estadisticas: { solicitudesPendientes, totalSolicitado: totalSolicitado[0]?.total || 0, totalPagado: totalPagado[0]?.total || 0, usuariosConSaldo: totalUsuariosConSaldo, usuariosVerificados: totalUsuariosVerificados } });
    } catch (error) {
        logger.error(`Error en estadísticas: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar estadísticas" });
    }
});

app.get('/admin/links/en-revision', verificarAdmin, async (req, res) => {
    try {
        const juegosEnRevision = await Juego.find({ linkStatus: 'revision' }).sort({ reportes: -1, createdAt: -1 }).lean();
        res.json({ success: true, juegos: juegosEnRevision, total: juegosEnRevision.length });
    } catch (error) {
        logger.error(`Error en links en revisión: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar links en revisión" });
    }
});

app.put('/admin/links/marcar-caido/:id', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const juego = await Juego.findByIdAndUpdate(req.params.id, { $set: { linkStatus: 'caido' } }, { new: true });
        if (!juego) return res.status(404).json({ success: false, error: "Juego no encontrado" });
        logger.warn(`Link marcado como caído: ${juego.title}`);
        res.json({ success: true, mensaje: "Link marcado como caído.", juego: { _id: juego._id, title: juego.title, linkStatus: juego.linkStatus } });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al marcar link como caído" });
    }
});

app.post('/items/verify-download/:id', async (req, res) => {
    res.json({ success: true, mensaje: "Por favor usa /economia/validar-descarga con el ID en el body", deprecado: true });
});
};
