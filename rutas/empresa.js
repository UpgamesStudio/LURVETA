/**
 * Panel admin → Empresa (solo el dueño): la empresa completa en una pantalla.
 *
 *   • Resumen ejecutivo: ingresos, costos, ganancia y margen del mes contra el anterior,
 *     usuarios activos, Premium, deuda con creadores, caja y alertas.
 *   • Finanzas: estado de resultados (6 meses), costos por proveedor (se cargan a mano),
 *     proyección de fin de mes y meses de caja.
 *   • Operación: salud del servidor, errores, seguridad, fraude, trabajo pendiente y respaldos.
 *   • Crecimiento: ARPU, ARPPU, conversión a pago, churn de Premium, CAC, LTV y referidos.
 *
 *   GET    /admin/empresa?mes=AAAA-MM[&formato=csv]   todo el tablero (CSV: estado de resultados)
 *   PUT    /admin/empresa/config                      parámetros (CPM que paga la red, comisiones, caja) y metas
 *   POST   /admin/empresa/costos                      { mes, categoria, concepto, usd, recurrente }
 *   DELETE /admin/empresa/costos/:id?mes=AAAA-MM      un recurrente deja de contar desde ese mes (el historial se queda)
 *   POST   /admin/empresa/respaldo                    descarga un respaldo completo de la base de datos (EJSON)
 *
 * De dónde sale cada cifra:
 *   ventas con dinero y lo que ganan los creadores por ellas → live_transacciones (igual que Economía)
 *   publicidad → anuncios vistos (stats_items y blog_vistas) × CPM que la red publicitaria paga a Lurveta
 *   pagos por publicidad a creadores → stats_items.g y blog_vistas.g/gd (lo que se les abona)
 *   comisiones de pasarela → estimadas: % + fijo por venta (configurable)
 *   el resto de costos → empresa_costos (los carga el dueño)
 * Todo es devengado (lo generado en el mes), no caja; los retiros pagados se muestran aparte.
 */
'use strict';

const mongoose = require('mongoose');
const os = require('os');
const { limitesMes, mesAnterior, mesCol, nombreMes } = require('./informes');
const { EXPR_PRODUCTO, EXPR_DINERO } = require('./adminEconomia');
const { MONEDA_USD } = require('../modulos/reparto');

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);

const CATEGORIAS = {
    servidor: 'Servidor (Railway)',
    base_datos: 'Base de datos (MongoDB)',
    correo: 'Correo (Resend)',
    ia: 'IA (Nexus y moderación)',
    imagenes: 'Imágenes y video (Cloudinary)',
    dominio: 'Dominio y DNS',
    herramientas: 'Herramientas y suscripciones',
    marketing: 'Marketing y publicidad',
    personal: 'Personal y colaboradores',
    legal: 'Legal, contabilidad e impuestos',
    otros: 'Otros',
};

// Ingresos que el dueño escribe a mano. «publicidad» = lo que la red pagó de verdad: reemplaza la estimación del mes
const CATEGORIAS_INGRESO = {
    publicidad: 'Publicidad (pago real de la red)',
    patrocinio: 'Patrocinios y colaboraciones',
    servicios: 'Servicios y ventas fuera de la app',
    otros_ingresos: 'Otros ingresos',
};

/**
 * Número escrito como lo escribe una persona: «12,50», «1.234,56», «1,234.56», «$ 20» o 20.
 * → número, o NaN si no se entiende.
 */
function numeroES(v) {
    if (typeof v === 'number') return v;
    let t = String(v ?? '').replace(/[\s$US]/gi, '').trim();
    if (!t || !/^-?[\d.,]+$/.test(t)) return NaN;
    const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.');
    if (coma >= 0 && punto >= 0) t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');   // el último separador es el decimal
    else if (coma >= 0) t = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');           // 1,500 = mil quinientos; 12,5 = doce y medio
    else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');                                     // 1.500 y 1.234.567 = miles (como en Colombia)
    return Number(t);
}

const METAS = {
    ingresosUsd: 'Ingresos (USD)', gananciaUsd: 'Ganancia (USD)', cuentasNuevas: 'Cuentas nuevas',
    visitantes: 'Visitantes del mes', premiumActivos: 'Premium activos',
};
// Las metas que se acumulan durante el mes (se comparan contra lo que va del mes); premiumActivos es una foto
const METAS_ACUMULADAS = ['ingresosUsd', 'gananciaUsd', 'cuentasNuevas', 'visitantes'];

const CONFIG_DEF = {
    cpmBrutoUsd: 0,          // lo que la red publicitaria le paga a Lurveta por 1.000 anuncios vistos
    comisionPct: 5.4,        // pasarela (PayPal / Mercado Pago): porcentaje por venta
    comisionFijaUsd: 0.30,   // … más un fijo por venta
    cajaUsd: null,           // dinero disponible hoy (lo escribe el dueño)
    cajaFecha: null,
    metas: { ingresosUsd: 0, gananciaUsd: 0, cuentasNuevas: 0, visitantes: 0, premiumActivos: 0 },
};

// Cuánto tiempo se guarda cada dato (TTL de las colecciones)
const RETENCION = [
    ['Visitas diarias (métricas)', '180 días'], ['Búsquedas', '120 días'], ['Visitantes anónimos', '400 días'],
    ['Estadísticas por publicación', '400 días'], ['Auditoría del equipo', '180 días'],
    ['Cuentas, publicaciones, comentarios, pagos y ventas', 'Siempre'],
];

/** Mezcla lo guardado con los valores por defecto. */
function configCompleta(guardada) {
    const g = guardada || {};
    return { ...CONFIG_DEF, ...g, metas: { ...CONFIG_DEF.metas, ...(g.metas || {}) } };
}

