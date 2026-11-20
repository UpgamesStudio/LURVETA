"""Genera el wordmark vectorial de Lurveta (public/icons/logo-lurveta.svg).
LUR y el trazo izquierdo de la V en verde; trazo derecho de la V y ETA en blanco.
Uso: pip install fonttools && python3 scripts/marca/logo.py"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os

FUENTE = '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf'
VERDE, BLANCO = '#32D583', '#F4F6F8'
f = TTFont(FUENTE); gs = f.getGlyphSet(); cmap = f.getBestCmap()
CAP = f['OS/2'].sCapHeight; TRACK = 40

def glifo(ch, x):
    g = cmap[ord(ch)]; pen = SVGPathPen(gs)
    gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, CAP)))   # y hacia abajo, base en CAP
    return pen.getCommands(), gs[g].width

partes, x = [], 0
def palabra(txt, color):
    global x
    for ch in txt:
        d, w = glifo(ch, x); partes.append(f'<path fill="{color}" d="{d}"/>'); x += w + TRACK

palabra('LUR', VERDE)
# V propia: dos trazos que se juntan abajo; el derecho sube un poco más (guiño a la flecha de "Up")
W, G = 1240, 330            # ancho de la V y grosor del trazo
x0 = x + 10
partes.append(f'<path fill="{VERDE}" d="M{x0} 0H{x0+G}L{x0+W/2+G*0.32} {CAP*0.70}L{x0+W/2-G*0.10} {CAP}Z"/>')
partes.append(f'<path fill="{BLANCO}" d="M{x0+W-G+60} {-CAP*0.12}H{x0+W+60}L{x0+W/2+G*0.38} {CAP}H{x0+W/2-G*0.10}Z"/>')
x = x0 + W + 60 + TRACK + 30
palabra('ETA', BLANCO)
ancho = x - TRACK; arriba = -CAP * 0.12
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {arriba:.0f} {ancho:.0f} {CAP - arriba:.0f}" '
       f'role="img" aria-label="Lurveta"><title>Lurveta</title>{"".join(partes)}</svg>\n')
destino = os.path.join(os.path.dirname(__file__), '../../public/icons/logo-lurveta.svg')
open(destino, 'w').write(svg); print('ok', os.path.normpath(destino), round(ancho), 'x', round(CAP - arriba))
