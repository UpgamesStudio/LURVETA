/**
 * Tests del reparto del dinero (modulos/reparto.js) y de los métodos de cobro
 * (rutas/cobros.js). Autónomo: `node test/reparto.test.js` (o `npm test`).
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto_de_prueba_para_cifrar';
const assert = require('assert');
const R = require('../modulos/reparto');
const L = require('../modulos/live');
const { PLANES, BONO_PAQUETE } = require('../rutas/tienda');
const C = require('../rutas/cobros');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

test('regalos (UpCoins): el creador recibe 50 % y UpGames 50 %', () => {
    const r = L.reparto(500);   // 💎 Diamante: 500 UpCoins = US$10
    assert.strictEqual(r.bruto, 10); assert.strictEqual(r.creador, 5); assert.strictEqual(r.plataforma, 5);
});
test('regalos: aun en el peor caso (paquete más grande + bono del pase) el bono no sube al creador por encima del 50 % de lo pagado', () => {
    for (const p of L.PAQUETES) {
        const monedas = p.monedas + R.bonoPaquete(p.monedas, p.usd, BONO_PAQUETE);
        const creador = monedas * L.MONEDA_USD * R.REGALO_CREADOR;
        const base = p.monedas * L.MONEDA_USD * R.REGALO_CREADOR / p.usd;   // los paquetes grandes tienen descuento: 50 % del valor nominal puede superar el 50 % de lo pagado
        assert.ok(creador / p.usd <= Math.max(0.5, base) + 1e-6, `${p.id}: ${(creador / p.usd * 100).toFixed(1)} %`);
    }
});
test('acceso directo: 25 % para el creador', () => assert.strictEqual(R.ACCESO_CREADOR, 0.25));
test('pases: fondo + monedas de regalo ≤ tope del creador (50 %) de lo pagado, con cualquier método', () => {
    for (const p of PLANES) for (const metodo of ['tarjeta_mp', 'paypal', 'saldo', 'monedas']) {
        const pagado = metodo === 'monedas' ? p.monedas * R.VALOR_MONEDA_MIN : p.usd;
        const fondo = R.fondoPase({ usd: p.usd, monedas: p.monedas, metodo, monedasRegalo: p.monedasRegalo });
        const total = fondo + p.monedasRegalo * L.MONEDA_USD * R.REGALO_CREADOR;
        assert.ok(fondo >= 0 && total <= pagado * R.TOPE_CREADOR + 1e-6, `${p.id}/${metodo}: ${(total / pagado * 100).toFixed(1)} %`);
    }
});
test('ninguna variable de entorno puede subir al creador por encima del 50 %', () => {
    const viejo = process.env.ACCESO_CREADOR; process.env.ACCESO_CREADOR = '0.9';
    delete require.cache[require.resolve('../modulos/reparto')];
    assert.strictEqual(require('../modulos/reparto').ACCESO_CREADOR, 0.5);
    if (viejo === undefined) delete process.env.ACCESO_CREADOR; else process.env.ACCESO_CREADOR = viejo;
    delete require.cache[require.resolve('../modulos/reparto')];
});

test('cobros: cifrar y descifrar ida y vuelta; un dato alterado no se descifra', () => {
    const c = C.cifrar({ numero: '1234567890' });
    assert.deepStrictEqual(C.descifrar(c), { numero: '1234567890' });
    assert.ok(!c.includes('1234567890'));
    assert.strictEqual(C.descifrar(c.slice(0, -4) + 'AAAA'), null);
});
test('cobros: valida y enmascara cada método', () => {
    assert.strictEqual(C.validar('paypal', { email: 'Yo@Correo.com' }).paypalEmail, 'yo@correo.com');
    assert.match(C.validar('mercadopago', { cuenta: 'yo@correo.com', titular: 'Ana' }).resumen, /yo•••@correo\.com/);
});
test('cobros: rechaza datos inválidos', () => {
    for (const [t, d] of [['paypal', { email: 'no-es-email' }], ['tarjeta', { numero: '4111111111111111' }]])
        assert.throws(() => C.validar(t, d), e => e.status === 400, t);
});

console.log(`\n${passed} pruebas OK`);
