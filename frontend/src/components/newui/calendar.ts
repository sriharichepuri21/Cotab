import type { InsightReceipt } from "@/lib/api";

export type SpendDay = { day: string; total: number; rows: InsightReceipt[] };

/** The date printed on a receipt, as the server stored it (no timezone shift). */
export const dayOf = (r: InsightReceipt) => (r.purchased_at ?? r.created_at ?? "").slice(0, 10);

/** Your share per day. Only `currency` adds up; other currencies are listed
 *  on their day but never added in. */
export function spendByDay(rows: InsightReceipt[], currency: string) {
  const days = new Map<string, SpendDay>();
  for (const r of rows) {
    const key = dayOf(r);
    if (!key) continue;
    const entry = days.get(key) ?? { day: key, total: 0, rows: [] };
    entry.rows.push(r);
    if ((r.currency || "USD") === currency)
      entry.total = Math.round((entry.total + (r.my_share ?? r.total)) * 100) / 100;
    days.set(key, entry);
  }
  return days;
}

/** A month as calendar cells, Sunday first; null pads the first week. */
export function monthCells(month: string): Array<string | null> {
  const [y, m] = month.split("-").map(Number);
  const pad = new Date(y, m - 1, 1).getDay();
  const count = new Date(y, m, 0).getDate();
  return [
    ...Array<null>(pad).fill(null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
}

/** 0 for no spending, then 1–4 by where the day ranks in the month, so one
 *  rent payment doesn't wash every other day out. */
export function heat(total: number, all: number[]) {
  const ranked = [...all].sort((a, b) => a - b);
  const below = ranked.findIndex((t) => t >= total);
  return below < 0 ? 0 : Math.ceil(((below + 1) / ranked.length) * 4);
}

/** A local day as YYYY-MM-DD. */
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const monthOf = (d: Date) => iso(d).slice(0, 7);

/** Move a YYYY-MM month by whole months. */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(y, m - 1 + by, 1));
}

/** The last seven days up to today, oldest first. */
export function lastSeven(days: Map<string, SpendDay>, now = new Date()) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i);
    return {
      day: iso(d),
      label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
      total: days.get(iso(d))?.total ?? 0,
    };
  });
}
