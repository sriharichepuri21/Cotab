"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScanItems, useScanPickers } from "@/components/ScanSheet";
import { Icon } from "@/components/ui";
import {
  CATEGORIES,
  addExpense,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  guessCategory,
  reviewReceipt,
  retryReceipt,
  type UploadResult,
} from "@/lib/api";
import { invalidateSpending } from "@/lib/data";
import { categoryLabel, categoryStyle } from "@/lib/format";
import { routes } from "@/lib/routes";
import { centsText, parseCents, reconcile, unitCents } from "./money";
import { Cat, Ticket, receiptFromApi, scanMoney, tileStyle, type Receipt } from "./parts";
import { Activity } from "./Activity";
import { SplitSheet } from "./Split";
import { Tabs } from "./Tabs";
import { Budgets } from "./Budgets";
import { Insights } from "./Insights";
import { Notifications } from "./Notifications";
import { Profile } from "./Profile";
import { TabbyTab } from "./TabbyTab";
import { Today } from "./Today";
import {
  addFiles,
  clearFinished,
  isFinished,
  remove,
  retry,
  sendAnyway,
  type ScanItem,
} from "@/lib/scanQueue";

type Tab = "today" | "activity" | "circles" | "tabby";
type V2EditItem = {
  id: number;
  backendId?: string;
  name: string;
  quantity: number;
  /** The line's total as typed; checked and turned into cents on save. */
  price: string;
};

/** What was bought: each item line, then tax, tip and fees (or discounts)
 *  as whatever the total adds beyond the items. */
function boughtRows(item: Receipt): Array<[string, string]> {
  const lines = item.lineItems ?? [];
  const rows: Array<[string, string]> = lines.map((line) => [
    `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.item_name || line.description}`,
    scanMoney(line.total_price, item.currency),
  ]);
  const itemsCents = lines.reduce((sum, line) => sum + Math.round(line.total_price * 100), 0);
  const extra = Math.round((item.total ?? 0) * 100) - itemsCents;
  if (lines.length && extra)
    rows.push([
      extra > 0 ? "Tax, tip and fees" : "Discounts",
      scanMoney(Math.abs(extra) / 100, item.currency),
    ]);
  return rows;
}

/** The edit form, from the receipt as last saved. */
function editState(item: Receipt) {
  return {
    items: (item.lineItems ?? []).map(
      (line, index): V2EditItem => ({
        id: index + 1,
        backendId: line.id,
        name: line.description,
        quantity: line.quantity || 1,
        price: centsText(Math.round((line.total_price || 0) * 100)),
      })
    ),
    merchant: item.merchant,
    purchaseDate: item.purchasedAt ? item.purchasedAt.slice(0, 10) : "",
    category: item.category || "other",
    currency: item.currency || "USD",
    subtotal: centsText(Math.round((item.subtotal ?? 0) * 100)),
    tax: centsText(Math.round((item.tax ?? 0) * 100)),
    total: centsText(Math.round((item.total ?? 0) * 100)),
  };
}

