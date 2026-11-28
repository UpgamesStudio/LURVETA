# Lurveta Blogs

Herramienta para que cualquier usuario cree su sitio o blog desde Lurveta. **Lurveta presta el medio** (editor, alojamiento y entrega de páginas); **el creador es el editor único y responsable** de su contenido. Guía pública para usuarios: `public/blogs-guia.html`. Marco legal: Términos v8.0 §10B (blogs) y §08B (programa de impulso), Privacidad v4.1 §2.6 y §2.7.

## Piezas

| Pieza | Archivo |
|---|---|
| Panel del creador (asistente, editor por bloques, temas, ajustes, dominio, estadísticas) | `public/blog.html`, `public/upgames-blog.js`, `public/upgames-blog.css` |
| Rutas del panel, páginas públicas, comentarios, Nexus escritor, anuncios | `rutas/blogs.js` |
| Modelos (Blog, Entrada, BlogVista, BlogReporte) | `modulos/blogs/modelos.js` |
| Validación de bloques, direcciones y dominios | `modulos/blogs/validar.js` |
| HTML de las páginas (sin scripts) | `modulos/blogs/render.js` |
| Temas (incluidos los exclusivos Premium) | `modulos/blogs/temas.js` |
| Anuncios del blog (ticket firmado, marco aislado) | `modulos/blogs/anuncios.js` |
| Nexus escritor (prompt y armado del borrador) | `modulos/blogs/escritor.js` |
| Marco de comentarios (vive en lurveta.com, donde está la sesión) | `public/blog-comentarios.html`, `.js`, `.css` |
| Guía pública | `public/blogs-guia.html` |

## Cómo funciona

- **Direcciones:** `/b/<direccion>/…` (gratis), dominio propio verificado por CNAME + TXT, o `<direccion>.BLOGS_DOMINIO` si se configura esa variable.
- **Páginas sin scripts:** el servidor genera el HTML; todo lo que escribe el creador se escapa. CSP estricta: solo se permiten marcos de YouTube, Spotify, el propio blog (anuncio) y `APP_URL` (comentarios).
- **Aceptación de términos:** `POST /blogs` exige `aceptaTerminos: true` y guarda `terminos: { version, fecha, ip }` en el blog (constancia de que el creador asumió la responsabilidad). Versión actual: `TERMINOS_BLOGS` en `rutas/blogs.js`.
- **Moderación:** reglas antes de publicar (texto y enlaces: sin acortadores, IP sueltas ni dominios disfrazados) y NEXUS en segundo plano, que devuelve a borrador lo claramente inaceptable.
- **Aviso a seguidores:** después de la revisión de NEXUS, una notificación `nueva_entrada` (con push) por seguidor; una sola vez por entrada (`Entrada.avisada`) y máximo 3 al día por blog.
- **Bloque Descarga:** solo publicaciones aprobadas de Lurveta; el botón lleva a `puente.html?id=…` (espera, anuncios y ticket), así cuenta al CPM normal del **dueño de la publicación**.
- **Comentarios:** `GET/POST /blogs/comentarios/:eid` y `DELETE /blogs/comentarios/:eid/:cid` (borra el autor o el dueño del blog). Se guardan en `Comentario` con `itemId = blog:<entradaId>` y pasan por Cero Tolerancia, reglas de moderación, límites y revisión de NEXUS.
- **Nexus escritor:** `POST /blogs/nexus/escribir` (`juegoId`, `tipo`: reseña | guía | noticia, `nota`). Límites: 6/hora y 20/día por usuario, 30/min en total. La salida pasa por `limpiarBloques`; la imagen, la tarjeta y la descarga se agregan por código. Sin clave de Groq responde 503.
- **Premium:** sin «Hecho con Lurveta», 10 blogs (3 gratis) y temas `cristal` y `lienzo`. Si vence, el tema exclusivo se muestra con el tema por defecto.
- **Monetización (opcional):** marco aislado con ticket firmado (blog + hora + huella de IP), pago por anuncio visto ≥10 s, límites 3/día por blog y 25/día en total por IP, anti-fraude. Tarifa: `BLOGS_CPM` (US$ por 1.000).

## Comunidad editorial

- Una cuenta verificada puede crear sitios, páginas, artículos y notas sin publicar en el catálogo. Los bloques de catálogo y descarga se pueden añadir cuando convienen al contenido. La publicidad editorial se activa desde Ingresos y conserva el CPM vigente.
- El propósito, las temáticas, el orden del menú y el pie se editan en Ajustes. La página de inicio puede ser cualquier página publicada del propio sitio. El menú puede ocultar el acceso a Blog. Los bloques Lista de artículos y Suscripción al blog se rellenan a partir del sitio.
- Post Studio ofrece una redacción generalista y conserva la generación desde una publicación como opción adicional. Nexus recibe el propósito, las temáticas y el estilo editorial del sitio del propio creador. Los borradores requieren revisión antes de publicar.
- Las notas de comunidad aparecen en el feed y en el perfil editorial de un sitio público. La opción Comunidad y sitio añade la nota a `/notas` y le da una URL `/n/…`. Las notas y republicaciones se excluyen del sitemap, el RSS y la indexación. Los artículos conservan su URL canónica.
- `GET /blogs/descubrir?vista=…` entrega lotes de 12 con cursor por fecha e ID. Para ti pondera actualidad, conversación, reacciones, lectura, intereses inferidos de blogs seguidos y el beneficio Premium existente. Alterna autores dentro de cada lote. Siguiendo es cronológico y reúne publicaciones de personas y de sitios seguidos. La respuesta sin `vista` mantiene el contrato previo.
- Los seguimientos de personas usan el perfil existente. Los seguimientos de sitios permiten avisos por cada artículo o lectura sin avisos. Las notificaciones y las respuestas usan los registros de Lurveta. El correo editorial requeriría un proveedor operativo y un flujo específico de consentimiento, confirmación y cancelación. La demostración usa avisos en Lurveta.

## Datos personales (resumen de Privacidad §2.6)

Contenido del blog (público), dominio y consulta DNS, estadísticas diarias sin datos de visitantes (IP en memoria 30 min para no duplicar visitas; huella cifrada en el ticket del anuncio), comentarios (usuario, texto, fecha), reportes (motivo, detalle e IP hasta resolverlos) y la constancia de aceptación (versión, fecha e IP; hasta 5 años después de borrar el blog).

## Programa de impulso a creadores

Beneficio discrecional que entrega el equipo: **2.000 UpCoins promocionales** (no retirables ni canjeables por dinero) y **30 días de Premium** sin renovación automática, una vez por persona. Condiciones en Términos §08B. Hoy se otorga desde el panel admin (saldo de UpCoins y Premium); no hay un flujo automático.

## Pruebas

- `npm test` → `test/blogs.test.js` (validación, render, descarga, comentarios, Premium, escritor).
- `node test/real/blogs.js` → compatibilidad de Blogs con el servidor real y MongoDB en memoria.
- `node test/real/blog-editorial.js` → cinco cuentas nuevas, contenidos, formularios, navegación, interacción, visibilidad, SEO y descarga opcional contra MongoDB aislado.
- `node test/real/blog-editorial.js --servir` → conserva la demostración local en `http://localhost:3000/__demo/`. Se puede indicar un directorio de archivos locales con `LURVETA_PREVIA_DIR`. Las fotografías opcionales se leen de `media/valle.jpg`, `media/montana.jpg`, `media/estudio.jpg` y `media/camara.jpg`.
- `node test/real/portada.js` → la biblioteca con el catálogo real de producción.
