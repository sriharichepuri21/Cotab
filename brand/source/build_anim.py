import json, os, shutil, sys
import anim
from anim import *
FR = "/tmp/claude-0/pack/work/frames"
shutil.rmtree(FR, ignore_errors=True); os.makedirs(FR)
VARIANTS = {   # name: (tube, background css or None)
    "transparent-dark": ("glass", None),       # for dark interfaces
    "transparent-light": ("deep", None),       # for light interfaces
    "on-moss": ("glass", logo.BACKGROUNDS["moss"]),
    "on-mist": ("deep", logo.BACKGROUNDS["mist"]),
}
jobs = []; manifest = {}
def add(name, var, w, h, frames_fn, nframes, wordcol=None):
    tube, bg = VARIANTS[var]
    d = f"{FR}/{name}_{var}"; os.makedirs(d, exist_ok=True)
    for i in range(nframes):
        svg = frames_fn(i / FPS, tube)
        p = f"{d}/{i:04d}.svg"; open(p, "w").write(svg)
        jobs.append(dict(svg=p, out=f"{d}/{i:04d}.png", w=w, h=h, bg=bg, pad=0.0, radius=0, color="#000"))
    manifest[f"{name}_{var}"] = dict(frames=nframes, w=w, h=h, bg=bool(bg), loop=(name in ANIMS and ANIMS[name][2] == "loop"))
for var in VARIANTS:
    for name, (fn, dur, mode) in ANIMS.items():
        add(name, var, 612, 540, lambda t, tube, n=name: frame_svg(n, t, tube), round(dur * FPS))
    # intro with the wordmark
    word = "#f4f6ea" if VARIANTS[var][0] == "glass" else "#1f2814"
    svg, (lw, lh) = lockup_frame(0, VARIANTS[var][0], word)
    W_ = 1280; H_ = round(W_ * lh / lw / 2) * 2
    add("intro-lockup", var, W_, H_, lambda t, tube, w=word: lockup_frame(t, tube, w)[0], round(4.2 * FPS))
json.dump(jobs, open("/tmp/claude-0/pack/work/jobs.json", "w")); json.dump(manifest, open("/tmp/claude-0/pack/work/anim_manifest.json", "w"))
print(len(jobs), "frames")
