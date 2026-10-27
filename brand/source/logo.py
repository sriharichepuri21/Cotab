"""Cotab mark B: geometry, colourways and SVG builders."""
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

# ---- geometry (64-unit grid) -------------------------------------------------
R = 13.0
W = 6.2
CC = (22.0, 32.0)            # the "c" centre
OC = (42.0, 32.0)            # the "o" centre
CIRC = 2 * math.pi * R
GAP_DEG = 80.0               # the c's open mouth
OPEN = CIRC * (360 - GAP_DEG) / 360
C_PATH = "M31.96 23.64 A13 13 0 1 0 31.96 40.36 A13 13 0 0 0 31.96 23.64"
VB = (2, 7, 60, 50)          # tight viewBox around the mark
OVER = (32.0, 40.3, 6.4)     # where the c passes over the o
UNDER = (32.0, 23.7, 6.4)    # where the o passes over the c

# ---- colour ------------------------------------------------------------------
PALETTE = {
    "moss": "#1d2411", "moss-light": "#46582a", "sage": "#8fae80",
    "mist": "#dde3cf", "cream": "#fbfcf0", "ink": "#1f2814",
    "amber": "#f0b552", "lime": "#d6e496",
}
TUBES = {
    "glass": ("#e6f5e0", "#a8cba6", "#4f7f5a"),   # on moss, mid greens, dark photos
    "deep": ("#7fbf93", "#2f6a45", "#123222"),    # on mist, cream, white
}
BACKGROUNDS = {
    "moss": "radial-gradient(60% 40% at 96% 2%,rgba(168,178,118,.85),transparent 70%),radial-gradient(56% 40% at 0% 34%,#46582a,transparent 70%),radial-gradient(70% 40% at 14% 104%,rgba(160,172,96,.7),transparent 70%),#1d2411",
    "mist": "radial-gradient(46% 34% at 12% 8%,#fafcf0,transparent 70%),radial-gradient(50% 36% at 100% 26%,rgba(172,188,120,.85),transparent 70%),radial-gradient(60% 36% at 0% 100%,rgba(150,168,104,.55),transparent 70%),#dde3cf",
    "cream": "linear-gradient(160deg,#ffffff,#e9edd6)",
    "ink": "#11160b",
    "sage": "radial-gradient(90% 70% at 20% 90%,#b9cbb2,transparent 70%),linear-gradient(160deg,#a9bda3,#6b8a6e 70%,#58745c)",
}
# which tube reads on which background
TUBE_ON = {"moss": "glass", "ink": "glass", "sage": "glass", "mist": "deep", "cream": "deep"}

def defs(tube="glass", uid="x"):
    a, b, c = TUBES[tube]
    return f'''<defs>
<linearGradient id="tube{uid}" gradientUnits="userSpaceOnUse" x1="8" y1="6" x2="56" y2="58"><stop offset="0" stop-color="{a}"/><stop offset=".45" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>
<filter id="glass{uid}" filterUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="b"/>
<feDiffuseLighting in="b" surfaceScale="3.2" diffuseConstant="1.05" lighting-color="#eaf8e4" result="d"><feDistantLight azimuth="225" elevation="52"/></feDiffuseLighting>
<feSpecularLighting in="b" surfaceScale="3.2" specularConstant="1.2" specularExponent="26" lighting-color="#ffffff" result="s"><feDistantLight azimuth="225" elevation="46"/></feSpecularLighting>
<feComposite in="d" in2="SourceAlpha" operator="in" result="dIn"/>
<feComposite in="s" in2="SourceAlpha" operator="in" result="sIn"/>
<feComposite in="SourceGraphic" in2="dIn" operator="arithmetic" k1="0" k2=".62" k3=".42" k4="0" result="lit"/>
<feComposite in="lit" in2="sIn" operator="arithmetic" k1="0" k2="1" k3=".8" k4="0"/>
</filter>
<filter id="soft{uid}" filterUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><feGaussianBlur stdDeviation="1.6"/></filter>
<clipPath id="over{uid}"><circle cx="{OVER[0]}" cy="{OVER[1]}" r="{OVER[2]}"/></clipPath>
<clipPath id="under{uid}"><circle cx="{UNDER[0]}" cy="{UNDER[1]}" r="{UNDER[2]}"/></clipPath>
</defs>'''

def dash(gap):
    """Dash that leaves a mouth of `gap` (0..1 of the open design) centred on the right."""
    g = (CIRC - OPEN) * gap
    centre = (OPEN + CIRC) / 2
    if g <= 0.001:
        return f"{CIRC:.3f} 0", 0.0
    return f"{CIRC - g:.3f} {g:.3f}", (-(centre + g / 2)) % CIRC

def c_attrs(gap=1.0):
    d, off = dash(gap)
    return f'd="{C_PATH}" stroke-dasharray="{d}" stroke-dashoffset="{off:.3f}"'

