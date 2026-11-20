/**
 * Límite diario de descargas pagadas por IP y publicación (colección DescargaIP).
 *
 * El contador se comprueba y se suma en UNA operación atómica sobre un índice ÚNICO
 * {juegoId, ip}: peticiones simultáneas (o un mismo ticket reenviado en paralelo) no
 * pueden pasar del tope. Antes era leer → comprobar → guardar, y 200 peticiones a la
 * vez contaban 200 descargas.
 */
'use strict';

const CLAVE = { juegoId: 1, ip: 1 };

function modelo(mongoose) {
    if (mongoose.models.DescargaIP) return mongoose.models.DescargaIP;
    const s = new mongoose.Schema({
        juegoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Juego', required: true },
        ip:      { type: String, required: true },
        contadorHoy: { type: Number, default: 1 },
        fecha: { type: Date, default: Date.now, expires: 86400 },
    });
    s.index(CLAVE, { unique: true });
    return mongoose.model('DescargaIP', s);
}

/** Suma 1 si la IP no llegó al tope de hoy para esa publicación. → true si contó. */
async function contar(DescargaIP, juegoId, ip, max) {
    const filtro = { juegoId, ip, contadorHoy: { $lt: max } };
    const cambio = { $inc: { contadorHoy: 1 }, $setOnInsert: { fecha: new Date() } };
    try {
        return !!(await DescargaIP.findOneAndUpdate(filtro, cambio, { upsert: true, new: true, setDefaultsOnInsert: false }).lean());
    } catch (e) {
        if (e.code !== 11000) throw e;
        // Ya existe: o la creó otra petición en este instante, o está en el tope
        return !!(await DescargaIP.findOneAndUpdate(filtro, { $inc: { contadorHoy: 1 } }, { new: true }).lean());
    }
}

/**
 * Migración idempotente: el índice viejo {juegoId, ip} no era único. Se borran los
 * duplicados (los registros duran 24 h; se conserva el de mayor contador) y se crea el único.
 */
async function asegurarIndice(DescargaIP, logger) {
    const col = DescargaIP.collection;
    for (let intento = 1; intento <= 3; intento++) {
        const indices = await col.indexes().catch(() => []);
        const actual = indices.find(i => JSON.stringify(i.key) === JSON.stringify(CLAVE));
        if (actual?.unique) return true;
        const dups = await col.aggregate([
            { $sort: { contadorHoy: -1 } },
            { $group: { _id: { juegoId: '$juegoId', ip: '$ip' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
        ]).toArray();
        const sobran = dups.flatMap(d => d.ids.slice(1));
        if (sobran.length) await col.deleteMany({ _id: { $in: sobran } });
        try {
            if (actual) await col.dropIndex(actual.name);
            await col.createIndex(CLAVE, { unique: true });
            logger?.info?.(`[descargas] índice único {juegoId, ip} listo (${sobran.length} duplicado(s) eliminados)`);
            return true;
        } catch (e) {
            logger?.warn?.(`[descargas] índice único, intento ${intento}: ${e.message}`);
        }
    }
    logger?.error?.('[descargas] no se pudo crear el índice único {juegoId, ip}: el tope por IP no está garantizado bajo concurrencia');
    return false;
}

module.exports = { modelo, contar, asegurarIndice };
