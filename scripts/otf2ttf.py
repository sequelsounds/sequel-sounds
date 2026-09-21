"""CFF -> glyf. Creato Display is an OTF, and pdf-lib embeds every font as a
TrueType one, which makes readers complain the file does not match its type."""
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.ttGlyphPen import TTGlyphPen
from cu2qu.pens import Cu2QuPen

MAX_ERR = 1.0  # in units of 1000upm — half a hundredth of a point at 10pt

def convert(src, dst):
    f = TTFont(src)
    order = f.getGlyphOrder()
    gs = f.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(glyf.glyphs)
        gs[name].draw(Cu2QuPen(pen, MAX_ERR * f['head'].unitsPerEm / 1000))
        glyf.glyphs[name] = pen.glyph()
    f['glyf'] = glyf
    f['loca'] = newTable('loca')
    f['maxp'].numGlyphs = len(order)
    del f['CFF ']
    f['head'].indexToLocFormat = 0
    f.sfntVersion = '\000\001\000\000'
    # post 3.0 keeps no names; 2.0 is what a TrueType font normally carries
    if 'post' in f:
        f['post'].formatType = 2.0
        f['post'].extraNames = []
        f['post'].mapping = {}
        f['post'].glyphOrder = order
    f.save(dst)
    return f

for name in ('CreatoDisplay-Regular', 'CreatoDisplay-Bold'):
    out = convert(name + '.ttf', name + '-ttf.ttf')
    print(name, 'converted, glyphs', len(out.getGlyphOrder()))
