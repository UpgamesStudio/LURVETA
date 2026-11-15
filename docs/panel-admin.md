# Panel de administración de UpGames

Guía para quien trabaja en el panel (`/admin/`). La misma información está dentro del panel, en **Guía del panel** y en el botón **?** de la barra superior.

## Empezar

- El menú agrupa las secciones (General, Contenido, Comunidad, Finanzas, Sistema). Los grupos se pliegan tocando su título y solo aparecen las secciones para las que tienes permiso.
- Un número rojo en el menú es **trabajo pendiente** en esa sección.
- **Ctrl + K** abre un buscador para ir a cualquier sección o lanzar una acción escribiendo.
- El panel se actualiza solo cada 30 s.

## Secciones

| Sección | Para qué sirve | Permiso |
|---|---|---|
| Inicio | Lo pendiente, la actividad en vivo y las cifras del día | estadísticas |
| Empresa | Estado de resultados, costos, caja, operación, crecimiento, metas y respaldo | solo el dueño |
| Métricas | Visitantes, embudo, retención y búsquedas (7, 30 o 90 días) | estadísticas |
| Informes | Registro mensual de toda la actividad, para descargar | estadísticas o finanzas |
| Revisión | Aprobar o rechazar publicaciones nuevas | revisión o contenido |
| Entradas / Videos | Todo el contenido publicado | contenido |
| Verificación | Publicaciones con nombre de juego comercial | revisión o contenido |
| Reportes | Contenido denunciado por la comunidad | revisión o contenido |
| Blogs | Sitios de los usuarios (UpGames Blogs): reportados, en revisión y suspendidos; activar o suspender | revisión, contenido o sanciones (cambiar estado: contenido o sanciones) |
| Comentarios / Moderación IA | Moderación | comentarios |
| Usuarios | Cuentas, suspensiones y saldos | usuarios, sanciones o finanzas |
| Anuncios | Mensajes a la comunidad | anuncios |
| Economía / Extras UC / Pagos / Tarjetas | Ingresos, UpCoins y cobros de creadores | finanzas |
| Equipo / Auditoría | Accesos y registro de acciones | solo el dueño |

## Empresa (solo el dueño)

La empresa completa en una pantalla. Código: `rutas/empresa.js` · pruebas: `test/empresa.test.js`.

| Pestaña | Qué muestra |
|---|---|
| Resumen | Ingresos, costos, ganancia y margen contra el mes anterior; caja y meses que alcanza; cuentas activas, nuevas y Premium; deuda con creadores; **alertas** por urgencia; **metas** del mes; gráfico de 6 meses |
| Finanzas | Estado de resultados de 6 meses, costos del mes (los escribe el dueño), balance de hoy, proyección al cierre y ventas por producto |
| Operación | Servidor y base de datos, errores de las últimas 24 h, seguridad y fraude, trabajo pendiente, **respaldo** y cuánto se guarda cada dato |
| Crecimiento | ARPU, ARPPU, conversión a pago, % Premium, churn de Premium, CAC, LTV, LTV ÷ CAC, usuarios y referidos |
| Metas y parámetros | CPM que paga la red publicitaria, comisión de la pasarela, caja disponible y metas mensuales |

El número rojo del menú cuenta las alertas urgentes.

### De dónde sale cada cifra

Todo es **devengado**: lo generado en el mes, aunque se cobre o pague después.

- **Ventas con dinero:** `live_transacciones` (igual que Economía; sin las revertidas).
- **Publicidad:** anuncios vistos (`stats_items` + `blogvistas`) × el CPM que la red le paga a UpGames. Si el CPM no está escrito, sale en 0.
- **Creadores:** su parte de las ventas y regalos (`creadorUsd`), el CPM que se les abona (`stats_items.g`) y lo de los blogs (`blogvistas.g` + `gd`).
- **Comisiones de pasarela:** estimadas, % + fijo por venta.
- **Costos fijos:** colección `empresa_costos`. «Cada mes» repite un costo hasta que se quita. Quitarlo en un mes posterior lo detiene desde ese mes y conserva el historial.
- **Churn de Premium:** Premium que vencieron en el mes sin renovar ÷ (esos + los activos). Es aproximado.
- **CAC:** costos de la categoría «Marketing y publicidad» ÷ cuentas nuevas.
- **LTV:** ARPPU × margen de contribución × vida media (1 ÷ churn, con tope de 24 meses).
- **Meses de caja:** caja ÷ pérdida media de los últimos 3 meses cerrados. Si no hay pérdidas, no se agota.

