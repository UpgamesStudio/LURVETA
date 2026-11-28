/**
 * 2FA contra MongoDB real en memoria: un código TOTP o de respaldo vale una sola vez (también en paralelo),
 * un setup nuevo no apaga un 2FA activo y /auth/login responde con códigos que el login público entiende.
 * Autónomo: `node test/twoFactor.test.js` (o `npm test`).
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas-2fa';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1/no-se-usa';
const assert = require('assert');
const mongoose = require('mongoose');
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { MongoMemoryServer } = require('mongodb-memory-server');
const tfa = require('../modulos/twoFactor');

(async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('tfa'));
    try {
        const { secret, backupCodes } = await tfa.iniciarSetup('ana', 'ana');
        assert.ok((await tfa.confirmarActivacion('ana', tfa.generarTOTP(secret, -1))).ok);
        assert.equal((await tfa.iniciarSetup('ana', 'ana')).ok, false, 'un setup nuevo no apaga el 2FA activo');
        assert.ok(await tfa.tieneActivo('ana'));

        // El código de la activación no se repite; el actual vale una sola vez aunque lleguen dos a la vez
        assert.equal((await tfa.verificar('ana', tfa.generarTOTP(secret, -1))).usado, true);
        const actual = tfa.generarTOTP(secret);
        const dos = await Promise.all([tfa.verificar('ana', actual), tfa.verificar('ana', actual)]);
        assert.equal(dos.filter(r => r.ok).length, 1, 'mismo TOTP en paralelo: solo uno pasa');
        const respaldo = await Promise.all([tfa.verificar('ana', backupCodes[0]), tfa.verificar('ana', backupCodes[0])]);
        assert.equal(respaldo.filter(r => r.ok).length, 1, 'código de respaldo en paralelo: solo uno pasa');
        console.log('  ✓ TOTP y respaldo de un solo uso, setup no reinicia un 2FA activo');

        // Ruta real de login
        const Usuario = mongoose.model('Usuario', new mongoose.Schema({ usuario: String, email: String, password: String, suspendido: Boolean }));
        await Usuario.create({ usuario: 'ana', email: 'ana@x.com', password: await bcrypt.hash('secreta1', 4) });
        const app = express(); app.use(express.json());
        require('../rutas/auth')({ API_URL_SELF: '', EMAIL_NORMALIZE_OPTS: {}, Limites: {}, RegistroPendiente: {}, Usuario, app, bcrypt, body, crypto,
            correoPermitido: async () => true, emailVerifTemplate: () => '', firmarToken: () => 't'.repeat(30), gamification: { onLogin: async () => {} },
            gmailLegacyEmail: () => null, logger: { info() {}, error() {}, warn() {} }, sendEmail: async () => {}, twoFactor: tfa, validationResult });
        const srv = app.listen(0); const url = `http://127.0.0.1:${srv.address().port}/auth/login`;
        const login = async extra => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'ANA@x.com', password: 'secreta1', ...extra }) }); return { s: r.status, d: await r.json() }; };
        let r = await login();
        assert.equal(r.s, 401); assert.equal(r.d.require2FA, true); assert.equal(r.d.code, '2FA_REQUERIDO');
        r = await login({ token2fa: '000000' === tfa.generarTOTP(secret) ? '111111' : '000000' });
        assert.equal(r.d.code, '2FA_INVALIDO'); assert.equal(r.d.require2FA, true);
        await new Promise(ok => setTimeout(ok, 0));
        r = await login({ token2fa: backupCodes[1].toLowerCase() });
        assert.equal(r.s, 200); assert.ok(r.d.token, 'entra con usuario o email y un código de respaldo');
        for (let i = 0; i < 5; i++) await login({ token2fa: '99999' + i });
        r = await login({ token2fa: backupCodes[2] });
        assert.equal(r.s, 429); assert.equal(r.d.code, '2FA_BLOQUEADO', 'tras 5 fallos queda bloqueado aunque el código sea bueno');
        srv.close();
        console.log('  ✓ /auth/login: 2FA_REQUERIDO, 2FA_INVALIDO, respaldo válido y 2FA_BLOQUEADO');
        console.log('twoFactor: pruebas OK');
    } finally {
        await mongoose.disconnect(); await mongo.stop();
    }
})().catch(e => { console.error(e); process.exit(1); });
