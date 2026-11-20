"""Cambia «UPGAMES» por «LURVETA» en las imágenes de RACING (iconos, logo y splash de la APK).
Detecta la palabra blanca junto a «RACING» (rojo), rellena el fondo y dibuja el texto nuevo
con la misma altura, posición y degradado plateado. Uso: python3 scripts/marca/racing.py <imágenes>"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FUENTE = '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf'

def bandas(filas):
    out, ini = [], None
    for y, v in enumerate(list(filas) + [False]):
        if v and ini is None: ini = y
        if not v and ini is not None: out.append((ini, y - 1)); ini = None
    return out

def procesar(ruta):
    im = Image.open(ruta); modo = im.mode; a = np.array(im.convert('RGBA')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    blanco = (np.minimum(np.minimum(r, g), b) > 150) & (np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b) < 50)
    rojo = (r > 150) & (g < 90) & (b < 90)
    H, W = r.shape; y_min = int(H * 0.45)
    rb = [bd for bd in bandas(rojo.sum(1) > max(2, W * 0.004)) if bd[0] >= y_min and bd[1] - bd[0] >= 3]
    if not rb: return print('  sin texto RACING:', ruta)
    R = rb[-1]                                             # la banda roja más baja = «RACING»
    xr = np.where(rojo[R[0]:R[1] + 1].any(0))[0]
    wb = [bd for bd in bandas(blanco.sum(1) > max(2, W * 0.004)) if y_min <= bd[0] and bd[1] < R[0] and bd[1] - bd[0] >= 3
          and rojo[bd[0]:bd[1] + 1].sum() < 0.02 * blanco[bd[0]:bd[1] + 1].sum()]
    if wb and R[0] - wb[-1][1] < (R[1] - R[0]) * 1.2:      # dos líneas: «UPGAMES» encima de «RACING»
        y0, y1 = wb[-1]; zona = blanco[y0:y1 + 1]; dos = True
    else:                                                  # una línea: «UPGAMES RACING»
        y0, y1 = R; zona = blanco[y0:y1 + 1].copy(); zona[:, xr.min() - 2:] = False; dos = False
    xs = np.where(zona.any(0))[0]; x0, x1 = xs.min(), xs.max()
    ys = np.where(zona.any(1))[0]; y0, y1 = y0 + ys.min(), y0 + ys.max()
    p = max(2, (y1 - y0) // 6)
    X0, X1, Y0, Y1 = max(0, x0 - p), min(W - 1, x1 + p if dos else min(x1 + p, xr.min() - 3)), max(0, y0 - p), min(H - 1, y1 + p)
    t = np.linspace(0, 1, Y1 - Y0 + 1)[:, None, None]      # borra interpolando el fondo de arriba y de abajo
    a[Y0:Y1 + 1, X0:X1 + 1] = (a[Y0 - 1, X0:X1 + 1][None] * (1 - t) + a[min(H - 1, Y1 + 1), X0:X1 + 1][None] * t).astype(int)
    out = Image.fromarray(a.astype('uint8'), 'RGBA')
    alto = y1 - y0 + 1; tam = alto
    for _ in range(3):                                     # ajusta el tamaño para igualar la altura de mayúsculas
        bb = ImageFont.truetype(FUENTE, tam).getbbox('LURVETA'); tam = max(6, round(tam * alto / (bb[3] - bb[1])))
    f = ImageFont.truetype(FUENTE, tam); bb = f.getbbox('LURVETA'); ancho = bb[2] - bb[0]
    limite = (x1 - x0 + 1) * (1.12 if dos else 1.0)
    if ancho > limite:
        tam = max(6, int(tam * limite / ancho)); f = ImageFont.truetype(FUENTE, tam); bb = f.getbbox('LURVETA'); ancho = bb[2] - bb[0]
    alto_n = bb[3] - bb[1]
    tx = ((x0 + x1) / 2 - ancho / 2) if dos else (x1 - ancho)
    ty = (y0 + y1) / 2 - alto_n / 2
    masc = Image.new('L', out.size, 0); ImageDraw.Draw(masc).text((tx - bb[0], ty - bb[1]), 'LURVETA', font=f, fill=255)
    grad = np.zeros((H, W, 4), 'uint8')                    # degradado plateado como el original
    k = np.clip((np.arange(H) - ty) / max(1, alto_n), 0, 1)[:, None]
    for c, (top, bot) in enumerate([(255, 178), (255, 186), (255, 198)]): grad[..., c] = (top + (bot - top) * k).astype('uint8')
    grad[..., 3] = 255
    out.paste(Image.fromarray(grad, 'RGBA'), (0, 0), masc)
    if modo != 'RGBA': out = out.convert(modo if modo in ('RGB', 'L', 'P') else 'RGB')
    out.save(ruta, **({'quality': 92} if ruta.endswith('.webp') else {}))
    print(f'  {ruta}: {"2 líneas" if dos else "1 línea"} caja=({x0},{y0})-({x1},{y1}) fuente={tam}')

for ruta in sys.argv[1:]: procesar(ruta)
