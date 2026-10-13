/** Fired on `window` after any successful upload, so pages can refresh. */
export const UPLOADED_EVENT = "rw:uploaded";

/**
 * Client-side compress before upload. Two goals: (1) upload is fast on mobile
 * data, (2) the image is small enough for the vision call but retains enough
 * detail to read receipt text. Target ~1MB — NOT a hard cap: this is a quality
 * knob, and the app uploads whatever comes out (only the server's 5MB ceiling
 * can refuse). Phone photos are 12–24MP, so we step down dimensions+quality
 * toward the target instead of assuming one pass is enough.
 */
const COMPRESS_TARGET_BYTES = 1024 * 1024;

export async function compressImage(file: File): Promise<Blob> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Failed to load image"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error("No canvas context");
  }

  const encode = (maxDim: number, quality: number) =>
    new Promise<Blob>((res, rej) => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/webp", quality);
    });

  let best = await encode(1600, 0.85);
  if (best.size <= COMPRESS_TARGET_BYTES) {
    URL.revokeObjectURL(url);
    return best;
  }
  for (const [maxDim, quality] of [
    [1400, 0.8],
    [1200, 0.75],
    [1000, 0.7],
  ] as const) {
    const b = await encode(maxDim, quality);
    if (b.size < best.size) best = b;
    if (best.size <= COMPRESS_TARGET_BYTES) break;
  }
  URL.revokeObjectURL(url);
  return best;
}
