/**
 * Tests de la moderación por reglas (modulos/moderacion.js), las páginas SEO (modulos/seo.js)
 * y el puntaje de promoción de lives (modulos/live.js). Autónomo: `node test/moderacion.test.js`.
 */
'use strict';

const assert = require('assert');
const M = require('../modulos/moderacion');
const Seo = require('../modulos/seo');
const L = require('../modulos/live');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
const bloquea = (t, tipo) => M.reglas(t, tipo).bloquear;

test('contenido sexual se bloquea aunque venga disfrazado', () => {
    for (const t of ['vendo mi pack de fotos', 'p0rn0 gratis', 'p.o.r.n.o', 'link de onlyfans', 'mod desnudo para skyrim', 'hentai mod', 'xvideos.com'])
        assert.strictEqual(M.reglas(t).categoria, 'sexual', t);
});
test('insultos fuertes, odio y spam no se publican', () => {
    assert.strictEqual(M.reglas('eres un hijo de puta').categoria, 'insulto');
    assert.strictEqual(M.reglas('heil hitler').categoria, 'odio');
    assert.strictEqual(M.reglas('escribeme al whatsapp 3001234567').categoria, 'spam');
    assert.strictEqual(M.reglas('Sub4Sub').categoria, 'spam');
    assert.strictEqual(M.reglas('visita www.a.com y www.b.net').categoria, 'spam');
});
test('jerga, entusiasmo y términos de juegos NO se bloquean', () => {
    for (const t of ['esta de puta madre el juego', 'marica que juego tan bueno', 'que gonorrea de lag', 'GTA 5 prostitutas mision', 'Escort mission en Halo',
        'computadora nueva', 'Minecraft PE 1.21', 'descarga la version 1.0.4', 'Buen mod, gracias!', 'Matar al jefe final es difícil'])
        assert.strictEqual(bloquea(t), false, t);
});
test('las palabras dudosas pasan a la IA (no se bloquean por reglas)', () => {
    assert.strictEqual(M.reglas('eres un estupido').dudoso, true);
    assert.strictEqual(M.reglas('qué mierda de lag').dudoso, true);
});
test('en publicaciones un insulto en el título no bloquea (lo decide la IA)', () => {
    assert.strictEqual(bloquea('Mod: el puto amo del Minecraft', 'publicacion'), false);
    assert.strictEqual(bloquea('Pack nudes 2026', 'publicacion'), true);
});
test('IA: umbrales para quitar', () => {
    assert.strictEqual(M.debeQuitar({ categoria: 'sexual', confianza: 0.8 }), true);
    assert.strictEqual(M.debeQuitar({ categoria: 'insulto', confianza: 0.7 }), false);
    assert.strictEqual(M.debeQuitar({ categoria: 'ok', confianza: 1 }), false);
    assert.strictEqual(M.debeQuitar(null), false);
});
test('SEO: slug estable y sin acentos; la página escapa el HTML', () => {
    assert.strictEqual(Seo.slug('Minecraft PE 1.21 — Ñandú édition!'), 'minecraft-pe-1-21-nandu-edition');
    assert.strictEqual(Seo.slug(''), 'publicacion');
    const it = { id: '6ae0192a31af3f254562d255', title: '<script>x</script>', description: '"><img src=x onerror=1>', image: 'javascript:alert(1)', category: 'Mod', usuario: 'a', fecha: new Date().toISOString() };
    const h = Seo.pagina(it);
    assert.ok(!/<script>x/.test(h) && !/<img src=x/.test(h) && !/javascript:alert/.test(h));
    assert.ok(h.includes('<link rel="canonical" href="https://lurveta.com/public/p/script-x-script-6ae0192a31af3f254562d255.html">'));
});
test('SEO ficha: capturas, videos, relacionados y perfil del creador (solo con datos reales)', () => {
    const base = { id: '6ae0192a31af3f254562d255', title: 'Mod F1', description: 'Mod de prueba', category: 'Mod', usuario: 'kero', fecha: new Date().toISOString(),
        image: 'https://res.cloudinary.com/x/image/upload/v1/portada.jpg' };
    // images mezcla capturas y enlaces de YouTube; la portada no se repite; un enlace raro no se cuela
    const m = Seo.medios(['https://youtu.be/5pABxBWf7Ec?si=abc', 'https://www.youtube.com/watch?v=3ZKK8nzuOuE&t=3', base.image,
        'https://res.cloudinary.com/x/image/upload/v1/cap1.jpg', 'javascript:alert(1)', 'https://res.cloudinary.com/x/video/upload/v1/a.mp4', 'https://youtu.be/5pABxBWf7Ec'], base.image);
    assert.deepStrictEqual(m.youtube, ['5pABxBWf7Ec', '3ZKK8nzuOuE']);
    assert.deepStrictEqual(m.capturas, ['https://res.cloudinary.com/x/image/upload/v1/cap1.jpg']);
    const rel = [{ id: '6ae0192a31af3f254562d256', title: 'Otro <b>mod</b>', category: 'Mod', usuario: 'kero', image: '' }, { ...base }];   // la propia no se lista
    const h = Seo.pagina({ ...base, images: ['https://youtu.be/5pABxBWf7Ec', 'https://res.cloudinary.com/x/image/upload/v1/cap1.jpg'] }, null, { relacionados: rel, perfil: true });
    assert.ok(h.includes('src="https://www.youtube-nocookie.com/embed/5pABxBWf7Ec"') && h.includes('<h2>Capturas</h2>') && h.includes('alt="Captura 1 de Mod F1"'));
    assert.ok(h.includes('href="https://lurveta.com/public/p/otro-b-mod-b-6ae0192a31af3f254562d256.html"') && !/<b>mod<\/b>/.test(h) && (h.match(/class="rel"/g) || []).length === 1);
    assert.ok(h.includes('Publicado por <a href="../u/kero.html">'), 'enlaza la página estática del creador');
    assert.ok(/"screenshot":\["https:\/\/res\.cloudinary\.com\/x\/image\/upload\/v1\/cap1\.jpg"\]/.test(h));
    // Sin datos: nada de secciones vacías ni inventadas; sin página estática, el perfil de la app
    const v = Seo.pagina(base);
    assert.ok(!/<h2>(Video|Capturas|También)/.test(v) && !v.includes('youtube') && v.includes('href="../perfil-publico.html?usuario=kero"') && !/"screenshot"/.test(v));
    // Video subido (categoría Video): reproductor y contentUrl; un link que no es video de Cloudinary no se usa
    const vid = Seo.pagina({ ...base, category: 'Video', video: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4' });
    assert.ok(vid.includes('<video controls preload="none"') && vid.includes('"contentUrl":"https://res.cloudinary.com/x/video/upload/v1/clip.mp4"'));
    assert.ok(!Seo.pagina({ ...base, category: 'Video', video: 'https://evil.example/x.mp4' }).includes('<video'));
    assert.ok(!Seo.pagina({ ...base, category: 'Mod', video: 'https://res.cloudinary.com/x/video/upload/v1/clip.mp4' }).includes('<video'), 'en las demás categorías no se muestra');
});
test('promoción de lives: rendimiento decreciente (no se compra el primer puesto)', () => {
    assert.strictEqual(L.puntosPromo(0), 0);
    assert.ok(Math.abs(L.puntosPromo(30) - 12) < 0.01);
    assert.ok(L.puntosPromo(300) < 4 * L.puntosPromo(30));          // 10× UC no da 10× puntos
    assert.ok(L.puntosPromo(300) < 100 * 3);                        // 100 espectadores (×3) siempre ganan
});

console.log(`\n${passed} pruebas OK`);
