import { describe, expect, it } from "vitest";

import { BLUR_LIMIT, DARK_LIMIT, judge, measure, MIN_SIDE } from "./scanQuality";

/** A synthetic "receipt": dark text-like strokes on light paper. */
function receipt(w: number, h: number, { soften = 0, light = 1 } = {}) {
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const stroke = y % 12 < 3 && x % 7 < 4; // rows of little glyphs
      gray[y * w + x] = (stroke ? 40 : 235) * light;
    }
  // Box blur `soften` times to imitate an out-of-focus photo.
  for (let pass = 0; pass < soften; pass++) {
    const src = gray.slice();
    const at = (x: number, y: number) =>
      src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(x + dx, y + dy);
        gray[y * w + x] = s / 9;
      }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

const report = (data: Uint8ClampedArray, w: number, h: number) => {
  const m = measure(data, w, h);
  return { ...m, width: w, height: h };
};

describe("photo quality", () => {
  it("passes a sharp, well-lit receipt", () => {
    const r = report(receipt(600, 800), 600, 800);
    expect(r.sharpness).toBeGreaterThan(BLUR_LIMIT);
    expect(judge(r)).toBeNull();
  });

  it("flags a blurry photo of the same receipt", () => {
    const r = report(receipt(600, 800, { soften: 10 }), 600, 800);
    expect(r.sharpness).toBeLessThan(BLUR_LIMIT);
    expect(judge(r)).toBe("blurry");
  });

  it("does not call a dim but sharp photo blurry", () => {
    const r = report(receipt(600, 800, { light: 0.45 }), 600, 800);
    expect(r.brightness).toBeGreaterThan(DARK_LIMIT);
    expect(judge(r)).toBeNull();
  });

  it("does not let a washed-out, almost blank photo score as sharp", () => {
    const w = 400;
    const h = 600;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = 200 + ((i * 7919) % 5); // faint sensor noise on a plain surface
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const r = report(rgba, w, h);
    expect(r.sharpness).toBeLessThan(BLUR_LIMIT);
  });

  it("flags a photo that is too dark to read", () => {
    const r = report(receipt(600, 800, { light: 0.12 }), 600, 800);
    expect(judge(r)).toBe("too_dark");
  });

  it("flags a tiny image before anything else", () => {
    const r = report(receipt(300, 400), 300, 400);
    expect(Math.min(r.width, r.height)).toBeLessThan(MIN_SIDE);
    expect(judge(r)).toBe("too_small");
  });
});
