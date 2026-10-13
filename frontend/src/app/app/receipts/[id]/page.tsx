"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
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
  isAuthed,
  reviewReceipt,
  retryReceipt,
  type LineItem,
  type Receipt,
} from "@/lib/api";
import { mutate, peek } from "@/lib/cache";
import { invalidateSpending, keys } from "@/lib/data";
import { amount, categoryLabel, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

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
  const canRetry = failed || receipt.status === "processing";
  const lines = receipt.line_items ?? [];
  const toReview = receipt.status === "extracted";

  const setItem = (idx: number, patch: Partial<EditableItem>) =>
    setItems(items.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
      <Link
        href={routes.tab}
        className="-ml-1 mb-2 inline-block py-2 text-sm font-semibold text-ink"
      >
        ‹ Your tab
      </Link>

      {!editing ? (
        <>
          <header className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-3xl md:text-4xl">
                {receipt.merchant || "Unreadable receipt"}
              </h1>
              <p className="mt-2 text-muted">
                {dayLabel(receipt.purchased_at)}, from {isPdf ? "a PDF" : "a photo"}
                {toReview ? ", not checked yet" : ""}
              </p>
            </div>
            {!failed && (
              <p className="shrink-0 font-display text-2xl md:text-3xl">
                {money(receipt.total, receipt.currency)}
              </p>
            )}
          </header>

          {failed && (
            <div className="mb-6 rounded-card bg-blush p-4">
              <p className="font-semibold">We couldn&apos;t read this receipt</p>
              <p className="mt-1 text-sm">
                {receipt.error_message || "The photo may be blurry or cut off."} Try reading it
                again, or type it in yourself.
              </p>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-10">
            <div className="flex gap-4 md:flex-col">
              <div className="w-24 shrink-0 overflow-hidden rounded-button border border-line bg-ink/[0.04] md:w-full">
                {imagePreview && imageUrl && isPdf ? (
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex aspect-[3/4] flex-col items-center justify-center gap-2 p-3 text-center text-sm font-semibold underline underline-offset-4"
                  >
                    <span className="font-mono text-xs no-underline">PDF</span>
                    Open the PDF
                  </a>
                ) : imagePreview && imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={`Receipt from ${receipt.merchant || "unknown merchant"}`}
                    className="h-auto w-full object-contain"
                  />
                ) : (
                  <div
                    role="img"
                    aria-label="No photo stored for this receipt"
                    className="flex aspect-[3/4] flex-col gap-1.5 p-3"
                  >
                    <span className="h-1 w-3/5 self-center bg-line" />
                    <span className="h-[3px] bg-line/60" />
                    <span className="h-[3px] w-4/5 bg-line/60" />
                    <span className="h-[3px] w-11/12 bg-line/60" />
                    <span className="h-[3px] w-3/4 bg-line/60" />
                  </div>
                )}
              </div>
              <dl className="flex flex-1 flex-col gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Category</dt>
                  <dd className="font-semibold">{categoryLabel(receipt.category)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Items</dt>
                  <dd className="font-semibold">{lines.length || "—"}</dd>
                </div>
                {!failed && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Read with</dt>
                    <dd className="font-semibold">
                      {Math.round((receipt.confidence ?? 0) * 100)}% confidence
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div>
              {lines.length > 0 || !failed ? (
                <Slip>
                  {lines.length === 0 && (
                    <p className="pb-2 text-muted">No item lines on this one.</p>
                  )}
                  {lines.map((li) => (
                    <SlipLine
                      key={li.id}
                      name={
                        <>
                          {li.description || "Item"}
                          {li.quantity !== 1 && <span className="text-muted"> ×{li.quantity}</span>}
                        </>
                      }
                      amount={amount(li.total_price)}
                    />
                  ))}
                  <div className="mt-2 border-t border-dashed border-muted/60 pt-2">
                    <SlipLine name="Subtotal" amount={amount(receipt.subtotal)} tone="muted" />
                    <SlipLine name="Tax" amount={amount(receipt.tax)} tone="muted" />
                    <SlipLine name="TOTAL" amount={amount(receipt.total)} strong />
                  </div>
                </Slip>
              ) : null}

              {retryNotice && (
                <p role="status" className="mt-4 text-sm">
                  {retryNotice}
                </p>
              )}
              {saveError && (
                <div className="mt-4">
                  <ErrorNote>{saveError}</ErrorNote>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {canRetry && (
                  <Button onClick={doRetry} disabled={retrying} arrow>
                    {retrying ? "Reading it again…" : "Read it again"}
                  </Button>
                )}
                {!failed && (
                  <Link
                    href={routes.splitReceipt(receipt.id)}
                    className={`${buttonClass.primary} sm:flex-1`}
                  >
                    <span aria-hidden="true">→</span> Split this
                  </Link>
                )}
                <Button variant="ghost" onClick={startEdit} className="sm:flex-1">
                  {failed ? "Type it in" : toReview ? "Check and edit" : "Edit"}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mt-4 min-h-11 text-sm font-semibold text-rose underline underline-offset-4"
              >
                Delete this receipt
              </button>
            </div>
          </div>
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
