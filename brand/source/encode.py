import json, os, subprocess, shutil
M = json.load(open("anim_manifest.json"))
FR = "/tmp/claude-0/pack/work/frames"; OUT = "/tmp/claude-0/pack/Cotab-Logo-B/05-animation"
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print("FAIL", " ".join(cmd)[:160], r.stderr[-300:])
for key, m in M.items():
    name, var = key.rsplit("_", 1) if key.count("_") == 1 else (key.split("_")[0], key.split("_", 1)[1])
    name, var = key.split("_", 1)
    d = f"{OUT}/{name}"; os.makedirs(d, exist_ok=True)
    src = f"{FR}/{key}/%04d.png"; base = f"{d}/cotab-{name}-{var}"
    once = not m["loop"]; hold = ["-vf", "tpad=stop_mode=clone:stop_duration=0.8"] if once else []
    inp = ["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", src]
    alpha = not m["bg"]
    if alpha:
        run(inp + hold + ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0", "-an", base + ".webm"])
        run(inp + hold + ["-c:v", "libwebp_anim", "-lossless", "0", "-quality", "82", "-loop", "0" if m["loop"] else "1", "-an", base + ".webp"])
        run(inp + [("-vf"), ("scale=iw/2:-2" + (",tpad=stop_mode=clone:stop_duration=0.8" if once else "")), "-plays", "0" if m["loop"] else "1", "-f", "apng", base + ".apng"])
    else:
        run(inp + hold + ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow", "-movflags", "+faststart", "-an", base + ".mp4"])
        run(inp + hold + ["-c:v", "libwebp_anim", "-lossless", "0", "-quality", "82", "-loop", "0" if m["loop"] else "1", "-an", base + ".webp"])
        vf = "fps=20,scale=iw/2:-2:flags=lanczos," + ("tpad=stop_mode=clone:stop_duration=0.8," if once else "") + "split[a][b];[a]palettegen=max_colors=200[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
        run(inp + ["-vf", vf, "-loop", "0" if m["loop"] else "-1", base + ".gif"])
    print("ok", key, flush=True)
print("ENCODED")