### Respaldo

**Operación → Descargar respaldo completo** baja todas las colecciones en un JSON (EJSON canónico, que conserva ObjectId, fechas y números). Se puede pedir uno cada 5 minutos y la fecha del último queda en `empresa_config`.

Contiene datos personales, contraseñas cifradas y secretos de 2FA: guárdalo cifrado y fuera del equipo.

Para restaurar una colección, extrae su lista y cárgala con `mongoimport`:

```
node -e "const {EJSON}=require('bson');const o=EJSON.parse(require('fs').readFileSync('UpGames-respaldo.json','utf8'),{relaxed:false});require('fs').writeFileSync('usuarios.json',EJSON.stringify(o.colecciones.usuarios,{relaxed:false}))"
mongoimport --uri "$MONGODB_URI" --collection usuarios --jsonArray --file usuarios.json
```

### API

```
GET    /admin/empresa?mes=AAAA-MM[&formato=csv]
PUT    /admin/empresa/config
POST   /admin/empresa/costos            { mes, categoria, concepto, usd, recurrente }
DELETE /admin/empresa/costos/:id?mes=AAAA-MM
POST   /admin/empresa/respaldo
```

## Actividad en vivo

La tarjeta **En vivo** de Inicio muestra las personas activas en los últimos 5 minutos, la actividad de los últimos 60 minutos minuto a minuto y los últimos movimientos. Se actualiza cada 15 s (`GET /admin/metricas/vivo`). Los visitantes son anónimos; la serie por minuto vive en la memoria del servidor y se reinicia con cada despliegue.

## Informe mensual

Reúne todo lo que pasó en un mes natural (hora de Colombia):

- **Resumen** con comparación contra el mes anterior: visitantes, visitantes nuevos, cuentas, publicaciones, anuncios vistos, búsquedas, publicaciones abiertas, idas a descargar, comentarios, reportes y pagos completados.
- **Día a día**: una fila por día con las mismas cifras.
- **Tops**: creadores y publicaciones con más anuncios vistos, categorías, lo más buscado y lo buscado sin resultado, reportes por motivo.
- **Pagos a creadores** (resumen y detalle): solo con permiso de finanzas.
- **Acciones del equipo** (por persona y detalle): solo el dueño.

No incluye emails, IP ni datos de cobro.

### Cómo se obtiene

1. **En el panel → Informes**: elegir el mes y pulsar *Descargar Excel (CSV)*, *JSON* o *Imprimir / PDF*.
2. **Descarga automática**: con la casilla *Descargar solo cada mes en este dispositivo*, el informe del mes cerrado se baja la primera vez que esa persona entra al panel en el mes nuevo. Sin la casilla, Inicio muestra un aviso con el botón de descarga.
3. **Correo al dueño**: al empezar cada mes el servidor envía a `OWNER_EMAIL` el resumen con el enlace al panel (colección `informes_enviados` para no repetirlo). Necesita el correo configurado (`RESEND_API_KEY` y `EMAIL_FROM`).

### API

```
GET /admin/informes/meses                          → últimos 12 meses
GET /admin/informes/mensual?mes=AAAA-MM            → JSON
GET /admin/informes/mensual?mes=AAAA-MM&formato=csv → CSV (separador ; y BOM, se abre en Excel)
```

Cabecera `x-admin-token` con la sesión del panel. El código está en `rutas/informes.js` y sus pruebas en `test/informes.test.js`.

### Hasta cuándo hay datos

| Dato | Se conserva |
|---|---|
| Visitas diarias | 180 días |
| Búsquedas | 120 días |
| Estadísticas por publicación (anuncios vistos) | 400 días |
| Auditoría del equipo | 180 días |
| Cuentas, publicaciones, comentarios, pagos | siempre |

Por eso conviene **descargar y archivar cada mes**: un informe de hace más de seis meses ya no puede reconstruir las visitas ni las acciones del equipo.
