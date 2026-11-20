# Pruebas reales

Las pruebas de `npm test` son rápidas y no necesitan red. Estas otras prueban la plataforma **como la usa la gente**, para que errores como una portada que no carga o un carrusel que abre otra publicación no lleguen a producción.

| Archivo | Qué prueba |
|---|---|
| `portada.js` | La biblioteca en un navegador de móvil con el **catálogo real de producción** e imágenes reales de Cloudinary. Revisa que carguen todas las portadas del carrusel, que «Ver más» y el carrusel principal abran la publicación que se ve, que un deslizamiento avance una sola entrada, la ficha (título, «Obtener link» a la página puente, sin «Comprar»), que «atrás» cierre la ficha, los enlaces compartidos, que el inicio recuerde la posición y que no haya errores de JavaScript ni imágenes rotas. |
| `migracion.js` | La portada en `https://upgames.games/`: el puente `/public/biblioteca.html` conserva query y `#` (ID real `6997729a30ddf46b1304e780`), cada parámetro (`?id ?tab=perfil ?plan=1 ?verificar=1 ?q ?ref ?reset_token ?verif ?volver ?login ?registro`) igual por `/` que por el puente, sin bucles, fichas `/public/p/<id>.html` directo a `/?id=`, sin recursos 404, y el service worker: instalación limpia, **actualización desde el main anterior** (6bc94d3), cachés viejas borradas sin tocar las de los juegos y uso sin conexión. |
| `blogs.js` | UpGames Blogs de extremo a extremo: el servidor real (`index.js`) con MongoDB en memoria. Premium, temas exclusivos, aviso a seguidores, comentarios y permisos, bloque de descarga, CSP del marco de comentarios, Nexus sin clave y que el botón «Comprar» no exista. |

## Cómo correrlas

```bash
cd test/real && npm install && npx playwright install chromium
node portada.js        # API=https://otro-servidor para apuntar a otro backend
node blogs.js
```

En GitHub corren solas en cada push y en cada PR a `main` (`.github/workflows/pruebas-reales.yml`), junto con `npm test`. Antes de subir algo a producción hay que correrlas y deben quedar en verde.
