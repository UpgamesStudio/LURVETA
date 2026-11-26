#!/usr/bin/env node
/**
 * Une y minifica las hojas de estilo de la biblioteca en public/upgames-app.css.
 *
 * Antes la portada pedía 6 hojas (~400 KB) que bloqueaban la primera pintura.
 * Ahora es UNA sola, sin comentarios ni espacios de más, en el MISMO orden (la
 * cascada y el diseño no cambian). Las fuentes siguen siendo los archivos de
 * siempre: edítalos a ellos y vuelve a correr este script (la acción
 * .github/workflows/css.yml lo hace sola al subir cambios a main).
 *
 *   node scripts/unir-css.js          → escribe el paquete y actualiza index.html (la portada)
 *   node scripts/unir-css.js --check  → falla si el paquete no está al día
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const PUB = path.join(__dirname, '..', 'public');
const FUENTES = ['biblioteca.css', 'upgames-glass.css', 'upgames-estilo.css', 'upgames-cyber.css', 'upgames-videos.css', 'upgames-ux.css', 'upgames-neo.css', 'upgames-hero.css', 'upgames-v6.css', 'lurveta-ui.css'];
const SALIDA = path.join(PUB, 'upgames-app.css');
const paginas = [[path.join(PUB, '..', 'index.html'), 'public/'], [path.join(PUB, 'biblioteca.html'), '']];

/** Minificador conservador: respeta cadenas y url(); solo quita comentarios y espacios sobrantes. */
function minificar(css) {
  let out = '', i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {            // comentario
      const fin = css.indexOf('*/', i + 2);
      i = fin < 0 ? n : fin + 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {                      // cadena: tal cual
      let j = i + 1;
      while (j < n && css[j] !== c) { if (css[j] === '\\') j++; j++; }
      out += css.slice(i, j + 1); i = j + 1;
      continue;
    }
    out += c; i++;
  }
  // Fuera de las cadenas ya no hay comentarios. Espacios: se protegen las cadenas otra vez.
  const partes = out.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  return partes.map((p, k) => (k % 2 ? p : p
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s*!important/g, '!important')
  )).join('').trim() + '\n';
}

const unido = FUENTES.map(f => `/* ${f} */\n` + fs.readFileSync(path.join(PUB, f), 'utf8')).join('\n');
const min = minificar(unido);
const hash = crypto.createHash('sha1').update(min).digest('hex').slice(0, 10);
const marcador = /<!-- css:inicio -->[\s\S]*?<!-- css:fin -->/;
const cambios = paginas.map(([archivo, prefijo]) => {
  const html = fs.readFileSync(archivo, 'utf8');
  if (!marcador.test(html)) throw new Error(`${archivo}: faltan los marcadores CSS`);
  const enlace = `<link rel="stylesheet" href="${prefijo}upgames-app.css?v=${hash}">`;
  const actualizado = html.replace(marcador, `<!-- css:inicio -->\n<!-- Paquete de: ${FUENTES.join(', ')} (scripts/unir-css.js) -->\n${enlace}\n<!-- css:fin -->`);
  return { archivo, actualizado, cambió: actualizado !== html };
});

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : '';
  if (actual !== min || cambios.some(pagina => pagina.cambió)) { console.error('CSS desactualizado: corre node scripts/unir-css.js'); process.exit(1); }
  console.log('CSS al día'); process.exit(0);
}
fs.writeFileSync(SALIDA, min);
for (const { archivo, actualizado, cambió } of cambios) {
  if (cambió) fs.writeFileSync(archivo, actualizado);
}
const kb = b => (b / 1024).toFixed(0) + ' KB';
console.log(`upgames-app.css: ${kb(Buffer.byteLength(unido))} → ${kb(Buffer.byteLength(min))} (${FUENTES.length} archivos → 1) · v=${hash}`);
