"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PricedLines, PriceTabby } from "@/components/PriceMemory";
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
import { invalidateSpending, keys, usePrices } from "@/lib/data";
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
  // What Tabby remembers about these prices. Refreshes with any change to spending.
  const prices = usePrices(id).data;

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
              {prices && <PriceTabby memory={prices} />}
              <PricedLines lines={lines} memory={prices} />
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
        <EditForm
          form={form}
          setForm={setForm}
          items={items}
          setItems={setItems}
          setItem={setItem}
          saving={saving}
          saveError={saveError}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
          currency={receipt.currency}
        />
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

type EditFormValues = {
  merchant: string;
  purchased_at: string;
  total: string;
  subtotal: string;
  tax: string;
  category: string;
};

/** Edit a receipt: details, money with live checks, and the item lines. */
function EditForm({
  form,
  setForm,
  items,
  setItems,
  setItem,
  saving,
  saveError,
  onSave,
  onCancel,
  currency,
}: {
  form: EditFormValues;
  setForm: (next: EditFormValues) => void;
  items: EditableItem[];
  setItems: (next: EditableItem[]) => void;
  setItem: (idx: number, patch: Partial<EditableItem>) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onCancel: () => void;
  currency: string;
}) {
  const style = categoryStyle(form.category);
  const cents = (v: number) => Math.round(v * 100);
  const itemsSum = items.reduce((sum, li) => sum + (Number(li.total_price) || 0), 0);
  const subtotal = num(form.subtotal);
  const tax = num(form.tax);
  const total = num(form.total);
  const itemsMatch = !items.length || cents(itemsSum) === cents(subtotal);
  const totalMatch = cents(subtotal + tax) === cents(total);
  const card = "rounded-card bg-card p-5";
  const label = "mb-1.5 block text-[13px] font-bold text-muted";
  const moneyInput = (key: "subtotal" | "tax" | "total", text: string) => (
    <label className="block">
      <span className={label}>{text}</span>
      <span className="flex items-center rounded-tile border border-ink/10 bg-card pl-3 focus-within:border-forest focus-within:ring-4 focus-within:ring-gold/60">
        <span className="text-[15px] font-bold text-faint">$</span>
        <input
          inputMode="decimal"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          className={`h-12 w-full min-w-0 bg-transparent pl-1 pr-3 text-[16px] font-bold outline-none ${key === "total" ? "text-forest" : ""}`}
          aria-label={text}
        />
      </span>
    </label>
  );

  return (
    <div className="pb-40 md:pb-0">
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Stop editing"
          className="press grid h-11 w-11 place-items-center rounded-full bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.05)]"
        >
          <Icon name="close" size={22} />
        </button>
        <span className="text-[15px] font-extrabold">Edit receipt</span>
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <section className={`${card} mt-6`}>
        <div className="flex items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px]"
            style={{ background: style.tile, color: style.ink }}
          >
            <Icon name={style.icon} fill size={24} />
          </span>
          <label className="min-w-0 flex-1">
            <span className={label}>Store</span>
            <input
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
              className={fieldClass}
              aria-label="Store"
            />
          </label>
        </div>
        <label className="mt-4 block">
          <span className={label}>Date</span>
          <input
            type="date"
            value={form.purchased_at}
            onChange={(e) => setForm({ ...form, purchased_at: e.target.value })}
            className={`${fieldClass} appearance-none`}
            aria-label="Date"
          />
        </label>
        <p className={`${label} mt-4`}>Category</p>
        <div
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]"
          role="radiogroup"
          aria-label="Category"
        >
          {CATEGORIES.map((c) => {
            const on = form.category === c;
            const st = categoryStyle(c);
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setForm({ ...form, category: c })}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-bold transition ${
                  on ? "bg-forest text-paper" : "bg-paper text-ink"
                }`}
              >
                <span
                  className="grid h-6 w-6 place-items-center rounded-full"
                  style={on ? undefined : { background: st.tile, color: st.ink }}
                >
                  <Icon name={st.icon} fill size={15} />
                </span>
                {categoryLabel(c)}
              </button>
            );
          })}
        </div>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Money</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {moneyInput("subtotal", "Subtotal")}
          {moneyInput("tax", "Tax")}
          {moneyInput("total", "Total")}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {!totalMatch && (
            <div className="flex items-center gap-2 rounded-tile bg-[#FBEFD3] px-3 py-2.5 text-[13px] font-semibold text-[#8A5A00]">
              <Icon name="calculate" size={18} />
              <span className="flex-1">
                Subtotal + tax is {money(subtotal + tax, currency)}, not {money(total, currency)}.
              </span>
              <button
                type="button"
                onClick={() => setForm({ ...form, total: (subtotal + tax).toFixed(2) })}
                className="shrink-0 rounded-full bg-card px-3 py-1 text-[12px] font-extrabold"
              >
                Use it
              </button>
            </div>
          )}
          {items.length > 0 && (
            <div
              className={`flex items-center gap-2 rounded-tile px-3 py-2.5 text-[13px] font-semibold ${
                itemsMatch ? "bg-mint text-good" : "bg-[#FBEFD3] text-[#8A5A00]"
              }`}
            >
              <Icon
                name={itemsMatch ? "check_circle" : "playlist_add_check"}
                fill={itemsMatch}
                size={18}
              />
              <span className="flex-1">
                {itemsMatch
                  ? `Items add up to the subtotal, ${money(itemsSum, currency)}.`
                  : `Items add up to ${money(itemsSum, currency)}; the subtotal says ${money(subtotal, currency)}.`}
              </span>
              {!itemsMatch && (
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      subtotal: itemsSum.toFixed(2),
                      total: (itemsSum + tax).toFixed(2),
                    })
                  }
                  className="shrink-0 rounded-full bg-card px-3 py-1 text-[12px] font-extrabold"
                >
                  Use {money(itemsSum, currency)}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className={`${card} mt-4`}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold tracking-[-0.02em]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </h2>
        </div>
        <ul className="mt-2 flex flex-col gap-2.5">
          {items.map((li, idx) => (
            <li key={li.id ?? `new-${idx}`} className="rounded-[18px] bg-paper p-3">
              <div className="flex items-start gap-2">
                <textarea
                  value={li.description}
                  placeholder="What was it?"
                  aria-label={`Item ${idx + 1} name`}
                  rows={1}
                  onChange={(e) => setItem(idx, { description: e.target.value })}
                  className="min-h-[44px] flex-1 resize-none rounded-[14px] border border-ink/10 bg-card px-3 py-2.5 text-[15px] font-semibold outline-none [field-sizing:content] focus:border-forest focus:ring-4 focus:ring-gold/60"
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  aria-label={`Remove item ${idx + 1}`}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-rose hover:bg-blush"
                >
                  <Icon name="delete" size={20} />
                </button>
              </div>
              {(li.item_name || li.item_code) && (
                <p className="mt-1 truncate px-1 text-[12px] font-semibold text-faint">
                  {[li.item_name !== li.description ? li.item_name : null, li.item_code]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-full bg-card p-1">
                  <button
                    type="button"
                    aria-label={`Fewer of item ${idx + 1}`}
                    onClick={() =>
                      setItem(idx, { quantity: Math.max(1, (Number(li.quantity) || 1) - 1) })
                    }
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper"
                  >
                    <Icon name="remove" size={18} />
                  </button>
                  <input
                    inputMode="decimal"
                    value={String(li.quantity)}
                    aria-label={`Item ${idx + 1} quantity`}
                    onChange={(e) => setItem(idx, { quantity: num(e.target.value) })}
                    className="w-9 bg-transparent text-center text-[15px] font-extrabold outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`More of item ${idx + 1}`}
                    onClick={() => setItem(idx, { quantity: (Number(li.quantity) || 0) + 1 })}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper"
                  >
                    <Icon name="add" size={18} />
                  </button>
                </div>
                <span className="flex-1" />
                <span className="flex items-center rounded-full border border-ink/10 bg-card pl-3 focus-within:border-forest focus-within:ring-4 focus-within:ring-gold/60">
                  <span className="text-[14px] font-bold text-faint">$</span>
                  <input
                    inputMode="decimal"
                    value={String(li.total_price)}
                    aria-label={`Item ${idx + 1} price`}
                    onChange={(e) => setItem(idx, { total_price: num(e.target.value) })}
                    className="h-10 w-24 bg-transparent pl-1 pr-3 text-right text-[15px] font-extrabold outline-none"
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            setItems([...items, { description: "", quantity: 1, unit_price: 0, total_price: 0 }])
          }
          className="press mt-3 flex w-full items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-[#B9C0BB] py-3 text-sm font-bold"
        >
          <Icon name="add" size={20} />
          Add an item
        </button>
      </section>

      {saveError && (
        <div className="mt-4">
          <ErrorNote>{saveError}</ErrorNote>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[96px] z-20 px-5 md:static md:mt-6 md:px-0">
        <div className="mx-auto flex max-w-2xl gap-2 rounded-full bg-paper/80 p-1.5 backdrop-blur md:bg-transparent md:p-0">
          <Button
            onClick={onSave}
            disabled={saving}
            className="flex-1 shadow-[0_18px_30px_-12px_rgb(15_61_49/0.7)]"
          >
            <Icon name="check" size={20} />
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
