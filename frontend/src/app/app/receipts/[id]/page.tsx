"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CatAvatar } from "@/components/Tabby";
import {
  Icon,
  Button,
  buttonClass,
  ErrorNote,
  Field,
  fieldClass,
  PageHeader,
  PageSkeleton,
  Slip,
  SlipLine,
} from "@/components/ui";
import {
  ApiError,
  CATEGORIES,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  getScan,
  isAuthed,
  reviewReceipt,
  retryReceipt,
  type LineItem,
  type Receipt,
} from "@/lib/api";
import { mutate, peek } from "@/lib/cache";
import { invalidateSpending, keys } from "@/lib/data";
import { amount, categoryLabel, categoryStyle, dayLabel, money, splitMoney } from "@/lib/format";
import { routes } from "@/lib/routes";
import { OPEN_SCANNER_EVENT } from "@/lib/scanQueue";

/** Editable line item: server rows have id; newly-added ones get a temp id. */
type EditableItem = Partial<LineItem> & {
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

function toEditable(items?: LineItem[]): EditableItem[] {
  return (items ?? []).map((li) => ({ ...li }));
}

/** ISO -> yyyy-MM-dd for <input type="date">. */
function toDateInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const num = (v: string) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

export default function ReceiptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");

  // Lists already carry every receipt in full, so a receipt opened from the
  // tab or Home shows at once; the fresh copy below replaces it quietly.
  const cached = peek<Receipt>(keys.receipt(id));
  const [receipt, setReceiptState] = useState<Receipt | null>(cached ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState(false); // false = no preview available
  const [isPdf, setIsPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);

  /** Show `r` here and everywhere else that has it cached. */
  const setReceipt = useCallback(
    (r: Receipt) => {
      setReceiptState(r);
      mutate(keys.receipt(id), r);
    },
    [id]
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    merchant: "",
    purchased_at: "",
    total: "",
    subtotal: "",
    tax: "",
    category: "other",
  });
  const [items, setItems] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [retrying, setRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    // The photo link and the data don't depend on each other: ask for both at once.
    const image = getReceiptImage(id)
      .then((img) => {
        setImageUrl(img.url);
        setIsPdf(img.kind === "pdf");
        setImagePreview(true);
      })
      .catch(() => {
        // 404 (no image) or 501 (local dev store) — either way no preview.
        setImageUrl(null);
        setImagePreview(false);
      });
    try {
      setReceipt(await getReceipt(id));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(routes.login);
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load this receipt");
    } finally {
      setLoading(false);
    }
    await image;
  }, [id, router, setReceipt]);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    load();
  }, [load, router]);

  // Just scanned and still being read: wait for it, then fill the page in.
  const [refusedNote, setRefusedNote] = useState<string | null>(null);
  const processing = receipt?.status === "processing";
  useEffect(() => {
    if (!processing) return;
    let stopped = false;
    void (async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 1500));
        if (stopped) return;
        let scan;
        try {
          scan = await getScan(id);
        } catch {
          continue; // a network blip: keep waiting
        }
        if (scan.state === "reading") continue;
        invalidateSpending();
        if (scan.state === "refused") {
          setRefusedNote(scan.message || "That wasn't a receipt, so nothing was kept.");
        } else if (scan.state === "joined" && scan.receipt && scan.receipt.id !== id) {
          router.replace(routes.receipt(scan.receipt.id));
        } else {
          await load();
        }
        return;
      }
    })();
    return () => {
      stopped = true;
    };
  }, [processing, id, load, router]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <PageSkeleton rows={4} />
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
        <PageHeader title="Receipt" back={{ href: routes.tab, label: "Your tab" }} />
        <ErrorNote>{error ?? "We couldn't find this receipt. It may have been deleted."}</ErrorNote>
      </main>
    );
  }

  const startEdit = () => {
    setForm({
      merchant: receipt.merchant,
      purchased_at: toDateInput(receipt.purchased_at),
      total: String(receipt.total),
      subtotal: String(receipt.subtotal),
      tax: String(receipt.tax),
      category: receipt.category || "other",
    });
    setItems(toEditable(receipt.line_items));
    setSaveError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await reviewReceipt(id, {
        merchant: form.merchant,
        purchased_at: form.purchased_at || null,
        total: num(form.total),
        subtotal: num(form.subtotal),
        tax: num(form.tax),
        category: form.category,
        line_items: items.map(({ description, quantity, unit_price, total_price }) => ({
          description,
          quantity: Number(quantity) || 0,
          unit_price: Number(unit_price) || 0,
          total_price: Number(total_price) || 0,
        })),
      });
      setReceipt(updated);
      invalidateSpending();
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const doRetry = async () => {
    setRetrying(true);
    setRetryNotice(null);
    try {
      const updated = await retryReceipt(id);
      setReceipt(updated);
      invalidateSpending();
      if (updated.status === "extracted") {
        setRetryNotice("Read it this time. Check the lines below.");
      } else {
        setRetryNotice(
          updated.error_message
            ? `Still couldn't read it: ${updated.error_message}`
            : "Still couldn't read it. You can type it in instead."
        );
      }
    } catch (e) {
      setRetryNotice(e instanceof Error ? e.message : "That retry didn't go through. Try again.");
    } finally {
      setRetrying(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteReceipt(id);
      invalidateSpending();
      router.push(routes.tab);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't delete. Try again.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const failed = receipt.status === "failed";
  const canRetry = failed;
  const lines = receipt.line_items ?? [];
  const tapped = receipt.source === "tap";
  const tapTime = receipt.purchased_at
    ? new Date(receipt.purchased_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const toReview = receipt.status === "extracted";

  const setItem = (idx: number, patch: Partial<EditableItem>) =>
    setItems(items.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const style = categoryStyle(receipt.category);
  const [whole, cents] = splitMoney(receipt.total, receipt.currency);
  const sourceChip = tapped
    ? { icon: "contactless", label: "Apple Pay" }
    : receipt.source === "email"
      ? { icon: "mail", label: "From email" }
      : isPdf
        ? { icon: "picture_as_pdf", label: "From a PDF" }
        : { icon: "photo_camera", label: "From a photo" };
  const actionClass =
    "press flex flex-col items-center gap-1.5 text-[13px] font-bold text-ink disabled:opacity-50";
  const actionDot =
    "grid h-[52px] w-[52px] place-items-center rounded-full bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.05)]";

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-6 md:px-8 md:pt-10">
      {!editing ? (
        <>
          <header className="flex items-center justify-between">
            <Link
              href={routes.tab}
              aria-label="Back to receipts"
              className="press grid h-11 w-11 place-items-center rounded-full bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.05)]"
            >
              <Icon name="arrow_back_ios_new" size={20} />
            </Link>
            <span className="text-[15px] font-extrabold">Receipt</span>
            <span className="h-11 w-11" aria-hidden="true" />
          </header>

          <section className="mt-6 flex flex-col items-center text-center">
            <span
              className="grid h-16 w-16 place-items-center rounded-[22px]"
              style={
                failed
                  ? { background: "#FCE6E9", color: "#C8373C" }
                  : { background: style.tile, color: style.ink }
              }
            >
              <Icon
                name={failed ? "error" : processing ? "hourglass_top" : style.icon}
                fill
                size={32}
              />
            </span>
            <h1 className="mt-4 text-[22px] font-extrabold tracking-[-0.03em]">
              {processing ? "New receipt" : receipt.merchant || "Unreadable receipt"}
            </h1>
            <p className="mt-1 text-sm font-medium text-faint">
              {dayLabel(receipt.purchased_at)}
              {tapped && tapTime ? ` at ${tapTime}` : ""}
              {toReview ? " · not checked yet" : ""}
            </p>
            {!failed && !processing && (
              <p className="mt-3 text-[48px] font-extrabold leading-none tracking-[-0.055em]">
                {whole}
                <span className="text-[#B3B9B5]">{cents}</span>
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[13px] font-bold">
                <Icon name={sourceChip.icon} size={17} />
                {sourceChip.label}
              </span>
              {!failed && !processing && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"
                  style={{ background: style.tile, color: style.ink }}
                >
                  <Icon name={style.icon} fill size={17} />
                  {categoryLabel(receipt.category)}
                </span>
              )}
            </div>
          </section>

          {tapped && !imageUrl && lines.length === 0 && (
            <div className="mt-6 flex items-center gap-3 rounded-card bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_48%,#FFFFFF_100%)] p-4">
              <CatAvatar choice={{ look: "hoodie", mood: "hi", bg: "mood" }} size={48} soft />
              <p className="flex-1 text-sm text-muted">
                <strong className="block text-[15px] text-ink">Got the receipt?</strong>
                Scan it and Tabby adds what you bought to this same purchase.
              </p>
              <Button
                onClick={() => window.dispatchEvent(new Event(OPEN_SCANNER_EVENT))}
                className="shrink-0 !min-h-10 !px-4 text-sm"
              >
                Scan the receipt
              </Button>
            </div>
          )}

          {processing && (
            <div
              className={`mt-6 flex items-center gap-3 rounded-card p-4 ${refusedNote ? "bg-blush" : "bg-card"}`}
              aria-live="polite"
            >
              <CatAvatar
                choice={{ look: "hoodie", mood: refusedNote ? "hmm" : "hi", bg: "mood" }}
                size={48}
              />
              {refusedNote ? (
                <div>
                  <p className="font-extrabold">Nothing was added</p>
                  <p className="mt-0.5 text-sm">
                    {refusedNote}{" "}
                    <Link href={routes.tab} className="font-bold underline underline-offset-4">
                      Back to receipts
                    </Link>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-extrabold">Tabby is reading this receipt…</p>
                  <p className="mt-0.5 text-sm text-muted">
                    It takes a few seconds. This page fills in by itself.
                  </p>
                </div>
              )}
            </div>
          )}

          {failed && (
            <div className="mt-6 flex items-center gap-3 rounded-card bg-blush p-4">
              <CatAvatar choice={{ look: "hoodie", mood: "hmm", bg: "mood" }} size={48} />
              <div>
                <p className="font-extrabold">Tabby couldn&apos;t read this one</p>
                <p className="mt-0.5 text-sm">
                  {receipt.error_message || "The photo may be blurry or cut off."} Try reading it
                  again, or type it in yourself.
                </p>
              </div>
            </div>
          )}

          <div className="mx-auto mt-7 flex max-w-sm justify-around">
            {canRetry && (
              <button type="button" onClick={doRetry} disabled={retrying} className={actionClass}>
                <span className={actionDot}>
                  <Icon name="refresh" />
                </span>
                {retrying ? "Reading…" : "Read it again"}
              </button>
            )}
            {!failed && !processing && (
              <Link href={routes.splitReceipt(receipt.id)} className={actionClass}>
                <span className={`${actionDot} !bg-forest text-gold`}>
                  <Icon name="call_split" />
                </span>
                Split this
              </Link>
            )}
            <button type="button" onClick={startEdit} className={actionClass}>
              <span className={actionDot}>
                <Icon name="edit" />
              </span>
              {failed ? "Type it in" : toReview ? "Check and edit" : "Edit"}
            </button>
            {imagePreview && imageUrl && (
              <a href={imageUrl} target="_blank" rel="noreferrer" className={actionClass}>
                <span className={actionDot}>
                  <Icon name={isPdf ? "picture_as_pdf" : "image"} />
                </span>
                {isPdf ? "PDF" : "Photo"}
              </a>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)} className={actionClass}>
              <span className={`${actionDot} text-rose`}>
                <Icon name="delete" />
              </span>
              Delete
            </button>
          </div>

          {retryNotice && (
            <p role="status" className="mt-4 text-center text-sm font-semibold">
              {retryNotice}
            </p>
          )}
          {saveError && (
            <div className="mt-4">
              <ErrorNote>{saveError}</ErrorNote>
            </div>
          )}

          {(lines.length > 0 || !failed) && !processing && (
            <section className="mt-7 rounded-card bg-card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-extrabold tracking-[-0.02em]">
                  {lines.length ? `${lines.length} item${lines.length === 1 ? "" : "s"}` : "Items"}
                </h2>
                {!failed && !(tapped && lines.length === 0) && (receipt.confidence ?? 0) > 0 && (
                  <span className="text-[13px] font-semibold text-faint">
                    Read with {Math.round((receipt.confidence ?? 0) * 100)}% confidence
                  </span>
                )}
              </div>
              {lines.length === 0 && (
                <p className="mt-3 text-sm text-muted">
                  {tapped
                    ? "No items yet. Scan the receipt to add them."
                    : "No item lines on this one."}
                </p>
              )}
              <ul className="mt-2">
                {lines.map((li, i) => (
                  <li
                    key={li.id}
                    className={`flex items-baseline gap-3 py-2.5 ${i ? "border-t border-line" : ""}`}
                  >
                    <span className="min-w-0 flex-1 text-[15px] font-semibold">
                      {li.description || "Item"}
                      {li.quantity !== 1 && (
                        <span className="ml-1.5 text-[13px] font-semibold text-faint">
                          × {li.quantity}
                        </span>
                      )}
                    </span>
                    <span className="text-[15px] font-bold">{amount(li.total_price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-ink/15 pt-3 text-sm font-semibold text-muted">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{amount(receipt.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>{amount(receipt.tax)}</span>
                </div>
                <div className="mt-1 flex justify-between text-[17px] font-extrabold text-ink">
                  <span>Total</span>
                  <span>{money(receipt.total, receipt.currency)}</span>
                </div>
              </div>
            </section>
          )}

          {imagePreview && imageUrl && !isPdf && (
            <section className="mt-4 overflow-hidden rounded-card bg-card p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`Receipt from ${receipt.merchant || "unknown merchant"}`}
                className="mx-auto max-h-[480px] w-auto rounded-[16px] object-contain"
              />
            </section>
          )}
        </>
      ) : (
        <div className="max-w-2xl">
          <h1 className="mb-6 font-display text-3xl">Edit receipt</h1>

          <div className="flex flex-col gap-4">
            <Field label="Store">
              <input
                value={form.merchant}
                onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  type="date"
                  value={form.purchased_at}
                  onChange={(e) => setForm({ ...form, purchased_at: e.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label="Category">
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={fieldClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Subtotal">
                <input
                  inputMode="decimal"
                  value={form.subtotal}
                  onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label="Tax">
                <input
                  inputMode="decimal"
                  value={form.tax}
                  onChange={(e) => setForm({ ...form, tax: e.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label="Total">
                <input
                  inputMode="decimal"
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value })}
                  className={fieldClass}
                />
              </Field>
            </div>
          </div>

          <h2 className="mb-3 mt-8 text-lg font-bold">Items</h2>
          <div className="flex flex-col gap-2">
            {items.map((li, idx) => (
              <div key={li.id ?? `new-${idx}`} className="flex items-center gap-2">
                <input
                  value={li.description}
                  placeholder="What was it"
                  aria-label={`Item ${idx + 1} name`}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                  className={`${fieldClass} flex-1`}
                />
                <input
                  inputMode="decimal"
                  value={String(li.quantity)}
                  aria-label={`Item ${idx + 1} quantity`}
                  onChange={(e) => setItem(idx, { quantity: num(e.target.value) })}
                  className={`${fieldClass} !w-16 text-center`}
                />
                <input
                  inputMode="decimal"
                  value={String(li.total_price)}
                  aria-label={`Item ${idx + 1} price`}
                  onChange={(e) => setItem(idx, { total_price: num(e.target.value) })}
                  className={`${fieldClass} !w-24 text-right font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  aria-label={`Remove item ${idx + 1}`}
                  className="grid h-12 w-10 shrink-0 place-items-center rounded-button text-lg text-rose hover:bg-blush/50"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setItems([...items, { description: "", quantity: 1, unit_price: 0, total_price: 0 }])
            }
            className="mt-3 min-h-11 text-sm font-semibold underline underline-offset-4"
          >
            + Add an item
          </button>

          {saveError && (
            <div className="mt-4">
              <ErrorNote>{saveError}</ErrorNote>
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <Button onClick={saveEdit} disabled={saving} className="flex-1">
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div className="rise w-full max-w-sm rounded-card bg-paper p-6">
            <h2 id="delete-title" className="text-lg font-bold">
              Delete this receipt?
            </h2>
            <p className="mt-2 text-sm text-muted">
              It comes off your tab and out of your spending totals.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={doDelete}
                disabled={deleting}
                className={`${buttonClass.primary} flex-1 !bg-rose`}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Keep it
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
