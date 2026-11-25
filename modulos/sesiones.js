'use strict';

const jwt = require('jsonwebtoken');

const invalida = (code, error, status = 401) => ({ code, error, status });

function crear({ secreto, buscarCuenta, estaSuspendido }) {
    return async function validarSesion(token) {
        if (typeof token !== 'string' || token === 'undefined' || token === 'null' || token.length < 20)
            return invalida('NO_TOKEN', 'Sesión no iniciada');

        let datos;
        try {
            datos = jwt.verify(token, secreto, { algorithms: ['HS256'] });
        } catch (error) {
            return error.name === 'TokenExpiredError'
                ? invalida('TOKEN_EXPIRED', 'Tu sesión expiró, vuelve a iniciar sesión')
                : invalida('TOKEN_INVALID', 'Sesión inválida, vuelve a iniciar sesión');
        }
        if (typeof datos.usuario !== 'string' || !datos.usuario)
            return invalida('TOKEN_INVALID', 'Sesión inválida, vuelve a iniciar sesión');

        let cuenta;
        try {
            cuenta = await buscarCuenta(datos.usuario);
        } catch (_) {
            return invalida('SESSION_UNAVAILABLE', 'No se pudo comprobar la sesión. Reintenta en unos instantes.', 503);
        }
        if (!cuenta) return invalida('TOKEN_INVALID', 'La cuenta ya no existe');
        if (cuenta.suspendido || estaSuspendido(datos.usuario))
            return invalida('SUSPENDIDO', 'Tu cuenta está suspendida. Contacta a soporte.', 403);
        if ((datos.sv ?? 0) !== (cuenta.sesionVer ?? 0))
            return invalida('SESSION_REVOKED', 'Tu contraseña cambió. Vuelve a iniciar sesión.');
        return { datos };
    };
}

module.exports = { crear };
