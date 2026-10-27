import json, os, shutil
import logo
from logo import *

OUT = "/tmp/claude-0/pack/Cotab-Logo-B"
shutil.rmtree(OUT, ignore_errors=True)
def P(*a):
    p = os.path.join(OUT, *a); os.makedirs(os.path.dirname(p), exist_ok=True); return p
def write(path, s): open(path, "w").write(s)
jobs = []
def job(svg, out, w, h, bg=None, pad=0.0, radius=0, mark_color="#1f2814"):
    jobs.append(dict(svg=svg, out=out, w=w, h=h, bg=bg, pad=pad, radius=radius, color=mark_color))

# ---------------- SVG: marks ----------------
MC = {"ink": "#1f2814", "moss": "#2c3a1b", "cream": "#fbfcf0", "white": "#ffffff", "black": "#000000", "sage": "#8fae80"}
svgs = {}
def save_svg(rel, s):
    p = P("01-svg", rel); write(p, s); svgs[rel] = p; return p
save_svg("mark/cotab-mark-glass.svg", mark_svg("glass", "glass", uid="a", title="Cotab"))
save_svg("mark/cotab-mark-glass-deep.svg", mark_svg("glass", "deep", uid="a", title="Cotab"))
save_svg("mark/cotab-mark-glass-settled.svg", mark_svg("glass", "glass", gap=0, uid="a", title="Cotab, settled"))
save_svg("mark/cotab-mark-glass-deep-settled.svg", mark_svg("glass", "deep", gap=0, uid="a", title="Cotab, settled"))
for n, c in MC.items():
    save_svg(f"mark/cotab-mark-flat-{n}.svg", mark_svg("flat", color=c, uid="f", title="Cotab"))
    save_svg(f"mark/cotab-mark-flat-{n}-settled.svg", mark_svg("flat", color=c, gap=0, uid="f", title="Cotab, settled")) if n in ("ink", "cream") else None

# ---------------- SVG: lockups ----------------
LOCK = {}
for lay in ("horizontal", "stacked"):
    cfgs = {
        "glass-on-dark": dict(kind="glass", tube="glass", word="#f4f6ea"),
        "glass-on-light": dict(kind="glass", tube="deep", word="#1f2814"),
        "flat-ink": dict(kind="flat", color="#1f2814", word="#1f2814"),
        "flat-cream": dict(kind="flat", color="#fbfcf0", word="#fbfcf0"),
        "flat-white": dict(kind="flat", color="#ffffff", word="#ffffff"),
        "flat-black": dict(kind="flat", color="#000000", word="#000000"),
    }
    for n, c in cfgs.items():
        s, w, h = lockup_svg(lay, uid="l", **c)
        save_svg(f"lockup/cotab-{lay}-{n}.svg", s); LOCK[(lay, n)] = (w, h)

# ---------------- favicon.svg (adapts to light / dark tabs) ----------------
fav = mark_svg("flat", color="currentColor", uid="v", title="Cotab", pad=2,
               extra_style='<style>svg{color:#1f2814}@media (prefers-color-scheme:dark){svg{color:#f4f6ea}}</style>')
save_svg("icon/favicon.svg", fav)

# ---------------- PNG: transparent marks ----------------
def mark_for(kind, tube=None, color=None, settled=False):
    k = "glass" if kind == "glass" else "flat"
    if kind == "glass": return svgs["mark/cotab-mark-glass%s%s.svg" % ("-deep" if tube == "deep" else "", "-settled" if settled else "")]
    return svgs[f"mark/cotab-mark-flat-{color}{'-settled' if settled else ''}.svg"]
for s in (64, 128, 256, 512, 1024, 2048):
    job(mark_for("glass", "glass"), P("02-png/transparent/mark-glass", f"cotab-mark-glass-{s}.png"), s, round(s * 50 / 60), pad=0.04)
    job(mark_for("glass", "deep"), P("02-png/transparent/mark-glass-deep", f"cotab-mark-glass-deep-{s}.png"), s, round(s * 50 / 60), pad=0.04)
for c in ("ink", "cream", "white", "black"):
    for s in (16, 32, 48, 64, 128, 256, 512, 1024):
        job(mark_for("flat", color=c), P("02-png/transparent/mark-flat", f"cotab-mark-flat-{c}-{s}.png"), s, round(s * 50 / 60), pad=0.03)
# transparent lockups
for (lay, n), (w, h) in LOCK.items():
    for k in (1, 2):
        W_ = round(1200 * k) if lay == "horizontal" else round(700 * k)
        job(svgs[f"lockup/cotab-{lay}-{n}.svg"], P("02-png/transparent/lockup", f"cotab-{lay}-{n}@{k}x.png"), W_, round(W_ * h / w))

