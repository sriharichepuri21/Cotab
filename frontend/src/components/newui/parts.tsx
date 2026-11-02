"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  durations,
  eases,
  gsap,
  holdFlip,
  listStagger,
  prefersReducedMotion,
  useGSAP,
} from "@/lib/motion";
import { brandLogo, shopName } from "@/lib/brands";
import { tabbyArt } from "@/lib/tabby";

import { Icon } from "@/components/ui";
import type { LineItem, Receipt as ApiReceipt } from "@/lib/api";
import { categoryLabel, categoryStyle } from "@/lib/format";

/** Pieces every New UI screen shares: the receipt shape the screens draw,
 *  Tabby's avatar, the ticket card, the sheet and a receipt row. */

/** A category's tile colours. The glass theme reads `--tile-ink` to turn the
 *  pastel tile into tinted glass; the light theme uses the inline colours. */
export function tileStyle(style: { tile: string; ink: string; bar: string }): CSSProperties {
  return {
    background: style.tile,
    color: style.ink,
    ["--tile-ink" as string]: style.bar === "#0F3D31" ? "#8ED968" : style.bar,
  };
}

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
  source?: ApiReceipt["source"];
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
    source: receipt.source,
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

/** An amount that rolls from 0, `from` or its old value to `value`, with the
 *  real figure for screen readers throughout. */
export function RollingMoney({
  value,
  currency,
  from = 0,
  centsClassName,
}: {
  value: number;
  currency?: string | null;
  from?: number;
  centsClassName?: string;
}) {
  const scope = useRef<HTMLSpanElement>(null);
  const roll = useRef({ shown: from });
  const split = (amount: number) => {
    const [whole, cents] = scanMoney(amount, currency).split(".");
    return [whole, cents ? `.${cents}` : ""];
  };
  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        roll.current.shown = value;
        return;
      }
      const [whole, cents] = Array.from(scope.current!.children);
      const draw = () => {
        [whole.textContent, cents.textContent] = split(roll.current.shown);
      };
      // Runs before paint, so the final figure React rendered is never seen.
      draw();
      gsap.to(roll.current, {
        shown: value,
        duration: 0.9,
        ease: eases.out,
        overwrite: true,
        onUpdate: draw,
      });
    },
    { scope, dependencies: [value, currency] }
  );
  const [whole, cents] = split(value);
  return (
    <span
      ref={scope}
      role="img"
      aria-label={scanMoney(value, currency)}
      aria-live="off"
      className="tabular-nums"
    >
      <span>{whole}</span>
      <span className={centsClassName}>{cents}</span>
    </span>
  );
}

const staggered = new Set<string>();

/** Staggers a list's cards in the first time it has any, once per visit to the
 *  app. Put the ref on the cards' parent. */
export function useStaggerIn<T extends HTMLElement>(name: string, ready: boolean) {
  const scope = useRef<T>(null);
  useGSAP(
    () => {
      if (!ready || staggered.has(name)) return;
      staggered.add(name);
      if (prefersReducedMotion()) return;
      const cards = Array.from(scope.current?.children ?? []);
      gsap.from(cards, {
        y: 12,
        opacity: 0,
        duration: durations.base,
        ease: eases.out,
        stagger: listStagger(cards.length),
        clearProps: "transform,opacity",
      });
    },
    { scope, dependencies: [ready] }
  );
  return scope;
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
        src={tabbyArt(v3(mood))}
        alt=""
        className="h-full w-full scale-[1.32] object-cover object-[50%_28%]"
      />
    </span>
  );
}
/** A person on a tab: initials on tinted glass, one of five tints chosen from
 *  the name so the same person always looks the same. You keep Tabby's face. */
export function Person({
  name,
  size = 38,
  me = false,
}: {
  name: string;
  size?: number;
  me?: boolean;
}) {
  if (me) return <Cat mood="cool" size={size} />;
  const clean = (name || "?").trim();
  const words = clean.split(/\s+/);
  const initials = (
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : clean.slice(0, 2)
  ).toUpperCase();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return (
    <span
      className="person-avatar grid shrink-0 place-items-center rounded-full font-bold"
      data-tone={hash % 5}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials}
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
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-glass-soft">
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
  inactive = false,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
  /** Another sheet is above this one; keep it visible as context, but non-interactive. */
  inactive?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(scope.current, { opacity: 0, duration: durations.fast, clearProps: "opacity" });
      // clearProps hands the transform back: wide screens rely on the sheet's own.
      gsap.from(".full-sheet", {
        y: 40,
        duration: durations.base,
        ease: eases.spring,
        clearProps: "transform",
      });
    },
    { scope }
  );
  return (
    <div
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-hidden={inactive || undefined}
      className={`app-overlay fixed inset-0 z-[70] mx-auto flex max-w-[467px] items-end bg-black/45 ${
        inactive ? "pointer-events-none" : ""
      }`}
    >
      <button className="absolute inset-0" aria-label="Close" tabIndex={-1} onClick={close} />
      <section className="ios-surface full-sheet relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-[30px] px-5 pb-8 pt-4">
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-black/15" />
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h2 className="text-[24px] font-semibold tracking-[-.04em]">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[12px] leading-relaxed text-glass-soft">{subtitle}</p>
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
/** The shop's logo when we know it, otherwise the category icon. */
export function ReceiptMark({
  item,
  size,
  className,
}: {
  item: Receipt;
  size: number;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const logo = failed ? null : brandLogo(item.merchant);
  return (
    <span
      data-flip-id={`${item.id}-icon`}
      className={`${logo ? "brand-tile" : `demo-${item.tone}`} ${className}`}
    >
      {logo ? (
        <img src={logo} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon name={item.icon} size={size} />
      )}
    </span>
  );
}

export function ReceiptRow({ item, onClick }: { item: Receipt; onClick?: () => void }) {
  return (
    <button
      onClick={(event) => {
        holdFlip(item.id, event.currentTarget);
        onClick?.();
      }}
      className="receipt-row -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[14px] px-2 py-3.5 text-left"
    >
      <ReceiptMark
        item={item}
        size={21}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
      />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[15px]">{shopName(item.merchant)}</b>
        <span className="block truncate text-[12px] text-glass-soft">{item.note}</span>
      </span>
      <span className="text-right">
        <b className="block text-[15px]">
          <span data-flip-id={`${item.id}-total`} className="inline-block">
            {item.amount}
          </span>
        </b>
        {/* Your share only says something when it differs from the total. */}
        {item.mine !== `${item.amount} yours` && (
          <span className="block text-[11px] font-semibold text-glass-soft">{item.mine}</span>
        )}
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
      {/* On wide screens the sidebar is the way back to Today. */}
      <button
        onClick={back}
        className={`flex min-h-10 items-center gap-1 text-[13px] font-bold text-glass-pos ${backLabel === "Today" ? "lg:hidden" : ""}`}
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
