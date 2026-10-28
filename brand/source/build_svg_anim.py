import logo, os
from logo import *
OUT = "/tmp/claude-0/pack/Cotab-Logo-B/01-svg/animated"
os.makedirs(OUT, exist_ok=True)
SPL = "0.4 0 0.2 1"
def vals(gaps):
    ds, offs = [], []
    for g in gaps:
        d, o = logo.dash(g); ds.append(d); offs.append(f"{o:.3f}")
    return ";".join(ds), ";".join(offs)
def anim_c(gaps, keytimes, dur, repeat="indefinite", begin="0s"):
    d, o = vals(gaps)
    ks = ";".join(SPL for _ in range(len(gaps) - 1))
    kt = ";".join(str(k) for k in keytimes)
    fill = 'fill="freeze"' if repeat != "indefinite" else ""
    return (f'<animate attributeName="stroke-dasharray" values="{d}" keyTimes="{kt}" keySplines="{ks}" calcMode="spline" dur="{dur}s" begin="{begin}" repeatCount="{repeat}" {fill}/>'
            f'<animate attributeName="stroke-dashoffset" values="{o}" keyTimes="{kt}" keySplines="{ks}" calcMode="spline" dur="{dur}s" begin="{begin}" repeatCount="{repeat}" {fill}/>')

def glass_loader(tube, uid="a", color=None, flat=False):
    a = anim_c([1, 1, 0, 0, 1, 1], [0, .125, .375, .6, .85, 1], 2.4)
    float_ = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.2;0 0;0 1.2;0 0" dur="2.4s" repeatCount="indefinite"/>'
    d_, off = logo.dash(1.0)
    cap = 'stroke-linecap="round"'
    if flat:
        gp = W + 2.6
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB[0]} {VB[1]-3} {VB[2]} {VB[3]+6}" role="img" aria-label="Loading"><title>Cotab loading</title>'
                f'<clipPath id="over{uid}"><circle cx="{OVER[0]}" cy="{OVER[1]}" r="{OVER[2]}"/></clipPath><clipPath id="under{uid}"><circle cx="{UNDER[0]}" cy="{UNDER[1]}" r="{UNDER[2]}"/></clipPath>'
                f'<mask id="mc{uid}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/><g clip-path="url(#under{uid})"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="#000" stroke-width="{gp}"/></g></mask>'
                f'<mask id="mo{uid}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/><g clip-path="url(#over{uid})"><path d="{C_PATH}" fill="none" stroke="#000" stroke-width="{gp}" {cap}>{a}</path></g></mask>'
                f'<g color="{color}"><g mask="url(#mc{uid})"><path d="{C_PATH}" fill="none" stroke="currentColor" stroke-width="{W}" {cap}>{a}</path></g>'
                f'<g mask="url(#mo{uid})"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="currentColor" stroke-width="{W}"/></g>'
                f'<g clip-path="url(#over{uid})"><path d="{C_PATH}" fill="none" stroke="currentColor" stroke-width="{W}" {cap}>{a}</path></g></g></svg>')
    st = f"url(#tube{uid})"; f = f' filter="url(#glass{uid})"'
    shp = f'<path d="{C_PATH}" fill="none" stroke="#12261a" stroke-width="{W}" {cap}>{a}</path>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB[0]-2} {VB[1]-3} {VB[2]+4} {VB[3]+8}" role="img" aria-label="Loading"><title>Cotab loading</title>{defs(tube, uid)}<g>{float_}'
            f'<g{f}><path d="{C_PATH}" fill="none" stroke="{st}" stroke-width="{W}" {cap}>{a}</path></g>'
            f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.6 2.2)"><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="#12261a" stroke-width="{W}"/></g>'
            f'<g{f}><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="{st}" stroke-width="{W}"/></g>'
            f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.4 2)"><g clip-path="url(#over{uid})">{shp}</g></g>'
            f'<g{f}><g clip-path="url(#over{uid})"><path d="{C_PATH}" fill="none" stroke="{st}" stroke-width="{W}" {cap}>{a}</path></g></g></g></svg>')

def glass_intro(tube, uid="a"):
    cap = 'stroke-linecap="round"'
    oc = (f'<animate attributeName="stroke-dasharray" values="0 {CIRC+5:.2f};{CIRC:.2f} {CIRC+5:.2f};{CIRC:.2f} {CIRC+5:.2f}" keyTimes="0;.3;1" dur="3.4s" begin="0.1s" fill="freeze"/>')
    cd = (f'<animate attributeName="stroke-dasharray" values="0 {CIRC:.2f};{OPEN:.2f} {CIRC:.2f};{OPEN:.2f} {CIRC:.2f}" keyTimes="0;.3;1" dur="3.4s" begin="0.4s" fill="freeze"/>')
    st = f"url(#tube{uid})"; f = f' filter="url(#glass{uid})"'
    def cpath(extra, sw, stroke):
        return f'<path d="{C_PATH}" fill="none" stroke="{stroke}" stroke-width="{sw}" {cap} stroke-dasharray="0 {CIRC:.2f}">{cd}{extra}</path>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB[0]-2} {VB[1]-3} {VB[2]+4} {VB[3]+8}" role="img" aria-label="Cotab"><title>Cotab</title>{defs(tube, uid)}'
            f'<g{f}>{cpath("", W, st)}</g>'
            f'<g{f}><circle cx="{OC[0]}" cy="{OC[1]}" r="{R}" fill="none" stroke="{st}" stroke-width="{W}" stroke-linecap="round" stroke-dasharray="0 {CIRC+5:.2f}" transform="rotate(-90 {OC[0]} {OC[1]})">{oc}</circle></g>'
            f'<g filter="url(#soft{uid})" opacity=".38" transform="translate(1.4 2)"><g clip-path="url(#over{uid})">{cpath("", W, "#12261a")}</g></g>'
            f'<g{f}><g clip-path="url(#over{uid})">{cpath("", W, st)}</g></g></svg>')

for tube, name in (("glass", "dark"), ("deep", "light")):
    open(f"{OUT}/cotab-loader-glass-{name}.svg", "w").write(glass_loader(tube))
    open(f"{OUT}/cotab-intro-glass-{name}.svg", "w").write(glass_intro(tube))
for n, c in (("ink", "#1f2814"), ("cream", "#fbfcf0")):
    open(f"{OUT}/cotab-loader-flat-{n}.svg", "w").write(glass_loader("glass", color=c, flat=True))
print(os.listdir(OUT))
