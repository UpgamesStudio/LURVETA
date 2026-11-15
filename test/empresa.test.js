/**
 * Tests del tablero Empresa (funciones puras de rutas/empresa.js): estado de resultados,
 * costos recurrentes, validaciones, indicadores, metas, caja, proyección, alertas y CSV.
 */
'use strict';
const assert = require('assert');
const E = require('../rutas/empresa');

let n = 0;
const test = (nombre, fn) => { fn(); n++; console.log('  ✓ ' + nombre); };
console.log('empresa');

const cfg = E.configCompleta({ cpmBrutoUsd: 4, comisionPct: 5, comisionFijaUsd: 0.3 });

test('estado de resultados: ingresos, costos de creadores, comisiones y manuales', () => {
    const p = E.calcularPyG({
        ventas: [
            { producto: 'premium', dinero: true, n: 2, usd: 10, creador: 1 },
            { producto: 'paquete', dinero: true, n: 1, usd: 5, creador: 0 },
            { producto: 'regalo', dinero: false, n: 4, usd: 0, creador: 2 },      // regalo con UC: no es ingreso, sí costo
        ],
        anuncios: { vistos: 2000, creadoresUsd: 3 }, blogs: { vistos: 500, creadoresUsd: 0.5 },
        costos: [{ categoria: 'servidor', usd: 5 }, { categoria: 'servidor', usd: 2 }, { categoria: 'marketing', usd: 1 }], cfg,
    });
    assert.strictEqual(p.ingresos.ventasUsd, 15); assert.strictEqual(p.ingresos.ventasN, 3);
    assert.strictEqual(p.ingresos.publicidadUsd, 10);           // 2.500 anuncios × US$4 / 1.000
    assert.strictEqual(p.ingresos.total, 25);
    assert.strictEqual(p.costos.creadoresVentasUsd, 3);
    assert.strictEqual(p.costos.comisionesUsd, 1.65);            // 5 % de 15 + 3 × 0,30
    assert.deepStrictEqual(p.costos.manuales, { servidor: 7, marketing: 1 });
    assert.strictEqual(p.costos.total, 3 + 3 + 0.5 + 1.65 + 8);
    assert.strictEqual(p.ganancia, r(25 - 16.15)); assert.strictEqual(p.contribucion, r(25 - 8.15));
    assert.strictEqual(p.margenPct, 35.4);
    assert.deepStrictEqual(p.ingresos.porProducto.premium, { n: 2, usd: 10 });
    assert.strictEqual(p.ingresos.porProducto.regalo, undefined);
});
function r(x) { return Math.round(x * 100) / 100; }

test('sin ingresos el margen es null y sin ventas no hay comisión fija', () => {
    const p = E.calcularPyG({ costos: [{ categoria: 'otros', usd: 3 }], cfg });
    assert.strictEqual(p.margenPct, null); assert.strictEqual(p.costos.comisionesUsd, 0); assert.strictEqual(p.ganancia, -3);
});

test('costos recurrentes: cuentan desde su mes y hasta que se detienen', () => {
    const L = [{ mes: '2026-08', recurrente: true, usd: 5 }, { mes: '2026-09', recurrente: false, usd: 1 }, { mes: '2026-07', recurrente: true, hastaMes: '2026-09', usd: 2 }];
    assert.deepStrictEqual(E.costosDelMes(L, '2026-07').map(c => c.usd), [2]);
    assert.deepStrictEqual(E.costosDelMes(L, '2026-09').map(c => c.usd), [5, 1, 2]);
    assert.deepStrictEqual(E.costosDelMes(L, '2026-10').map(c => c.usd), [5]);
});

