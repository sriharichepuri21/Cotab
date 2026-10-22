"use client";

import { useState } from "react";

import { CatAvatar } from "@/components/Tabby";
import { Icon } from "@/components/ui";
import type { LineItem, PricedItem, PriceMemory } from "@/lib/api";
import { amount, money } from "@/lib/format";

function shortDate(iso?: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Tabby's one line about this receipt's prices. */
export function PriceTabby({ memory }: { memory: PriceMemory }) {
  if (!memory.tabby.text) return null;
  const tone =
    memory.tabby.mood === "bill-shock"
      ? "bg-blush"
      : memory.tabby.mood === "cool"
        ? "bg-mint"
        : memory.tabby.mood === "hmm"
          ? "bg-[#FBEFD3]"
          : "bg-paper";
  return (
    <div className={`mt-4 flex items-start gap-3 rounded-[20px] p-3.5 ${tone}`} role="status">
      <CatAvatar choice={{ look: "hoodie", mood: memory.tabby.mood, bg: "mood" }} size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">{memory.tabby.text}</p>
        {memory.trip_change !== null && memory.compared > 1 && (
          <p className="mt-1 text-[12px] font-bold text-muted">
            {Math.abs(memory.trip_change) < 0.01
              ? `Same total as last time for the ${memory.compared} items you've bought here before`
              : `The ${memory.compared} items you've bought here before cost ${money(Math.abs(memory.trip_change), memory.currency)} ${memory.trip_change > 0 ? "more" : "less"} than last time`}
          </p>
        )}
      </div>
    </div>
  );
}

/** The small note under a line: usual price, up, down, or worth a look. */
function badge(item: PricedItem, currency: string) {
  const since = shortDate(item.last_date);
  switch (item.status) {
    case "check":
      return {
        cls: "bg-blush text-rose",
        icon: "error",
        text: `Usually ${money(item.usual_price ?? 0, currency)} here`,
      };
    case "up":
      return {
        cls: "bg-[#FBEFD3] text-[#8A5A00]",
        icon: "trending_up",
        text: `+${money(item.change ?? 0, currency)} since ${since}`,
      };
    case "down":
      return {
        cls: "bg-mint text-good",
        icon: "trending_down",
        text: `${money(Math.abs(item.change ?? 0), currency)} cheaper than ${since}`,
      };
    case "same":
      return { cls: "bg-paper text-muted", icon: "check", text: "Your usual price" };
    default:
      return null;
  }
}

/**
 * The item lines of a receipt, each with what Tabby remembers about its
 * price. Tapping a line that has history shows the earlier visits.
 */
export function PricedLines({
  lines,
  memory,
}: {
  lines: LineItem[];
  memory: PriceMemory | null | undefined;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const byLine = new Map<string, PricedItem>();
  const firstLine = new Set<string>();
  for (const item of memory?.items ?? []) {
    item.line_ids.forEach((id, i) => {
      byLine.set(id, item);
      if (i === 0) firstLine.add(id);
    });
  }
  const currency = memory?.currency ?? "USD";

  return (
    <ul className="mt-2">
      {lines.map((li, i) => {
        const item = byLine.get(li.id);
        const lead = firstLine.has(li.id);
        const note = item && lead ? badge(item, currency) : null;
        const hasHistory = Boolean(item && lead && item.history.length);
        const expanded = hasHistory && open === li.id;
        const name = li.item_name || li.description || "Item";
        const printed = li.item_name && li.item_name !== li.description ? li.description : null;
        const sub = [li.item_code, printed].filter(Boolean).join(" · ");
        const body = (
          <>
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 text-[15px] font-semibold">
                {name}
                {li.quantity !== 1 && (
                  <span className="ml-1.5 text-[13px] font-semibold text-faint">
                    × {li.quantity}
                  </span>
                )}
              </span>
              <span className={`text-[15px] font-bold ${li.total_price < 0 ? "text-good" : ""}`}>
                {amount(li.total_price)}
              </span>
            </span>
            {sub && (
              <span className="mt-0.5 block truncate text-[12px] font-medium text-faint">
                {sub}
              </span>
            )}
            {note && (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1.5 pr-2.5 text-[12px] font-bold ${note.cls}`}
                >
                  <Icon name={note.icon} size={15} />
                  {note.text}
                </span>
                {item?.more_than_usual && (
                  <span className="whitespace-nowrap rounded-full bg-paper px-2 py-0.5 text-[12px] font-bold text-muted">
                    ×{item.quantity} today · usually {item.usual_quantity}
                  </span>
                )}
                {hasHistory && (
                  <Icon
                    name={expanded ? "expand_less" : "expand_more"}
                    size={18}
                    className="text-faint"
                  />
                )}
              </span>
            )}
          </>
        );
        return (
          <li key={li.id} className={i ? "border-t border-line" : ""}>
            {hasHistory ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : li.id)}
                className="block w-full py-2.5 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="py-2.5">{body}</div>
            )}
            {expanded && item && <History item={item} currency={currency} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Earlier visits for one item, newest first, with this one on top. */
function History({ item, currency }: { item: PricedItem; currency: string }) {
  const points = [...item.history].reverse();
  const top = Math.max(item.price, ...points.map((p) => p.price)) || 1;
  const row = (label: string, price: number, now = false) => (
    <li key={label + price} className="flex items-center gap-3 py-1">
      <span
        className={`w-16 shrink-0 text-[12px] ${now ? "font-extrabold" : "font-semibold text-faint"}`}
      >
        {label}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
        <span
          className={`bar-fill block h-full rounded-full ${now ? "bg-forest" : "bg-[#C9D3CC]"}`}
          style={{ width: `${(price / top) * 100}%` }}
        />
      </span>
      <span className={`w-16 text-right text-[13px] ${now ? "font-extrabold" : "font-semibold"}`}>
        {money(price, currency)}
      </span>
    </li>
  );
  return (
    <div className="rise mb-3 rounded-[16px] bg-paper p-3">
      <ul>
        {row("Today", item.price, true)}
        {points.map((p) => row(shortDate(p.date), p.price))}
      </ul>
      <p className="mt-1.5 text-[12px] font-semibold text-muted">
        Bought here {item.times} time{item.times === 1 ? "" : "s"} before · usually{" "}
        {money(item.usual_price ?? 0, currency)} · lowest {money(item.lowest_price ?? 0, currency)}
        {item.discounted ? " · discount applied today" : ""}
      </p>
    </div>
  );
}
