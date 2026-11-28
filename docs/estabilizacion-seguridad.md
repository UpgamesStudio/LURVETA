# Estabilización y seguridad: decisiones y pendientes que requieren autorización

Este documento acompaña la rama de estabilización. Recoge lo que se cambió en el código, lo que **no** se cambió
porque necesita una decisión o una operación externa (DNS, Railway, Mercado Pago) y los fallos que ya existían
antes de intervenir.

## 1. Sesiones (Error 03)

**Estado actual.** El login devuelve un JWT HS256 que el navegador guarda en `localStorage` (`token`) y envía en
`Authorization: Bearer`. El panel guarda su token en `sessionStorage` o, con «mantener sesión», en `localStorage`
(`ugAdmin`). Cada token lleva la versión de sesión de la cuenta (`sv`): cambiar o restablecer la contraseña sube la
versión y revoca todos los tokens anteriores en todas las instancias (`modulos/sesiones.js`). Los tokens web duran
24 h; los de las apps, 30 días.

**Por qué no se migró ya a cookies HttpOnly.** La web se sirve desde GitHub Pages (`lurveta.com`) y la API desde
Railway (`upgames-production.up.railway.app`): son sitios distintos (otro dominio registrable). Una cookie de la API
sería de terceros para `lurveta.com`: Safari la bloquea y Chrome la está retirando, y `SameSite=None` obligaría a
proteger cada petición contra CSRF. Migrar sin cambiar el dominio de la API desconectaría a parte de los usuarios.

**Arquitectura objetivo (requiere autorización y DNS).**
1. Dominio propio para la API: `api.lurveta.com` como dominio personalizado del servicio en Railway (registro CNAME
   en el DNS de `lurveta.com`). Mismo sitio que la web → las cookies dejan de ser de terceros.
2. Cookie de sesión `__Host-`-compatible en la API: `HttpOnly; Secure; SameSite=Lax; Path=/`, con duración corta
   (15–60 min) y una cookie de renovación rotatoria (`HttpOnly; Secure; SameSite=Strict; Path=/auth/renovar`)
   guardada como hash en Mongo para poder revocarla una a una (cerrar sesión en este dispositivo / en todos).
3. CSRF: con `SameSite=Lax` las peticiones entre sitios no llevan la cookie; además, doble envío (`X-CSRF` igual a
   una cookie legible no HttpOnly) en todos los métodos que cambian datos, y comprobación de `Origin` contra la lista
   exacta de CORS.
4. CORS con `credentials: true` y lista exacta (ya está así, ver §3).
5. Transición: durante un periodo la API acepta las dos formas (cookie o `Authorization`); el login nuevo emite
   cookie y deja de devolver el token en el cuerpo para la web; las apps Capacitor siguen con `Authorization`.

**Endurecido ya, sin romper nada.** Escape en las vistas con datos de usuario (la principal vía para robar un token
de `localStorage` es un XSS), 2FA en el login público con anti-replay, `/2fa/verify` ya no es público, `/2fa/setup`
no apaga un 2FA activo, el service worker no guarda respuestas con sesión, el cierre de sesión limpia los datos de la
pestaña y la caché de API, y el panel recarga limpio al cerrar sesión (sin datos ni respuestas de la sesión anterior).

## 2. URLs de la API (Error 10)

Ya existe una fuente central por página: `window.UG_CONFIG.API_URL` (definida en el `<head>` de cada HTML con la
regla de `localhost`). Todos los scripts la leen y solo usan la dirección de Railway como respaldo; la portada
(`public/lurveta-portada.js`) era la única que la ignoraba y ya la usa. Lo que sigue escrito a mano y debe cambiarse
junto si se adopta `api.lurveta.com`: el bloque `UG_CONFIG` de cada HTML, `connect-src` de las CSP, los
`preconnect`, `isApiRequest()` del service worker y `API_URL_SELF`/`APP_URL` en Railway. No se cambió el endpoint de
producción.

## 3. CORS (Error 13)

- Se quitaron `https://upgames.games`, `https://www.upgames.games` y `https://roucedevstudio.github.io`.
  Comprobado el 2026-11-28: `upgames.games` resuelve a GitHub Pages pero responde «Page not found» (no hay sitio
  reclamado: **cualquiera puede publicar ahí** creando un repositorio con ese dominio) y la cuenta antigua
  `roucedevstudio.github.io` responde 404. Si se recupera el control, se añaden con `CORS_ORIGINS` sin tocar código.
- **Acción recomendada fuera del código:** borrar los registros DNS de `upgames.games` que apuntan a GitHub Pages o
  reclamar el dominio en la configuración de Pages de este repositorio (y verificarlo en la organización de GitHub).
- El preflight (`OPTIONS`) usa ahora la misma lista que el resto (antes respondía `*`), y la comparación es exacta.
- Se mantienen `upgamesstudio.github.io` (redirige a `lurveta.com`), `lurveta.com`, `www.lurveta.com`, `APP_URL`,
  `CORS_ORIGINS`, los orígenes locales y los de Capacitor.

## 4. Webhook de Mercado Pago

La firma se exige cuando existe `MERCADOPAGO_WEBHOOK_SECRET`. En producción sin la variable no se corta la recepción
(dejaría sin entregar pagos pendientes), pero ya **no pasa en silencio**: error al arrancar y otro por hora mientras
lleguen avisos sin firma. Cada aviso se verifica consultando el pago con el token propio; monto y moneda deben
coincidir con los fijados al cobrar; producto y usuario vienen de la referencia que fija el servidor; la entrega es
idempotente (`mp:<id>`) y los reembolsos/contracargos la revierten. Ver `docs/mercadopago-webhook.md`.

## 5. Modo turno: concurrencia

Se eligió control optimista en lugar de reservas: cada decisión manda lo que el panel vio (`esperado`: estado,
enlace, número de reportes o revisión) y el servidor la aplica solo si sigue igual; si otro administrador decidió
antes responde 409 y el panel recarga la tarea. Los retiros ya eran atómicos (reclamo `pendiente → procesado`).
Una reserva temporal por tarea (con expiración) puede añadirse más adelante si el equipo crece; no hace falta para
evitar que una decisión vieja pise una nueva.

## 6. Fallos que ya existían antes de la intervención (línea base en `8f678d7`)

- `test/real/navegacion.js` (12 de 52 en rojo) y `test/real/migracion.js` (3 de 55 en rojo): la app usa el propio
  origen como API en `localhost` (`UG_CONFIG`), pero las pruebas solo simulaban la API de Railway, así que el feed de
  Blogs y el aviso de verificación pedían rutas inexistentes al servidor estático. Además la prueba seguía buscando la
  pestaña «Novedades» y su marcado anterior, renombrada a «Blogs» con el feed editorial. Se actualizó el simulador
  (mismas intenciones, nuevo marcado) y ambas quedan en verde. No era un fallo de la aplicación.
- `test/real/blog-editorial.js` pasaba en local pero no corría en CI: ya está en `pruebas-reales.yml`.
