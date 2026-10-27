import math, json, os, shutil
import logo
from logo import *

VBA = (-2, 2, 68, 60)            # animation viewBox, a little roomier for the ripple
FPS = 30
def ease(t, a=0.0, b=1.0):
    x = min(1, max(0, (t - a) / (b - a))) if b > a else 1.0
    return x * x * (3 - 2 * x)
def ease_out(t, a, b):
    x = min(1, max(0, (t - a) / (b - a)))
    return 1 - (1 - x) ** 3

def c_dash(gap, draw):
    if draw < 1: return f"{OPEN * draw:.3f} {CIRC:.3f}", 0.0
    return logo.dash(gap)

def body_anim(kind, uid, gap=1.0, cdraw=1.0, odraw=1.0, ripple=0.0, shadow=True):
    d, off = c_dash(gap, cdraw)
    ca = f'd="{C_PATH}" stroke-dasharray="{d}" stroke-dashoffset="{off:.3f}"'
    cap = 'stroke-linecap="round"'
    st = f"url(#tube{uid})"; f = f' filter="url(#glass{uid})"'
    c_op = 'opacity="0"' if cdraw < 0.02 else ""
    o_op = 'opacity="0"' if odraw < 0.02 else ""
    if odraw < 1:
        oa = f'stroke-dasharray="{CIRC * odraw:.3f} {CIRC + 5:.3f}" stroke-linecap="round" transform="rotate(-90 {OC[0]} {OC[1]})"'
    else:
        oa = ""
    sh1 = (f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.6 2.2)"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="#12261a" stroke-width="{W}" {oa} {o_op}/></g>' if shadow else "")
    sh2 = (f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.4 2)"><g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="#12261a" stroke-width="{W}" {cap} {c_op}/></g></g>' if shadow else "")
    out = (f'<g{f}><path {ca} fill="none" stroke="{st}" stroke-width="{W}" {cap} {c_op}/></g>'
           f'{sh1}<g{f}><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="{st}" stroke-width="{W}" {oa} {o_op}/></g>'
           f'{sh2}<g{f}><g clip-path="url(#over{uid})"><path {ca} fill="none" stroke="{st}" stroke-width="{W}" {cap} {c_op}/></g></g>')
    if ripple > 0:
        r_ = 12 + 20 * ripple; a = (1 - ripple) ** 1.5 * 0.55
        out += f'<circle cx="32" cy="32" r="{r_:.2f}" fill="none" stroke="#d6e496" stroke-width="{1.6*(1-ripple)+0.3:.2f}" opacity="{a:.3f}"/>'
    return out

def wrap(inner, tube, uid, vb=VBA, tx=0.0, ty=0.0, rot=0.0, sc=1.0, cx=32.0, cy=32.0):
    x, y, w, h = vb
    g = f'<g transform="translate({tx:.3f} {ty:.3f}) rotate({rot:.3f} {cx} {cy}) translate({cx} {cy}) scale({sc:.4f}) translate({-cx} {-cy})">{inner}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}">{defs(tube, uid)}{g}</svg>'

# ---------- timelines: each returns the parameters at time t ----------
def tl_loader(t):                       # 2.4 s loop: the c closes, holds, opens
    T = 2.4; t %= T
    if t < 0.30: g = 1.0
    elif t < 0.90: g = 1 - ease(t, 0.30, 0.90)
    elif t < 1.45: g = 0.0
    elif t < 2.05: g = ease(t, 1.45, 2.05)
    else: g = 1.0
    pulse = ease_out(t, 0.85, 1.05) * (1 - ease(t, 1.05, 1.35))
    return dict(gap=g, sc=1 + 0.045 * pulse, ty=-1.2 * math.sin(2 * math.pi * t / T), rot=1.2 * math.sin(2 * math.pi * t / T))
def tl_idle(t):                         # 4 s loop: slow float and tilt
    T = 4.0; p = 2 * math.pi * t / T
    return dict(gap=1.0, ty=-1.6 * math.sin(p), rot=2.2 * math.sin(p + 0.6), sc=1 + 0.012 * math.sin(2 * p))