function ReceiptDetail({
  item,
  close,
  onChange,
}: {
  item: Receipt;
  close: () => void;
  /** The receipt as the server now has it, after a save or a second read. */
  onChange: (receipt: Receipt) => void;
}) {
  const [mode, setMode] = useState<"edit" | "split" | "scan" | null>(null);
  const [form, setForm] = useState(() => editState(item));
  const editItems = form.items;
  const setEditItems = (next: (current: V2EditItem[]) => V2EditItem[]) =>
    setForm((current) => ({ ...current, items: next(current.items) }));
  const { merchant, purchaseDate, category, currency, subtotal, tax, total } = form;
  const setField =
    (field: "merchant" | "purchaseDate" | "category" | "currency") => (value: string) =>
      setForm((current) => ({ ...current, [field]: value }));
  const [setMerchant, setPurchaseDate, setCategory, setCurrency] = (
    ["merchant", "purchaseDate", "category", "currency"] as const
  ).map(setField);
  const setMoney = (field: "subtotal" | "tax" | "total") => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const startEdit = () => {
    setForm(editState(item));
    setReceiptMessage(null);
    setMode("edit");
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(editState(item));
  const closeEdit = () => {
    if (dirty && !window.confirm("Discard your changes to this receipt?")) return;
    setMode(null);
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const lineCents = editItems.map((line) => parseCents(line.price));
  const subtotalCents = parseCents(subtotal);
  const taxCents = parseCents(tax);
  const totalCents = parseCents(total);
  const moneyOk =
    lineCents.every((c) => c !== null) &&
    subtotalCents !== null &&
    taxCents !== null &&
    totalCents !== null;
  const itemsCents = lineCents.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const itemsTotal = itemsCents / 100;
  const money = (cents: number) => scanMoney(cents / 100, currency);
  const check = moneyOk
    ? reconcile(itemsCents, subtotalCents, taxCents, totalCents, money)
    : { ok: false, message: "Some amounts aren’t numbers. Fix the highlighted fields." };
  const namesOk = merchant.trim().length > 0 && editItems.every((line) => line.name.trim());
  const updateEditItem = (id: number, patch: Partial<(typeof editItems)[number]>) =>
    setEditItems((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );

  useEffect(() => {
    if (!item.id) return;
    getReceiptImage(item.id)
      .then((image) => setImageUrl(image.url))
      .catch(() => setImageUrl(null));
  }, [item.id]);

  const saveReceipt = async () => {
    if (!item.id) {
      setMode(null);
      return;
    }
    if (!moneyOk || !namesOk) return;
    setSavingReceipt(true);
    setReceiptMessage(null);
    try {
      const updated = await reviewReceipt(item.id, {
        merchant: merchant.trim(),
        purchased_at: purchaseDate || null,
        category,
        currency,
        subtotal: (subtotalCents as number) / 100,
        tax: (taxCents as number) / 100,
        total: (totalCents as number) / 100,
        line_items: editItems.map((line, index) => {
          const cents = lineCents[index] as number;
          return {
            id: line.backendId,
            description: line.name.trim(),
            quantity: line.quantity,
            unit_price: unitCents(cents, line.quantity) / 100,
            total_price: cents / 100,
          };
        }),
      });
      onChange(receiptFromApi(updated as UploadResult));
      invalidateSpending();
      setReceiptMessage("Receipt changes saved.");
      setMode(null);
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t save this receipt.");
    } finally {
      setSavingReceipt(false);
    }
  };
  const retryScan = async () => {
    if (!item.id) return;
    setReceiptMessage("Tabby is reading the receipt again…");
    try {
      const updated = await retryReceipt(item.id);
      onChange(receiptFromApi(updated as UploadResult));
      invalidateSpending();
      setReceiptMessage(
        updated.status === "extracted"
          ? "Read it this time. Check the items below."
          : updated.error_message
            ? `Still couldn’t read it: ${updated.error_message}`
            : "Still couldn’t read it. You can type it in with Edit receipt."
      );
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t retry this receipt.");
    }
  };
  const deleteSavedReceipt = async () => {
    if (!item.id) return;
    try {
      await deleteReceipt(item.id);
      invalidateSpending();
      close();
    } catch (error) {
      setConfirmingDelete(false);
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t delete this receipt.");
    }
  };
  return (
    <>
      <main className="receipt-detail min-h-screen bg-[#eee8dc] px-5 pb-10 pt-5">
        <button onClick={close} className="flex min-h-11 items-center gap-1 text-[13px] font-bold">
          <Icon name="arrow_back" size={19} />
          Activity
        </button>
        <Ticket className="mt-3 rounded-t-[22px] px-5 pb-8 pt-6">
          <div className="text-center">
            <span
              className={`demo-${item.tone} mx-auto grid h-14 w-14 place-items-center rounded-[17px]`}
            >
              <Icon name={item.icon} size={25} />
            </span>
            <h1 className="mt-4 text-[24px] font-semibold tracking-[-.04em]">{item.merchant}</h1>
            <p className="mt-1 text-[12px] text-[#77776f]">{item.date}</p>
            <p className="mt-5 text-[44px] font-semibold tracking-[-.055em]">{item.amount}</p>
          </div>
          <div className="my-6 border-t border-dashed border-black/20" />
          <div className="space-y-3 text-[13px]">
            <div className="flex justify-between">
              <span>Receipt total</span>
              <b>{item.amount}</b>
            </div>
            <div className="flex justify-between">
              <span>Your share</span>
              <b>{item.mine.split(" ")[0]}</b>
            </div>
            {typeof item.confidence === "number" && (
              <div className="flex justify-between text-[#77776f]">
                <span>Read by Tabby</span>
                <span>{Math.round(item.confidence * 100)}% confidence</span>
              </div>
            )}
          </div>
          <div className="my-6 border-t border-dashed border-black/20" />
          <h2 className="text-[15px] font-bold">What was bought</h2>
          {boughtRows(item).map(([n, a], index) => (
            <div
              key={`${n}-${index}`}
              className="flex justify-between gap-3 border-b border-black/[0.06] py-3 text-[13px]"
            >
              <span className="min-w-0">{n}</span>
              <b className="shrink-0">{a}</b>
            </div>
          ))}
          {!item.lineItems?.length && (
            <p className="py-3 text-[12px] text-[#77776f]">
              No item lines. Add them with Edit receipt.
            </p>
          )}
          {imageUrl && (
            <button
              onClick={() => setMode("scan")}
              className="mt-5 flex w-full items-center gap-3 rounded-[16px] border border-black/[0.08] bg-black/[0.025] p-3 text-left"
            >
              <span className="relative grid h-[74px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[#f7f0df] text-[#554b3e] shadow-sm">
                <span className="absolute inset-x-2 top-2 h-1 rounded-full bg-black/15" />
                <span className="absolute inset-x-2 top-5 h-px bg-black/10" />
                <span className="absolute inset-x-2 top-8 h-px bg-black/10" />
                <span className="absolute inset-x-2 top-11 h-px bg-black/10" />
                <Icon name="receipt_long" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13px]">Original receipt</b>
                <span className="mt-1 block text-[11px] leading-relaxed text-[#77776f]">
                  Uploaded photo · Tap to inspect the scan
                </span>
              </span>
              <Icon name="open_in_full" size={17} className="text-[#77776f]" />
            </button>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={startEdit}
              className="rounded-full border border-black/15 py-3 text-[13px] font-bold"
            >
              Edit receipt
            </button>
            <button
              onClick={() => setMode("split")}
              className="rounded-full bg-[#103e33] py-3 text-[13px] font-bold text-white"
            >
              {item.splitTab ? "Change split" : "Split this"}
            </button>
          </div>
          {item.id && (
            <div className="mt-3 flex justify-center gap-5 text-[11px] font-bold">
              {item.status === "failed" && (
                <button
                  onClick={retryScan}
                  className="min-h-11 text-[#103e33] underline underline-offset-4"
                >
                  Read it again
                </button>
              )}
              {!confirmingDelete && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="min-h-11 text-[#a74132] underline underline-offset-4"
                >
                  Delete receipt
                </button>
              )}
            </div>
          )}
          {confirmingDelete && (
            <div
              role="alertdialog"
              aria-label="Delete this receipt?"
              className="receipt-delete-confirm mt-3 rounded-[16px] bg-[#fde7e7] p-4 text-[12px] text-[#7a2b20]"
            >
              <b className="block text-[13px]">Delete this receipt?</b>
              It comes off your spending and off any tab it was split on.
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="min-h-11 rounded-full bg-white/70 font-bold text-[#22231f]"
                >
                  Keep it
                </button>
                <button
                  onClick={deleteSavedReceipt}
                  className="min-h-11 rounded-full bg-[#a74132] font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {receiptMessage && (
            <p role="status" className="mt-3 text-center text-[11px] font-semibold text-[#77776f]">
              {receiptMessage}
            </p>
          )}
        </Ticket>
      </main>
      {mode === "scan" && (
        <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col bg-black/90 px-5 pb-8 pt-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <b className="block text-[15px]">Original receipt</b>
              <span className="text-[11px] text-white/55">{item.date}</span>
            </div>
            <button
              onClick={() => setMode(null)}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
              aria-label="Close receipt photo"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="my-8 flex min-h-0 flex-1 items-center justify-center">
            {imageUrl && (
              <img
                src={imageUrl}
                alt={`Original receipt from ${item.merchant}`}
                className="max-h-full max-w-full rounded-[10px] object-contain shadow-2xl"
              />
            )}
          </div>
        </div>
      )}
      {(mode === "edit" || mode === "split") && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[430px] bg-black/45">
          <section className="ios-surface full-sheet flex h-full w-full flex-col overflow-hidden sm:rounded-[30px]">
            <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 pb-4 pt-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                  {mode === "edit" ? "Correct what Tabby read" : "Create or update a tab"}
                </p>
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">
                  {mode === "edit"
                    ? "Edit receipt"
                    : `${item.splitTab ? "Change split of" : "Split"} ${item.amount}`}
                </h2>
              </div>
              <button
                onClick={mode === "edit" ? closeEdit : () => setMode(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
                aria-label={`Close ${mode} receipt`}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            {mode === "edit" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-5">
                <section className="grid grid-cols-2 gap-3">
                  <label className="col-span-2 block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Store
                    </span>
                    <input
                      value={merchant}
                      onChange={(event) => setMerchant(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-4 py-3 text-[14px] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Date
                    </span>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(event) => setPurchaseDate(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Category
                    </span>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    >
                      {CATEGORIES.map((id) => (
                        <option key={id} value={id}>
                          {categoryLabel(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Currency
                    </span>
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    >
                      {Array.from(new Set([currency, "USD", "CAD", "GBP", "EUR", "AUD"])).map(
                        (code) => (
                          <option key={code}>{code}</option>
                        )
                      )}
                    </select>
                  </label>
                </section>
                <section className="mt-6">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                        Line items
                      </p>
                      <h3 className="mt-1 text-[19px] font-semibold">{editItems.length} items</h3>
                    </div>
                    <span className="text-[12px] font-semibold text-[#77776f]">
                      {scanMoney(itemsTotal, currency)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {editItems.map((line, index) => {
                      const duplicate = editItems.some(
                        (other, otherIndex) =>
                          otherIndex < index &&
                          other.name.trim().toLowerCase() === line.name.trim().toLowerCase()
                      );
                      return (
                        <div
                          key={line.id}
                          className={`rounded-[18px] border p-3 ${duplicate ? "border-[#f0a08f]/60 bg-[#f7e9e3]" : "border-black/[0.08] bg-black/[0.025]"}`}
                        >
                          {duplicate && (
                            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#a74132]">
                              <Icon name="content_copy" size={14} />
                              Possible duplicate
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              aria-label={`Item ${index + 1} name`}
                              value={line.name}
                              onChange={(event) =>
                                updateEditItem(line.id, { name: event.target.value })
                              }
                              className="min-w-0 flex-1 rounded-[12px] border border-black/10 bg-transparent px-3 py-2.5 text-[14px] font-semibold outline-none"
                            />
                            <button
                              onClick={() =>
                                setEditItems((current) =>
                                  current.filter((entry) => entry.id !== line.id)
                                )
                              }
                              aria-label={`Delete ${line.name}`}
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#c84c3d]"
                            >
                              <Icon name="delete" size={19} />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#77776f]">Qty</span>
                            <button
                              onClick={() =>
                                updateEditItem(line.id, {
                                  quantity: Math.max(1, line.quantity - 1),
                                })
                              }
                              aria-label={`Fewer ${line.name || "of this item"}`}
                              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.06]"
                            >
                              <Icon name="remove" size={16} />
                            </button>
                            <b className="w-5 text-center text-[13px]">{line.quantity}</b>
                            <button
                              onClick={() =>
                                updateEditItem(line.id, { quantity: line.quantity + 1 })
                              }
                              aria-label={`More ${line.name || "of this item"}`}
                              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.06]"
                            >
                              <Icon name="add" size={16} />
                            </button>
                            <span className="flex-1" />
                            <label
                              className={`flex items-center rounded-[12px] border px-3 ${lineCents[index] === null ? "border-[#c84c3d]" : "border-black/10"}`}
                            >
                              <span className="text-[12px] text-[#77776f]">$</span>
                              <input
                                aria-label={`Item ${index + 1} price`}
                                aria-invalid={lineCents[index] === null}
                                inputMode="decimal"
                                value={line.price}
                                onChange={(event) =>
                                  updateEditItem(line.id, { price: event.target.value })
                                }
                                className="h-10 w-16 bg-transparent text-right text-[14px] font-bold outline-none"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() =>
                      setEditItems((current) => [
                        ...current,
                        { id: Date.now(), name: "", quantity: 1, price: "" },
                      ])
                    }
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-black/20 py-3 text-[12px] font-bold"
                  >
                    <Icon name="add" size={18} />
                    Add an item
                  </button>
                </section>
                <section className="mt-6 rounded-[18px] bg-black/[0.04] p-4">
                  <h3 className="text-[14px] font-bold">Money check</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["Subtotal", subtotal, subtotalCents, setMoney("subtotal")],
                        ["Tax + tip", tax, taxCents, setMoney("tax")],
                        ["Total", total, totalCents, setMoney("total")],
                      ] as Array<[string, string, number | null, (value: string) => void]>
                    ).map(([label, value, cents, setter]) => (
                      <label key={label}>
                        <span className="block text-[10px] font-semibold text-[#77776f]">
                          {label}
                        </span>
                        <span
                          className={`mt-1 flex items-center rounded-[11px] border px-2 ${cents === null ? "border-[#c84c3d]" : "border-black/10"}`}
                        >
                          <span className="text-[11px] text-[#77776f]">$</span>
                          <input
                            aria-label={label}
                            aria-invalid={cents === null}
                            inputMode="decimal"
                            value={value}
                            onChange={(event) => setter(event.target.value)}
                            className="h-10 min-w-0 w-full bg-transparent text-right text-[13px] font-bold outline-none"
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                  <p
                    role="status"
                    className={`mt-3 flex items-center gap-1.5 text-[11px] font-semibold ${check.ok ? "text-[#50713a]" : "text-[#a74132]"}`}
                  >
                    <Icon name={check.ok ? "check_circle" : "error"} size={16} fill />
                    {check.message}
                  </p>
                  {!check.ok && moneyOk && (
                    <p className="mt-1 text-[10px] text-[#77776f]">
                      You can still save; the total you enter is what counts.
                    </p>
                  )}
                </section>
                <div className="sheet-footer fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] px-5 pb-5 pt-4">
                  {!namesOk && (
                    <p className="mb-2 text-center text-[11px] font-semibold text-[#f0b5a9]">
                      Give the store and every item a name.
                    </p>
                  )}
                  <button
                    onClick={saveReceipt}
                    disabled={savingReceipt || !moneyOk || !namesOk}
                    className="w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    {savingReceipt ? "Saving…" : "Save receipt changes"}
                  </button>
                </div>
              </div>
            ) : (
              <SplitSheet
                receipt={item}
                close={() => setMode(null)}
                onSaved={(message) => {
                  setMode(null);
                  setReceiptMessage(message);
                }}
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`nav-item flex min-h-12 flex-col items-center justify-end gap-0.5 text-[10px] font-bold ${active ? "text-[#103e33]" : "text-[#92928b]"}`}
    >
      <span className="nav-orb">
        <Icon name={icon} size={21} fill={active} />
      </span>
      <span>{label}</span>
    </button>
  );
}
function BottomNav({
  tab,
  setTab,
  scan,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  scan: () => void;
}) {
  const items: [Tab, string, string][] = [
    ["today", "Today", "home"],
    ["activity", "Activity", "receipt_long"],
    ["circles", "Tabs", "group"],
    ["tabby", "Tabby", "pets"],
  ];
  return (
    <>
      <div aria-hidden="true" className="nav-scrim" />
      <nav
        aria-label="Main"
        className="ios-glass-nav fixed inset-x-3 bottom-3 z-30 mx-auto max-w-[404px] rounded-[28px] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2"
      >
        <div className="grid grid-cols-5 items-end">
          {items.slice(0, 2).map(([id, l, i]) => (
            <NavButton key={id} active={tab === id} label={l} icon={i} onClick={() => setTab(id)} />
          ))}
          <button onClick={scan} aria-label="Scan a receipt" className="-mt-7 flex justify-center">
            <span className="nav-scan grid h-[58px] w-[58px] place-items-center rounded-full border-[5px] border-[#f4f1eb] bg-[#103e33] text-[#d7f45b] shadow-md">
              <Icon name="document_scanner" size={25} />
            </span>
          </button>
          {items.slice(2).map(([id, l, i]) => (
            <NavButton key={id} active={tab === id} label={l} icon={i} onClick={() => setTab(id)} />
          ))}
        </div>
      </nav>
    </>
  );
}

function scanStatus(item: ScanItem) {
  if (item.status === "checking") return "Checking light, framing and clarity";
  if (item.status === "needs_ok") return item.title || "This photo needs a look";
  if (item.status === "waiting") return "Waiting to upload";
  if (item.status === "reading") return item.uploaded ? "Reading every line" : "Uploading securely";
  if (item.status === "added") return "Added to Activity";
  if (item.status === "duplicate") return "Already on your tab";
  return item.message || "This receipt needs attention";
}

function Scanner({
  close,
  review,
  openReceipt,
  goActivity,
}: {
  close: () => void;
  review: (receipt: Receipt) => void;
  openReceipt: (id: string) => void;
  goActivity: () => void;
}) {
  const scanItems = useScanItems();
  const [stage, setStage] = useState<
    | "start"
    | "camera"
    | "review"
    | "batch"
    | "reading"
    | "done"
    | "manual"
    | "manualDone"
    | "manualSplit"
    | "manualSplitDone"
  >("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"starting" | "live" | "blocked">("starting");
  const [cameraMessage, setCameraMessage] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualCategory, setManualCategory] = useState("other");
  const [manualCategoryPicked, setManualCategoryPicked] = useState(false);
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualPicker, setManualPicker] = useState<"category" | null>(null);
  const [manualSaved, setManualSaved] = useState<Receipt | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualSplitMessage, setManualSplitMessage] = useState("");
  const [readingStep, setReadingStep] = useState(0);
  const [showItems, setShowItems] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [manualItems, setManualItems] = useState([
    { name: "", price: "" },
    { name: "", price: "" },
  ]);
  const manualItemsTotal = manualItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const manualTotal =
    showItems && manualItemsTotal > 0 ? manualItemsTotal : (Number(manualAmount) || 0) / 100;
  const manualValid = manualName.trim().length > 0 && manualTotal > 0;

  useEffect(() => {
    if (manualCategoryPicked || !manualName.trim()) return;
    let live = true;
    const timer = window.setTimeout(() => {
      guessCategory(manualName.trim())
        .then(({ category }) => live && setManualCategory(category))
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [manualCategoryPicked, manualName]);

  async function saveManualExpense() {
    if (!manualValid || manualBusy) return;
    const items = showItems
      ? manualItems
          .filter((item) => item.name.trim() && item.price.trim())
          .map((item) => ({ description: item.name.trim(), total_price: Number(item.price) }))
      : [];
    if (
      showItems &&
      manualItems.some((item) => Boolean(item.name.trim()) !== Boolean(item.price.trim()))
    ) {
      setManualError("Give every item both a name and a price.");
      return;
    }
    setManualBusy(true);
    setManualError("");
    try {
      const saved = await addExpense({
        description: manualName.trim(),
        amount: items.length ? undefined : manualTotal,
        date: manualDate,
        category: manualCategory,
        items,
      });
      const receipt = receiptFromApi(saved);
      setManualSaved(receipt);
      invalidateSpending();
      setStage("manualDone");
    } catch (error) {
      setManualError((error as Error).message);
    } finally {
      setManualBusy(false);
    }
  }

  const onPicked = useCallback(
    (files: File[]) => {
      const result = addFiles(files);
      if (!result.added) {
        setScanMessage(
          result.unsupported
            ? "Cotab can read receipt photos, HEIC images and PDFs."
            : "The current batch is full. Finish or clear it before adding more."
        );
        return;
      }
      setScanMessage(
        result.tooMany
          ? `${result.tooMany} file${result.tooMany === 1 ? " was" : "s were"} left out. Add them in the next batch.`
          : result.unsupported
            ? `${result.unsupported} unsupported file${result.unsupported === 1 ? " was" : "s were"} left out.`
            : null
      );
      setStage(result.added > 1 || scanItems.length > 0 ? "batch" : "reading");
    },
    [scanItems.length]
  );
  const scanPickers = useScanPickers(onPicked);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (stage !== "camera") {
      stopCamera();
      return;
    }
    let live = true;
    setCameraState("starting");
    setCameraMessage("");
    const openCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("blocked");
        setCameraMessage(
          "This browser cannot show the camera here. You can still use the phone camera."
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!live) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("live");
      } catch {
        if (!live) return;
        setCameraState("blocked");
        setCameraMessage(
          "Camera access is off. Allow it for Cotab, or use the phone camera instead."
        );
      }
    };
    void openCamera();
    return () => {
      live = false;
      stopCamera();
    };
  }, [stage, stopCamera]);

  const captureReceipt = useCallback(() => {
    const video = videoRef.current;
    if (!video || cameraState !== "live" || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraMessage("Cotab couldn't capture that frame. Please try once more.");
          return;
        }
        stopCamera();
        onPicked([
          new File([blob], `receipt-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, {
            type: "image/jpeg",
          }),
        ]);
      },
      "image/jpeg",
      0.92
    );
  }, [cameraState, onPicked, stopCamera]);

  const activeScans = scanItems.filter((item) => !isFinished(item.status));
  const needsDecision = scanItems.some((item) => item.status === "needs_ok");
  const completedScans = scanItems.filter((item) => item.status === "added");
  const duplicateScans = scanItems.filter((item) => item.status === "duplicate");
  // Real budget news from the upload: the first budget it pushed past a line.
  const budgetAlert = completedScans.flatMap((item) => item.result?.budget_alerts ?? [])[0];
  const matchedTap = completedScans.some((item) => item.result?.matched_tap);
  const failedScans = scanItems.filter(
    (item) => item.status === "error" || item.status === "refused"
  );
  const needsSignIn = failedScans.some((item) => item.title === "Sign in to scan");

  useEffect(() => {
    if (!scanItems.length || stage === "start" || stage === "camera") return;
    if (needsDecision) {
      setStage("batch");
      return;
    }
    if (activeScans.length) {
      setStage("reading");
      return;
    }
    setStage("done");
  }, [activeScans.length, needsDecision, scanItems.length, stage]);

  useEffect(() => {
    if (stage !== "reading") return;
    setReadingStep(0);
    const timers = [
      window.setTimeout(() => setReadingStep(1), 900),
      window.setTimeout(() => setReadingStep(2), 2100),
      window.setTimeout(() => setReadingStep(3), 3200),
    ];
    if (!scanItems.length) timers.push(window.setTimeout(() => setStage("done"), 4200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [scanItems.length, stage]);

  const reset = () => {
    clearFinished();
    setManualName("");
    setManualAmount("");
    setManualCategory("other");
    setManualCategoryPicked(false);
    setManualDate(new Date().toISOString().slice(0, 10));
    setManualSaved(null);
    setManualError("");
    setManualSplitMessage("");
    setShowItems(false);
    setManualItems([
      { name: "", price: "" },
      { name: "", price: "" },
    ]);
    setStage("camera");
  };

  if (stage === "camera") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receipt camera"
        className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col overflow-hidden bg-[#090d0b] text-white"
      >
        {scanPickers.inputs}
        <div className="flex items-center justify-between px-5 pb-3 pt-[max(18px,env(safe-area-inset-top))]">
          <button
            onClick={close}
            aria-label="Close camera"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10"
          >
            <Icon name="close" size={21} />
          </button>
          <span className="text-[13px] font-semibold">Receipt camera</span>
          <button
            onClick={() => setStage("start")}
            aria-label="More scan options"
            className="grid h-11 min-w-11 place-items-center rounded-full bg-white/10 px-3"
          >
            <Icon name="more_horiz" size={21} />
          </button>
        </div>
        <div className="receipt-camera-viewport relative mx-4 flex-1 overflow-hidden rounded-[28px] bg-[#18201c]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live receipt camera preview"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${cameraState === "live" ? "opacity-100" : "opacity-0"}`}
          />
          <div className="absolute inset-x-1/3 inset-y-0 border-x border-white/5" />
          <div className="absolute inset-x-0 inset-y-1/3 border-y border-white/5" />
          {cameraState !== "live" && (
            <div className="absolute inset-0 grid place-items-center px-10 text-center text-[13px] text-white/70">
              <span>
                <span className="camera-pulse mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/10">
                  <Icon
                    name={cameraState === "blocked" ? "no_photography" : "photo_camera"}
                    size={30}
                  />
                </span>
                <b className="mt-4 block text-[14px] text-white">
                  {cameraState === "blocked" ? "Camera needs permission" : "Opening camera…"}
                </b>
                {cameraMessage && (
                  <span className="mt-2 block leading-relaxed">{cameraMessage}</span>
                )}
              </span>
            </div>
          )}
          <span className="absolute left-5 top-5 h-12 w-12 rounded-tl-[18px] border-l-2 border-t-2 border-[#d7f45b]" />
          <span className="absolute right-5 top-5 h-12 w-12 rounded-tr-[18px] border-r-2 border-t-2 border-[#d7f45b]" />
          <span className="absolute bottom-5 left-5 h-12 w-12 rounded-bl-[18px] border-b-2 border-l-2 border-[#d7f45b]" />
          <span className="absolute bottom-5 right-5 h-12 w-12 rounded-br-[18px] border-b-2 border-r-2 border-[#d7f45b]" />
        </div>
        <p className="px-6 py-4 text-center text-[12px] text-white/70">
          Keep the whole receipt inside the corners
        </p>
        <div className="flex items-center justify-around pb-[max(28px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => scanPickers.open("photos")}
            className="min-h-11 px-3 text-[12px] font-semibold"
          >
            Photos
          </button>
          <button
            onClick={cameraState === "live" ? captureReceipt : () => scanPickers.open("camera")}
            aria-label="Take photo"
            className="camera-shutter grid h-[76px] w-[76px] place-items-center rounded-full border-[4px] border-white disabled:opacity-50"
          >
            <span className="h-[62px] w-[62px] rounded-full bg-white active:scale-95" />
          </button>
          <button
            onClick={() => setStage("start")}
            className="min-h-11 px-3 text-[12px] font-semibold"
          >
            More
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-title"
      className="fixed inset-0 z-50 grid place-items-end bg-black/45"
    >
      {scanPickers.inputs}
      <div className="ios-surface scan-sheet mx-auto max-h-[96vh] w-full max-w-[430px] overflow-y-auto rounded-t-[30px] px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-black/15" />
        <div className="flex items-center justify-between">
          <div>
            <h2 id="scanner-title" className="text-[26px] font-semibold tracking-[-.045em]">
              {stage === "start" && "Add a receipt"}
              {stage === "review" && "Check the photo"}
              {stage === "batch" &&
                `${scanItems.length} receipt${scanItems.length === 1 ? "" : "s"} ready`}
              {stage === "reading" &&
                `Tabby is reading${scanItems.length > 1 ? ` ${scanItems.length} receipts` : ""}`}
              {stage === "done" &&
                (completedScans.length
                  ? `${completedScans.length} added to your tab`
                  : duplicateScans.length && !failedScans.length
                    ? "Already on your tab"
                    : needsSignIn
                      ? "Sign in to finish scanning"
                      : "These receipts need attention")}
              {stage === "manual" && "Add an expense"}
              {stage === "manualDone" && "Expense added"}
              {stage === "manualSplit" && "Split this expense"}
              {stage === "manualSplitDone" && "Split created"}
            </h2>
            <p className="mt-1 text-[12px] text-[#77776f]">
              {stage === "start" && "Photos stay private and can be corrected before saving."}
              {stage === "review" && "Clear, bright and fully inside the frame."}
              {stage === "batch" && "Up to 20 photos or PDFs in one batch."}
              {stage === "reading" && "You can close this—reading continues in the background."}
              {stage === "done" &&
                (completedScans.length
                  ? "Items, tax and totals are ready to review."
                  : duplicateScans.length && !failedScans.length
                    ? "Nothing new was added."
                    : needsSignIn
                      ? "Your session ended before anything was uploaded."
                      : "Nothing was added. Review the messages below.")}
              {stage === "manual" && "Cash, a bill, or anything without a receipt."}
              {stage === "manualDone" && "Saved to Activity and included in your budgets."}
              {stage === "manualSplit" && "Choose the Tab, people and how the amount is shared."}
              {stage === "manualSplitDone" && "Everyone’s share is ready in the Tab."}
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close scanner"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.05]"
          >
            <Icon name="close" />
          </button>
        </div>

        {stage === "start" && (
          <>
            <button
              onClick={() => setStage("camera")}
              className="scan-take-card mt-6 flex w-full items-center rounded-[24px] bg-[#103e33] p-5 text-left text-white active:scale-[.985]"
            >
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#d7f45b] text-[#103e33]">
                <Icon name="photo_camera" size={29} />
              </span>
              <span className="ml-4 flex-1">
                <b className="block text-[18px] tracking-[-.02em]">Take a photo</b>
                <span className="mt-1 block text-[12px] text-white/65">
                  Best for a paper receipt in front of you
                </span>
              </span>
              <Icon name="chevron_right" />
            </button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                onClick={() => scanPickers.open("photos")}
                className="min-h-[104px] rounded-[20px] bg-[#dff0ff] p-4 text-left active:scale-[.985]"
              >
                <Icon name="photo_library" size={23} />
                <b className="mt-4 block text-[14px]">Choose photos</b>
                <span className="text-[11px] text-[#45667b]">Select several at once</span>
              </button>
              <button
                onClick={() => scanPickers.open("files")}
                className="scan-file-card min-h-[104px] rounded-[20px] bg-[#f4e9dc] p-4 text-left active:scale-[.985]"
              >
                <Icon name="upload_file" size={23} />
                <b className="mt-4 block text-[14px]">Browse files</b>
                <span className="text-[11px] text-[#76604e]">PDF, HEIC or image</span>
              </button>
            </div>
            <button
              onClick={() => setStage("manual")}
              className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-[18px] bg-black/[0.035] px-4 text-left"
            >
              <Icon name="edit_note" size={22} />
              <span className="flex-1">
                <b className="block text-[13px]">Add without a receipt</b>
                <span className="text-[11px] text-[#77776f]">
                  Enter a cash purchase or bill by hand
                </span>
              </span>
              <Icon name="chevron_right" size={18} />
            </button>
            <div className="scan-privacy-note mt-5 flex items-start gap-3 rounded-[16px] px-2 py-2">
              <Cat mood="cool" size={43} />
              <p className="pt-1 text-[11px] leading-relaxed text-[#77776f]">
                <b className="text-[12px] text-[#22231f]">Tabby checks before uploading.</b>
                <br />
                Blurry, dark or tiny photos stay on your phone until you choose to use them.
              </p>
            </div>
            {scanMessage && (
              <p
                role="status"
                className="mt-3 rounded-[14px] bg-[#fff0d9] px-3 py-2.5 text-[11px] font-semibold text-[#725024]"
              >
                {scanMessage}
              </p>
            )}
          </>
        )}

        {stage === "review" && (
          <>
            <div className="relative mx-auto mt-5 h-[280px] w-[202px] overflow-hidden rounded-[12px] bg-[#fff9ea] px-5 py-6 text-[#38352f] shadow-lg">
              <div className="text-center text-[10px] font-bold tracking-[.16em]">NORTH MARKET</div>
              {["Organic milk", "Sourdough", "Avocados", "Coffee beans", "Dish soap"].map(
                (line, i) => (
                  <div key={line} className="mt-6 flex justify-between text-[8px]">
                    <span>{line}</span>
                    <span>{["5.49", "6.25", "4.98", "14.50", "7.99"][i]}</span>
                  </div>
                )
              )}
              <div className="mt-6 flex justify-between border-t border-dashed border-black/20 pt-3 text-[11px] font-bold">
                <span>TOTAL</span>
                <span>$42.68</span>
              </div>
              <div className="absolute inset-x-0 top-[42%] h-px bg-[#49bfa7] shadow-[0_0_12px_2px_rgb(73_191_167/.55)]" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-semibold">
              {[
                ["check_circle", "Sharp"],
                ["light_mode", "Bright"],
                ["crop_free", "Full receipt"],
              ].map(([icon, label]) => (
                <div
                  key={label}
                  className="scan-quality-chip rounded-[13px] bg-[#e6f5df] px-2 py-3 text-[#285c3c]"
                >
                  <Icon name={icon} size={17} />
                  <span className="mt-1 block">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-[1fr_1.45fr] gap-3">
              <button
                onClick={() => setStage("camera")}
                className="min-h-12 rounded-full bg-black/[0.05] text-[13px] font-bold"
              >
                Retake
              </button>
              <button
                onClick={() => setStage("reading")}
                className="min-h-12 rounded-full bg-[#103e33] text-[13px] font-bold text-white"
              >
                Read receipt
              </button>
            </div>
          </>
        )}

        {stage === "batch" && (
          <>
            <div className="mt-5 space-y-2">
              {scanItems.map((item) => (
                <div
                  key={item.id}
                  className={`scan-batch-row flex items-center gap-3 rounded-[17px] p-3 ${item.status === "needs_ok" ? "scan-batch-review bg-[#fff0d9]" : "bg-black/[0.035]"}`}
                >
                  <span className="scan-batch-thumb grid h-14 w-11 shrink-0 place-items-center rounded-[8px] bg-[#fff9ea] text-[10px] font-bold">
                    {item.preview ? (
                      <img
                        src={item.preview}
                        alt=""
                        className="h-full w-full rounded-[8px] object-cover"
                      />
                    ) : (
                      "PDF"
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px]">{item.name}</b>
                    <span className="text-[11px] text-[#77776f]">{scanStatus(item)}</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold ${item.status === "needs_ok" ? "text-[#9a5a13]" : "text-[#34704c]"}`}
                  >
                    {item.status === "needs_ok" ? "Review" : "Ready"}
                  </span>
                  <button
                    onClick={() => remove(item.id)}
                    aria-label={`Remove ${item.name}`}
                    className="grid h-9 w-9 place-items-center rounded-full"
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              ))}
            </div>
            {needsDecision && (
              <div className="scan-batch-warning mt-4 rounded-[15px] bg-[#fff0d9] p-3 text-[11px] leading-relaxed text-[#725024]">
                <b>One or more photos need a look.</b> You can use them anyway, remove them, or
                choose clearer photos.
              </div>
            )}
            <button
              onClick={() => {
                scanItems
                  .filter((item) => item.status === "needs_ok")
                  .forEach((item) => sendAnyway(item.id));
                setStage("reading");
              }}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
            >
              {needsDecision ? "Use selected photos and read" : "Continue reading"}
            </button>
            <button
              onClick={() => scanPickers.open("photos")}
              className="mt-2 min-h-11 w-full text-[12px] font-semibold text-[#77776f]"
            >
              Add more photos
            </button>
          </>
        )}

        {stage === "reading" && (
          <div className="py-7 text-center">
            <div className="scan-motion mx-auto" aria-hidden="true">
              <div className="scan-receipt">
                <div className="mx-auto h-2 w-16 rounded-full bg-black/15" />
                <div className="mt-5 flex justify-between">
                  <span className="h-1.5 w-20 rounded-full bg-black/12" />
                  <span className="h-1.5 w-7 rounded-full bg-black/15" />
                </div>
                <div className="mt-4 flex justify-between">
                  <span className="h-1.5 w-24 rounded-full bg-black/10" />
                  <span className="h-1.5 w-8 rounded-full bg-black/15" />
                </div>
                <div className="mt-4 flex justify-between">
                  <span className="h-1.5 w-16 rounded-full bg-black/10" />
                  <span className="h-1.5 w-7 rounded-full bg-black/15" />
                </div>
                <div className="mt-6 flex justify-between border-t border-dashed border-black/20 pt-4">
                  <span className="h-2 w-12 rounded-full bg-black/20" />
                  <span className="h-2 w-10 rounded-full bg-black/25" />
                </div>
                <div className="scan-beam" />
              </div>
              <div className="scan-data-chip scan-data-chip-one">
                <Icon name="storefront" size={15} /> Merchant
              </div>
              <div className="scan-data-chip scan-data-chip-two">
                <Icon name="list_alt" size={15} /> Items
              </div>
              <div className="scan-data-chip scan-data-chip-three">
                <Icon name="calculate" size={15} /> Total
              </div>
              <div className="scan-orbit">
                <Cat mood={readingStep < 2 ? "working" : "cool"} size={52} />
              </div>
              <div className="scan-tabby-thought">
                {
                  [
                    "Got the photo—keeping it secure.",
                    "Looking for the store and the date.",
                    "Reading each item, then tax and tip.",
                    "Checking it isn’t already on your tab.",
                  ][readingStep]
                }
              </div>
            </div>
            <p aria-live="polite" className="mt-14 text-[15px] font-semibold tracking-[-.015em]">
              {
                [
                  "Securing your upload",
                  "Reading merchant and date",
                  "Finding items, tax and tip",
                  "Checking duplicates and budgets",
                ][readingStep]
              }
            </p>
            <p className="mt-1 text-[11px] text-[#77776f]">
              {readingStep === 0
                ? "Your original stays private."
                : "You can close this—Tabby keeps working."}
            </p>
            <div className="mx-auto mt-5 flex max-w-[220px] gap-1.5">
              {[0, 1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 flex-1 rounded-full ${step <= readingStep ? "bg-[#39a68e]" : "bg-black/[0.08]"}`}
                />
              ))}
            </div>
          </div>
        )}

        {stage === "done" && (
          <>
            <div
              className={`mt-5 rounded-[22px] p-5 ${completedScans.length ? "scan-success-card bg-[#e7f7df]" : "bg-[#fde7e7]"}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-11 w-11 place-items-center rounded-full text-white ${completedScans.length ? "scan-success-check bg-[#2e7450]" : "bg-[#a74132]"}`}
                >
                  <Icon name={completedScans.length ? "check" : "error"} />
                </span>
                <span className="flex-1">
                  <b className="block text-[17px]">
                    {completedScans.length > 1
                      ? `${completedScans.length} receipts saved`
                      : completedScans[0]?.result
                        ? `${completedScans[0].result.merchant || "Receipt"} · ${scanMoney(completedScans[0].result.total, completedScans[0].result.currency)}`
                        : needsSignIn
                          ? "Nothing was uploaded"
                          : "Nothing was added"}
                  </b>
                  <span className="text-[11px] text-[#4b6d55]">
                    {completedScans.length
                      ? `${completedScans.length} ready to review`
                      : "Nothing was added. Check the messages below."}
                  </span>
                </span>
              </div>
              {budgetAlert && (
                <div className="scan-budget-row mt-4 flex justify-between rounded-[13px] bg-white/55 px-3 py-3 text-[12px]">
                  <span>
                    {budgetAlert.level === "total"
                      ? budgetAlert.label
                      : `${budgetAlert.label} budget`}
                  </span>
                  <b>
                    {budgetAlert.over_budget
                      ? `${scanMoney(-budgetAlert.remaining, completedScans[0]?.result?.currency ?? "USD")} over`
                      : `${scanMoney(budgetAlert.remaining, completedScans[0]?.result?.currency ?? "USD")} left`}
                  </b>
                </div>
              )}
            </div>
            <div className="scan-success-copy mt-3 flex items-center gap-3 px-2">
              <Cat mood={completedScans.length ? "done" : "hmm"} size={48} />
              <p className="text-left text-[11px] leading-relaxed text-[#77776f]">
                <b className="block text-[13px] text-[#22231f]">
                  {completedScans.length
                    ? "I’ve got this receipt."
                    : needsSignIn
                      ? "Your receipts are still on this device."
                      : "I couldn’t add these yet."}
                </b>
                {completedScans.length
                  ? "Review the items now, or come back from Activity later."
                  : needsSignIn
                    ? "Sign in, then choose the receipts again to upload them."
                    : "Check each message below and try again when you’re ready."}
              </p>
            </div>
            {matchedTap && (
              <div className="scan-match-card mt-3 flex items-center gap-3 rounded-[17px] bg-[#dff0ff] p-4">
                <Icon name="link" size={21} />
                <span className="flex-1">
                  <b className="block text-[12px]">Matched your Apple Pay tap</b>
                  <span className="text-[10px] text-[#45667b]">
                    The items were added to that purchase instead of a second one
                  </span>
                </span>
              </div>
            )}
            {duplicateScans.length > 0 && (
              <div className="mt-3 space-y-2">
                {duplicateScans.map((item) => (
                  <div
                    key={item.id}
                    className="scan-duplicate-row flex items-center gap-3 rounded-[15px] bg-[#fff0d9] p-3 text-left text-[11px] text-[#725024]"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{item.name}</b>
                      <span>Already on your tab</span>
                    </span>
                    {item.receiptId && (
                      <button
                        onClick={() => openReceipt(item.receiptId as string)}
                        className="min-h-9 rounded-full bg-white/70 px-3 font-bold"
                      >
                        Open it
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {failedScans.length > 0 && (
              <div className="mt-3 space-y-2">
                {failedScans.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[15px] bg-[#fde7e7] p-3 text-left text-[11px]"
                  >
                    <b className="block">{item.title || item.name}</b>
                    <span>{scanStatus(item)}</span>
                    {item.status === "error" && !needsSignIn && (
                      <button onClick={() => retry(item.id)} className="ml-2 font-bold underline">
                        Try again
                      </button>
                    )}
                    {item.status === "refused" && (
                      <button
                        onClick={() => {
                          remove(item.id);
                          scanPickers.open("camera");
                        }}
                        className="ml-2 font-bold underline"
                      >
                        Take another photo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {needsSignIn && (
              <button
                onClick={() => window.location.assign("/login")}
                className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
              >
                Sign in to scan
              </button>
            )}
            <button
              onClick={() => {
                const result = completedScans.find((item) => item.result)?.result;
                if (result) review(receiptFromApi(result));
                else close();
              }}
              className={`${needsSignIn ? "mt-2 bg-black/[0.05] text-[#22231f]" : "mt-5 bg-[#103e33] text-white"} min-h-12 w-full rounded-full text-[13px] font-bold`}
            >
              {completedScans.some((item) => item.result) ? "Review receipt" : "Back to Activity"}
            </button>
            <button onClick={reset} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Scan another
            </button>
          </>
        )}

        {stage === "manual" && (
          <div className="mt-5">
            <label className="block text-[12px] font-semibold text-[#77776f]" htmlFor="manual-name">
              What was it for?
            </label>
            <input
              id="manual-name"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              placeholder="Dinner at Nopa"
              autoFocus
              className="manual-field mt-2 h-12 w-full rounded-[15px] bg-black/[0.045] px-4 text-[14px] outline-none focus:ring-2 focus:ring-[#39a68e]"
            />

            <div className="mt-5 flex items-end justify-between">
              <label className="text-[12px] font-semibold text-[#77776f]" htmlFor="manual-amount">
                Total amount
              </label>
              {showItems && manualItemsTotal > 0 && (
                <span className="text-[10px] font-semibold text-[#34704c]">
                  Calculated from items
                </span>
              )}
            </div>
            <label className="manual-field mt-2 flex h-[72px] items-center rounded-[18px] bg-black/[0.045] px-4 focus-within:ring-2 focus-within:ring-[#39a68e]">
              <span className="text-[28px] font-semibold text-[#77776f]">$</span>
              <input
                id="manual-amount"
                type="text"
                inputMode="numeric"
                disabled={showItems && manualItemsTotal > 0}
                value={
                  showItems && manualItemsTotal > 0
                    ? manualItemsTotal.toFixed(2)
                    : ((Number(manualAmount) || 0) / 100).toFixed(2)
                }
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "");
                  setManualAmount(digits && Number(digits) ? String(Number(digits)) : "");
                }}
                aria-describedby="amount-entry-hint"
                className="h-full min-w-0 flex-1 bg-transparent px-2 text-[34px] font-semibold tracking-[-.04em] outline-none disabled:opacity-100"
              />
            </label>
            <p id="amount-entry-hint" className="mt-2 text-[10px] text-[#77776f]">
              Type digits continuously: 558 becomes $5.58.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="manual-field rounded-[16px] bg-black/[0.035] px-3 py-2 text-left">
                <span className="block text-[10px] font-semibold text-[#77776f]">Date</span>
                <input
                  type="date"
                  aria-label="Expense date"
                  value={manualDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setManualDate(event.target.value)}
                  className="mt-1 h-6 w-full bg-transparent text-[12px] font-semibold outline-none"
                />
              </label>
              <button
                onClick={() => setManualPicker(manualPicker === "category" ? null : "category")}
                className={`manual-field rounded-[16px] bg-black/[0.035] px-3 py-2 text-left ${manualPicker === "category" ? "ring-2 ring-[#39a68e]" : ""}`}
              >
                <span className="block text-[10px] font-semibold text-[#77776f]">Category</span>
                <span className="mt-1 flex items-center justify-between text-[12px] font-semibold">
                  <span>{categoryLabel(manualCategory)}</span>
                  <Icon name="expand_more" size={16} />
                </span>
              </button>
            </div>
            {manualPicker === "category" && (
              <div
                role="radiogroup"
                aria-label="Expense category"
                className="manual-picker mt-3 grid grid-cols-2 gap-2 rounded-[18px] bg-black/[0.035] p-3"
              >
                {CATEGORIES.map((category) => {
                  const style = categoryStyle(category);
                  return (
                    <button
                      key={category}
                      role="radio"
                      aria-checked={manualCategory === category}
                      onClick={() => {
                        setManualCategory(category);
                        setManualCategoryPicked(true);
                        setManualPicker(null);
                      }}
                      className={`flex min-h-12 items-center gap-2 rounded-[13px] px-3 text-[11px] font-bold ${manualCategory === category ? "bg-[#103e33] text-white" : "bg-black/[0.045]"}`}
                    >
                      <span
                        className="cat-tile grid h-7 w-7 place-items-center rounded-full"
                        style={manualCategory === category ? undefined : tileStyle(style)}
                      >
                        <Icon name={style.icon} size={16} fill />
                      </span>
                      {categoryLabel(category)}
                    </button>
                  );
                })}
              </div>
            )}
            {manualName && (
              <p className="mt-2 text-[10px] text-[#77776f]">
                {manualCategoryPicked
                  ? "Category selected by you."
                  : `Tabby suggested ${categoryLabel(manualCategory)} from what you typed. Tap to change it.`}
              </p>
            )}

            {!showItems ? (
              <button
                onClick={() => setShowItems(true)}
                className="mt-4 flex min-h-11 items-center gap-2 text-[12px] font-bold text-[#103e33]"
              >
                <Icon name="add" size={18} /> Add item details
              </button>
            ) : (
              <div className="mt-5 rounded-[18px] bg-black/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <b className="text-[12px]">Item details</b>
                  <button
                    onClick={() => setShowItems(false)}
                    className="min-h-9 text-[10px] font-semibold text-[#77776f]"
                  >
                    Use one total
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {manualItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_86px] gap-2">
                      <input
                        aria-label={`Item ${index + 1} name`}
                        value={item.name}
                        onChange={(event) =>
                          setManualItems((current) =>
                            current.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                        placeholder={index === 0 ? "Entrée" : "Drink"}
                        className="h-11 rounded-[12px] bg-white/55 px-3 text-[12px] outline-none"
                      />
                      <input
                        aria-label={`Item ${index + 1} price`}
                        type="number"
                        inputMode="decimal"
                        value={item.price}
                        onChange={(event) =>
                          setManualItems((current) =>
                            current.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, price: event.target.value } : entry
                            )
                          )
                        }
                        placeholder="0.00"
                        className="h-11 rounded-[12px] bg-white/55 px-3 text-right text-[12px] outline-none"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setManualItems((current) => [...current, { name: "", price: "" }])}
                  className="mt-2 min-h-9 text-[11px] font-bold text-[#103e33]"
                >
                  + Another item
                </button>
              </div>
            )}

            {manualError && (
              <p
                role="alert"
                className="mt-4 rounded-[14px] bg-[#fde7e7] px-4 py-3 text-[12px] font-semibold text-[#7a2b20]"
              >
                {manualError}
              </p>
            )}
            <button
              disabled={!manualValid || manualBusy}
              onClick={saveManualExpense}
              className="manual-submit mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white disabled:opacity-35"
            >
              {manualBusy
                ? "Saving…"
                : `Add $${manualTotal > 0 ? manualTotal.toFixed(2) : "0.00"} expense`}
            </button>
            <button
              onClick={() => setStage("start")}
              className="mt-2 min-h-11 w-full text-[12px] font-semibold text-[#77776f]"
            >
              Back to scan options
            </button>
          </div>
        )}

        {stage === "manualDone" && (
          <div className="mt-5">
            <div className="scan-success-card rounded-[22px] bg-[#e7f7df] p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#2e7450] text-white">
                  <Icon name="check" />
                </span>
                <span className="flex-1">
                  <b className="block text-[17px]">{manualSaved?.merchant}</b>
                  <span className="text-[11px] text-[#4b6d55]">
                    {scanMoney(manualSaved?.total ?? manualTotal, manualSaved?.currency)} ·{" "}
                    {categoryLabel(manualSaved?.category ?? manualCategory)} · Added by hand
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-[17px] bg-[#dff0ff] p-4">
              <Icon name="receipt_long" size={21} />
              <span className="flex-1">
                <b className="block text-[12px]">Saved without a receipt image</b>
                <span className="text-[10px] text-[#45667b]">
                  You can edit, delete or split it from Activity.
                </span>
              </span>
            </div>
            <button
              disabled={!manualSaved}
              onClick={() => setStage("manualSplit")}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white disabled:opacity-40"
            >
              Split this expense
            </button>
            <button
              onClick={goActivity}
              className="mt-2 min-h-11 w-full rounded-full bg-black/[0.045] text-[12px] font-bold"
            >
              View in Activity
            </button>
            <button onClick={reset} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Add another expense
            </button>
          </div>
        )}

        {stage === "manualSplit" && manualSaved && (
          <SplitSheet
            receipt={manualSaved}
            close={() => setStage("manualDone")}
            onSaved={(message) => {
              setManualSplitMessage(message);
              setStage("manualSplitDone");
            }}
          />
        )}

        {stage === "manualSplitDone" && (
          <div className="mt-5">
            <div className="rounded-[22px] bg-[#e7f7df] p-5 text-center">
              <Cat mood="love" size={82} />
              <h3 className="mt-2 text-[20px] font-semibold tracking-[-.035em]">Split saved</h3>
              <p className="mt-1 text-[11px] text-[#4b6d55]">
                {manualSplitMessage || "Everyone’s share is ready."}
              </p>
            </div>
            <button
              onClick={goActivity}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
            >
              View in Activity
            </button>
            <button onClick={close} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type Panel = "insights" | "budgets" | "profile" | "notifications";
const TABS: Tab[] = ["today", "activity", "circles", "tabby"];
const PANELS: Panel[] = ["insights", "budgets", "profile", "notifications"];

/** The signed-in app. Where you are lives in the address (/app?tab=activity,
 *  &panel=insights, &receipt=<id>, &group=<id>), so Back and shared links work. */
export default function NewApp() {
  const router = useRouter();
  const params = useSearchParams();
  const typePreview = ["system", "avenir", "rounded"].includes(params.get("type") ?? "")
    ? params.get("type")!
    : "system";
  const tab: Tab = TABS.find((t) => t === params.get("tab")) ?? "today";
  const panel: Panel | null = PANELS.find((p) => p === params.get("panel")) ?? null;
  const receiptId = params.get("receipt");
  const groupId = params.get("group");
  // The receipt being shown: from the list that opened it, or loaded from a link.
  const [opened, setOpened] = useState<Receipt | null>(null);
  const [scan, setScan] = useState(false);
  const go = useCallback(
    (to: { tab?: Tab; panel?: Panel | null; receipt?: string | null; group?: string | null }) => {
      const q = new URLSearchParams();
      if (to.tab && to.tab !== "today") q.set("tab", to.tab);
      if (to.panel) q.set("panel", to.panel);
      if (to.receipt) q.set("receipt", to.receipt);
      if (to.group) q.set("group", to.group);
      if (typePreview !== "system") q.set("type", typePreview);
      router.push(q.toString() ? `${routes.home}?${q}` : routes.home, { scroll: false });
    },
    [router, typePreview]
  );
  const setTab = (next: Tab) => go({ tab: next });
  const setPanel = (next: Panel | null) => go({ tab, panel: next });
  const setReceipt = (next: Receipt | null) => {
    setOpened(next);
    go({ tab, panel, receipt: next?.id ?? null });
  };
  useEffect(() => {
    if (!receiptId || opened?.id === receiptId) return;
    let live = true;
    getReceipt(receiptId)
      .then((r) => live && setOpened(receiptFromApi(r as UploadResult)))
      .catch(() => live && go({ tab, panel }));
    return () => {
      live = false;
    };
  }, [receiptId, opened?.id, go, tab, panel]);
  // Receipts without an id (not saved yet) open in place, without a link.
  const receipt = receiptId
    ? opened?.id === receiptId
      ? opened
      : null
    : opened?.id
      ? null
      : opened;
  // Dark is the house theme; a saved choice still wins.
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("cotab-demo-theme");
    if (savedTheme) setDark(savedTheme === "dark");
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, panel, receipt]);
  const toggleTheme = () =>
    setDark((current) => {
      const next = !current;
      window.localStorage.setItem("cotab-demo-theme", next ? "dark" : "light");
      return next;
    });
  return (
    <div
      className="ios-stage min-h-screen sm:py-6"
      data-theme={dark ? "dark" : "light"}
      data-type={typePreview}
    >
      <style jsx global>{`
        :root {
          --ios-label: rgb(29 29 31);
          --ios-secondary: rgb(60 60 67 / 0.62);
          --ios-glass: rgb(255 255 255 / 0.56);
          --ios-glass-thick: rgb(255 255 255 / 0.72);
          --ios-spring: linear(
            0,
            0.007,
            0.029 2.2%,
            0.118 4.7%,
            0.625 14.4%,
            0.843 19%,
            0.968 24.2%,
            1.011 29.9%,
            1.024 36.8%,
            1.012 52.7%,
            1.002 68.3%,
            1
          );
        }
        html {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        .ios-stage {
          background: #d9dde1;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
            "Helvetica Neue", system-ui, sans-serif;
          font-optical-sizing: auto;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }
        .ios-stage[data-type="avenir"] {
          font-family:
            "Avenir Next",
            Avenir,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }
        .ios-stage[data-type="rounded"] {
          font-family:
            ui-rounded,
            "SF Pro Rounded",
            -apple-system,
            BlinkMacSystemFont,
            "Helvetica Neue",
            sans-serif;
        }
        .ios-stage[data-theme="dark"] {
          background: #161917;
        }
        .ios-shell {
          background: #eef1ee;
          isolation: isolate;
        }
        .tabby-v3-avatar {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.78),
            0 0 0 1px rgb(52 74 59 / 0.16),
            0 8px 16px -9px rgb(52 74 59 / 0.58);
        }
        .tabby-v3-avatar img {
          transform: scale(1.2);
          filter: saturate(0.94) contrast(1.02) drop-shadow(0 5px 4px rgb(47 66 52 / 0.22));
        }
        .tabby-v3-stage::before {
          content: "";
          position: absolute;
          pointer-events: none;
          border-radius: 999px;
          background: rgb(185 205 178 / 0.44);
          filter: blur(18px);
          opacity: 0.94;
          transform: translateZ(0);
        }
        .tabby-v3-stage-card::before {
          inset: -28% -36% -24% -72%;
        }
        .tabby-v3-stage-hero::before {
          inset: -18% -42% -22% -76%;
        }
        .tabby-v3-stage-profile::before {
          inset: -22% -38% -24% -72%;
        }
        .tabby-v3-figure {
          transform: scale(1.045);
          transform-origin: 50% 100%;
          filter: saturate(0.96) drop-shadow(0 16px 10px rgb(47 66 52 / 0.3));
        }
        .tabby-v3-scene {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.72),
            0 13px 24px -17px rgb(52 74 59 / 0.68);
        }
        .tabby-profile-preview {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.72),
            0 18px 30px -20px rgb(52 74 59 / 0.7);
        }
        .tabby-profile-portrait img {
          transform: scale(1.55) translateY(12%);
        }
        .tabby-profile-full-body img {
          transform: scale(0.94);
        }
        .tabby-profile-soft-frame {
          background: #e5ede1;
          box-shadow: none;
        }
        .tabby-profile-soft-frame img {
          transform: scale(0.96);
          filter: drop-shadow(0 15px 10px rgb(47 66 52 / 0.28));
        }
        button .tabby-v3-avatar {
          transition:
            transform 220ms var(--ios-spring),
            box-shadow 220ms ease-out;
        }
        button:active .tabby-v3-avatar {
          transform: scale(0.94);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.42),
            0 0 0 1px rgb(52 74 59 / 0.18);
        }
        .ios-aurora {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: #eef1ee;
        }
        .ios-surface {
          background: #fffefa;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.92),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.1),
            0 10px 30px -24px rgb(32 54 40 / 0.42);
        }
        .demo-ticket {
          border-color: transparent !important;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.96),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.11),
            0 12px 30px -25px rgb(32 54 40 / 0.5);
        }
        .ios-glass-nav {
          background: rgb(246 249 246 / 0.74);
          -webkit-backdrop-filter: blur(28px) saturate(190%);
          backdrop-filter: blur(28px) saturate(190%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.92),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.48),
            0 0 0 0.5px rgb(42 67 50 / 0.1),
            0 14px 38px rgb(28 51 35 / 0.18);
        }
        .receipt-camera-viewport {
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.14),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.1),
            0 18px 42px rgb(0 0 0 / 0.38);
        }
        .camera-shutter {
          box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.35),
            0 0 0 7px rgb(255 255 255 / 0.08),
            0 10px 24px rgb(0 0 0 / 0.35);
        }
        .camera-pulse {
          animation: camera-breathe 1.4s ease-in-out infinite alternate;
        }
        @keyframes camera-breathe {
          to {
            transform: scale(1.06);
            background: rgb(255 255 255 / 0.16);
          }
        }
        .ios-round-control {
          background: #fffefa;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.94),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.1),
            0 8px 22px -16px rgb(32 54 40 / 0.46);
        }
        .ios-chip {
          background: rgb(255 254 250 / 0.7);
          -webkit-backdrop-filter: blur(14px) saturate(165%);
          backdrop-filter: blur(14px) saturate(165%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.9),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.09),
            0 7px 18px -16px rgb(32 54 40 / 0.42);
        }
        .ios-divider {
          box-shadow: inset 0 0.5px 0 rgb(44 66 51 / 0.1);
        }
        .ios-theme-glyph {
          background: #dce7d6;
          color: #31563d;
        }
        .ios-shell [class*="bg-[#edf9b7]"] {
          background: #e1eadc;
        }
        .ios-shell [class*="bg-[#dff0ff]"] {
          background: #dbe6de;
        }
        .ios-shell[data-theme="dark"] {
          --ios-label: #f5f5f7;
          --ios-secondary: rgb(235 235 245 / 0.62);
          --ios-glass: rgb(37 42 40 / 0.58);
          --ios-glass-thick: rgb(31 36 34 / 0.72);
          background: #060807;
          color: #f5f5f7;
          color-scheme: dark;
        }
        .ios-shell[data-theme="dark"] .ios-aurora {
          background: #060807;
        }
        .ios-shell[data-theme="dark"] .tabby-v3-avatar {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.2),
            0 0 0 1px rgb(198 218 192 / 0.16),
            0 10px 22px -10px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-v3-stage::before {
          background: rgb(76 103 82 / 0.32);
          filter: blur(22px);
          opacity: 0.82;
        }
        .ios-shell[data-theme="dark"] .tabby-v3-figure {
          filter: brightness(0.96) saturate(0.9) drop-shadow(0 17px 11px rgb(0 0 0 / 0.62));
        }
        .ios-shell[data-theme="dark"] .tabby-v3-scene {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.15),
            0 14px 28px -16px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-profile-preview {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.14),
            0 18px 34px -18px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-profile-soft-frame {
          background: #26372c;
          box-shadow: none;
        }
        .ios-shell[data-theme="dark"] .home-insight-copy h2 {
          color: #f5f5f7;
        }
        .ios-shell[data-theme="dark"] .home-insight-copy p:last-of-type {
          color: rgb(245 245 247 / 0.72);
        }
        .ios-shell[data-theme="dark"] .ios-surface {
          /* The light surface was kept in dark mode: light text on cream. */
          background: rgb(30 34 32 / 0.92);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.16),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 0 0 0.5px rgb(0 0 0 / 0.55),
            0 18px 42px rgb(0 0 0 / 0.3);
        }
        .ios-shell[data-theme="dark"] .demo-ticket {
          border-color: transparent !important;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.13),
            inset 0 0 0 0.5px rgb(190 215 184 / 0.09),
            0 18px 40px -25px rgb(0 0 0 / 0.92);
        }
        .ios-shell[data-theme="dark"] .ios-glass-nav {
          background: rgb(27 31 29 / 0.72);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.17),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 0 0 0.5px rgb(0 0 0 / 0.58),
            0 18px 45px rgb(0 0 0 / 0.48);
        }
        .ios-shell[data-theme="dark"] .ios-round-control {
          background: rgb(42 48 45 / 0.64);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.18),
            0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 10px 24px rgb(0 0 0 / 0.28);
        }
        .ios-shell[data-theme="dark"] .ios-chip {
          background: rgb(37 42 40 / 0.7);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.12),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.06),
            0 9px 24px -18px rgb(0 0 0 / 0.82);
        }
        .ios-shell[data-theme="dark"] .ios-divider {
          box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.09);
        }
        .ios-shell[data-theme="dark"] .ios-theme-glyph {
          background: rgb(128 157 119 / 0.2);
          color: #bed0b8;
        }
        .ios-shell[data-theme="dark"] [class*="text-[#77776f]"],
        .ios-shell[data-theme="dark"] [class*="text-[#9c9c95]"],
        .ios-shell[data-theme="dark"] [class*="text-[#62625d]"],
        .ios-shell[data-theme="dark"] [class*="text-[#526346]"],
        .ios-shell[data-theme="dark"] [class*="text-[#45667b]"],
        .ios-shell[data-theme="dark"] [class*="text-[#715f59]"] {
          color: rgb(235 235 245 / 0.62);
        }
        .ios-shell[data-theme="dark"] [class*="text-[#103e33]"],
        .ios-shell[data-theme="dark"] [class*="text-[#50713a]"] {
          color: #b8cdb2;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#103e33]"] {
          background: #a8c3a0;
          color: #102016;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#fffefa]"] {
          background: rgb(50 54 52 / 0.78);
          color: #f5f5f7;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#f7e9e3]"] {
          background: rgb(133 58 43 / 0.34);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#edf9b7]"] {
          background: rgb(83 107 76 / 0.42);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#dff0ff]"] {
          background: rgb(57 81 65 / 0.48);
        }
        .ios-shell[data-theme="dark"] [class*="bg-black/[0.07]"] {
          background: rgb(255 255 255 / 0.11);
        }
        .ios-shell[data-theme="dark"] [class*="bg-black/[0.05]"] {
          background: rgb(255 255 255 / 0.1);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#e6f3e5]"] {
          background: rgb(70 120 76 / 0.3);
        }
        .ios-shell[data-theme="dark"] [class*="text-[#286036]"] {
          color: #a9d7a3;
        }
        .ios-shell[data-theme="dark"] [class*="text-[#a74132]"] {
          color: #ff9f8f;
        }
        .ios-shell[data-theme="dark"] [class*="border-black"] {
          border-color: rgb(255 255 255 / 0.12);
        }
        .ios-shell[data-theme="dark"] .demo-ticket:after {
          background: rgb(31 36 34 / 0.72);
        }
        .ios-shell[data-theme="dark"] .demo-soft-gloss {
          background: rgb(34 40 37 / 0.67);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.15),
            inset -1px -1px 0 rgb(215 244 91 / 0.06),
            0 20px 38px -20px rgb(0 0 0 / 0.65);
        }
        .ios-shell[data-theme="dark"] .demo-nav-gloss {
          background: rgb(27 31 29 / 0.78);
        }
        .ios-shell[data-theme="dark"] .tabs-hero {
          background: #24392d;
          color: #f3f6f1;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.22),
            inset 0 0 0 0.5px rgb(184 205 178 / 0.16),
            0 20px 38px -20px rgb(0 15 7 / 0.82);
        }
        .ios-shell[data-theme="dark"] .tabs-hero .ring-\[\#103e33\] {
          --tw-ring-color: #24392d;
        }
        .ios-shell[data-theme="dark"] .tabs-action {
          background: #789570;
          color: #f4f7f2;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.24);
        }
        .ios-shell[data-theme="dark"] .tabs-remind {
          background: rgb(126 155 117 / 0.18);
          color: #bed0b8;
          box-shadow: inset 0 0 0 0.5px rgb(176 202 169 / 0.16);
        }
        .ios-shell[data-theme="dark"][data-active-tab="circles"]
          .ios-glass-nav
          button[class*="text-[#103e33]"] {
          color: #b9ceb2;
        }
        .ios-shell[data-theme="dark"] .receipt-detail {
          background: transparent;
        }
        button {
          -webkit-tap-highlight-color: transparent;
          transition:
            transform 420ms var(--ios-spring),
            filter 180ms ease-out;
        }
        button:active {
          transform: scale(0.97);
          filter: brightness(0.97);
          transition-duration: 90ms;
        }
        main {
          animation: ios-materialize 360ms var(--ios-spring) both;
        }
        @keyframes ios-materialize {
          from {
            opacity: 0;
            transform: scale(0.985) translateY(8px);
          }
        }
        .demo-ticket:after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: -7px;
          height: 14px;
          background: rgb(255 255 255 / 0.72);
          clip-path: polygon(
            0 0,
            5% 100%,
            10% 0,
            15% 100%,
            20% 0,
            25% 100%,
            30% 0,
            35% 100%,
            40% 0,
            45% 100%,
            50% 0,
            55% 100%,
            60% 0,
            65% 100%,
            70% 0,
            75% 100%,
            80% 0,
            85% 100%,
            90% 0,
            95% 100%,
            100% 0
          );
        }
        .demo-sand {
          background: #f2e7d5;
          color: #79552b;
        }
        .demo-coral {
          background: #f8ddd5;
          color: #a74132;
        }
        .demo-lime {
          background: #edf9b7;
          color: #50713a;
        }
        .demo-sky {
          background: #dff0ff;
          color: #365f78;
        }
        .demo-gloss {
          background: #103e33;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.48),
            inset 1px 0 0 rgb(255 255 255 / 0.12),
            inset 0 -1px 0 rgb(0 0 0 / 0.24),
            0 18px 32px -22px rgb(15 62 51 / 0.62);
        }
        .demo-soft-gloss {
          background: rgb(255 255 255 / 0.64);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 1),
            inset -1px -1px 0 rgb(80 113 58 / 0.08),
            0 16px 30px -20px rgb(20 21 18 / 0.34);
        }
        .demo-nav-gloss {
          background: rgb(255 254 250 / 0.78);
          -webkit-backdrop-filter: saturate(180%) blur(22px);
          backdrop-filter: saturate(180%) blur(22px);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 1),
            0 -14px 30px -22px rgb(20 21 18 / 0.38);
        }
        .scan-motion {
          position: relative;
          width: 270px;
          height: 270px;
        }
        .scan-receipt {
          position: absolute;
          left: 50%;
          top: 14px;
          width: 154px;
          height: 224px;
          overflow: hidden;
          padding: 24px 18px;
          border-radius: 10px;
          background: #fff9ea;
          box-shadow: 0 18px 36px -22px rgb(20 21 18 / 0.45);
          transform: translateX(-50%) rotate(-1.5deg);
          animation: scan-receipt-float 2.2s ease-in-out infinite alternate;
        }
        .scan-beam {
          position: absolute;
          left: 8px;
          right: 8px;
          top: 16px;
          height: 2px;
          border-radius: 99px;
          background: #39a68e;
          box-shadow: 0 0 14px 3px rgb(57 166 142 / 0.38);
          animation: scan-beam-pass 1.15s ease-in-out infinite alternate;
          will-change: transform;
        }
        .scan-data-chip {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 5px;
          min-height: 34px;
          padding: 0 10px;
          border-radius: 11px;
          background: rgb(255 255 255 / 0.9);
          box-shadow: 0 8px 20px -14px rgb(20 21 18 / 0.48);
          color: #285c4d;
          font-size: 10px;
          font-weight: 700;
          opacity: 0;
          transform: translateY(8px) scale(0.96);
          animation: scan-chip-in 0.45s var(--ios-spring) forwards;
        }
        .scan-data-chip-one {
          right: 0;
          top: 42px;
          animation-delay: 0.85s;
        }
        .scan-data-chip-two {
          left: 0;
          top: 114px;
          animation-delay: 1.8s;
        }
        .scan-data-chip-three {
          right: 2px;
          top: 182px;
          animation-delay: 2.8s;
        }
        .scan-orbit {
          position: absolute;
          bottom: 0;
          left: 50%;
          display: grid;
          width: 52px;
          height: 52px;
          place-items: center;
          border-radius: 50%;
          background: #d7f45b;
          transform: translateX(-50%);
          animation: scan-tabby-pulse 1.6s ease-in-out infinite alternate;
        }
        .scan-tabby-thought {
          position: absolute;
          left: 50%;
          bottom: -38px;
          width: 228px;
          padding: 10px 13px;
          border-radius: 15px;
          background: rgb(255 255 255 / 0.92);
          box-shadow: 0 10px 28px -18px rgb(20 21 18 / 0.55);
          color: #315a4d;
          font-size: 10px;
          font-weight: 650;
          transform: translateX(-50%);
          animation: scan-thought-in 0.42s var(--ios-spring) both;
        }
        .scan-tabby-thought::before {
          content: "";
          position: absolute;
          left: 50%;
          top: -6px;
          width: 12px;
          height: 12px;
          background: inherit;
          transform: translateX(-50%) rotate(45deg);
        }
        .scan-success-card {
          transform-origin: 50% 80%;
          animation: scan-success-card-in 0.55s var(--ios-spring) both;
        }
        .scan-success-check {
          animation: scan-success-check-in 0.58s 0.12s var(--ios-spring) both;
        }
        .ios-shell[data-theme="dark"] .scan-success-card {
          background: #20392d;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(170 205 175 / 0.12);
        }
        .ios-shell[data-theme="dark"] .scan-success-card [class*="text-[#4b6d55]"] {
          color: #b9cabb;
        }
        .ios-shell[data-theme="dark"] .scan-budget-row {
          background: rgb(255 255 255 / 0.08);
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-success-copy b {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-success-copy p {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .scan-match-card {
          background: #26382f;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-match-card [class*="text-[#45667b]"] {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .scan-data-chip {
          background: #2b3530;
          color: #d5e7dc;
          box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.08),
            0 9px 22px -14px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .scan-tabby-thought {
          background: #2b3530;
          color: #d5e7dc;
          box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.08),
            0 10px 24px -14px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .scan-quality-chip {
          background: #26382f;
          color: #c5ddca;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-file-card {
          background: #382f29;
          color: #f5f1ed;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.07);
        }
        .ios-shell[data-theme="dark"] .scan-file-card [class*="text-[#76604e]"] {
          color: #c8bcb2;
        }
        .ios-shell[data-theme="dark"] .scan-take-card [class*="text-white/65"] {
          color: #355241;
        }
        .ios-shell[data-theme="dark"] .scan-privacy-note b {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-privacy-note p {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .manual-field {
          background: #202723;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.055);
        }
        .ios-shell[data-theme="dark"] .manual-field input,
        .ios-shell[data-theme="dark"] .manual-field select {
          color: #f5f7f4;
          color-scheme: dark;
        }
        .ios-shell[data-theme="dark"] .manual-field input::placeholder {
          color: #8f9992;
          opacity: 1;
        }
        .ios-shell[data-theme="dark"] .manual-budget-preview {
          background: #20392d;
          color: #e6f1e8;
          box-shadow: inset 0 0 0 1px rgb(170 205 175 / 0.12);
        }
        .ios-shell[data-theme="dark"] .manual-submit:disabled {
          background: #425148;
          color: #b9c2bc;
          opacity: 1;
        }
        .ios-shell[data-theme="dark"] .scan-batch-row {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-batch-review,
        .ios-shell[data-theme="dark"] .scan-batch-warning,
        .ios-shell[data-theme="dark"] .scan-duplicate-row {
          background: #3a3027;
          color: #ead7c0;
          box-shadow: inset 0 0 0 1px rgb(239 205 165 / 0.12);
        }
        /* A full sheet over the page: the see-through card surface let the
           screen behind show through the text. */
        .ios-shell[data-theme="dark"] .scan-sheet,
        .ios-shell[data-theme="dark"] .full-sheet {
          background: rgb(30 34 32);
        }
        .remind-sheet {
          color: #171916;
          background: rgb(248 249 246 / 0.96);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.96),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.08),
            0 -18px 48px rgb(20 36 25 / 0.14);
          -webkit-backdrop-filter: blur(28px) saturate(1.25);
          backdrop-filter: blur(28px) saturate(1.25);
        }
        .remind-kicker,
        .remind-secondary {
          color: rgb(60 60 67 / 0.64);
        }
        .remind-close,
        .remind-options,
        .remind-preview {
          background: rgb(255 255 255 / 0.72);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.9),
            inset 0 0 0 0.5px rgb(44 66 51 / 0.09),
            0 12px 28px -24px rgb(32 54 40 / 0.44);
        }
        .remind-amount {
          color: #f8faf7;
          background: #173e32;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.18),
            0 18px 34px -24px rgb(20 62 47 / 0.72);
        }
        .remind-tabby {
          filter: saturate(0.94) drop-shadow(0 14px 9px rgb(0 18 9 / 0.5));
        }
        .remind-option {
          color: #20211f;
        }
        .remind-option:disabled {
          cursor: not-allowed;
        }
        .remind-option:disabled .remind-option-icon,
        .remind-option:disabled > .ms {
          opacity: 0.4;
        }
        .remind-option.is-selected {
          color: #174936;
        }
        .remind-option-icon {
          color: #315a49;
          background: rgb(218 232 216 / 0.78);
        }
        .remind-divider {
          height: 0.5px;
          background: rgb(60 60 67 / 0.14);
        }
        .remind-primary {
          color: #f8faf7;
          background: #103e33;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.18),
            0 12px 24px -18px rgb(16 62 51 / 0.9);
        }
        .remind-error {
          color: #9f302b;
          background: #f9e4df;
        }
        .ios-shell[data-theme="dark"] .remind-sheet {
          color: #f5f5f7;
          background: rgb(30 34 32 / 0.97);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.14),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 -22px 52px rgb(0 0 0 / 0.58);
        }
        .ios-shell[data-theme="dark"] .remind-kicker,
        .ios-shell[data-theme="dark"] .remind-secondary {
          color: rgb(235 235 245 / 0.62);
        }
        .ios-shell[data-theme="dark"] .remind-close,
        .ios-shell[data-theme="dark"] .remind-options,
        .ios-shell[data-theme="dark"] .remind-preview {
          background: rgb(48 53 50 / 0.8);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.12),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.06),
            0 16px 32px -26px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .remind-amount {
          background: #263d31;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.16),
            0 18px 32px -22px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .remind-option {
          color: #f5f5f7;
        }
        .ios-shell[data-theme="dark"] .remind-option.is-selected {
          color: #bed0b8;
        }
        .ios-shell[data-theme="dark"] .remind-option-icon {
          color: #bed0b8;
          background: rgb(126 155 117 / 0.18);
        }
        .ios-shell[data-theme="dark"] .remind-divider {
          background: rgb(235 235 245 / 0.12);
        }
        .ios-shell[data-theme="dark"] .remind-primary {
          color: #102016;
          background: #a8c3a0;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.24);
        }
        .ios-shell[data-theme="dark"] .remind-error {
          color: #ffb4a9;
          background: rgb(133 58 43 / 0.34);
        }
        /* Save bar of a full sheet: the sheet's own colour, not a black band. */
        .sheet-footer {
          background: #fffefa;
          box-shadow: 0 -1px 0 rgb(0 0 0 / 0.07);
        }
        .ios-shell[data-theme="dark"] .sheet-footer {
          background: rgb(30 34 32);
          box-shadow: 0 -1px 0 rgb(255 255 255 / 0.08);
        }
        .pay-method.is-on {
          background: #edf9b7;
          color: #22231f;
        }
        .ios-shell[data-theme="dark"] .pay-method.is-on {
          background: #a6c4a0;
          border-color: #a6c4a0;
          color: #10231d;
        }
        .insight-bar {
          background: rgb(0 0 0 / 0.08);
        }
        .insight-bar.is-on {
          background: #103e33;
        }
        .insight-month {
          color: #9c9c95;
        }
        .insight-month.is-on {
          color: #141512;
        }
        .ios-shell[data-theme="dark"] .insight-bar {
          background: rgb(255 255 255 / 0.12);
        }
        .ios-shell[data-theme="dark"] .insight-bar.is-on {
          background: #a6c4a0;
        }
        .ios-shell[data-theme="dark"] .insight-month.is-on {
          color: #f5f7f4;
        }
        .tabby-section {
          color: #77776f;
        }
        .tabby-section.is-on {
          color: #103e33;
        }
        .tabby-section-bar {
          background: #103e33;
        }
        .ios-shell[data-theme="dark"] .tabby-section.is-on {
          color: #a6c4a0;
        }
        .ios-shell[data-theme="dark"] .tabby-section-bar {
          background: #a6c4a0;
        }
        .ios-shell[data-theme="dark"] .tabby-hero p:first-child {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .tabby-hero p + p {
          color: rgb(245 247 244 / 0.7);
        }
        .ios-shell[data-theme="dark"] .tabby-ask,
        .ios-shell[data-theme="dark"] .tabby-suggestion {
          background: rgb(255 255 255 / 0.06);
          border-color: rgb(255 255 255 / 0.12);
          color: #f5f7f4;
        }
        .budget-level.is-on {
          background: #edf9b7;
        }
        .ios-shell[data-theme="dark"] .budget-level.is-on {
          background: rgb(166 196 160 / 0.14);
          border-color: #a6c4a0;
        }
        .split-mode.is-on {
          background: rgb(16 62 51 / 0.06);
        }
        .ios-shell[data-theme="dark"] .split-mode.is-on {
          background: rgb(166 196 160 / 0.14);
          border-color: #a6c4a0;
        }
        /* Shared forms (name, number, payment handles, export, delete) use the
           app's older colour tokens; in dark mode they follow this theme. */
        .ios-shell[data-theme="dark"] .profile-panel,
        .ios-shell[data-theme="dark"] .profile-panel .text-ink,
        .ios-shell[data-theme="dark"] .split-picker .text-ink {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .profile-panel .text-muted,
        .ios-shell[data-theme="dark"] .profile-panel .text-faint {
          color: rgb(245 247 244 / 0.62);
        }
        .ios-shell[data-theme="dark"] .profile-panel input,
        .ios-shell[data-theme="dark"] .profile-panel select {
          background: rgb(255 255 255 / 0.07);
          border-color: rgb(255 255 255 / 0.14);
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .profile-panel .border-line {
          border-color: rgb(255 255 255 / 0.08);
        }
        .ios-shell[data-theme="dark"] .profile-panel .bg-forest {
          background: #a6c4a0;
          color: #10231d;
        }
        .ios-shell[data-theme="dark"] .profile-panel [class*="bg-ink/"],
        .ios-shell[data-theme="dark"] .profile-panel .bg-paper,
        .ios-shell[data-theme="dark"] .profile-panel .bg-card {
          background: rgb(255 255 255 / 0.08);
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .profile-panel .bg-mint {
          background: rgb(166 196 160 / 0.14);
          color: #c9e2c3;
        }
        .ios-shell[data-theme="dark"] .profile-panel .bg-blush {
          background: #3a2522;
          color: #f3c3b8;
        }
        .ios-shell[data-theme="dark"] .profile-panel .text-rose {
          color: #f3a99c;
        }
        .ios-shell[data-theme="dark"] .profile-panel .text-forest {
          color: #a6c4a0;
        }
        .ios-shell[data-theme="dark"] .profile-panel .\!bg-rose {
          background: #c8504a !important;
          color: #fff;
        }
        .ios-shell[data-theme="dark"] .profile-tabby b {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .profile-tabby span {
          color: rgb(245 247 244 / 0.7);
        }
        /* The person picker is shared with the rest of the app. */
        .ios-shell[data-theme="dark"] .split-picker input {
          background: rgb(255 255 255 / 0.07);
          border-color: rgb(255 255 255 / 0.14);
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .split-picker input::placeholder {
          color: rgb(245 247 244 / 0.5);
        }
        .ios-shell[data-theme="dark"] .split-picker label,
        .ios-shell[data-theme="dark"] .split-picker p {
          color: rgb(245 247 244 / 0.72);
        }
        .ios-shell[data-theme="dark"] .split-picker button.bg-forest {
          background: #a6c4a0;
          color: #10231d;
        }
        .ios-shell[data-theme="dark"] .receipt-delete-confirm {
          background: #3a2522;
          color: #f3c3b8;
          box-shadow: inset 0 0 0 1px rgb(243 195 184 / 0.14);
        }
        .ios-shell[data-theme="dark"] .receipt-delete-confirm button:first-child {
          background: rgb(255 255 255 / 0.12);
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-duplicate-row button {
          background: rgb(255 255 255 / 0.12);
          color: #f5e6d3;
        }
        .ios-shell[data-theme="dark"] .scan-batch-review [class*="text-[#9a5a13]"] {
          color: #efba76;
        }
        .ios-shell[data-theme="dark"] .scan-batch-thumb {
          background: #f3eadb;
          color: #544536;
        }
        .ios-shell[data-theme="dark"] .manual-picker {
          background: #1d2420;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        @keyframes scan-beam-pass {
          from {
            transform: translateY(0);
            opacity: 0.65;
          }
          to {
            transform: translateY(184px);
            opacity: 1;
          }
        }
        @keyframes scan-receipt-float {
          from {
            transform: translateX(-50%) translateY(0) rotate(-1.5deg);
          }
          to {
            transform: translateX(-50%) translateY(-3px) rotate(-0.5deg);
          }
        }
        @keyframes scan-chip-in {
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes scan-tabby-pulse {
          from {
            transform: translateX(-50%) scale(0.96);
          }
          to {
            transform: translateX(-50%) scale(1.04);
          }
        }
        @keyframes scan-thought-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
        @keyframes scan-success-card-in {
          from {
            opacity: 0;
            transform: translateY(18px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes scan-success-check-in {
          from {
            opacity: 0;
            transform: scale(0.45) rotate(-12deg);
          }
          to {
            opacity: 1;
            transform: scale(1) rotate(0);
          }
        }
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .ios-surface,
          .ios-glass-nav,
          .demo-soft-gloss {
            background: rgb(255 255 255 / 0.94);
          }
        }
        @media (prefers-reduced-transparency: reduce) {
          .ios-surface,
          .ios-glass-nav,
          .demo-soft-gloss {
            background: #fff;
            -webkit-backdrop-filter: none;
            backdrop-filter: none;
          }
        }
        @media (prefers-contrast: more) {
          .ios-surface {
            box-shadow:
              inset 0 0 0 1px rgb(16 62 51 / 0.24),
              0 12px 30px -25px rgb(32 54 40 / 0.5);
          }
          .ios-glass-nav {
            box-shadow:
              inset 0 1px 0 rgb(255 255 255 / 0.96),
              inset 0 0 0 1px rgb(16 62 51 / 0.2),
              0 14px 38px rgb(28 51 35 / 0.18);
          }
          .ios-shell[data-theme="dark"] .ios-surface,
          .ios-shell[data-theme="dark"] .ios-glass-nav {
            box-shadow:
              inset 0 1px 0 rgb(255 255 255 / 0.16),
              inset 0 0 0 1px rgb(190 215 184 / 0.22),
              0 18px 42px -26px rgb(0 0 0 / 0.92);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          main {
            animation: ios-crossfade 140ms ease-out both;
          }
          button {
            transition-duration: 0.01ms;
          }
          .scan-receipt,
          .scan-beam,
          .scan-data-chip,
          .scan-orbit,
          .scan-tabby-thought,
          .scan-success-card,
          .scan-success-check {
            animation: none;
          }
          .camera-pulse {
            animation: none;
          }
          .scan-data-chip {
            opacity: 1;
            transform: none;
          }
          @keyframes ios-crossfade {
            from {
              opacity: 0;
            }
          }
        }
      `}</style>
      <div
        className="ios-shell relative mx-auto min-h-screen max-w-[430px] overflow-hidden text-[#141512] sm:min-h-[880px] sm:rounded-[34px]"
        data-theme={dark ? "dark" : "light"}
        data-active-tab={tab}
      >
        <div className="ios-aurora" aria-hidden="true" />
        <div className="relative z-[1]">
          {receipt && (
            <ReceiptDetail item={receipt} close={() => setReceipt(null)} onChange={setOpened} />
          )}
          {!receipt && (
            <>
              {panel === "insights" && (
                <Insights
                  back={() => setPanel(null)}
                  goBudgets={() => setPanel("budgets")}
                  openReceipt={(id) => go({ tab, panel, receipt: id })}
                />
              )}
              {panel === "budgets" && <Budgets back={() => setPanel("insights")} />}
              {panel === "notifications" && (
                <Notifications
                  back={() => setPanel(null)}
                  openReceipt={(id) => go({ tab, panel, receipt: id })}
                  goBudgets={() => setPanel("budgets")}
                  goInsights={() => setPanel("insights")}
                  goTabby={() => go({ tab: "tabby" })}
                />
              )}
              {panel === "profile" && (
                <Profile
                  back={() => setPanel(null)}
                  dark={dark}
                  toggleTheme={toggleTheme}
                  goBudgets={() => setPanel("budgets")}
                  goTabby={() => go({ tab: "tabby" })}
                />
              )}
              {!panel && tab === "today" && (
                <Today
                  goActivity={() => setTab("activity")}
                  goCircles={() => setTab("circles")}
                  goInsights={() => setPanel("insights")}
                  goBudgets={() => setPanel("budgets")}
                  goProfile={() => setPanel("profile")}
                  goNotifications={() => setPanel("notifications")}
                  openTab={(id) => go({ tab: "circles", group: id })}
                  dark={dark}
                  toggleTheme={toggleTheme}
                  openReceipt={setReceipt}
                />
              )}{" "}
              {!panel && tab === "activity" && <Activity openReceipt={setReceipt} />}{" "}
              {!panel && tab === "circles" && (
                <Tabs
                  initialDetail={groupId}
                  onDetailChange={(id) => go({ tab: "circles", group: id })}
                  openReceipt={(id) => go({ tab: "circles", group: groupId, receipt: id })}
                />
              )}{" "}
              {!panel && tab === "tabby" && <TabbyTab />}
              {!panel && <BottomNav tab={tab} setTab={setTab} scan={() => setScan(true)} />}
              {scan && (
                <Scanner
                  close={() => setScan(false)}
                  goActivity={() => {
                    setScan(false);
                    setTab("activity");
                  }}
                  openReceipt={(id) => {
                    setScan(false);
                    go({ tab, panel, receipt: id });
                  }}
                  review={(next) => {
                    setScan(false);
                    setReceipt(next);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
