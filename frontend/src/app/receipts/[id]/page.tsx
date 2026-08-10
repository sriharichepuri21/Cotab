"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  isAuthed,
  reviewReceipt,
  retryReceipt,
  type LineItem,
  type Receipt,
} from "@/lib/api";

const CATEGORIES = [
  "groceries",
  "dining",
  "transport",
  "utilities",
  "rent",
  "entertainment",
  "health",
  "shopping",
  "travel",
  "other",
];

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

function fmtMoney(n: number, currency: string) {
  return `${currency} ${n.toFixed(2)}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
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

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState(false); // false = no preview available
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    try {
      const r = await getReceipt(id);
      setReceipt(r);
      setError(null);
      try {
        const img = await getReceiptImage(id);
        setImageUrl(img.url);
        setImagePreview(true);
      } catch {
        // 404 (no image) or 501 (local dev store) — either way no preview.
        setImageUrl(null);
        setImagePreview(false);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load this receipt");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && !isAuthed()) {
      router.replace("/login");
      return;
    }
    load();
  }, [load, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-sm text-red-600">{error ?? "Receipt not found."}</p>
        <button
          onClick={() => router.push("/")}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ← Back to receipts
        </button>
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
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save — try again.");
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
      if (updated.status === "extracted") {
        setRetryNotice("Re-extraction succeeded.");
      } else {
        setRetryNotice(
          `Re-extraction ${updated.status}${updated.error_message ? `: ${updated.error_message}` : ""}`
        );
      }
    } catch (e) {
      setRetryNotice(e instanceof Error ? e.message : "Retry failed — try again.");
    } finally {
      setRetrying(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteReceipt(id);
      router.push("/");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't delete — try again.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const canRetry = receipt.status === "failed" || receipt.status === "processing";
  const confidencePct = Math.round((receipt.confidence ?? 0) * 100);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.push("/")}
          className="mb-6 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          ← Back
        </button>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
          {/* Image */}
          <div className="md:col-span-2">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {imagePreview && imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={`Receipt from ${receipt.merchant || "unknown merchant"}`}
                  className="h-auto w-full object-contain"
                />
              ) : (
                <div className="flex h-48 items-center justify-center text-sm text-gray-400">
                  No image preview
                </div>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-gray-400">
              {receipt.status === "failed"
                ? `Extraction failed${receipt.error_message ? `: ${receipt.error_message}` : ""}`
                : `AI confidence: ${confidencePct}% · status: ${receipt.status}`}
            </p>
          </div>

          {/* Fields + actions */}
          <div className="md:col-span-3">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              {!editing ? (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-xl font-bold text-gray-900">
                        {receipt.merchant || "(unparsed merchant)"}
                      </h1>
                      <p className="mt-0.5 text-sm text-gray-500">
                        {fmtDate(receipt.purchased_at)} ·{" "}
                        <span className="capitalize">{receipt.category}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={startEdit}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <dl className="mt-5 grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-gray-500">Subtotal</dt>
                      <dd className="tabular-nums text-gray-900">
                        {fmtMoney(receipt.subtotal, receipt.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Tax</dt>
                      <dd className="tabular-nums text-gray-900">
                        {fmtMoney(receipt.tax, receipt.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Total</dt>
                      <dd className="tabular-nums font-semibold text-gray-900">
                        {fmtMoney(receipt.total, receipt.currency)}
                      </dd>
                    </div>
                  </dl>

                  <h2 className="mt-6 mb-2 text-sm font-semibold text-gray-900">
                    Line items
                  </h2>
                  {receipt.line_items && receipt.line_items.length > 0 ? (
                    <ul className="divide-y divide-gray-100 text-sm">
                      {receipt.line_items.map((li) => (
                        <li key={li.id} className="flex justify-between py-2">
                          <span className="text-gray-900">
                            {li.description || "(item)"}
                            {li.quantity !== 1 && (
                              <span className="text-gray-400">
                                {" "}
                                × {li.quantity}
                                {li.unit_price ? ` @ ${li.unit_price.toFixed(2)}` : ""}
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums text-gray-900">
                            {fmtMoney(li.total_price, receipt.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-400">No line items extracted.</p>
                  )}

                  {canRetry && (
                    <button
                      onClick={doRetry}
                      disabled={retrying}
                      className="mt-6 w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                    >
                      {retrying ? "Re-running AI…" : "Retry AI extraction"}
                    </button>
                  )}
                  {retryNotice && (
                    <p className="mt-2 text-sm text-gray-600">{retryNotice}</p>
                  )}
                </>
              ) : (
                /* -------- Edit mode -------- */
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Edit receipt</h1>

                  <label className="mt-4 block text-sm">
                    <span className="mb-1 block font-medium text-gray-700">Merchant</span>
                    <input
                      value={form.merchant}
                      onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </label>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">Date</span>
                      <input
                        type="date"
                        value={form.purchased_at}
                        onChange={(e) =>
                          setForm({ ...form, purchased_at: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">Category</span>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">Subtotal</span>
                      <input
                        inputMode="decimal"
                        value={form.subtotal}
                        onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">Tax</span>
                      <input
                        inputMode="decimal"
                        value={form.tax}
                        onChange={(e) => setForm({ ...form, tax: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-gray-700">Total</span>
                      <input
                        inputMode="decimal"
                        value={form.total}
                        onChange={(e) => setForm({ ...form, total: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>

                  <h2 className="mt-5 mb-2 text-sm font-semibold text-gray-900">
                    Line items
                  </h2>
                  <div className="space-y-2">
                    {items.map((li, idx) => (
                      <div key={li.id ?? `new-${idx}`} className="flex items-center gap-2">
                        <input
                          value={li.description}
                          placeholder="Description"
                          onChange={(e) =>
                            setItems(
                              items.map((x, i) =>
                                i === idx ? { ...x, description: e.target.value } : x
                              )
                            )
                          }
                          className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                        />
                        <input
                          inputMode="decimal"
                          value={String(li.quantity)}
                          title="Qty"
                          onChange={(e) =>
                            setItems(
                              items.map((x, i) =>
                                i === idx ? { ...x, quantity: num(e.target.value) } : x
                              )
                            )
                          }
                          className="w-14 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                        />
                        <input
                          inputMode="decimal"
                          value={String(li.total_price)}
                          title="Total"
                          onChange={(e) =>
                            setItems(
                              items.map((x, i) =>
                                i === idx ? { ...x, total_price: num(e.target.value) } : x
                              )
                            )
                          }
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          aria-label="Remove item"
                          className="rounded px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setItems([
                        ...items,
                        { description: "", quantity: 1, unit_price: 0, total_price: 0 },
                      ])
                    }
                    className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    + Add line item
                  </button>

                  {saveError && (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {saveError}
                    </p>
                  )}
                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h2 className="text-lg font-bold text-gray-900">Delete this receipt?</h2>
            <p className="mt-2 text-sm text-gray-600">
              This removes it from your list. The record is soft-deleted and can be
              recovered within the grace period.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={doDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