test('validar costo', () => {
    const ok = E.validarCosto({ mes: '2026-10', categoria: 'servidor', concepto: '  Railway   Pro ', usd: '20.4567', recurrente: true }, '2026-11');
    assert.deepStrictEqual(ok.costo, { tipo: 'costo', mes: '2026-10', categoria: 'servidor', concepto: 'Railway Pro', usd: 20.46, recurrente: true, hastaMes: null });
    assert.ok(E.validarCosto({ mes: '2026-12', categoria: 'servidor', concepto: 'x', usd: 1 }, '2026-11').error);   // mes futuro
    assert.ok(E.validarCosto({ categoria: 'casino', concepto: 'x', usd: 1 }, '2026-11').error);
    assert.ok(E.validarCosto({ categoria: 'ia', concepto: ' ', usd: 1 }, '2026-11').error);
    assert.ok(E.validarCosto({ categoria: 'ia', concepto: 'x', usd: 0 }, '2026-11').error);
    assert.ok(E.validarCosto({ categoria: 'ia', concepto: 'x', usd: 'abc' }, '2026-11').error);
    assert.strictEqual(E.validarCosto({ categoria: 'ia', concepto: 'x', usd: 1 }, '2026-11').costo.mes, '2026-11');
});

test('validar parámetros y metas', () => {
    const r1 = E.validarConfig({ cpmBrutoUsd: '3.5', comisionPct: 6, cajaUsd: '1200', metas: { ingresosUsd: 500, cuentasNuevas: '' } });
    assert.strictEqual(r1.cfg.cpmBrutoUsd, 3.5); assert.strictEqual(r1.cfg.cajaUsd, 1200); assert.ok(r1.cfg.cajaFecha instanceof Date);
    assert.strictEqual(r1.cfg.metas.ingresosUsd, 500); assert.strictEqual(r1.cfg.metas.cuentasNuevas, 0);
    assert.strictEqual(r1.cfg.comisionFijaUsd, 0.3);                       // lo que no se envía queda igual
    assert.strictEqual(E.validarConfig({ cajaUsd: '' }, r1.cfg).cfg.cajaUsd, null);
    assert.ok(E.validarConfig({ comisionPct: 50 }).error);
    assert.ok(E.validarConfig({ cpmBrutoUsd: '' }).error);
    assert.ok(E.validarConfig({ metas: { visitantes: -1 } }).error);
    assert.ok(E.validarConfig({ metas: 'x' }).error);
});

test('indicadores de negocio', () => {
    const i = E.indicadores({ ingresosUsd: 100, ventasUsd: 80, pagadores: 8, cuentasActivas: 200, cuentasNuevas: 40, marketingUsd: 20,
        premiumActivos: 15, premiumVencidos: 5, margenContribucionPct: 60 });
    assert.strictEqual(i.arpuUsd, 0.5); assert.strictEqual(i.arppuUsd, 10); assert.strictEqual(i.conversionPct, 4);
    assert.strictEqual(i.churnPremiumPct, 25); assert.strictEqual(i.vidaMeses, 4);
    assert.strictEqual(i.ltvUsd, 24);              // 10 × 0,6 × 4 meses
    assert.strictEqual(i.cacUsd, 0.5); assert.strictEqual(i.ltvCac, 48);
    const v = E.indicadores({});
    assert.strictEqual(v.arpuUsd, null); assert.strictEqual(v.cacUsd, null); assert.strictEqual(v.ltvUsd, null); assert.strictEqual(v.churnPremiumPct, null);
    assert.strictEqual(E.indicadores({ ventasUsd: 10, pagadores: 1, margenContribucionPct: 50 }).vidaMeses, 24);   // sin churn medido: tope
});

test('metas: se comparan contra lo que va del mes', () => {
    const m = E.progresoMetas({ ingresosUsd: 100, cuentasNuevas: 0, premiumActivos: 10 }, { ingresosUsd: 20, premiumActivos: 9 }, 0.5);
    assert.strictEqual(m.length, 2);
    assert.deepStrictEqual(m[0], { clave: 'ingresosUsd', nombre: 'Ingresos (USD)', valor: 20, objetivo: 100, pct: 20, esperadoPct: 50, atrasada: true });
    assert.strictEqual(m[1].esperadoPct, 100); assert.strictEqual(m[1].atrasada, false);   // foto: 90 % no está 15 puntos por debajo
});