# ---------------- PNG: marks and lockups on backgrounds ----------------
for bg, css in BACKGROUNDS.items():
    tube = TUBE_ON.get(bg, "glass")
    job(mark_for("glass", tube), P("02-png/with-background", f"cotab-mark-on-{bg}-2048.png"), 2048, 2048, bg=css, pad=0.17)
    word = "#f4f6ea" if tube == "glass" else "#1f2814"
    n = "glass-on-dark" if tube == "glass" else "glass-on-light"
    for lay, (cw, ch) in (("horizontal", (2400, 1200)), ("stacked", (1600, 1600))):
        w, h = LOCK[(lay, n)]
        job(svgs[f"lockup/cotab-{lay}-{n}.svg"], P("02-png/with-background", f"cotab-{lay}-lockup-on-{bg}.png"), cw, ch, bg=css, pad=0.2 if lay == "horizontal" else 0.22)

# ---------------- App icons ----------------
MOSS = BACKGROUNDS["moss"]
def icon(out, s, bg=MOSS, tube="glass", radius=0, pad=0.13, svg=None):
    job(svg or mark_for("glass", tube), out, s, s, bg=bg, pad=pad, radius=radius)
icon(P("03-app-icons/ios", "AppIcon-1024.png"), 1024)
icon(P("03-app-icons/ios", "AppIcon-1024-light.png"), 1024, bg=BACKGROUNDS["mist"], tube="deep")
icon(P("03-app-icons/rounded", "cotab-icon-moss-1024.png"), 1024, radius=0.2237)
icon(P("03-app-icons/rounded", "cotab-icon-mist-1024.png"), 1024, bg=BACKGROUNDS["mist"], tube="deep", radius=0.2237)
icon(P("03-app-icons/rounded", "cotab-icon-cream-1024.png"), 1024, bg=BACKGROUNDS["cream"], tube="deep", radius=0.2237)
for s in (20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180):
    icon(P("03-app-icons/ios/sizes", f"icon-{s}.png"), s)
icon(P("03-app-icons/web-pwa", "apple-touch-icon.png"), 180)
icon(P("03-app-icons/web-pwa", "icon-192.png"), 192, radius=0.2237)
icon(P("03-app-icons/web-pwa", "icon-512.png"), 512, radius=0.2237)
icon(P("03-app-icons/web-pwa", "icon-maskable-512.png"), 512, pad=0.24)   # mark inside the 80% safe zone
# Android adaptive: 432 canvas, mark inside the 66% safe zone
job(mark_for("glass", "glass"), P("03-app-icons/android/adaptive", "ic_launcher_foreground.png"), 432, 432, pad=0.27)
job(None, P("03-app-icons/android/adaptive", "ic_launcher_background.png"), 432, 432, bg=MOSS)
job(mark_for("flat", color="black"), P("03-app-icons/android/adaptive", "ic_launcher_monochrome.png"), 432, 432, pad=0.27)
icon(P("03-app-icons/android", "ic_launcher-512-play-store.png"), 512, radius=0.2237)
for dpi, s in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    icon(P("03-app-icons/android/legacy", f"ic_launcher-{dpi}-{s}.png"), s, radius=0.2237)
# Favicons: flat cream mark on moss, so they read on any browser theme
FAV_BG = "#1d2411"
for s in (16, 32, 48, 64, 96, 180, 192, 512):
    job(mark_for("flat", color="cream"), P("03-app-icons/favicon", f"favicon-{s}.png"), s, s, bg=FAV_BG, pad=0.17 if s >= 32 else 0.12, radius=0.22)
save_svg("icon/cotab-app-icon-moss.svg", "<!-- see 03-app-icons for the raster icons; the glass icon relies on filters. -->\n" + mark_svg("glass", "glass", uid="i", pad=14).replace("<defs>", f'<defs>', 1))
shutil.copy(svgs["icon/favicon.svg"], P("03-app-icons/favicon", "favicon.svg"))

# ---------------- Social ----------------
def social(name, w, h, bg, lay="horizontal", n="glass-on-dark", pad=0.28):
    job(svgs[f"lockup/cotab-{lay}-{n}.svg"], P("04-social", name), w, h, bg=bg, pad=pad)
social("og-image-1200x630.png", 1200, 630, MOSS, pad=0.3)
social("twitter-header-1500x500.png", 1500, 500, MOSS, pad=0.3)
social("linkedin-banner-1584x396.png", 1584, 396, MOSS, pad=0.3)
social("youtube-banner-2560x1440.png", 2560, 1440, MOSS, pad=0.42)
social("og-image-light-1200x630.png", 1200, 630, BACKGROUNDS["mist"], n="glass-on-light", pad=0.3)
for s in (400, 800):
    icon(P("04-social", f"avatar-moss-{s}.png"), s, radius=0.5, pad=0.17)
    icon(P("04-social", f"avatar-mist-{s}.png"), s, bg=BACKGROUNDS["mist"], tube="deep", radius=0.5, pad=0.17)
    icon(P("04-social", f"avatar-square-{s}.png"), s, pad=0.17)

json.dump(jobs, open("/tmp/claude-0/pack/work/jobs.json", "w"))
print(len(jobs), "raster jobs;", len(svgs), "svgs")
