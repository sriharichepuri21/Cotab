/**
 * Quick checks on a receipt photo before it is uploaded: is it big enough,
 * bright enough and sharp enough to read? They run in the browser in a few
 * milliseconds, so a bad photo is caught while the person is still holding
 * the receipt, without spending an upload or an AI call on it.
 *
 * The checks only warn. The person can always choose "Use it anyway", and
 * the server's own reading has the final say on whether it's a receipt.
 */

export type QualityIssue = "blurry" | "too_dark" | "too_small";

export type QualityReport = {
  issue: QualityIssue | null;
  /** Sharpest-edge strength scaled by contrast. Below BLUR_LIMIT reads as blurry. */
  sharpness: number;
  /** Mean brightness, 0 (black) to 255 (white). */
  brightness: number;
  width: number;
  height: number;
};

/**
 * Calibrated in Chromium on 34 generated phone photos of receipts (three sizes
 * in frame, normal and dim light, five blur levels, two motion-blur levels):
 * every photo whose text was still readable scored 25.9 or more, every
 * unreadable one 22.1 or less. 24 sits in that gap. Synthetic photos are a
 * starting point; re-check against real scans once enough are collected.
 */
export const BLUR_LIMIT = 24;
/** Contrast floor for the sharpness score (see measure). */
const MIN_CONTRAST = 60;
/** Average brightness below this is too dark to read reliably. */
export const DARK_LIMIT = 40;
/** Shorter side in pixels; below this receipt text is too few pixels tall. */
export const MIN_SIDE = 480;

/**
 * Score a grayscale-convertible RGBA pixel buffer (as from getImageData).
 * Pure, so it can be unit tested without a canvas.
 */
export function measure(data: Uint8ClampedArray, width: number, height: number) {
  const n = width * height;
  const gray = new Float32Array(n);
  const grayHist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    gray[i] = g;
    grayHist[g | 0]++;
    sum += g;
  }

  // |Laplacian| for every interior pixel, binned so percentiles are cheap.
  const lapHist = new Uint32Array(1021);
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lapHist[Math.min(1020, Math.abs(lap) | 0)]++;
      count++;
    }
  }

  const percentile = (hist: Uint32Array, total: number, q: number) => {
    const target = total * q;
    let seen = 0;
    for (let v = 0; v < hist.length; v++) {
      seen += hist[v];
      if (seen >= target) return v;
    }
    return hist.length - 1;
  };

  // Scale by contrast so dim light isn't mistaken for blur, but never by less
  // than MIN_CONTRAST: on a near-blank photo, faint grain would otherwise
  // be divided by almost nothing and look like crisp text.
  const contrast = Math.max(
    MIN_CONTRAST,
    percentile(grayHist, n, 0.99) - percentile(grayHist, n, 0.01)
  );
  const edge = count ? percentile(lapHist, count, 0.999) : 0;
  return { sharpness: (edge / contrast) * 100, brightness: n ? sum / n : 0 };
}

export function judge(r: Omit<QualityReport, "issue">): QualityIssue | null {
  if (Math.min(r.width, r.height) < MIN_SIDE) return "too_small";
  if (r.brightness < DARK_LIMIT) return "too_dark";
  if (r.sharpness < BLUR_LIMIT) return "blurry";
  return null;
}

/** What to tell someone about each issue, in Cotab's voice. */
export const QUALITY_MESSAGES: Record<QualityIssue, { title: string; body: string }> = {
  blurry: {
    title: "This photo looks blurry",
    body: "Hold the phone steady, or rest your elbows on the table, and take it again.",
  },
  too_dark: {
    title: "This photo is too dark",
    body: "Move somewhere brighter, or turn on a light, and take it again.",
  },
  too_small: {
    title: "This photo is very small",
    body: "Try the original photo, or move closer so the receipt fills the frame.",
  },
};

/**
 * Check a photo the person just took or picked. Analyses it at the same size
 * it will be uploaded at (1600px on the long side), because that is what the
 * reader sees. Returns null when the browser can't decode the file (HEIC on
 * some browsers, PDFs): those go straight to the server, which checks them.
 */
export async function checkPhoto(file: Blob): Promise<QualityReport | null> {
  if (!file.type.startsWith("image/")) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  // Shrink with proper averaging. A quick nearest-pixel shrink keeps camera
  // grain, which the sharpness score would mistake for crisp text.
  try {
    const small = await createImageBitmap(bitmap, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "high",
    });
    bitmap.close();
    bitmap = small;
  } catch {
    // Older browsers without resize options: draw at full size below.
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const m = measure(data, w, h);
    const base = { ...m, width, height };
    return { ...base, issue: judge(base) };
  } finally {
    bitmap.close();
  }
}