test('meses de caja y proyección de fin de mes', () => {
    assert.strictEqual(E.mesesDeCaja(300, [-100, -50, -150]), 3);
    assert.strictEqual(E.mesesDeCaja(300, [100, -50]), null);       // en promedio gana: no se agota
    assert.strictEqual(E.mesesDeCaja(null, [-100]), null);
    assert.strictEqual(E.mesesDeCaja(-20, [-10]), 0);
    const pyg = { ingresos: { total: 50 }, costos: { variablesUsd: 10, manualesUsd: 30 } };
    assert.deepStrictEqual(E.proyectarFinMes(pyg, 0.5), { ingresos: 100, costos: 50, ganancia: 50 });
    assert.strictEqual(E.proyectarFinMes(pyg, 1), null);
});

test('alertas por urgencia', () => {
    const a = E.generarAlertas({ pagos: { n: 2, usd: 30, masAntiguoDias: 4 }, incidentesAbiertos: 1, fraude: { critical: 1 }, erroresNuevos24h: 3, runwayMeses: 2,
        pyg: { ingresos: { total: 10 }, ganancia: -5 }, enCurso: false, metas: [{ nombre: 'X', pct: 10, esperadoPct: 100, atrasada: true }],
        respaldo: null, cfg: E.configCompleta({}), costosMesN: 0, enRevision: 0 });
    assert.deepStrictEqual(a.map(x => x.nivel), [...a.map(x => x.nivel)].sort((p, q) => ['alta', 'media', 'info'].indexOf(p) - ['alta', 'media', 'info'].indexOf(q)));
    assert.strictEqual(a.filter(x => x.nivel === 'alta').length, 5);
    assert.ok(a.some(x => /respaldo/.test(x.texto))); assert.ok(a.some(x => /CPM/.test(x.texto))); assert.ok(a.some(x => /caja disponible/.test(x.texto)));
    const limpio = E.generarAlertas({ pagos: {}, fraude: {}, runwayMeses: null, pyg: { ingresos: { total: 10 }, ganancia: 5 }, metas: [],
        respaldo: { fecha: new Date() }, cfg: E.configCompleta({ cpmBrutoUsd: 2, cajaUsd: 100 }), costosMesN: 3 });
    assert.deepStrictEqual(limpio, []);
});

test('CSV del estado de resultados', () => {
    const p = E.calcularPyG({ ventas: [{ producto: 'premium', dinero: true, n: 1, usd: 9.5, creador: 0 }], costos: [{ categoria: 'servidor', usd: 5 }], cfg });
    const csv = E.aCSV({ nombre: 'octubre de 2026', historia: [{ nombre: 'septiembre de 2026', pyg: E.calcularPyG({ cfg }) }, { nombre: 'octubre de 2026', pyg: p }],
        costos: [{ categoria: 'servidor', concepto: '=HYPERLINK("x")', usd: 5, recurrente: true }] });
    assert.ok(csv.startsWith('﻿UPGAMES'));
    assert.ok(csv.includes('Concepto;septiembre de 2026;octubre de 2026'));
    assert.ok(csv.includes('Ventas con dinero;0;9,5'));
    assert.ok(csv.includes('Servidor (Railway);0;-5'));
    assert.ok(csv.includes(`'=HYPERLINK`));                      // fórmulas neutralizadas
});

test('números escritos como en Colombia', () => {
    const c = [['12,50', 12.5], ['12.50', 12.5], ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['$ 20', 20], ['1,500', 1500], ['0,3', 0.3],
        ['1.234.567', 1234567], [7, 7], ['-5,5', -5.5], ['1.500', 1500], ['2.75', 2.75], ['0.300', 0.3], ['0,300', 0.3], ['12.5', 12.5]];
    for (const [t, v] of c) assert.strictEqual(E.numeroES(t), v, t);
    for (const t of ['', 'abc', '12a', null]) assert.ok(Number.isNaN(E.numeroES(t)), String(t));
    assert.strictEqual(E.validarCosto({ categoria: 'ia', concepto: 'x', usd: '12,50' }, '2026-11').costo.usd, 12.5);
    assert.strictEqual(E.validarConfig({ cpmBrutoUsd: '2,75', cajaUsd: '1.500,40' }).cfg.cajaUsd, 1500.4);
});

