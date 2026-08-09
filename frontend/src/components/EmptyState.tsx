import type { Intent } from "@/lib/api";

/**
 * Shown instead of an empty receipts list.
 *
 * "Recent receipts" with nothing under it reads as broken; a prompt reads as a
 * next step. Copy is chosen by the intent captured at /welcome — the only place
 * intent currently changes anything, deliberately kept to strings so there's no
 * branching UI to maintain.
 */

const COPY: Record<Intent | "unknown", { title: string; blurb: string }> = {
  personal: {
    title: "Let's scan your first receipt",
    blurb: "Snap one and we'll pull out the merchant, total, and items for you.",
  },
  splits: {
    title: "Add the first receipt to split",
    blurb: "Scan a bill and you can divide it with friends — they don't need accounts.",
  },
  business: {
    title: "Start your expense records",
    blurb: "Scan a receipt and we'll keep it organised and ready for tax time.",
  },
  unknown: {
    title: "Let's scan your first receipt",
    blurb: "Snap one and we'll pull out the merchant, total, and items for you.",
  },
};

export function EmptyState({
  intent,
  onFile,
  busy,
  message,
}: {
  intent: Intent | null;
  onFile: (f: File) => void;
  busy: boolean;
  message: string;
}) {
  const copy = COPY[intent ?? "unknown"];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-3xl">
        <span aria-hidden>🧾</span>
      </div>
      <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">{copy.blurb}</p>

      <label className="mt-6 inline-block cursor-pointer rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
        {busy ? "Working…" : "Scan a receipt"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>

      {message && <p className="mt-4 text-sm text-gray-600">{message}</p>}
    </section>
  );
}
