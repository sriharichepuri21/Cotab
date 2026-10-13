import type { BudgetState } from "@/lib/api";

/** narrowSymbol keeps this "$50" not "US$50" — the wide form overflows the row
 *  label on mobile. Same reasoning as the dashboard cards. */
export function money(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const LEVEL_STYLE: Record<string, string> = {
  total: "bg-gray-100 text-gray-700",
  category: "bg-blue-50 text-blue-700",
  merchant: "bg-purple-50 text-purple-700",
  item: "bg-teal-50 text-teal-700",
};

/** The level is a badge rather than part of the label, so "groceries" reads as
 *  "groceries" and the taxonomy stays out of the sentence. */
export function LevelBadge({ level }: { level: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        LEVEL_STYLE[level] ?? LEVEL_STYLE.category
      }`}
    >
      {level}
    </span>
  );
}

/**
 * One budget as a progress row.
 *
 * The bar is capped at 100% so an overspend can't overflow its track, but the
 * numbers above it always show the true figure — clamping the bar and the label
 * together would hide the overage, which is the one thing worth seeing.
 */
export function BudgetBar({
  state,
  currency = "USD",
  compact = false,
}: {
  state: BudgetState;
  currency?: string;
  compact?: boolean;
}) {
  const warn = state.threshold_reached !== null;
  const barColor = state.over_budget ? "bg-red-500" : warn ? "bg-amber-500" : "bg-blue-500";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate capitalize text-gray-800">{state.label}</span>
          {!compact && <LevelBadge level={state.level} />}
        </span>
        <span
          className={`shrink-0 tabular-nums ${
            state.over_budget ? "font-semibold text-red-600" : "text-gray-500"
          }`}
        >
          {money(state.spent, currency)} / {money(state.limit, currency)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(state.percent_used, 100)}%` }}
        />
      </div>
      {!compact && (
        <p className="mt-1 text-xs text-gray-400">
          {state.percent_used}% of {state.period} budget ·{" "}
          {state.remaining >= 0
            ? `${money(state.remaining, currency)} left`
            : `${money(Math.abs(state.remaining), currency)} over`}
        </p>
      )}
    </div>
  );
}