test('ingresos escritos a mano: la publicidad real reemplaza la estimada', () => {
    const ing = E.validarCosto({ tipo: 'ingreso', categoria: 'publicidad', concepto: 'AdSense octubre', usd: '30' }, '2026-11');
    assert.strictEqual(ing.costo.tipo, 'ingreso');
    assert.ok(E.validarCosto({ tipo: 'ingreso', categoria: 'servidor', concepto: 'x', usd: 1 }, '2026-11').error);   // categoría de costo
    const base = { anuncios: { vistos: 10000, creadoresUsd: 0 }, cfg };
    assert.strictEqual(E.calcularPyG(base).ingresos.publicidadUsd, 40);   // estimada: 10.000 × 4 / 1.000
    const p = E.calcularPyG({ ...base, costos: [{ tipo: 'ingreso', categoria: 'publicidad', usd: 30 }, { tipo: 'ingreso', categoria: 'patrocinio', usd: 5 }, { categoria: 'servidor', usd: 7 }] });
    assert.strictEqual(p.ingresos.publicidadReal, true); assert.strictEqual(p.ingresos.publicidadUsd, 30); assert.strictEqual(p.ingresos.publicidadEstimadaUsd, 40);
    assert.strictEqual(p.ingresos.otrosUsd, 5); assert.strictEqual(p.ingresos.total, 35);
    assert.deepStrictEqual(p.costos.manuales, { servidor: 7 }); assert.strictEqual(p.ganancia, 28);
});

test('diagnóstico: estado de cada chequeo', () => {
    assert.strictEqual(E.estadoChequeo({ ok: true, ms: 100 }), 'ok');
    assert.strictEqual(E.estadoChequeo({ ok: true, ms: 5000 }), 'lento');
    assert.strictEqual(E.estadoChequeo({ ok: false, ms: 10 }), 'falla');
    assert.strictEqual(E.estadoChequeo({ ok: true, configurado: false }), 'sin_configurar');
    const a = E.generarAlertas({ diagnostico: { resultados: [{ nombre: 'PayPal', estado: 'falla', critico: true, detalle: 'token' }, { nombre: 'Correo', estado: 'falla', critico: false, detalle: 'x' }] },
        monitor: { disponibilidad24h: 97.5, ahora: { peticiones: 100, erroresPct: 5, p95: 4000 } }, respaldo: { fecha: new Date() }, cfg: E.configCompleta({ cpmBrutoUsd: 1, cajaUsd: 1 }), costosMesN: 1 });
    assert.ok(a.find(x => /PayPal/.test(x.texto)).nivel === 'alta');
    assert.ok(a.find(x => /Correo/.test(x.texto)).nivel === 'media');
    assert.ok(a.some(x => /97,5 %/.test(x.texto))); assert.ok(a.some(x => /están fallando/.test(x.texto))); assert.ok(a.some(x => /lenta/.test(x.texto)));
});

test('monitor: peticiones por minuto, p95 y disponibilidad', () => {
    const M = require('../modulos/monitor');
    M._minutos.clear();
    for (let i = 1; i <= 100; i++) M.anotar(i === 100 ? 503 : i === 99 ? 404 : 200, i);
    const r = M.resumen(15);
    assert.strictEqual(r.peticiones, 100); assert.strictEqual(r.e5, 1); assert.strictEqual(r.e4, 1);
    assert.strictEqual(r.erroresPct, 1); assert.strictEqual(r.p95, 96); assert.strictEqual(r.msProm, 51);
    const ahora = Date.UTC(2026, 10, 15, 12);
    const fotos = Array.from({ length: 288 }, (_, i) => ({ t: new Date(ahora - (288 - i) * 300e3 + 1000), dbOk: i % 48 !== 0 }));
    assert.strictEqual(M.disponibilidad(fotos, ahora), 97.9);   // 6 fotos sin base de datos de 288
    assert.strictEqual(M.disponibilidad(fotos.slice(0, 144), ahora), 49);   // 141 buenas de 288: 12 h sin fotos = caído
    assert.strictEqual(M.disponibilidad([], ahora), null);
});

console.log(`  ${n} pruebas OK`);
