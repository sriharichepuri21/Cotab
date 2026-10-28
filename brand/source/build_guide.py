import base64, glob, os, json
import logo
from logo import *
OUT = "/tmp/claude-0/pack/Cotab-Logo-B"
def b64(p): return base64.b64encode(open(p, "rb").read()).decode()
outfit = b64("/tmp/claude-0/fonts/node_modules/@fontsource/outfit/files/outfit-latin-700-normal.woff")
urb = glob.glob("/home/user/Cotab/frontend/node_modules/@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2")[0]
urbanist = b64(urb)
def inline(path, w=None, h=None, extra=""):
    s = open(path).read()
    st = f' style="{("width:%s;" % w) if w else ""}{("height:%s;" % h) if h else ""}{extra}"'
    return s.replace("<svg ", f"<svg{st} ", 1)
S = lambda rel: f"{OUT}/01-svg/{rel}"
glass = S("mark/cotab-mark-glass.svg"); deep = S("mark/cotab-mark-glass-deep.svg")
flat_ink = S("mark/cotab-mark-flat-ink.svg"); flat_cream = S("mark/cotab-mark-flat-cream.svg")
lock_dark = S("lockup/cotab-horizontal-glass-on-dark.svg"); lock_light = S("lockup/cotab-horizontal-glass-on-light.svg")
stack_dark = S("lockup/cotab-stacked-glass-on-dark.svg")

# construction drawing
cons = f'''<svg viewBox="0 0 120 112" style="width:100%" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round">
<g transform="translate(14 8) scale(1.6)" stroke="#1f2814">
<circle cx="22" cy="32" r="13" stroke-width="6.2" opacity=".14"/><circle cx="42" cy="32" r="13" stroke-width="6.2" opacity=".14"/>
<circle cx="22" cy="32" r="13" stroke-width=".35" stroke-dasharray="1 1.2"/><circle cx="42" cy="32" r="13" stroke-width=".35" stroke-dasharray="1 1.2"/>
<path d="M22 14v36M42 14v36M9 32h46" stroke-width=".25" stroke-dasharray="1 1.5" opacity=".7"/>
<circle cx="22" cy="32" r="1" fill="#1f2814" stroke="none"/><circle cx="42" cy="32" r="1" fill="#1f2814" stroke="none"/>
<path d="M22 32L31.96 23.64M22 32L31.96 40.36" stroke-width=".5" stroke="#d98e1f"/>
<path d="M30 32 A8 8 0 0 0 28.9 28" stroke-width=".5" stroke="#d98e1f"/>
<circle cx="31.96" cy="23.64" r="1.4" fill="#d98e1f" stroke="none"/><circle cx="31.96" cy="40.36" r="1.4" fill="#d98e1f" stroke="none"/>
</g>
<g font-family="Urbanist" font-size="3.2" fill="#1f2814" stroke="none"><text x="63" y="12">radius 13 · tube 6.2 · centres 20 apart</text><text x="63" y="19">the mouth of the c is 80°</text><text x="63" y="26">its tips land on the crossings</text></g></svg>'''

def sw(name, hexv, ink="#fff"):
    return f'<div class="sw" style="background:{hexv};color:{ink}"><b>{name}</b><span>{hexv}</span></div>'

