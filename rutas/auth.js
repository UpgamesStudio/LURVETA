/**
 * Autenticación: registro, login y sesión
 *
 * Identidad única (usuario y email), registro, inicio de sesión y verificación.
 * Extraído de index.js: recibe sus dependencias explícitas (ver la llamada en index.js).
 */
module.exports = function auth({ API_URL_SELF, EMAIL_NORMALIZE_OPTS, Limites, RegistroPendiente, Usuario, app, bcrypt, body, crypto, correoPermitido, emailVerifTemplate, firmarToken, gamification, gmailLegacyEmail, logger, sendEmail, twoFactor, validationResult }) {
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const NOMBRES_RESERVADOS = new Set(['admin', 'administrador', 'upgames', 'nexus', 'soporte', 'support',
    'moderador', 'mod', 'staff', 'sistema', 'system', 'root', 'oficial', 'official', 'coral', 'rouce', 'roucedev']);
function errorNombreUsuario(nombre) {
    const n = String(nombre || '').trim().toLowerCase();
    if (n.length < 3 || n.length > 20) return 'El nombre debe tener entre 3 y 20 caracteres';
    if (!USERNAME_RE.test(n)) return 'Solo se permiten letras (a-z), números y guion bajo (_), sin espacios ni tildes';
    if (NOMBRES_RESERVADOS.has(n)) return 'Ese nombre está reservado. Elige otro';
    return null;
}
/** Error E11000 de MongoDB (índice único) → mensaje claro según el campo */
function mensajeDuplicado(err) {
    if (!err || err.code !== 11000) return null;
    const campo = Object.keys(err.keyPattern || err.keyValue || {})[0] || '';
    return campo === 'email' ? 'Ese email ya está registrado en otra cuenta' : 'Ese nombre de usuario ya está en uso';
}
// GET /auth/disponibilidad?usuario= — solo comprueba nombres públicos.
app.get('/auth/disponibilidad', async (req, res) => {
    if (!(await Limites.permitir(`disp:${req.ip || ''}`, [[Limites.MIN, 40]]))) return res.status(429).json({ success: false, error: 'Demasiadas consultas, espera un momento' });
    try {
        const out = { success: true };
        if (typeof req.query.usuario === 'string' && req.query.usuario.trim()) {
            const n = req.query.usuario.trim().toLowerCase();
            const err = errorNombreUsuario(n);
            if (err) out.usuario = { disponible: false, motivo: err };
            else {
                const existe = await Usuario.exists({ usuario: n });
                out.usuario = existe ? { disponible: false, motivo: `@${n} ya existe. Prueba con otro nombre` } : { disponible: true };
            }
        }
        res.json(out);
    } catch (err) {
        logger.error(`[disponibilidad] ${err.message}`);
        res.status(500).json({ success: false, error: 'No se pudo comprobar' });
    }
});

const registroRecibido = res => res.status(202).json({
    success: true, ok: true,
    mensaje: 'Revisa tu correo para verificar la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.',
});

app.post('/auth/register', [
    body('usuario').trim().isLength({ min: 3, max: 20 }).toLowerCase(),
    body('email').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });

        const { usuario, email, password } = req.body;
        const errNombre = errorNombreUsuario(usuario);
        if (errNombre) return res.status(400).json({ success: false, error: errNombre, campo: 'usuario' });
        const registrationIP = req.ip;

        const existeUsuario = await Usuario.exists({ usuario });
        if (existeUsuario) return res.status(409).json({ success: false, error: `El nombre @${usuario.toLowerCase()} ya está en uso. Elige otro`, campo: 'usuario' });

        const emailClave = crypto.createHash('sha256').update(email).digest('hex');
        if (!(await correoPermitido('registro', emailClave))) return registroRecibido(res);
        const passwordHash = await bcrypt.hash(password, 10);
        if (await Usuario.exists({ email })) return registroRecibido(res);

        const verifToken = crypto.randomBytes(32).toString('hex');
        const ref = typeof req.body.ref === 'string' ? req.body.ref : req.body.codigoReferral;
        await RegistroPendiente.create({
            usuario, email, password: passwordHash, registrationIP,
            referido: typeof ref === 'string' ? ref.slice(0, 40) : '',
            tokenHash: crypto.createHash('sha256').update(verifToken).digest('hex'),
            vence: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        sendEmail({ to: email, subject: '✅ Verifica tu email en Lurveta', html: emailVerifTemplate(usuario, verifLink) }).catch(() => {});
        return registroRecibido(res);
    } catch (error) {
        // Dos registros simultáneos con el mismo nombre/email: el índice único lo frena
        const dup = mensajeDuplicado(error);
        if (dup) return res.status(409).json({ success: false, error: dup, campo: 'usuario' });
        logger.error(`Error en register: ${error.name} (${error.code || "sin código"})`);
        res.status(500).json({ success: false, error: "Error al registrar usuario" });
    }
});

