/**
 * PayPal Checkout (Orders v2) para cobros dentro de UpGames: monedas del live y
 * acceso directo a enlaces. El comprador paga con TARJETA (crédito/débito, sin
 * cuenta de PayPal) o con su cuenta PayPal; los datos de la tarjeta los captura
 * PayPal en su formulario seguro, nunca pasan por UpGames.
 *
 * Flujo seguro: el servidor crea la orden con el dueño (custom_id) y el producto
 * (reference_id); al capturar, verifica ambos y el monto ANTES de cobrar.
 */
'use strict';

const https = require('https');

function crear(config, getToken, { transporte } = {}) {
    const host = () => config.PAYPAL_MODE === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    const configurado = () => !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);

    // Verificación real con PayPal (OAuth). Si las credenciales están mal copiadas o
    // no corresponden al modo (live/sandbox) los pagos se desactivan con un aviso claro
    // en el log, en vez de mostrar botones que fallan en el navegador del comprador.
    let estado = { ok: null, motivo: '', detalle: '' };
    async function verificar() {
        if (!configurado()) return (estado = { ok: false, motivo: 'sin_configurar', detalle: 'Faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET' });
        if (transporte) return (estado = { ok: true, motivo: '', detalle: '' });
        try {
            await getToken();
            estado = { ok: true, motivo: '', detalle: '' };
        } catch (e) {
            const invalidas = /invalid_client|Client Authentication failed|401/i.test(e.message);
            estado = {
                ok: false, motivo: invalidas ? 'credenciales_invalidas' : 'no_disponible',
                detalle: invalidas
                    ? `PayPal rechazó PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET en modo "${config.PAYPAL_MODE}". Copia ambos completos desde developer.paypal.com → Apps & Credentials (pestaña ${config.PAYPAL_MODE === 'live' ? 'Live' : 'Sandbox'}). El Client ID mide unos 80 caracteres (el actual mide ${String(config.PAYPAL_CLIENT_ID).length}).`
                    : `No se pudo contactar a PayPal: ${e.message.slice(0, 160)}`,
            };
        }
        return estado;
    }
    // Pagos disponibles: configurado y no rechazado por PayPal (null = aún sin verificar)
    const activo = () => configurado() && estado.ok !== false;

    async function req(method, path, body, extraHeaders = {}) {
        if (transporte) return transporte(method, path, body, extraHeaders);   // tests
        let token;
        try { token = await getToken(); } catch (e) { e.antesDeEnviar = true; throw e; }   // nada salió hacia PayPal
        const payload = body ? JSON.stringify(body) : '';
        return new Promise((resolve, reject) => {
            const r = https.request({
                hostname: host(), path, method,
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders },
                timeout: 20000,
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    let json = {};
                    try { json = data ? JSON.parse(data) : {}; } catch (_) {}
                    resolve({ status: res.statusCode, data: json });
                });
            });
            r.on('timeout', () => r.destroy(new Error('PayPal no respondió a tiempo')));
            r.on('error', reject);
            if (payload) r.write(payload);
            r.end();
        });
    }

    /** Crea una orden. Devuelve el orderID o lanza un error con .status. */
    async function crearOrden({ usuario, referencia, usd, descripcion }) {
        const r = await req('POST', '/v2/checkout/orders', {
            intent: 'CAPTURE',
            purchase_units: [{ reference_id: referencia, custom_id: usuario, description: descripcion.slice(0, 127), amount: { currency_code: 'USD', value: usd.toFixed(2) } }],
            application_context: { brand_name: 'UpGames', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
        }, { 'PayPal-Request-Id': `ug-${usuario}-${referencia}-${Date.now()}`.slice(0, 108) });
        if (r.status !== 201 || !r.data.id) {
            const e = new Error('PayPal no pudo crear la orden'); e.status = 502; e.detalle = JSON.stringify(r.data).slice(0, 300); throw e;
        }
        return r.data.id;
    }

    /**
     * Verifica dueño, producto y monto de la orden y la captura (idempotente si
     * ya estaba capturada). Devuelve { captura, referencia }.
     * `validarRef(ref)` decide si la referencia corresponde a lo que se compra.
     */
    async function capturar(orderID, { usuario, validarRef, usd }) {
        const fallo = (status, msg, extra = {}) => { const e = new Error(msg); e.status = status; Object.assign(e, extra); return e; };
        if (!/^[A-Z0-9]{10,30}$/.test(String(orderID || ''))) throw fallo(400, 'Orden no válida');
        const o = await req('GET', `/v2/checkout/orders/${orderID}`);
        if (o.status !== 200) throw fallo(404, 'PayPal no encontró la orden');
        const pu = o.data.purchase_units?.[0] || {};
        if (pu.custom_id !== usuario || !validarRef(pu.reference_id)) throw fallo(403, 'Esta orden no es tuya');
        const monto = typeof usd === 'function' ? usd(pu.reference_id) : usd;
        if (pu.amount?.currency_code !== 'USD' || Math.abs(parseFloat(pu.amount?.value) - monto) > 0.001) throw fallo(400, 'El monto de la orden no coincide');

        let captura = pu.payments?.captures?.[0];
        if (o.data.status !== 'COMPLETED') {
            const c = await req('POST', `/v2/checkout/orders/${orderID}/capture`, {}, { 'PayPal-Request-Id': `ug-cap-${orderID}` });
            if (c.status !== 201 && c.status !== 200) {
                const rechazo = c.data?.details?.[0]?.issue === 'INSTRUMENT_DECLINED';
                throw fallo(402, rechazo ? 'Tu banco o PayPal rechazó el pago. Prueba con otra tarjeta.' : 'No se pudo completar el pago', { reintentar: rechazo, detalle: JSON.stringify(c.data).slice(0, 300) });
            }
            captura = c.data.purchase_units?.[0]?.payments?.captures?.[0];
        }
        if (!captura || captura.status !== 'COMPLETED' || Math.abs(parseFloat(captura.amount?.value) - monto) > 0.001)
            throw fallo(402, 'El pago quedó pendiente en PayPal. Se acreditará cuando se confirme.', { detalle: captura?.status });
        return { captura, referencia: pu.reference_id };
    }

    /**
     * Payout a un creador (PayPal Payouts). sender_batch_id ESTABLE por retiro: si se reintenta
     * el mismo retiro, PayPal rechaza el lote repetido en vez de pagar dos veces.
     * Errores: e.definitivo = true solo cuando es seguro que PayPal no creó el lote; en
     * cualquier otro caso (timeout, red, 5xx, lote repetido) el resultado es DESCONOCIDO.
     */
    async function enviarPayout({ email, monto, pagoId }) {
        const fallo = (msg, definitivo) => Object.assign(new Error(msg), { definitivo });
        let r;
        try {
            r = await req('POST', '/v1/payments/payouts', {
                sender_batch_header: { sender_batch_id: `UPGAMES_${pagoId}`, email_subject: '¡Tu pago de UpGames ha llegado!',
                    email_message: 'Has recibido un pago por tus ganancias de creador en UpGames. ¡Gracias por crear!' },
                items: [{ recipient_type: 'EMAIL', amount: { value: Number(monto).toFixed(2), currency: 'USD' }, receiver: email,
                    note: `Retiro UpGames #${pagoId}`, sender_item_id: `item_${pagoId}` }],
            });
        } catch (e) { throw fallo(e.message, !!e.antesDeEnviar); }
        if (r.status === 201) return { batchId: r.data?.batch_header?.payout_batch_id || '', batchStatus: r.data?.batch_header?.batch_status || 'PENDING' };
        const texto = JSON.stringify(r.data || {});
        const msg = `PayPal Payout falló [HTTP ${r.status}]: ${r.data?.message || r.data?.name || texto.slice(0, 200)}`;
        const repetido = /DUPLICATE|already exists|sender_batch_id/i.test(texto);
        throw fallo(msg, r.status >= 400 && r.status < 500 && !repetido);
    }

    /**
     * Estado REAL de un lote ya creado (GET /v1/payments/payouts/{id}). Cada retiro va en su propio
     * lote con un solo ítem. → { estado (del lote), item (transaction_status del ítem: SUCCESS, UNCLAIMED,
     * RETURNED, FAILED, BLOCKED, REFUNDED, REVERSED, ONHOLD, PENDING…), itemId, error, procesado }
     */
    async function consultarPayout(batchId) {
        if (!/^[A-Z0-9]{5,40}$/.test(String(batchId || ''))) { const e = new Error('Lote no válido'); e.status = 400; throw e; }
        const r = await req('GET', `/v1/payments/payouts/${batchId}`);
        if (r.status !== 200) { const e = new Error(`PayPal no devolvió el lote (HTTP ${r.status})`); e.status = 502; throw e; }
        const it = r.data?.items?.[0] || {};
        return { estado: r.data?.batch_header?.batch_status || '', item: it.transaction_status || '', itemId: it.payout_item_id || '',
            error: it.errors ? `${it.errors.name || ''}${it.errors.message ? ': ' + it.errors.message : ''}`.slice(0, 300) : '', procesado: it.time_processed || '' };
    }

    /** Cancela un ítem NO RECLAMADO (UNCLAIMED): PayPal devuelve el dinero a la cuenta de UpGames. → mismo formato que consultarPayout. */
    async function cancelarItemPayout(itemId) {
        if (!/^[A-Z0-9]{5,40}$/.test(String(itemId || ''))) { const e = new Error('Ítem no válido'); e.status = 400; throw e; }
        const r = await req('POST', `/v1/payments/payouts-item/${itemId}/cancel`, {});
        if (r.status !== 200) { const e = new Error(`PayPal no canceló el ítem (HTTP ${r.status}): ${r.data?.message || r.data?.name || ''}`.trim()); e.status = 502; throw e; }
        return { estado: '', item: r.data?.transaction_status || '', itemId: r.data?.payout_item_id || itemId, error: '', procesado: r.data?.time_processed || '' };
    }

    return { activo, configurado, verificar, estado: () => ({ ...estado }), req, crearOrden, capturar, enviarPayout, consultarPayout, cancelarItemPayout };
}

module.exports = { crear };
