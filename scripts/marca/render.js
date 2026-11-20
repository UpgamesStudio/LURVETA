// Rasteriza la marca Lurveta desde public/icons/logo-lurveta.svg (generado por logo.py) a todos los
// PNG/JPG que usa la web. Uso: node scripts/marca/render.js   (necesita playwright y python3 con Pillow)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const R = p => path.join(__dirname, '../..', p);
const SVG = fs.readFileSync(R('public/icons/logo-lurveta.svg'), 'utf8').replace('<svg ', '<svg style="display:block;width:100%;height:auto" ');
const marca = (ancho, brillo = 0) => `<div style="width:${ancho};filter:${brillo ? `drop-shadow(0 0 ${brillo}px rgba(50,213,131,.55))` : 'none'}">${SVG}</div>`;
const FONDO = 'radial-gradient(120% 90% at 50% 40%, #1b1f26 0%, #0d0f13 60%, #07080b 100%)';
const pagina = (cuerpo, fondo = 'transparent') => `<!doctype html><html><head><style>
  html,body{margin:0;width:100%;height:100%;background:${fondo};font-family:Inter,sans-serif;overflow:hidden}
  .c{width:100%;height:100%;display:grid;place-items:center}</style></head><body>${cuerpo}</body></html>`;

const trabajos = [];
const icono = (archivo, lado, pct) => trabajos.push({ archivo, w: lado, h: lado, html: pagina(`<div class="c">${marca(pct + '%', lado / 40)}</div>`, FONDO) });
for (const n of [48, 72, 96, 144, 192, 512]) icono(`public/icons/icon-${n}.png`, n, 84);
icono('public/icons/apple-touch-icon.png', 180, 80);
icono('public/icons/maskable-192.png', 192, 62);    // zona segura de iconos adaptables: círculo del 80 %
icono('public/icons/maskable-512.png', 512, 62);
trabajos.push({ archivo: 'public/icons/logo-upgames.png', w: 448, h: 144, transparente: true, html: pagina(`<div class="c">${marca('94%')}</div>`) });
for (const d of ['public/intro', 'marketing/blogs', 'marketing/ecosistema', 'marketing/patrocinio', 'marketing/publicar', 'marketing/saas'])
  trabajos.push({ archivo: `${d}/logo.png`, w: 1658, h: 532, transparente: true, html: pagina(`<div class="c">${marca('90%', 26)}</div>`) });
trabajos.push({ archivo: 'public/og-cover.png', w: 2048, h: 2048, html: pagina(`<div class="c"><div style="width:1540px;height:1540px;border-radius:50%;
  border:22px solid #32D583;box-shadow:0 0 90px rgba(50,213,131,.6),inset 0 0 90px rgba(50,213,131,.35);display:grid;place-items:center;background:#0b0d11">
  ${marca('1180px', 40)}</div></div>`, 'linear-gradient(180deg,#2a2f38 0%,#101318 35%,#07080b 100%)') });
trabajos.push({ archivo: 'public/og-upgames.jpg', w: 1200, h: 630, html: pagina(`
  <div style="position:absolute;inset:0;background:radial-gradient(60% 70% at 85% 10%,rgba(50,213,131,.22),transparent 60%),radial-gradient(50% 60% at 10% 100%,rgba(90,200,250,.10),transparent 60%),#07090d"></div>
  <div style="position:absolute;left:72px;top:165px;width:300px;height:300px;border-radius:50%;background:#15181d;box-shadow:0 0 60px rgba(50,213,131,.45);display:grid;place-items:center">${marca('236px', 10)}</div>
  <div style="position:absolute;left:430px;top:142px;right:60px;color:#fff">
    <div style="font-weight:800;letter-spacing:.18em;color:#32D583;font-size:22px">LURVETA</div>
    <div style="font-weight:800;font-size:46px;line-height:1.16;margin-top:20px;letter-spacing:-.01em">El ecosistema digital para gamers, creadores y <span style="background:linear-gradient(90deg,#32D583,#5AC8FA);-webkit-background-clip:text;color:transparent">desarrolladores independientes</span></div>
    <div style="font-size:22px;color:#c3c8d0;margin-top:30px">Juegos · Mods · Apps · Videos · Blogs · Nexus IA</div></div>
  <div style="position:absolute;right:72px;bottom:44px;color:#c3c8d0;font-size:22px;font-weight:600">upgames.games</div>`, '#07090d') });

(async () => {
  const b = await chromium.launch();
  for (const t of trabajos) {
    const p = await b.newPage({ viewport: { width: t.w, height: t.h } });
    await p.setContent(t.html); await p.evaluate(() => document.fonts.ready);
    const png = R(t.archivo) + '.tmp.png';
    await p.screenshot({ path: png, omitBackground: !!t.transparente }); await p.close();
    if (t.archivo.endsWith('.jpg')) { execFileSync('python3', ['-c', `from PIL import Image;import os;Image.open(r'${png}').convert('RGB').save(r'${R(t.archivo)}',quality=90);os.remove(r'${png}')`]); }
    else if (!t.transparente) execFileSync('python3', ['-c', `from PIL import Image;import os;Image.open(r'${png}').convert('RGB').save(r'${R(t.archivo)}',optimize=True);os.remove(r'${png}')`]);
    else fs.renameSync(png, R(t.archivo));
    console.log('ok', t.archivo);
  }
  await b.close();
})();
