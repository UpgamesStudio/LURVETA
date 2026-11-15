/**
 * Regresión: rutas/economia.js carga los modelos de blogs antes que rutas/blogs.js, y la segunda carga
 * devolvía la lista SIN BlogMensaje (bandeja de mensajes, formulario de contacto y pedidos fallaban en producción).
 */
'use strict';
const assert = require('assert');
const mongoose = require('mongoose');
const modelos = require('../modulos/blogs/modelos');

const primera = modelos(mongoose), segunda = modelos(mongoose);
for (const nombre of ['Blog', 'Entrada', 'BlogVista', 'BlogReporte', 'BlogMensaje']) {
    assert.strictEqual(typeof primera[nombre]?.find, 'function', `1ª carga: falta ${nombre}`);
    assert.strictEqual(segunda[nombre], primera[nombre], `2ª carga: ${nombre} debe ser el mismo modelo`);
}
console.log('modelosBlog: 5 modelos disponibles en cada carga ✓');
