/**
 * NEW · armado de secciones (modulos/blogs/descubrir.js): tope por blog, sin repetir lo
 * de Nexus, «siguiendo» solo de los seguidos y el impulso Premium.
 * Autónomo: `node test/descubrir.test.js` (o `npm test`).
 */
'use strict';
const assert = require('assert');
const D = require('../modulos/blogs/descubrir');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const AHORA = Date.parse('2026-11-20T12:00:00Z'), DIA = 864e5;
const e = (id, o = {}) => ({ id, blogId: o.blogId || `b${id}`, usuario: o.usuario || `u${id}`, titulo: `T${id}`, vistas: 0, comentarios: 0, premium: false, fecha: new Date(AHORA - (o.dias || 1) * DIA).toISOString(), ...o });

test('tope por blog: un solo blog no llena «Recomendado por Nexus»', () => {
    const lista = Array.from({ length: 10 }, (_, i) => e(`a${i}`, { blogId: 'mismo', vistas: 1000 - i })).concat([e('x', { vistas: 1 }), e('y', { vistas: 1 })]);
    const s = D.armar(lista, { ahora: AHORA });
    assert.ok(s.nexus.filter(x => x.blogId === 'mismo').length <= 2);
    assert.ok(s.nexus.some(x => x.id === 'x') && s.nexus.some(x => x.id === 'y'));
});

test('lo que sale en Nexus no se repite en populares ni destacadas', () => {
    const lista = Array.from({ length: 20 }, (_, i) => e(`p${i}`, { vistas: 50 + i, premium: i % 2 === 0 }));
    const s = D.armar(lista, { ahora: AHORA });
    const enNexus = new Set(s.nexus.map(x => x.id));
    assert.ok(s.populares.every(x => !enNexus.has(x.id)));
    assert.ok(s.destacadas.every(x => !enNexus.has(x.id) && x.premium));
});

test('«siguiendo» trae solo de quienes sigue, de lo más nuevo a lo más viejo', () => {
    const lista = [e('1', { usuario: 'ana', dias: 3 }), e('2', { usuario: 'ana', dias: 1 }), e('3', { usuario: 'otro' })];
    const s = D.armar(lista, { ahora: AHORA, siguiendo: ['ana'] });
    assert.deepStrictEqual(s.siguiendo.map(x => x.id), ['2', '1']);
    assert.deepStrictEqual(D.armar(lista, { ahora: AHORA }).siguiendo, []);
});

test('populares: solo del último mes y con lecturas', () => {
    const s = D.armar([e('viejo', { vistas: 9999, dias: 45 }), e('cero', { vistas: 0 }), ...Array.from({ length: 8 }, (_, i) => e(`n${i}`, { vistas: 10 + i }))], { ahora: AHORA });
    assert.ok(!s.populares.some(x => x.id === 'viejo' || x.id === 'cero'));
});

test('puntaje: más lecturas, más conversación y más reciente suben; Premium suma el 10 %', () => {
    const base = { ahora: AHORA, maxVistas: 100, maxCom: 10 };
    const p = o => D.puntaje(e('z', o), base);
    assert.ok(p({ vistas: 100 }) > p({ vistas: 10 }));
    assert.ok(p({ comentarios: 10 }) > p({ comentarios: 0 }));
    assert.ok(p({ dias: 1 }) > p({ dias: 30 }));
    assert.ok(Math.abs(p({ premium: true }) - p({}) - 0.10) < 1e-9);
});

test('lista vacía: secciones vacías, sin errores', () => {
    const s = D.armar([], { ahora: AHORA, siguiendo: ['a'] });
    assert.deepStrictEqual(Object.values(s).map(x => x.length), [0, 0, 0, 0, 0]);
});

test('el feed conserva formatos, variedad de autores y orden cronológico en Siguiendo', () => {
    const lote = [
        e('foto', { usuario: 'ines', tipo: 'nota', temas: ['Fotografía'] }),
        e('nota', { usuario: 'ines', tipo: 'nota', temas: ['Fotografía'] }),
        e('texto', { usuario: 'abril', tipo: 'entrada', temas: ['Cultura'] }),
    ];
    const recomendado = D.ordenarFeed(lote, { ahora: AHORA, vista: 'todo', intereses: ['Fotografía'] });
    assert.deepStrictEqual(recomendado.map(x => x.id), ['foto', 'texto', 'nota']);
    assert.deepStrictEqual(D.ordenarFeed(lote, { ahora: AHORA, vista: 'siguiendo' }), lote);
});

console.log(`\ndescubrir: ${passed} pruebas OK`);