/** Valida los parámetros y metas que envía el panel. → { cfg } o { error } */
function validarConfig(body, actual = CONFIG_DEF) {
    const b = body || {}, cfg = configCompleta(actual);
    const numero = (v, min, max, nombre) => {
        const n = numeroES(v);
        if (v === '' || v === null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${nombre}: escribe un número entre ${min} y ${max}`);
        return n;
    };
    try {
        if (b.cpmBrutoUsd !== undefined) cfg.cpmBrutoUsd = r2(numero(b.cpmBrutoUsd, 0, 100, 'CPM de la red publicitaria'));
        if (b.comisionPct !== undefined) cfg.comisionPct = Math.round(numero(b.comisionPct, 0, 30, 'Comisión de la pasarela (%)') * 100) / 100;
        if (b.comisionFijaUsd !== undefined) cfg.comisionFijaUsd = r2(numero(b.comisionFijaUsd, 0, 5, 'Comisión fija por venta'));
        if (b.cajaUsd !== undefined) {
            const vacia = b.cajaUsd === null || b.cajaUsd === '';
            const caja = vacia ? null : r2(numero(b.cajaUsd, -1e9, 1e9, 'Caja disponible'));
            if (caja !== cfg.cajaUsd) cfg.cajaFecha = caja === null ? null : new Date();
            cfg.cajaUsd = caja;
        }
        if (b.metas !== undefined) {
            if (!b.metas || typeof b.metas !== 'object') throw new Error('Metas no válidas');
            for (const k of Object.keys(METAS)) if (b.metas[k] !== undefined) cfg.metas[k] = r2(numero(b.metas[k] === '' ? 0 : b.metas[k], 0, 1e9, METAS[k]));
        }
    } catch (e) { return { error: e.message }; }
    return { cfg };
}

/** Valida un movimiento nuevo o editado (costo o ingreso manual). → { costo } o { error } */
function validarCosto(body, mesActual = mesCol()) {
    const b = body || {};
    const mes = String(b.mes || mesActual);
    if (!MES_RE.test(mes) || mes > mesActual) return { error: 'Mes no válido' };
    const tipo = b.tipo === 'ingreso' ? 'ingreso' : 'costo';
    if (!(tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS)[b.categoria]) return { error: 'Elige una categoría' };
    const concepto = String(b.concepto || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!concepto) return { error: tipo === 'ingreso' ? 'Escribe el concepto (por ejemplo «Pago de AdSense de octubre»)' : 'Escribe el concepto (por ejemplo «Railway plan Pro»)' };
    const usd = numeroES(b.usd);
    if (!Number.isFinite(usd) || usd <= 0 || usd > 1e6) return { error: 'El monto debe ser un número mayor que 0 (en USD, por ejemplo 12,50)' };
    return { costo: { tipo, mes, categoria: b.categoria, concepto, usd: r2(usd), recurrente: b.recurrente === true || b.recurrente === 'true', hastaMes: null } };
}

/** Los costos que cuentan en un mes: los de ese mes y los recurrentes vigentes. */
function costosDelMes(lista, mes) {
    return (lista || []).filter(c => c.mes === mes || (c.recurrente && c.mes <= mes && (!c.hastaMes || c.hastaMes >= mes)));
}

/**
 * Estado de resultados de un mes a partir de los datos crudos.
 *   ventas: filas agrupadas { producto, dinero, n, usd, creador }
 *   anuncios: { vistos, creadoresUsd }   blogs: { vistos, creadoresUsd }
 *   costos: costos manuales que cuentan en el mes
 */
function calcularPyG({ ventas = [], anuncios = {}, blogs = {}, costos = [], cfg = CONFIG_DEF }) {
    const ing = { ventasUsd: 0, ventasN: 0, porProducto: {}, publicidadUsd: 0, anunciosVistos: 0, total: 0 };
    let creadoresVentas = 0;
    for (const f of ventas) {
        if (f.dinero) {
            ing.ventasUsd += f.usd || 0; ing.ventasN += f.n || 0;
            const p = (ing.porProducto[f.producto] ||= { n: 0, usd: 0 }); p.n += f.n || 0; p.usd += f.usd || 0;
        }
        creadoresVentas += f.creador || 0;   // también los regalos con UpCoins: esos UC se vendieron antes con dinero
    }
    ing.anunciosVistos = (anuncios.vistos || 0) + (blogs.vistos || 0);
    ing.publicidadEstimadaUsd = ing.anunciosVistos / 1000 * (cfg.cpmBrutoUsd || 0);
    // ingresos escritos a mano: la publicidad real (si la hay) reemplaza la estimación
    const ingManuales = {};
    for (const c of costos) if (c.tipo === 'ingreso') ingManuales[c.categoria] = (ingManuales[c.categoria] || 0) + (c.usd || 0);
    ing.publicidadReal = ingManuales.publicidad !== undefined;
    ing.publicidadUsd = ing.publicidadReal ? ingManuales.publicidad : ing.publicidadEstimadaUsd;
    ing.otrosUsd = Object.entries(ingManuales).filter(([k]) => k !== 'publicidad').reduce((a, [, v]) => a + v, 0);
    ing.manuales = Object.fromEntries(Object.entries(ingManuales).map(([k, v]) => [k, r2(v)]));
    ing.total = ing.ventasUsd + ing.publicidadUsd + ing.otrosUsd;

    const manuales = {};
    for (const c of costos) if (c.tipo !== 'ingreso') manuales[c.categoria] = (manuales[c.categoria] || 0) + (c.usd || 0);
    const cos = {
        creadoresVentasUsd: creadoresVentas,
        creadoresPublicidadUsd: anuncios.creadoresUsd || 0,
        creadoresBlogsUsd: blogs.creadoresUsd || 0,
        comisionesUsd: ing.ventasN ? ing.ventasUsd * (cfg.comisionPct || 0) / 100 + ing.ventasN * (cfg.comisionFijaUsd || 0) : 0,
        manuales, manualesUsd: Object.values(manuales).reduce((a, b) => a + b, 0),
    };
    cos.variablesUsd = cos.creadoresVentasUsd + cos.creadoresPublicidadUsd + cos.creadoresBlogsUsd + cos.comisionesUsd;
    cos.total = cos.variablesUsd + cos.manualesUsd;

    const ganancia = ing.total - cos.total, contribucion = ing.total - cos.variablesUsd;
    const redondear = o => { for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && k !== 'ventasN' && k !== 'anunciosVistos') o[k] = r2(v); return o; };
    for (const v of Object.values(ing.porProducto)) v.usd = r2(v.usd);
    for (const k of Object.keys(manuales)) manuales[k] = r2(manuales[k]);
    return {
        ingresos: redondear(ing), costos: redondear(cos),
        ganancia: r2(ganancia), contribucion: r2(contribucion),
        margenPct: ing.total > 0 ? pct(ganancia, ing.total) : null,
        margenContribucionPct: ing.total > 0 ? pct(contribucion, ing.total) : null,
    };
}

/** Indicadores de negocio (unit economics). Los que no se pueden calcular quedan en null. */
function indicadores({ ingresosUsd = 0, ventasUsd = 0, pagadores = 0, cuentasActivas = 0, cuentasNuevas = 0, marketingUsd = 0,
    premiumActivos = 0, premiumVencidos = 0, margenContribucionPct = null }) {
    const churn = premiumVencidos + premiumActivos > 0 ? premiumVencidos / (premiumVencidos + premiumActivos) : null;
    const arppu = pagadores ? ventasUsd / pagadores : null;
    const margen = margenContribucionPct === null ? null : Math.max(0, Math.min(100, margenContribucionPct)) / 100;
    // vida media del cliente: 1 / churn mensual, con tope de 24 meses (sin churn medido se usan 24)
    const vidaMeses = churn ? Math.min(24, 1 / churn) : 24;
    const ltv = arppu !== null && margen !== null ? arppu * margen * vidaMeses : null;
    const cac = marketingUsd > 0 && cuentasNuevas > 0 ? marketingUsd / cuentasNuevas : null;
    const r = v => (v === null ? null : r2(v));
    return {
        arpuUsd: cuentasActivas ? r(ingresosUsd / cuentasActivas) : null,
        arppuUsd: r(arppu),
        conversionPct: cuentasActivas ? pct(pagadores, cuentasActivas) : null,
        premiumPct: cuentasActivas ? pct(premiumActivos, cuentasActivas) : null,
        churnPremiumPct: churn === null ? null : Math.round(churn * 1000) / 10,
        vidaMeses: Math.round(vidaMeses * 10) / 10,
        cacUsd: r(cac),
        ltvUsd: r(ltv),
        ltvCac: ltv !== null && cac ? Math.round(ltv / cac * 10) / 10 : null,
    };
}

/** Avance de las metas del mes. `avanceMes` = fracción del mes transcurrida (1 si ya cerró). */
function progresoMetas(metas, valores, avanceMes) {
    return Object.entries(METAS).filter(([k]) => (metas?.[k] || 0) > 0).map(([k, nombre]) => {
        const objetivo = metas[k], valor = valores[k] || 0;
        const p = Math.round(valor / objetivo * 1000) / 10;
        const esperado = METAS_ACUMULADAS.includes(k) ? Math.round(avanceMes * 1000) / 10 : 100;
        return { clave: k, nombre, valor: r2(valor), objetivo, pct: p, esperadoPct: esperado, atrasada: p < esperado - 15 };
    });
}

/** Meses de caja: caja ÷ pérdida media mensual. null = no hay pérdidas (o no hay caja escrita). */
function mesesDeCaja(cajaUsd, ganancias) {
    if (cajaUsd === null || cajaUsd === undefined) return null;
    const v = (ganancias || []).filter(Number.isFinite);
    if (!v.length) return null;
    const media = v.reduce((a, b) => a + b, 0) / v.length;
    if (media >= 0) return null;
    return Math.max(0, Math.round(cajaUsd / -media * 10) / 10);
}

/** Proyección lineal al cierre del mes: lo variable escala con los días; los costos fijos no. */
function proyectarFinMes(pyg, avanceMes) {
    if (!pyg || !(avanceMes > 0) || avanceMes >= 1) return null;
    const ingresos = pyg.ingresos.total / avanceMes;
    const costos = pyg.costos.variablesUsd / avanceMes + pyg.costos.manualesUsd;
    return { ingresos: r2(ingresos), costos: r2(costos), ganancia: r2(ingresos - costos) };
}

/** Lo que el dueño debería mirar ya, de más a menos urgente. */
// (formato colombiano en los textos: $8,83 y 19,8 %)
const usdTxt = n => '$' + (Math.round(Math.abs(Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const decTxt = n => String(n).replace('.', ',');
function generarAlertas(d) {
    const A = [], add = (nivel, area, texto, ir) => A.push({ nivel, area, texto, ir });
    const p = d.pagos || {};
    if (p.n && p.masAntiguoDias >= 3) add('alta', 'Finanzas', `${p.n} pago(s) a creadores esperando; el más antiguo lleva ${p.masAntiguoDias} días`, 'pays');
    else if (p.n) add('media', 'Finanzas', `${p.n} pago(s) a creadores pendientes (${usdTxt(p.usd)})`, 'pays');
    if (d.incidentesAbiertos) add('alta', 'Seguridad', `${d.incidentesAbiertos} incidente(s) de seguridad sin cerrar`, 'moder');
    const fr = d.fraude || {};
    if ((fr.critical || 0) + (fr.high || 0)) add('alta', 'Seguridad', `${(fr.critical || 0) + (fr.high || 0)} alerta(s) de fraude grave sin revisar`, 'usrs');
    if (d.erroresNuevos24h) add('media', 'Sistema', `${d.erroresNuevos24h} error(es) nuevo(s) en las últimas 24 h`, 'api');
    if (d.runwayMeses !== null && d.runwayMeses !== undefined && d.runwayMeses < 3) add('alta', 'Finanzas', `La caja alcanza para ${decTxt(d.runwayMeses)} mes(es) al ritmo de pérdidas actual`, 'emp');
    if (d.pyg && d.pyg.ingresos.total > 0 && d.pyg.ganancia < 0) add(d.enCurso ? 'media' : 'alta', 'Finanzas', `El mes ${d.enCurso ? 'va' : 'cerró'} con pérdida (${usdTxt(d.pyg.ganancia)})`, 'emp');
    if (d.contracargos?.n) add('media', 'Finanzas', `${d.contracargos.n} reembolso(s) o contracargo(s) este mes (${usdTxt(d.contracargos.usd)})`, 'econ');
    for (const m of d.metas || []) if (m.atrasada) add('media', 'Metas', `${m.nombre}: ${decTxt(m.pct)} % de la meta (se esperaba ~${decTxt(Math.round(m.esperadoPct))} %)`, 'emp');
    if (d.enRevision >= 20) add('media', 'Contenido', `${d.enRevision} publicaciones esperando revisión`, 'revn');
    const ult = d.respaldo?.fecha ? new Date(d.respaldo.fecha) : null;
    if (!ult) add('media', 'Sistema', 'Nunca se ha descargado un respaldo de la base de datos', 'emp');
    else if (Date.now() - ult > 30 * 864e5) add('media', 'Sistema', `El último respaldo tiene ${Math.floor((Date.now() - ult) / 864e5)} días`, 'emp');
    for (const c of d.diagnostico?.resultados || []) if (c.estado === 'falla') add(c.critico ? 'alta' : 'media', 'Plataforma', `${c.nombre} no funciona: ${c.detalle}`, 'emp');
    const mon = d.monitor;
    if (mon?.disponibilidad24h !== null && mon?.disponibilidad24h !== undefined && mon.disponibilidad24h < 99) add('media', 'Plataforma', `Disponibilidad de las últimas 24 h: ${decTxt(mon.disponibilidad24h)} % (caídas o reinicios)`, 'emp');
    if (mon?.ahora?.peticiones >= 50 && mon.ahora.erroresPct >= 2) add('alta', 'Plataforma', `${decTxt(mon.ahora.erroresPct)} % de las peticiones están fallando (errores del servidor, últimos 15 min)`, 'emp');
    if (mon?.ahora?.p95 >= 3000) add('media', 'Plataforma', `La API va lenta: el 5 % más lento tarda ${decTxt(Math.round(mon.ahora.p95 / 100) / 10)} s`, 'emp');
    if (!d.cfg?.cpmBrutoUsd && !d.pyg?.ingresos?.publicidadReal) add('info', 'Configuración', 'Falta el CPM que te paga la red publicitaria: los ingresos por publicidad salen en 0', 'emp');
    if (!d.costosMesN) add('info', 'Configuración', 'No hay costos registrados este mes: la ganancia sale más alta que la real', 'emp');
    if (d.cfg && (d.cfg.cajaUsd === null || d.cfg.cajaUsd === undefined)) add('info', 'Configuración', 'Escribe la caja disponible para calcular cuántos meses alcanza', 'emp');
    const orden = { alta: 0, media: 1, info: 2 };
    return A.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

// ── CSV del estado de resultados (mismo formato que el informe mensual: ; y BOM) ──
const celda = v => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s;
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const fila = (...c) => c.map(celda).join(';');
function aCSV(t) {
    const L = [fila('LURVETA · ESTADO DE RESULTADOS (USD, devengado)'), fila('Generado', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'), ''];
    const h = t.historia;
    L.push(fila('Concepto', ...h.map(m => m.nombre)));
    const lin = (n, f) => L.push(fila(n, ...h.map(m => f(m.pyg))));
    lin('Ventas con dinero', p => p.ingresos.ventasUsd);
    lin('Publicidad (real o estimada)', p => p.ingresos.publicidadUsd);
    lin('Otros ingresos', p => p.ingresos.otrosUsd || 0);
    lin('INGRESOS', p => p.ingresos.total);
    lin('Creadores · ventas y regalos', p => -p.costos.creadoresVentasUsd);
    lin('Creadores · publicidad', p => -p.costos.creadoresPublicidadUsd);
    lin('Creadores · blogs', p => -p.costos.creadoresBlogsUsd);
    lin('Comisiones de pasarela (est.)', p => -p.costos.comisionesUsd);
    lin('MARGEN DE CONTRIBUCIÓN', p => p.contribucion);
    for (const [k, nombre] of Object.entries(CATEGORIAS)) if (h.some(m => m.pyg.costos.manuales[k])) lin(nombre, p => -(p.costos.manuales[k] || 0));
    lin('COSTOS TOTALES', p => -p.costos.total);
    lin('GANANCIA', p => p.ganancia);
    lin('Margen %', p => p.margenPct);
    L.push('', fila('MOVIMIENTOS REGISTRADOS · ' + t.nombre.toUpperCase()), fila('Tipo', 'Categoría', 'Concepto', 'USD', 'Recurrente'));
    for (const c of t.costos) L.push(fila(c.tipo === 'ingreso' ? 'Ingreso' : 'Costo', (c.tipo === 'ingreso' ? CATEGORIAS_INGRESO : CATEGORIAS)[c.categoria] || c.categoria, c.concepto, c.usd, c.recurrente ? 'sí' : 'no'));
    return '﻿' + L.join('\r\n') + '\r\n';
}

/** Estado de un chequeo según su resultado y su latencia. */
function estadoChequeo({ ok, configurado = true, ms = 0, lentoMs = 2500 }) {
    if (!configurado) return 'sin_configurar';
    if (!ok) return 'falla';
    return ms >= lentoMs ? 'lento' : 'ok';
}

function registrar(app, { verificarAdmin, Usuario, Juego, Pago, LiveTx, logger, correo, mercadoPago, getPayPalAccessToken, cloudinary, puerto, sitioUrl = 'https://lurveta.com/' }) {
    const monitor = require('../modulos/monitor');
    const nexusLLM = require('../modulos/nexus/llm');
    const db = () => mongoose.connection;
    const colCostos = () => db().collection('empresa_costos');
    const colCfg = () => db().collection('empresa_config');
    const ok = (res, d) => res.json({ success: true, ...d });
    const err = (res, code, error) => res.status(code).json({ success: false, error });
    const cache = new Map();   // datos crudos de meses cerrados (10 min)

    const leerCfg = async () => configCompleta(await colCfg().findOne({ _id: 'config' }).catch(() => null));
    const leerCostos = () => colCostos().find({}).sort({ mes: 1, categoria: 1 }).limit(5000).toArray();

    /** Datos crudos de un mes y su estado de resultados. */
    async function finanzasMes(mes, cfg, costosTodos) {
        // (el caché guarda solo los datos crudos: costos y parámetros se aplican siempre al momento)
        const enCurso = mes === mesCol(), clave = mes;
        const c = !enCurso && cache.get(clave);
        if (c && Date.now() - c.t < 10 * 60e3) return { ...c.v, pyg: calcularPyG({ ...c.v.crudo, costos: costosDelMes(costosTodos, mes), cfg }) };
        const { dias, desde, hasta } = limitesMes(mes);
        const d0 = dias[0], d1 = dias[dias.length - 1];
        const BlogVista = mongoose.models.BlogVista;
        const [ventas, anuncios, blogs, revertidas, pagos] = await Promise.all([
            LiveTx.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta }, estado: { $ne: 'revertida' } } },
                { $group: { _id: { producto: EXPR_PRODUCTO, dinero: EXPR_DINERO }, n: { $sum: 1 }, usd: { $sum: '$usd' }, creador: { $sum: '$creadorUsd' } } }]),
            db().collection('stats_items').aggregate([{ $match: { dia: { $gte: d0, $lte: d1 } } },
                { $group: { _id: null, vistos: { $sum: { $ifNull: ['$d', 0] } }, g: { $sum: { $ifNull: ['$g', 0] } } } }]).toArray(),
            BlogVista ? BlogVista.aggregate([{ $match: { dia: { $gte: d0, $lte: d1 } } },
                { $group: { _id: null, vistos: { $sum: { $ifNull: ['$a', 0] } }, g: { $sum: { $add: [{ $ifNull: ['$g', 0] }, { $ifNull: ['$gd', 0] }] } } } }]) : [],
            LiveTx.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta }, estado: 'revertida' } }, { $group: { _id: null, n: { $sum: 1 }, usd: { $sum: '$usd' } } }]),
            // (fecha de pago ≈ última actualización de la solicitud completada)
            Pago.aggregate([{ $match: { estado: 'completado', updatedAt: { $gte: desde, $lt: hasta } } },
                { $group: { _id: null, n: { $sum: 1 }, usd: { $sum: '$monto' } } }]),
        ]);
        const crudo = {
            ventas: ventas.map(f => ({ ...f._id, n: f.n, usd: f.usd, creador: f.creador })),
            anuncios: { vistos: anuncios[0]?.vistos || 0, creadoresUsd: anuncios[0]?.g || 0 },
            blogs: { vistos: blogs[0]?.vistos || 0, creadoresUsd: blogs[0]?.g || 0 },
        };
        const v = { mes, nombre: nombreMes(mes), crudo,
            contracargos: { n: revertidas[0]?.n || 0, usd: r2(revertidas[0]?.usd) },
            retirosPagados: { n: pagos[0]?.n || 0, usd: r2(pagos[0]?.usd) } };
        if (!enCurso) { cache.set(clave, { t: Date.now(), v }); if (cache.size > 60) cache.delete(cache.keys().next().value); }
        return { ...v, pyg: calcularPyG({ ...crudo, costos: costosDelMes(costosTodos, mes), cfg }) };
    }

    async function salud() {
        const t0 = Date.now();
        const dbOk = db().readyState === 1 && await db().db.admin().ping().then(() => true).catch(() => false);
        const m = process.memoryUsage();
        return { db: dbOk, dbMs: Date.now() - t0, uptimeS: Math.round(process.uptime()), heapMB: Math.round(m.heapUsed / 1048576), rssMB: Math.round(m.rss / 1048576),
            memSistemaMB: Math.round(os.totalmem() / 1048576), node: process.version, commit: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.UPGAMES_COMMIT || '').slice(0, 7) || null };
    }

    async function tablero(mes) {
        const ahora = Date.now(), enCurso = mes === mesCol();
        const { dias, desde, hasta } = limitesMes(mes);
        const finMes = new Date(Math.min(+hasta, ahora));
        const avanceMes = enCurso ? Math.min(1, Math.max(1 / dias.length, (ahora - desde) / (hasta - desde))) : 1;
        const [cfg, costosTodos] = await Promise.all([leerCfg(), leerCostos()]);

        // 6 meses de historia (del más antiguo al seleccionado) + el anterior para comparar
        const meses = [mes]; for (let i = 0; i < 5; i++) meses.unshift(mesAnterior(meses[0]));
        const historia = await Promise.all(meses.map(m => finanzasMes(m, cfg, costosTodos)));
        const actual = historia[historia.length - 1], anterior = historia[historia.length - 2];

        const hoy = new Date(ahora - 5 * 3600e3).toISOString().slice(0, 10);
        const SA = mongoose.models.SuspiciousActivity;
        const [usuariosTotal, nuevosMes, nuevosAnt, activos30, dau, mau, visitantesMes, premiumActivos, premiumVencidos, suspendidas, listaNegra,
            pagadores, circ, pagosPend, erroresActivos, erroresNuevos, erroresTop, incidentes, fraude, enRevision, reportadas, referidos, srv] = await Promise.all([
            Usuario.estimatedDocumentCount(),
            Usuario.countDocuments({ createdAt: { $gte: desde, $lt: hasta } }),
            Usuario.countDocuments({ createdAt: { $gte: limitesMes(mesAnterior(mes)).desde, $lt: desde } }),
            Usuario.countDocuments({ ultimoLogin: { $gte: new Date(ahora - 30 * 864e5) } }),
            db().collection('metricas_visitas').countDocuments({ dia: hoy }),
            db().collection('metricas_visitantes').countDocuments({ ultima: { $gte: new Date(ahora - 30 * 864e5) } }),
            db().collection('metricas_visitas').countDocuments({ dia: { $gte: dias[0], $lte: dias[dias.length - 1] } }),
            Usuario.countDocuments({ planHasta: { $gt: new Date(ahora) } }),
            Usuario.countDocuments({ planHasta: { $gte: desde, $lt: finMes } }),   // vencieron en el mes y no renovaron
            Usuario.countDocuments({ suspendido: true }),
            Usuario.countDocuments({ listaNegraAdmin: true }),
            LiveTx.aggregate([{ $match: { fecha: { $gte: desde, $lt: hasta }, estado: { $ne: 'revertida' }, $expr: EXPR_DINERO } }, { $group: { _id: '$usuario' } }, { $count: 'n' }]),
            Usuario.aggregate([{ $group: { _id: null, ganado: { $sum: '$saldo' }, retenido: { $sum: '$saldoRetenido' }, comprados: { $sum: '$monedas' }, fondo: { $sum: '$paseFondoUsd' } } }]),
            Pago.aggregate([{ $match: { estado: 'pendiente' } }, { $group: { _id: null, n: { $sum: 1 }, usd: { $sum: '$monto' }, primera: { $min: '$fecha' } } }]),
            db().collection('errores').countDocuments({ ultima: { $gte: new Date(ahora - 864e5) } }),
            db().collection('errores').countDocuments({ primera: { $gte: new Date(ahora - 864e5) } }),
            db().collection('errores').find({ ultima: { $gte: new Date(ahora - 864e5) }, silenciado: { $ne: true } }).sort({ n: -1 }).limit(5).project({ mensaje: 1, n: 1, origen: 1, ultima: 1 }).toArray(),
            db().collection('incidentes_seguridad').countDocuments({ estado: 'abierto' }),
            SA ? SA.aggregate([{ $match: { revisado: false } }, { $group: { _id: '$severidad', n: { $sum: 1 } } }]) : [],
            Juego.countDocuments({ status: { $ne: 'rechazado' }, $or: [{ linkStatus: 'revision' }, { status: { $in: ['pendiente', 'pending'] } }] }),
            Juego.countDocuments({ reportes: { $gt: 0 } }),
            Usuario.aggregate([{ $match: { referidoPor: { $nin: ['', null] } } },
                { $group: { _id: null, total: { $sum: 1 }, pagados: { $sum: { $cond: [{ $eq: ['$referidoEstado', 'pagado'] }, 1, 0] } },
                    mes: { $sum: { $cond: [{ $and: [{ $gte: ['$referidoEn', desde] }, { $lt: ['$referidoEn', hasta] }] }, 1, 0] } } } }]),
            salud(),
        ]);
        const [cfgDoc, diagDoc, fotos24] = await Promise.all([
            colCfg().findOne({ _id: 'respaldo' }).catch(() => null),
            colCfg().findOne({ _id: 'diagnostico' }).catch(() => null),
            monitor.fotos(new Date(ahora - 864e5)).catch(() => []),
        ]);
        const monitorDatos = {
            ahora: monitor.resumen(15, ahora),
            disponibilidad24h: monitor.disponibilidad(fotos24, ahora),
            peticiones24h: fotos24.reduce((a, f) => a + (f.peticiones || 0), 0),
            errores5xx24h: fotos24.reduce((a, f) => a + (f.e5 || 0), 0),
            fotos: fotos24.map(f => ({ t: f.t, peticiones: f.peticiones, e5: f.e5, p95: f.p95, heapMB: f.heapMB, lagMs: f.lagMs, dbOk: f.dbOk, dbMs: f.dbMs })),
        };

        const c = circ[0] || {}, pp = pagosPend[0];
        const deudaCreadores = r2((c.ganado || 0) + (c.retenido || 0));
        const ganCerradas = historia.slice(-4, -1).map(h => h.pyg.ganancia);   // los 3 meses cerrados anteriores
        if (!enCurso) ganCerradas.push(actual.pyg.ganancia);
        const runway = mesesDeCaja(cfg.cajaUsd, ganCerradas.slice(-3));
        const marketing = actual.pyg.costos.manuales.marketing || 0;
        const ind = indicadores({ ingresosUsd: actual.pyg.ingresos.total, ventasUsd: actual.pyg.ingresos.ventasUsd, pagadores: pagadores[0]?.n || 0,
            cuentasActivas: activos30, cuentasNuevas: nuevosMes, marketingUsd: marketing, premiumActivos, premiumVencidos,
            margenContribucionPct: actual.pyg.margenContribucionPct });
        const metas = progresoMetas(cfg.metas, { ingresosUsd: actual.pyg.ingresos.total, gananciaUsd: actual.pyg.ganancia, cuentasNuevas: nuevosMes,
            visitantes: visitantesMes, premiumActivos }, avanceMes);
        const fr = Object.fromEntries((fraude || []).map(f => [f._id, f.n]));
        const pagos = { n: pp?.n || 0, usd: r2(pp?.usd), masAntiguoDias: pp?.primera ? Math.floor((ahora - new Date(pp.primera)) / 864e5) : 0 };
        const costosMes = costosDelMes(costosTodos, mes).map(x => ({ id: String(x._id), tipo: x.tipo === 'ingreso' ? 'ingreso' : 'costo', mes: x.mes, categoria: x.categoria, concepto: x.concepto, usd: x.usd,
            recurrente: !!x.recurrente, desde: x.mes, hastaMes: x.hastaMes || null }));
        const promedio3 = (() => {
            const ult = historia.slice(enCurso ? -4 : -3, enCurso ? -1 : undefined).map(h => h.pyg);
            if (!ult.length) return null;
            const avg = k => r2(ult.reduce((a, p) => a + k(p), 0) / ult.length);
            return { ingresos: avg(p => p.ingresos.total), costos: avg(p => p.costos.total), ganancia: avg(p => p.ganancia) };
        })();

        const t = {
            mes, nombre: nombreMes(mes), enCurso, avanceMes: Math.round(avanceMes * 1000) / 1000, diasMes: dias.length,
            generado: ahora, cfg, categorias: CATEGORIAS, categoriasIngreso: CATEGORIAS_INGRESO, nombresMetas: METAS,
            pyg: actual.pyg, pygAnterior: anterior.pyg, anterior: anterior.nombre,
            historia: historia.map(h => ({ mes: h.mes, nombre: h.nombre, pyg: h.pyg, retirosPagados: h.retirosPagados })),
            proyeccion: { finMes: enCurso ? proyectarFinMes(actual.pyg, avanceMes) : null, promedio3 },
            balance: { cajaUsd: cfg.cajaUsd, cajaFecha: cfg.cajaFecha, deudaCreadoresUsd: deudaCreadores, retenidoUsd: r2(c.retenido),
                pagosPendientesUsd: pagos.usd, ucCompradosUsd: r2((c.comprados || 0) * MONEDA_USD), fondoPremiumUsd: r2(c.fondo),
                cajaLibreUsd: cfg.cajaUsd === null ? null : r2(cfg.cajaUsd - deudaCreadores), runwayMeses: runway,
                retirosPagadosMes: actual.retirosPagados },
            usuarios: { total: usuariosTotal, nuevosMes, nuevosAnterior: nuevosAnt, activos30, dau, mau, visitantesMes, premiumActivos, premiumVencidos, suspendidas, listaNegra },
            crecimiento: { ...ind, pagadores: pagadores[0]?.n || 0, marketingUsd: r2(marketing),
                referidos: { total: referidos[0]?.total || 0, pagados: referidos[0]?.pagados || 0, mes: referidos[0]?.mes || 0 } },
            operacion: {
                servidor: srv,
                errores: { activos24h: erroresActivos, nuevos24h: erroresNuevos, top: erroresTop.map(e => ({ mensaje: String(e.mensaje || '').slice(0, 160), n: e.n, origen: e.origen, ultima: e.ultima })) },
                seguridad: { incidentesAbiertos: incidentes, fraude: { critical: fr.critical || 0, high: fr.high || 0, medium: fr.medium || 0, low: fr.low || 0 },
                    suspendidas, listaNegra, contracargos: actual.contracargos },
                contenido: { enRevision, reportadas },
                pagos,
                respaldo: cfgDoc ? { fecha: cfgDoc.fecha, por: cfgDoc.por, mb: cfgDoc.mb, colecciones: cfgDoc.colecciones, documentos: cfgDoc.documentos } : null,
                retencionDatos: RETENCION,
                monitor: monitorDatos,
                diagnostico: diagDoc ? { fecha: diagDoc.fecha, resultados: diagDoc.resultados || [] } : null,
            },
            costos: costosMes, metas,
        };
        t.alertas = generarAlertas({ pagos, incidentesAbiertos: incidentes, fraude: fr, erroresNuevos24h: erroresNuevos, runwayMeses: runway,
            pyg: actual.pyg, enCurso, contracargos: actual.contracargos, metas, enRevision, respaldo: t.operacion.respaldo, cfg, costosMesN: costosMes.filter(x => x.tipo !== 'ingreso').length,
            diagnostico: t.operacion.diagnostico, monitor: t.operacion.monitor });
        return t;
    }

    app.get('/admin/empresa', verificarAdmin, async (req, res) => {
        try {
            const mes = String(req.query.mes || mesCol());
            if (!MES_RE.test(mes) || mes > mesCol()) return err(res, 400, 'Mes no válido');
            const t = await tablero(mes);
            if (req.query.formato === 'csv') {
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="Lurveta-resultados-${mes}.csv"`);
                return res.send(aCSV(t));
            }
            ok(res, { empresa: t });
        } catch (e) { logger.error(`[empresa] ${e.message}`); err(res, 500, 'No se pudo cargar el tablero de la empresa'); }
    });

    app.put('/admin/empresa/config', verificarAdmin, async (req, res) => {
        try {
            const r = validarConfig(req.body, await leerCfg());
            if (r.error) return err(res, 400, r.error);
            await colCfg().updateOne({ _id: 'config' }, { $set: { ...r.cfg, actualizado: new Date(), por: req.admin?.usuario || '' } }, { upsert: true });
            ok(res, { cfg: r.cfg });
        } catch (e) { logger.error(`[empresa] config: ${e.message}`); err(res, 500, 'No se pudo guardar'); }
    });

    app.post('/admin/empresa/costos', verificarAdmin, async (req, res) => {
        try {
            const r = validarCosto(req.body);
            if (r.error) return err(res, 400, r.error);
            const doc = { ...r.costo, fecha: new Date(), por: req.admin?.usuario || '' };
            const ins = await colCostos().insertOne(doc);
            ok(res, { costo: { ...doc, id: String(ins.insertedId) } });
        } catch (e) { logger.error(`[empresa] costo: ${e.message}`); err(res, 500, 'No se pudo guardar el costo'); }
    });

    app.delete('/admin/empresa/costos/:id', verificarAdmin, async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) return err(res, 400, 'ID no válido');
            const mes = String(req.query.mes || mesCol());
            if (!MES_RE.test(mes)) return err(res, 400, 'Mes no válido');
            const _id = new mongoose.Types.ObjectId(req.params.id);
            const c = await colCostos().findOne({ _id });
            if (!c) return err(res, 404, 'Ese costo ya no existe');
            // un recurrente que empezó antes: deja de contar desde este mes y los meses pasados no cambian
            if (c.recurrente && c.mes < mes) {
                await colCostos().updateOne({ _id }, { $set: { hastaMes: mesAnterior(mes) } });
                ok(res, { accion: 'detenido', hastaMes: mesAnterior(mes) });
            } else {
                await colCostos().deleteOne({ _id });
                ok(res, { accion: 'eliminado' });
            }
        } catch (e) { logger.error(`[empresa] borrar costo: ${e.message}`); err(res, 500, 'No se pudo quitar el costo'); }
    });

    // ── Respaldo completo: todas las colecciones en EJSON canónico (conserva ObjectId, fechas y números) ──
    // Se restaura colección por colección con mongoimport --jsonArray (ver docs/panel-admin.md).
    let respaldoEnCurso = false, ultimoRespaldo = 0;
    app.post('/admin/empresa/respaldo', verificarAdmin, async (req, res) => {
        if (respaldoEnCurso) return err(res, 409, 'Ya hay un respaldo en curso');
        if (Date.now() - ultimoRespaldo < 5 * 60e3) return err(res, 429, 'Espera unos minutos antes de pedir otro respaldo');
        if (db().readyState !== 1) return err(res, 503, 'La base de datos no está disponible');
        respaldoEnCurso = true; ultimoRespaldo = Date.now();
        const { EJSON } = mongoose.mongo.BSON;
        let bytes = 0, documentos = 0, completo = false;
        // (si el navegador corta, 'close' también despierta la espera y el bucle se detiene)
        const escribir = async s => { bytes += Buffer.byteLength(s); if (!res.write(s)) await new Promise(r => { res.once('drain', r); res.once('close', r); }); };
        try {
            const nombres = (await db().db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort();
            const fecha = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="Lurveta-respaldo-${fecha}.json"`);
            res.setHeader('Cache-Control', 'no-store');
            await escribir(`{"generado":${JSON.stringify(new Date().toISOString())},"formato":"EJSON canónico · una lista por colección","colecciones":{`);
            for (let i = 0; i < nombres.length; i++) {
                await escribir(`${i ? ',' : ''}${JSON.stringify(nombres[i])}:[`);
                let primero = true;
                for await (const doc of db().collection(nombres[i]).find({}).batchSize(500)) {
                    if (res.destroyed) throw new Error('descarga cancelada');
                    await escribir((primero ? '' : ',') + EJSON.stringify(doc, { relaxed: false }));
                    primero = false; documentos++;
                }
                await escribir(']');
            }
            await escribir('}}');
            res.end(); completo = true;
            await colCfg().updateOne({ _id: 'respaldo' }, { $set: { fecha: new Date(), por: req.admin?.usuario || '', mb: Math.round(bytes / 1048576 * 10) / 10, colecciones: nombres.length, documentos } }, { upsert: true });
            logger.warn(`[empresa] respaldo completo descargado por @${req.admin?.usuario || '?'} (${nombres.length} colecciones, ${documentos} documentos, ${Math.round(bytes / 1048576)} MB)`);
        } catch (e) {
            logger.error(`[empresa] respaldo: ${e.message}`);
            ultimoRespaldo = 0;   // si falló, se puede reintentar enseguida
            if (!res.headersSent) err(res, 500, 'No se pudo generar el respaldo');
            else if (!completo) res.destroy();   // cortar: un archivo a medias no debe parecer un respaldo válido
        } finally { respaldoEnCurso = false; }
    });

    // ── Diagnóstico real: prueba cada pieza de la plataforma ──
    const conTiempo = (p, ms = 8000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no respondió en ${ms / 1000} s`)), ms).unref?.())]);
    async function chequeo(nombre, critico, fn, { lentoMs, configurado = true } = {}) {
        const t0 = Date.now();
        if (!configurado) return { nombre, critico, estado: 'sin_configurar', ms: null, detalle: 'No está configurado' };
        try {
            const r = await conTiempo(Promise.resolve().then(fn));
            const ok = r?.ok !== false, ms = Date.now() - t0;
            return { nombre, critico, estado: estadoChequeo({ ok, ms, lentoMs }), ms, detalle: String(r?.detalle || (ok ? '' : 'Falla')).slice(0, 200) };
        } catch (e) { return { nombre, critico, estado: 'falla', ms: Date.now() - t0, detalle: String(e.message || e).slice(0, 200) }; }
    }
    const pedir = async (url, opt = {}) => { const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(8000) }); return r; };
    const env = process.env;
    async function diagnosticar() {
        const local = `http://127.0.0.1:${puerto}`;
        const resultados = await Promise.all([
            chequeo('Base de datos', true, async () => { await db().db.admin().ping(); return { detalle: 'MongoDB responde' }; }, { lentoMs: 500 }),
            chequeo('API (salud)', true, async () => { const r = await pedir(`${local}/salud`); return { ok: r.ok, detalle: `HTTP ${r.status}` }; }, { lentoMs: 1500 }),
            chequeo('Catálogo público', true, async () => { const r = await pedir(`${local}/items?limit=1`); return { ok: r.ok, detalle: `HTTP ${r.status}` }; }, { lentoMs: 2500 }),
            chequeo('Sitio web', true, async () => { const r = await pedir(sitioUrl, { redirect: 'follow' }); return { ok: r.ok, detalle: `${new URL(sitioUrl).host} · HTTP ${r.status}` }; }, { lentoMs: 3000 }),
            chequeo('Correo', false, async () => { const e = await correo.verificar(); return { ok: !!e.ok, detalle: e.ok ? `Proveedor: ${e.proveedor}` : e.detalle }; }, { configurado: !!correo }),
            chequeo('PayPal', true, async () => { await getPayPalAccessToken(); return { detalle: `Credenciales válidas (${env.PAYPAL_MODE === 'live' ? 'producción' : 'pruebas'})` }; },
                { configurado: !!(getPayPalAccessToken && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), lentoMs: 4000 }),
            chequeo('Mercado Pago', true, async () => { const r = await pedir('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${String(env.MERCADOPAGO_ACCESS_TOKEN || env.MP_ACCESS_TOKEN).trim()}` } }); return { ok: r.ok, detalle: r.ok ? 'Token válido' : `Rechazó el token (HTTP ${r.status})` }; },
                { configurado: !!(env.MERCADOPAGO_ACCESS_TOKEN || env.MP_ACCESS_TOKEN), lentoMs: 4000 }),
            chequeo('Nexus IA', false, async () => { const p = await nexusLLM.ping(); return { ok: !!p.ok, detalle: p.ok ? 'El modelo responde' : (p.error || 'No responde') }; }, { configurado: !!env.GROQ_API_KEY, lentoMs: 4000 }),
            chequeo('Imágenes (Cloudinary)', false, async () => { await cloudinary.api.ping(); return { detalle: 'Responde' }; },
                { configurado: !!(cloudinary && (env.CLOUDINARY_URL || env.CLOUDINARY_API_KEY)), lentoMs: 4000 }),
            chequeo('Avisos de errores', false, async () => ({ detalle: env.SENTRY_DSN ? 'Correo + Sentry' : 'Por correo (Sentry opcional)' })),
        ]);
        const doc = { _id: 'diagnostico', fecha: new Date(), resultados };
        // avisar (correo de alertas) solo cuando algo pasa de funcionar a fallar
        const antes = await colCfg().findOne({ _id: 'diagnostico' }).catch(() => null);
        for (const r of resultados) {
            const prev = antes?.resultados?.find(x => x.nombre === r.nombre);
            if (r.estado === 'falla' && prev && prev.estado !== 'falla') logger.error(`[diagnóstico] ${r.nombre} dejó de funcionar: ${r.detalle}`);
        }
        await colCfg().updateOne({ _id: 'diagnostico' }, { $set: doc }, { upsert: true }).catch(() => {});
        return doc;
    }

    app.post('/admin/empresa/diagnostico', verificarAdmin, async (req, res) => {
        try { ok(res, { diagnostico: await diagnosticar() }); }
        catch (e) { logger.error(`[empresa] diagnóstico: ${e.message}`); err(res, 500, 'No se pudo ejecutar el diagnóstico'); }
    });

    // Editar un movimiento. Un recurrente que empezó antes de este mes se parte: el viejo termina el mes
    // anterior y desde este mes cuenta el nuevo valor (los meses pasados no cambian).
    app.put('/admin/empresa/costos/:id', verificarAdmin, async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) return err(res, 400, 'ID no válido');
            const _id = new mongoose.Types.ObjectId(req.params.id);
            const c = await colCostos().findOne({ _id });
            if (!c) return err(res, 404, 'Ese movimiento ya no existe');
            const mesVista = String(req.body?.mes || c.mes);
            if (!MES_RE.test(mesVista)) return err(res, 400, 'Mes no válido');
            const partir = c.recurrente && c.mes < mesVista;
            const r = validarCosto({ ...req.body, tipo: c.tipo, mes: partir ? mesVista : c.mes });
            if (r.error) return err(res, 400, r.error);
            if (partir) {
                await colCostos().updateOne({ _id }, { $set: { hastaMes: mesAnterior(mesVista) } });
                const nuevo = { ...r.costo, hastaMes: c.hastaMes || null, fecha: new Date(), por: req.admin?.usuario || '', reemplazaA: _id };
                const ins = await colCostos().insertOne(nuevo);
                return ok(res, { accion: 'partido', id: String(ins.insertedId) });
            }
            await colCostos().updateOne({ _id }, { $set: { categoria: r.costo.categoria, concepto: r.costo.concepto, usd: r.costo.usd, recurrente: r.costo.recurrente, editado: new Date(), por: req.admin?.usuario || '' } });
            ok(res, { accion: 'editado' });
        } catch (e) { logger.error(`[empresa] editar: ${e.message}`); err(res, 500, 'No se pudo guardar el cambio'); }
    });

    // Monitoreo: fotos cada 5 min y diagnóstico automático cada 30 min (solo con la base conectada)
    if (!registrar._arrancado) {
        registrar._arrancado = true;
        const arrancar = () => { monitor.iniciar(logger); setTimeout(() => diagnosticar().catch(() => {}), 60e3).unref?.(); setInterval(() => diagnosticar().catch(() => {}), 30 * 60e3).unref?.(); };
        if (db().readyState === 1) arrancar(); else db().once('connected', arrancar);
    }

    return { tablero, diagnosticar };
}

module.exports = { registrar, numeroES, estadoChequeo, CATEGORIAS_INGRESO, calcularPyG, costosDelMes, validarCosto, validarConfig, configCompleta, indicadores, progresoMetas, mesesDeCaja, proyectarFinMes, generarAlertas, aCSV, CATEGORIAS, METAS };