html = f'''<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:Outfit;font-weight:700;src:url(data:font/woff;base64,{outfit}) format("woff")}}
@font-face{{font-family:Urbanist;font-weight:100 900;src:url(data:font/woff2;base64,{urbanist}) format("woff2")}}
@page{{size:297mm 210mm;margin:0}}
*{{box-sizing:border-box}}body{{margin:0;font-family:Urbanist,sans-serif;color:#1f2814;font-weight:500}}
.pg{{width:297mm;height:210mm;padding:16mm 18mm;position:relative;overflow:hidden;page-break-after:always;background:#eef1e3}}
.dark{{background:radial-gradient(60% 40% at 96% 2%,rgba(168,178,118,.85),transparent 70%),radial-gradient(56% 40% at 0% 34%,#46582a,transparent 70%),#1d2411;color:#f4f6ea}}
h1{{font-family:Urbanist;font-weight:300;font-size:46pt;letter-spacing:-.035em;line-height:1;margin:0}}
h2{{font-weight:300;font-size:30pt;letter-spacing:-.03em;margin:0 0 6mm}}
p{{font-size:11pt;line-height:1.5;margin:0 0 3mm;max-width:130mm}}
.k{{font-size:8pt;letter-spacing:.14em;text-transform:uppercase;opacity:.65;margin-bottom:4mm}}
.row{{display:flex;gap:10mm;align-items:center}}
.col{{flex:1}}
.sw{{width:40mm;height:30mm;border-radius:4mm;padding:3mm;display:flex;flex-direction:column;justify-content:flex-end;font-size:8.5pt}}
.sw b{{font-size:10pt}}
.card{{border-radius:6mm;padding:8mm;display:grid;place-items:center;height:60mm}}
.m{{background:#1d2411}}.l{{background:#dde3cf}}.c{{background:#fbfcf0;box-shadow:inset 0 0 0 .3mm #cdd5b8}}
ul{{margin:0;padding-left:5mm;font-size:11pt;line-height:1.6}}
.no{{color:#9a4b3e}}.yes{{color:#44592b}}
.pill{{display:inline-block;border-radius:99px;padding:1.5mm 4mm;font-size:9pt;background:rgba(127,127,127,.18);margin:0 2mm 2mm 0}}
.foot{{position:absolute;left:18mm;right:18mm;bottom:9mm;font-size:8pt;opacity:.55;display:flex;justify-content:space-between}}
</style>

<div class="pg dark"><div class="k">Cotab · brand mark B</div>
<div style="display:flex;align-items:center;height:150mm;gap:18mm"><div style="width:120mm">{inline(glass, "120mm")}</div>
<div><h1>Two halves.<br>One tab.</h1><p style="margin-top:8mm;opacity:.8">Logo guidelines for the c and o that share one stroke.</p></div></div>
<div class="foot"><span>Cotab logo pack</span><span>Version 1.0</span></div></div>

<div class="pg"><div class="k">The idea</div><h2>A c and an o, woven together</h2>
<div class="row"><div class="col"><p>The name is co + tab: together, and a tab. The mark is a c and an o that share one stroke, so the name and the idea are the same shape.</p>
<ul><li><b>The overlap is the shared amount.</b> The lens where the rings cross is the part of the bill you split.</li>
<li><b>The gap in the c is an open tab.</b> It closes when the tab is settled. The loader and the settle animation use this.</li>
<li><b>Over, then under.</b> The c passes over the o at the bottom and under it at the top: two people, each holding up one end.</li>
<li><b>The glass is the interface.</b> The mark is made of the same frosted glass as the app.</li></ul></div>
<div class="col card m" style="height:110mm">{inline(glass, "100mm")}</div></div>
<div class="foot"><span>The idea</span><span>2</span></div></div>

<div class="pg"><div class="k">Construction</div><h2>Built on circles</h2><div class="row"><div class="col">{cons}</div>
<div class="col"><p>Two circles of radius 13, twenty units apart, drawn with a 6.2 tube on a 64-unit grid. The c is left open by 80°, so its two tips land exactly on the two crossings: one hides under the o, the other rides over it.</p>
<p>Never redraw the mark. Use the files in 01-svg.</p></div></div><div class="foot"><span>Construction</span><span>3</span></div></div>

<div class="pg"><div class="k">Colour</div><h2>Moss, mist and one glass</h2>
<div class="row" style="flex-wrap:wrap;gap:5mm">{sw("Moss","#1d2411")}{sw("Moss light","#46582a")}{sw("Sage","#8fae80","#1f2814")}{sw("Lime","#d6e496","#1f2814")}{sw("Mist","#dde3cf","#1f2814")}{sw("Cream","#fbfcf0","#1f2814")}{sw("Ink","#1f2814")}{sw("Amber","#f0b552","#1f2814")}</div>
<p style="margin-top:6mm">Moss and mist are the two grounds. Sage is Tabby's fur and the glass tube. Amber is not in the mark: it is the app's one action colour, so keep it out of the logo.</p>
<div class="row" style="margin-top:2mm"><div style="width:52mm">{inline(glass,"52mm")}<p style="margin-top:2mm;font-size:9pt">Glass · on moss, ink and mid greens</p></div>
<div style="width:52mm">{inline(deep,"52mm")}<p style="margin-top:2mm;font-size:9pt">Glass deep · on mist, cream and white</p></div>
<div style="width:52mm">{inline(flat_ink,"52mm")}<p style="margin-top:2mm;font-size:9pt">Flat · one colour, for print and small sizes</p></div></div>
<div class="foot"><span>Colour</span><span>4</span></div></div>

<div class="pg"><div class="k">Lockups</div><h2>The mark with the name</h2>
<div class="row"><div class="col card m">{inline(lock_dark,"100%")}</div><div class="col card l">{inline(lock_light,"100%")}</div></div>
<div class="row" style="margin-top:8mm"><div class="col"><p><b>Wordmark.</b> cotab, lower case, in Outfit Bold with tracking −4%, drawn as outlines in every file. The mark is as tall as the word from the top of the b to the baseline, and shares its centre line.</p>
<p><b>Stacked</b> lockups are for square and tall spaces. <b>Horizontal</b> is the default.</p></div>
<div class="card m" style="width:60mm;height:60mm">{inline(stack_dark,"46mm")}</div></div><div class="foot"><span>Lockups</span><span>5</span></div></div>

<div class="pg"><div class="k">Space and size</div><h2>Give it room</h2>
<div class="row"><div class="col"><p><b>Clear space.</b> Keep a margin equal to the height of one ring (the o) around the mark on every side. Nothing else enters it.</p>
<p><b>Minimum size.</b> Glass: 48 px wide on screen, 16 mm in print. Below that, use the flat mark: 16 px on screen (favicons), 6 mm in print.</p>
<p><b>Favicons</b> use the flat cream mark on moss, so they read on light and dark browser tabs.</p></div>
<div class="col card l" style="height:100mm;position:relative"><div style="padding:14mm;border:.3mm dashed #44592b;border-radius:3mm">{inline(deep,"60mm")}</div></div></div>
<div class="foot"><span>Space and size</span><span>6</span></div></div>

<div class="pg"><div class="k">Use and misuse</div><h2>Do and do not</h2>
<div class="row"><div class="col"><div class="yes"><b>Do</b></div><ul><li>Use glass on moss, ink, sage; use glass deep on mist and cream.</li><li>Use flat one-colour files on photos and in print.</li><li>Animate with the c closing, never with spinning.</li><li>Keep clear space and minimum size.</li></ul></div>
<div class="col"><div class="no"><b>Do not</b></div><ul><li>Recolour the glass tube, or add an outline or glow.</li><li>Stretch, rotate, skew or mirror the mark.</li><li>Put glass on a busy photo; use a flat file there.</li><li>Close the c in the static logo: the open mouth is the brand. Closed is only for "settled".</li><li>Re-set the word in another typeface.</li></ul></div></div>
<div class="foot"><span>Use and misuse</span><span>7</span></div></div>

<div class="pg dark"><div class="k">Motion</div><h2>The c closes when a tab is settled</h2>
<div class="row"><div class="col"><ul>
<li><b>Loader</b> · 2.4 s loop. The c closes over 0.6 s, holds, opens again. Gentle float and tilt.</li>
<li><b>Intro</b> · 3.4 s. The o draws in, then the c, then the c closes once and reopens to rest. With the wordmark it slides in at the end.</li>
<li><b>Settle</b> · 1.6 s. The c closes, a lime ripple leaves the crossing, hold closed.</li>
<li><b>Idle</b> · 4 s loop. Slow float, a 2° tilt.</li></ul>
<p style="margin-top:6mm;opacity:.8">Easing: ease in-out (cubic-bezier .4, 0, .2, 1). 30 frames per second. With reduced motion on, show the still logo.</p></div>
<div class="col">{inline(S("animated/cotab-loader-glass-dark.svg"),"90mm")}</div></div>
<div class="foot"><span>Motion</span><span>8</span></div></div>
'''
open("/tmp/claude-0/pack/work/guide.html", "w").write(html)
# tokens
os.makedirs(f"{OUT}/06-guidelines", exist_ok=True)
pal = {"moss": "#1d2411", "moss-light": "#46582a", "sage": "#8fae80", "lime": "#d6e496", "mist": "#dde3cf", "cream": "#fbfcf0", "ink": "#1f2814", "amber": "#f0b552"}
json.dump({"colors": pal, "glass-tube": {"light": list(TUBES["glass"]), "deep": list(TUBES["deep"])}, "wordmark": {"font": "Outfit Bold", "tracking": "-4%"}, "mark": {"ring-radius": 13, "tube": 6.2, "mouth-deg": 80, "grid": 64}}, open(f"{OUT}/06-guidelines/cotab-brand-tokens.json", "w"), indent=2)
open(f"{OUT}/06-guidelines/cotab-colors.css", "w").write(":root{\n" + "\n".join(f"  --cotab-{k}: {v};" for k, v in pal.items()) + "\n}\n")
print("guide html ok")