def body(kind="glass", color="#1f2814", uid="x", gap=1.0, shadow=True):
    """The mark's drawing, in the 64-unit grid. kind: glass | flat"""
    ca = c_attrs(gap)
    cap = 'stroke-linecap="round"'
    if kind == "glass":
        st = f'url(#tube{uid})'
        f = f' filter="url(#glass{uid})"'
        sh1 = (f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.6 2.2)"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="#12261a" stroke-width="{W}"/></g>' if shadow else "")
        sh2 = (f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.4 2)"><g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="#12261a" stroke-width="{W}" {cap}/></g></g>' if shadow else "")
        return (f'<g{f}><path {ca} fill="none" stroke="{st}" stroke-width="{W}" {cap}/></g>'
                f'{sh1}<g{f}><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="{st}" stroke-width="{W}"/></g>'
                f'{sh2}<g{f}><g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="{st}" stroke-width="{W}" {cap}/></g></g>')
    # flat: keep the weave with small gaps cut where one loop passes over the other
    gp = W + 2.6
    return (f'<defs><mask id="mc{uid}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/>'
            f'<g clip-path="url(#under{uid})"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="#000" stroke-width="{gp}"/></g></mask>'
            f'<mask id="mo{uid}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/>'
            f'<g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="#000" stroke-width="{gp}" {cap}/></g></mask></defs>'
            f'<g mask="url(#mc{uid})"><path {ca} fill="none" stroke="{color}" stroke-width="{W}" {cap}/></g>'
            f'<g mask="url(#mo{uid})"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="{color}" stroke-width="{W}"/></g>'
            f'<g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="{color}" stroke-width="{W}" {cap}/></g>')

def mark_svg(kind="glass", tube="glass", color="#1f2814", gap=1.0, size=None, vb=VB, pad=0, uid="m", title="Cotab", extra_style=""):
    x, y, w, h = vb
    x -= pad; y -= pad; w += 2 * pad; h += 2 * pad
    wh = f' width="{size[0]}" height="{size[1]}"' if size else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}"{wh} role="img" aria-label="{title}">'
            f'<title>{title}</title>{defs(tube, uid)}{extra_style}{body(kind, color, uid, gap)}</svg>')

# ---- wordmark as outlines ----------------------------------------------------
_font = TTFont("/tmp/claude-0/fonts/node_modules/@fontsource/outfit/files/outfit-latin-700-normal.woff")
_gs = _font.getGlyphSet(); _cmap = _font.getBestCmap(); _upem = _font["head"].unitsPerEm
def wordmark(text="cotab", size=100.0, tracking=-0.04):
    """Return (path_d, width, ymin, ymax) with y down, baseline at 0, size = font size in units."""
    s = size / _upem
    x = 0.0; ds = []; ymin = 1e9; ymax = -1e9
    for ch in text:
        gn = _cmap[ord(ch)]
        pen = SVGPathPen(_gs)
        tp = TransformPen(pen, (s, 0, 0, -s, x, 0))
        _gs[gn].draw(tp)
        ds.append(pen.getCommands())
        bp = BoundsPen(_gs); _gs[gn].draw(bp)
        if bp.bounds:
            ymin = min(ymin, -bp.bounds[3] * s); ymax = max(ymax, -bp.bounds[1] * s)
        x += _gs[gn].width * s + tracking * size
    return " ".join(ds), x - tracking * size, ymin, ymax

# visible bounds of the rings (without the soft shadow), used to align the mark with the word
MB = (CC[0] - R - W / 2, CC[1] - R - W / 2, (OC[0] + R + W / 2) - (CC[0] - R - W / 2), 2 * (R + W / 2))

def lockup_svg(layout="horizontal", kind="glass", tube="glass", word="#f4f6ea", color="#1f2814", uid="l", gap=1.0, pad=10, title="Cotab"):
    d, ww, y0, y1 = wordmark(size=100)
    mbx, mby, mbw, mbh = MB
    if layout == "horizontal":
        # the mark is as tall as the word from ascender to baseline and shares its centre
        wh = y1 - y0
        k = wh * 0.98 / mbh; mkw = mbw * k; mkh = mbh * k
        gapx = 24
        W_ = mkw + gapx + ww + 2 * pad; H_ = wh + 2 * pad
        cy = H_ / 2
        mark = f'<g transform="translate({pad - mbx*k:.2f} {cy - mkh/2 - mby*k:.2f}) scale({k:.4f})">{body(kind, color, uid, gap)}</g>'
        tx = pad + mkw + gapx; ty = cy - (y0 + y1) / 2
        text = f'<path transform="translate({tx:.2f} {ty:.2f})" d="{d}" fill="{word}"/>'
    else:
        k = 130 / mbh; mkw = mbw * k; mkh = mbh * k
        W_ = max(ww, mkw) + 2 * pad; H_ = mkh + 36 + (y1 - y0) + 2 * pad
        mark = f'<g transform="translate({(W_ - mkw)/2 - mbx*k:.2f} {pad - mby*k:.2f}) scale({k:.4f})">{body(kind, color, uid, gap)}</g>'
        tx = (W_ - ww) / 2; ty = pad + mkh + 36 - y0
        text = f'<path transform="translate({tx:.2f} {ty:.2f})" d="{d}" fill="{word}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W_:.1f} {H_:.1f}" role="img" aria-label="{title}"><title>{title}</title>'
            f'{defs(tube, uid)}{mark}{text}</svg>', W_, H_)
