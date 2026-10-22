/** Money and dates, formatted the same way on every screen. */

export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Plain amount for receipt lines, where the currency is implied: 1,240.18 */
export function amount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", or "Sat Oct 10" for grouping a list by day. */
export function dayLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No date";
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function categoryLabel(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : "Other";
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Icon and tile colours for each spending category, shared by every list. */
export const CATEGORY_STYLE: Record<
  string,
  { icon: string; tile: string; ink: string; bar: string }
> = {
  groceries: { icon: "shopping_basket", tile: "#EEF7CF", ink: "#4D6B05", bar: "#A9CC2E" },
  dining: { icon: "restaurant", tile: "#F1E9DF", ink: "#7A4E25", bar: "#C08A55" },
  transport: { icon: "local_gas_station", tile: "#FCE9E6", ink: "#B4321F", bar: "#E46A4F" },
  utilities: { icon: "bolt", tile: "#FBEFD3", ink: "#8A5A00", bar: "#E8A33B" },
  rent: { icon: "home", tile: "#E2EEF9", ink: "#1F5C99", bar: "#5CB7F2" },
  entertainment: { icon: "live_tv", tile: "#ECE8FA", ink: "#5B3FB8", bar: "#8E78E0" },
  health: { icon: "favorite", tile: "#FCE6E9", ink: "#B42343", bar: "#FF5C7C" },
  shopping: { icon: "shopping_bag", tile: "#E2F1E5", ink: "#2F7D49", bar: "#2F7D49" },
  travel: { icon: "flight", tile: "#DCF3EF", ink: "#13706A", bar: "#3FB5A8" },
  other: { icon: "receipt_long", tile: "#E7ECEA", ink: "#0C110E", bar: "#8B928E" },
  total: { icon: "account_balance_wallet", tile: "#E2F1E5", ink: "#0F3D31", bar: "#0F3D31" },
};
export const categoryStyle = (id: string) => CATEGORY_STYLE[id] ?? CATEGORY_STYLE.other;

/** "$1,284" and ".50" separately, so cents can be drawn quieter. */
export function splitMoney(value: number, currency = "USD"): [string, string] {
  const full = money(value, currency);
  const dot = full.lastIndexOf(".");
  return dot < 0 ? [full, ""] : [full.slice(0, dot), full.slice(dot)];
}

/** Share of the current month already gone, 0–1. */
export function monthProgress(now = new Date()): { done: number; daysLeft: number } {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  return { done: day / days, daysLeft: days - day };
}
