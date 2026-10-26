"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import type { ReactNode } from "react";

import { Icon } from "@/components/ui";
import type { LineItem, Receipt as ApiReceipt } from "@/lib/api";
import { categoryLabel, categoryStyle } from "@/lib/format";

/** Pieces every New UI screen shares: the receipt shape the screens draw,
 *  Tabby's avatar, the ticket card, the sheet and a receipt row. */

export type Receipt = {
  id?: string;
  merchant: string;
  note: string;
  amount: string;
  mine: string;
  icon: string;
  tone: string;
  date: string;
  purchasedAt?: string | null;
  currency?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  category?: string;
  confidence?: number | null;
  status?: string;
  lineItems?: LineItem[];
  /** The tab it's split on, when it is. */
  splitTab?: string | null;
};

export function receiptFromApi(receipt: ApiReceipt): Receipt {
  const currency = receipt.currency || "USD";
  const formatted = scanMoney(receipt.total, currency);
  return {
    id: receipt.id,
    merchant: receipt.merchant || "Receipt",
    note: [
      categoryLabel(receipt.category || "other"),
      receipt.source === "manual"
        ? "By hand"
        : `${receipt.line_items?.length || 0} item${receipt.line_items?.length === 1 ? "" : "s"}`,
    ].join(" · "),
    amount: formatted,
    mine: `${scanMoney(receipt.my_share ?? receipt.total, currency)} yours`,
    icon: categoryStyle(receipt.category || "other").icon,
    tone: TONE[receipt.category || ""] ?? "sky",
    date: receipt.purchased_at
      ? new Date(receipt.purchased_at).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Just now",
    purchasedAt: receipt.purchased_at,
    currency,
    total: receipt.total,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    category: receipt.category,
    confidence: receipt.confidence,
    status: receipt.status,
    lineItems: receipt.line_items,
    splitTab: receipt.split_group_id ?? null,
  };
}

// Category -> the screen's colour tone (each tone has light and dark styles).
const TONE: Record<string, string> = {
  groceries: "lime",
  shopping: "lime",
  dining: "sand",
  drinks: "sand",
  bars: "sand",
  transport: "coral",
  utilities: "coral",
  health: "coral",
};

export function scanMoney(value: number, currency?: string | null) {
  // Older receipts can have no currency; the backend's default is USD.
  currency = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export const cats = ["cool", "love", "hmm", "hi"];

/** Moods that have a picture in Tabby's V3 stock (public/cat-v3-stock/png). */
export const V3_MOODS = new Set([
  "autopilot",
  "bill-shock",
  "celebrate",
  "cool",
  "done",
  "hi",
  "hmm",
  "love",
  "morning",
  "need-money",
  "oops",
  "out-of-cash",
  "over-budget",
  "payday",
  "remember",
  "salute",
  "thinking",
  "working",
]);
export const v3 = (mood?: string | null) => (mood && V3_MOODS.has(mood) ? mood : "cool");

export function Cat({ mood = "cool", size = 42 }: { mood?: string; size?: number }) {
  return (
    <span
      className="tabby-v3-avatar relative block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <img
        src={`/cat-v3-stock/png/${v3(mood)}.png`}
        alt=""
        className="h-full w-full scale-[1.32] object-cover object-[50%_28%]"
      />
    </span>
  );
}
export function Ticket({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`demo-ticket ios-surface relative ${className}`}>{children}</div>;
}
export function Header({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#77776f]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.045em]">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function DemoSheet({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] mx-auto flex max-w-[430px] items-end bg-black/45"
    >
      <button className="absolute inset-0" aria-label="Close" tabIndex={-1} onClick={close} />
      <section className="ios-surface full-sheet relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-[30px] px-5 pb-8 pt-4">
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-black/15" />
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h2 className="text-[24px] font-semibold tracking-[-.04em]">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[12px] leading-relaxed text-[#77776f]">{subtitle}</p>
            )}
          </div>
          <button
            onClick={close}
            aria-label="Close sheet"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
          >
            <Icon name="close" size={19} />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
export function ReceiptRow({ item, onClick }: { item: Receipt; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-3.5 text-left">
      <span
        className={`demo-${item.tone} grid h-11 w-11 shrink-0 place-items-center rounded-[14px]`}
      >
        <Icon name={item.icon} size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[15px]">{item.merchant}</b>
        <span className="block truncate text-[12px] text-[#77776f]">{item.note}</span>
      </span>
      <span className="text-right">
        <b className="block text-[15px]">{item.amount}</b>
        <span className="block text-[11px] font-semibold text-[#77776f]">{item.mine}</span>
      </span>
    </button>
  );
}

export function BackHeader({
  title,
  back,
  action,
  backLabel = "Today",
}: {
  title: string;
  back: () => void;
  action?: ReactNode;
  backLabel?: string;
}) {
  return (
    <header>
      <button
        onClick={back}
        className="flex min-h-10 items-center gap-1 text-[13px] font-bold text-[#103e33]"
      >
        <Icon name="arrow_back" size={18} /> {backLabel}
      </button>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.045em]">{title}</h1>
        {action}
      </div>
    </header>
  );
}
