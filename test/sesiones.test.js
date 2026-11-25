'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { crear } = require('../modulos/sesiones');
const live = require('../rutas/live');

const secreto = 'solo-pruebas-de-sesion';
const token = (datos = {}, opciones = {}) => jwt.sign({ usuario: 'ana', ...datos }, secreto, opciones);

test('una nueva versión invalida el token anterior en todas las instancias', async () => {
    let cuenta = {};
    const deps = { secreto, buscarCuenta: async () => cuenta, estaSuspendido: () => false };
    const validar = crear(deps);
    const otraInstancia = crear(deps);
    const anterior = token();
    assert.equal((await validar(anterior)).datos.usuario, 'ana');
    cuenta = { sesionVer: 1 };
    assert.equal((await validar(anterior)).code, 'SESSION_REVOKED');
    assert.equal((await otraInstancia(anterior)).code, 'SESSION_REVOKED');
    assert.equal((await validar(token({ sv: 1 }))).datos.usuario, 'ana');
    assert.equal((await validar(token({ sv: 1 }, { expiresIn: -1 }))).code, 'TOKEN_EXPIRED');
    cuenta.suspendido = true;
    assert.equal((await validar(token({ sv: 1 }))).status, 403);
    cuenta = null;
    assert.equal((await validar(token({ sv: 1 }))).status, 401);
    const sinBase = crear({ ...deps, buscarCuenta: async () => { throw new Error('Mongo no disponible'); } });
    assert.equal((await sinBase(anterior)).status, 503);
});

test('Live desconecta una sesión revocada antes de procesar su siguiente evento', { timeout: 6000 }, async () => {
    let sesionVer = 0;
    const estaSuspendido = () => false;
    const validarSesion = crear({ secreto, buscarCuenta: async () => ({ sesionVer }), estaSuspendido });
    const app = express();
    const server = createServer(app);
    const logger = { info() {}, warn() {}, error() {} };
    const { io } = live.registrar(app, server, {
        verificarToken: (_req, _res, next) => next(),
        verificarAdmin: (_req, _res, next) => next(),
        config: { ALLOWED_ORIGINS: [] }, logger, validarSesion, usuarioOpcional: () => null, estaSuspendido,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const base = `http://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=polling`;
        const apertura = await (await fetch(base)).text();
        assert.equal(apertura[0], '0');
        const url = base + '&sid=' + JSON.parse(apertura.slice(1)).sid;
        const evento = body => fetch(url, { method: 'POST', body });
        const conectado = once(io, 'connection');
        assert.equal((await evento('40' + JSON.stringify({ token: token() }))).status, 200);
        const [socket] = await conectado;
        assert.equal(socket.data.usuario, 'ana');
        assert.match(await (await fetch(url)).text(), /^40/);
        let recibido = false;
        socket.on('like', () => { recibido = true; });
        const desconectado = once(socket, 'disconnect', { signal: AbortSignal.timeout(3000) });
        sesionVer++;
        await evento('42["like",{}]');
        await desconectado;
        assert.equal(recibido, false);
    } finally {
        await io.close();
    }
});