app.post('/auth/login', [body('usuario').isString().notEmpty(), body('password').isString().notEmpty()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const { usuario: identificador, password } = req.body;
        const id = identificador.toLowerCase().trim();
        const orConds = [{ usuario: id }, { email: id }];
        // Fallback para cuentas antiguas de Gmail guardadas sin puntos por el
        // normalizeEmail anterior: permite entrar con el email real "con puntos".
        const legacyGmail = gmailLegacyEmail(id);
        if (legacyGmail) orConds.push({ email: legacyGmail });
        const usuario = await Usuario.findOne({ $or: orConds });
        if (!usuario) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });

        const esValida = await bcrypt.compare(password, usuario.password);
        if (!esValida) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });
        if (usuario.suspendido) return res.status(403).json({ success: false, error: 'Tu cuenta está suspendida' + (usuario.motivoSuspension ? `: ${usuario.motivoSuspension}` : '') + '. Contacta a soporte.', code: 'SUSPENDIDO' });

        // ── Verificación 2FA (si el usuario lo tiene activo) ──
        const tieneDFA = await twoFactor.tieneActivo(usuario.usuario);
        if (tieneDFA) {
            if (typeof req.body.token2fa !== 'string' || !req.body.token2fa.trim()) {
                res.locals.credencialesOk = true;   // la contraseña era correcta: este paso no gasta intentos del límite de login
                return res.status(401).json({ success: false, error: 'Se requiere código 2FA', require2FA: true, code: '2FA_REQUERIDO' });
            }
            const check = await twoFactor.verificar(usuario.usuario, req.body.token2fa.slice(0, 16));
            if (!check.ok) {
                return res.status(check.bloqueado ? 429 : 401).json({ success: false, error: check.error || 'Código 2FA incorrecto', require2FA: true,
                    code: check.bloqueado ? '2FA_BLOQUEADO' : check.usado ? '2FA_USADO' : '2FA_INVALIDO' });
            }
        }

        const token = firmarToken(usuario, req);
        logger.info(`Login exitoso: @${usuario.usuario}`);

        // ── Hook gamificación: racha diaria (fire & forget) ──
        gamification.onLogin(usuario.usuario).catch(() => {});

        // Fire & forget — no bloquea la respuesta
        Usuario.updateOne({ usuario: usuario.usuario }, { $set: { ultimoLogin: new Date() } }).catch(() => {});

        res.json({ success: true, ok: true, token, usuario: usuario.usuario, email: usuario.email, datosUsuario: { usuario: usuario.usuario, email: usuario.email, verificadoNivel: usuario.verificadoNivel, isVerificado: usuario.isVerificado, saldo: usuario.saldo, socialLinks: usuario.socialLinks || [], lastUsernameChange: usuario.lastUsernameChange || null, lastEmailChange: usuario.lastEmailChange || null } });
    } catch (error) {
        logger.error(`Error en login: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al iniciar sesión" });
    }
});

    return { errorNombreUsuario, mensajeDuplicado };
};
