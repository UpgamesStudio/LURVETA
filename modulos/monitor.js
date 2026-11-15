/**
 * Monitoreo real de la plataforma (panel admin → Empresa → Operación).
 *
 *   • Cada petición HTTP se anota en memoria por minuto: cantidad, errores 4xx/5xx y tiempos.
 *   • Cada 5 minutos se guarda una foto en `empresa_monitor` (30 días): peticiones, % de errores,
 *     latencia p95, memoria, retraso del event loop y si la base de datos respondió.
 *     Los huecos entre fotos = el servidor estuvo caído o reiniciándose → % de disponibilidad.
 *   • El diagnóstico (rutas/empresa.js) prueba de verdad cada servicio externo cada 30 minutos.
 */
'use strict';

const mongoose = require('mongoose');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const FOTO_MS = 5 * 60e3;
const MUESTRAS_MIN = 400;          // tiempos guardados por minuto para calcular el p95
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

const minutos = new Map();         // minuto → { n, e4, e5, ms: [] , suma }
const minuto = (t = Date.now()) => Math.floor(t / 60e3);

/** Lo llama el middleware de index.js al terminar cada petición. */
function anotar(status, ms) {
    const m = minuto();
    let c = minutos.get(m);
    if (!c) {
        minutos.set(m, c = { n: 0, e4: 0, e5: 0, suma: 0, ms: [] });
        for (const k of minutos.keys()) if (k < m - 60) minutos.delete(k);   // memoria: solo la última hora
    }
    c.n++; c.suma += ms;
    if (status >= 500) c.e5++; else if (status >= 400) c.e4++;
    if (c.ms.length < MUESTRAS_MIN) c.ms.push(ms);
}

const percentil = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
};

/** Resumen de los últimos `n` minutos (en memoria). */
function resumen(n = 15, ahora = Date.now()) {
    const m0 = minuto(ahora) - n;
    let t = 0, e4 = 0, e5 = 0, suma = 0; const ms = [];
    for (const [k, c] of minutos) if (k > m0) { t += c.n; e4 += c.e4; e5 += c.e5; suma += c.suma; ms.push(...c.ms); }
    return { minutos: n, peticiones: t, porMinuto: Math.round(t / n * 10) / 10, e4, e5,
        erroresPct: t ? Math.round(e5 / t * 1000) / 10 : 0, msProm: t ? Math.round(suma / t) : null, p95: percentil(ms, 95) };
}

/** Disponibilidad a partir de las fotos: fotos con base de datos OK ÷ fotos esperadas en la ventana. */
function disponibilidad(fotos, ahora = Date.now(), ventanaMs = 864e5) {
    if (!fotos.length) return null;
    const inicio = Math.max(ahora - ventanaMs, Math.min(...fotos.map(f => +new Date(f.t))) - FOTO_MS);
    const esperadas = Math.max(1, Math.round((ahora - inicio) / FOTO_MS));
    const buenas = fotos.filter(f => f.dbOk && +new Date(f.t) >= ahora - ventanaMs).length;
    return Math.min(100, Math.round(buenas / esperadas * 1000) / 10);
}

let intervalo = null;
const col = () => mongoose.connection.collection('empresa_monitor');

async function tomarFoto(logger) {
    if (mongoose.connection.readyState !== 1) return null;
    const r = resumen(5), mem = process.memoryUsage(), t0 = Date.now();
    const dbOk = await mongoose.connection.db.admin().ping().then(() => true).catch(() => false);
    const foto = { t: new Date(), peticiones: r.peticiones, e4: r.e4, e5: r.e5, erroresPct: r.erroresPct, msProm: r.msProm, p95: r.p95,
        heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576), lagMs: Math.round(lag.percentile(99) / 1e6),
        carga: Math.round(os.loadavg()[0] * 100) / 100, dbOk, dbMs: Date.now() - t0 };
    lag.reset();
    try { await col().insertOne(foto); } catch (e) { logger?.warn?.(`[monitor] ${e.message}`); }
    return foto;
}

/** Arranca las fotos periódicas (una sola vez por proceso). */
function iniciar(logger) {
    if (intervalo) return;
    col().createIndex({ t: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {});
    intervalo = setInterval(() => tomarFoto(logger).catch(() => {}), FOTO_MS);
    intervalo.unref?.();
    setTimeout(() => tomarFoto(logger).catch(() => {}), 30e3).unref?.();
}

const fotos = (desde) => col().find({ t: { $gte: desde } }).sort({ t: 1 }).limit(2000).toArray();

module.exports = { anotar, resumen, disponibilidad, percentil, iniciar, tomarFoto, fotos, FOTO_MS, _minutos: minutos };
