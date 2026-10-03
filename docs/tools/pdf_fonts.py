"""
Fonts for the PDF renderer.

A stock Debian/Ubuntu container ships only the upright cuts of DejaVu, so italic
emphasis would silently fall back to roman. When no real italic file exists this
module builds one by shearing every glyph outline with fontTools and caches it, so
later runs are instant and nothing is written into the repository.
"""
from __future__ import annotations

import hashlib
import os

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

DEJAVU_DIR = "/usr/share/fonts/truetype/dejavu"
CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "fems-pdf-fonts")

SLANT = 0.22  # tan(~12.4 degrees), a conventional oblique


def _slant_font(src: str, dst: str) -> str:
    """Write an obliqued copy of the TTF at `src` to `dst`, and return `dst`."""
    font = TTFont(src, lazy=False)
    glyf = font["glyf"]
    glyph_set = font.getGlyphSet()

    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            continue
        x_min, _, x_max, y_max = _bounds(glyph, glyf)
        # Shear about the baseline, then nudge the glyph left by half the lean so
        # it stays visually centred on its advance width.
        shear = Transform().translate(-SLANT * max(y_max, 0) / 2, 0).skew(SLANT)
        pen = TTGlyphPen(glyph_set)
        glyph.draw(TransformPen(pen, shear), glyf)
        new_glyph = pen.glyph()
        new_glyph.recalcBounds(glyf)
        glyf[name] = new_glyph
        del x_min, x_max

    font["post"].italicAngle = -SLANT * 45  # PostScript units: degrees
    head = font["head"]
    head.macStyle = (head.macStyle or 0) | 0x02  # italic bit

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    font.save(dst)
    return dst


def _bounds(glyph, glyf):
    """(xMin, yMin, xMax, yMax) of a glyph, decompiling it first if needed."""
    try:
        glyph.recalcBounds(glyf)
    except Exception:
        pass
    return (
        getattr(glyph, "xMin", 0) or 0,
        getattr(glyph, "yMin", 0) or 0,
        getattr(glyph, "xMax", 0) or 0,
        getattr(glyph, "yMax", 0) or 0,
    )


def oblique_path(src: str, tag: str) -> str | None:
    """Path to an oblique version of `src`, generating (and caching) it if needed."""
    if not os.path.exists(src):
        return None
    try:
        with open(src, "rb") as handle:
            digest = hashlib.sha1(handle.read()).hexdigest()[:10]
        dst = os.path.join(CACHE_DIR, f"{tag}-{digest}.ttf")
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            return dst
        return _slant_font(src, dst)
    except Exception:  # a missing oblique is not fatal: we fall back to roman
        return None


def available_faces() -> dict[str, str]:
    """Paths for the faces the renderer registers, with obliques made on demand."""
    base = {
        "regular": os.path.join(DEJAVU_DIR, "DejaVuSans.ttf"),
        "bold": os.path.join(DEJAVU_DIR, "DejaVuSans-Bold.ttf"),
        "mono": os.path.join(DEJAVU_DIR, "DejaVuSansMono.ttf"),
        "mono-bold": os.path.join(DEJAVU_DIR, "DejaVuSansMono-Bold.ttf"),
    }
    italic = os.path.join(DEJAVU_DIR, "DejaVuSans-Oblique.ttf")
    italic_bold = os.path.join(DEJAVU_DIR, "DejaVuSans-BoldOblique.ttf")
    base["italic"] = (
        italic
        if os.path.exists(italic)
        else (oblique_path(base["regular"], "DejaVuSans-Oblique") or base["regular"])
    )
    base["bold-italic"] = (
        italic_bold
        if os.path.exists(italic_bold)
        else (oblique_path(base["bold"], "DejaVuSans-BoldOblique") or base["bold"])
    )
    return {name: path for name, path in base.items() if path and os.path.exists(path)}