def tl_intro(t):                        # 3.4 s: draw o, draw c, settle once, rest open
    od = ease_out(t, 0.05, 1.05); cd = ease_out(t, 0.40, 1.45)
    if t < 1.5: g = 1.0
    elif t < 1.95: g = 1 - ease(t, 1.5, 1.95)
    elif t < 2.25: g = 0.0
    elif t < 2.75: g = ease(t, 2.25, 2.75)
    else: g = 1.0
    rip = ease(t, 1.9, 2.7) if 1.9 < t < 2.7 else 0.0
    pop = ease_out(t, 1.8, 2.0) * (1 - ease(t, 2.0, 2.5))
    land = 1 - ease_out(t, 0.0, 1.1)
    return dict(gap=g, odraw=od, cdraw=cd, ripple=rip, sc=1 + 0.05 * pop, ty=-8 * land * 0 + 0, rot=-8 * land)
def tl_settle(t):                       # 1.6 s: c closes, ripple, hold closed
    g = 1 - ease(t, 0.15, 0.75)
    rip = ease(t, 0.6, 1.5) if t > 0.6 else 0.0
    pop = ease_out(t, 0.65, 0.85) * (1 - ease(t, 0.85, 1.3))
    return dict(gap=g, ripple=rip, sc=1 + 0.06 * pop)

ANIMS = {
    "loader": (tl_loader, 2.4, "loop"),
    "idle": (tl_idle, 4.0, "loop"),
    "intro": (tl_intro, 3.4, "once"),
    "settle": (tl_settle, 1.6, "once"),
}
def frame_svg(name, t, tube, uid="a"):
    fn, _, _ = ANIMS[name]; p = fn(t)
    inner = body_anim("glass", uid, gap=p.get("gap", 1.0), cdraw=p.get("cdraw", 1.0), odraw=p.get("odraw", 1.0), ripple=p.get("ripple", 0.0))
    return wrap(inner, tube, uid, tx=p.get("tx", 0), ty=p.get("ty", 0), rot=p.get("rot", 0), sc=p.get("sc", 1))

# ---------- intro with the wordmark ----------
def lockup_frame(t, tube, wordcol, uid="a", total=4.2):
    d, ww, y0, y1 = wordmark(size=100)
    mbx, mby, mbw, mbh = logo.MB
    wh = y1 - y0
    k = wh * 0.98 / mbh; mkw = mbw * k; mkh = mbh * k; gapx = 24; pad = 10
    W_ = mkw + gapx + ww + 2 * pad; H_ = wh + 2 * pad
    p = tl_intro(t); cy = H_ / 2
    # mark group, same maths as lockup_svg, plus the animation
    inner = body_anim("glass", uid, gap=p.get("gap", 1), cdraw=p.get("cdraw", 1), odraw=p.get("odraw", 1), ripple=p.get("ripple", 0))
    mcx = mbx + mbw / 2; mcy = mby + mbh / 2
    ox = pad - mbx * k; oy = cy - mkh / 2 - mby * k
    mark = (f'<g transform="translate({ox:.2f} {oy:.2f}) scale({k:.4f})"><g transform="rotate({p.get("rot",0):.3f} {mcx} {mcy}) translate({mcx} {mcy}) scale({p.get("sc",1):.4f}) translate({-mcx} {-mcy})">{inner}</g></g>')
    a = ease_out(t, 2.0, 2.9); slide = (1 - a) * 22
    tx = pad + mkw + gapx + slide; ty = cy - (y0 + y1) / 2
    text = f'<path transform="translate({tx:.2f} {ty:.2f})" d="{d}" fill="{wordcol}" opacity="{a:.3f}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -10 {W_+28:.1f} {H_+20:.1f}">{defs(tube, uid)}{mark}{text}</svg>', (W_ + 28, H_ + 20)
