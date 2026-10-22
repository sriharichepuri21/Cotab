"use client";

import type { DashboardSummary } from "@/lib/api";

/**
 * Charts are client-only and sized by ResponsiveContainer, which needs a parent
 * with a real height — hence the fixed h-64 wrappers. Without that the SVG
 * collapses to zero height and renders nothing, silently.
 */

/** narrowSymbol keeps this as "$12" rather than "US$12" — the wide form clipped
 *  the Y axis and truncated the summary cards at mobile widths. */
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

/** "2026-08" -> "Aug" — the axis has no room for the year, and the ordering
 *  already makes the sequence obvious. */
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

export function SpendCharts({ summary }: { summary: DashboardSummary }) {
  const cur = summary.this_month.currency;
  const trend = summary.monthly_trend.map((t) => ({
    ...t,
    label: monthLabel(t.month),
  }));
  const categories = summary.categories.slice(0, 6);
  const top = Math.max(1, ...categories.map((c) => c.amount));

  const hasTrend = trend.some((t) => t.amount > 0);
  const hasCategories = categories.length > 0;
  if (!hasTrend && !hasCategories) return null;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {hasCategories && (
        <div>
          <h3 className="mb-3 font-semibold">By category, this month</h3>
          <ul className="flex flex-col gap-3">
            {categories.map((c, i) => (
              <li key={c.name}>
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <span className="capitalize">{c.name}</span>
                  <span className="font-mono">{money(c.amount, cur)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-ink/10">
                  <div
                    className={`h-full rounded-full ${i === 0 ? "bg-gold ring-1 ring-ink/10" : "bg-forest"}`}
                    style={{ width: `${Math.max(3, (c.amount / top) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasTrend && <MonthBars trend={trend} currency={cur} />}
    </div>
  );
}

/**
 * Spending per month as plain bars: past months in ledger green, this month in
 * gold with its amount printed on it. Drawn with divs rather than a chart
 * library, which kept ~100 KB of JavaScript off the Home page.
 */
function MonthBars({
  trend,
  currency,
}: {
  trend: { month: string; label: string; amount: number }[];
  currency: string;
}) {
  const top = Math.max(1, ...trend.map((t) => t.amount));
  const last = trend.length - 1;
  return (
    <div>
      <h3 className="mb-3 font-semibold">Month by month</h3>
      <div className="flex h-48 items-end gap-[2px] border-b border-ink/15" aria-hidden="true">
        {trend.map((t, i) => {
          const now = i === last;
          return (
            <div key={t.month} className="group relative flex h-full flex-1 flex-col justify-end">
              {/* Value: always shown on this month, on hover for the rest. The
                  table below carries every value for screen readers. */}
              <span
                className={`pointer-events-none mb-1 self-center whitespace-nowrap rounded-button px-1.5 py-0.5 font-mono text-xs ${
                  now ? "text-ink" : "invisible bg-forest text-paper group-hover:visible"
                }`}
              >
                {money(t.amount, currency)}
              </span>
              <span
                className={`mx-auto block w-full max-w-12 rounded-t-[4px] ${
                  now
                    ? "bg-gold ring-1 ring-inset ring-ink/10"
                    : "bg-forest group-hover:bg-forest/80"
                }`}
                style={{ height: `${Math.max(2, (t.amount / top) * 82)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-xs text-muted" aria-hidden="true">
        {trend.map((t, i) => (
          <span
            key={t.month}
            className={`flex-1 text-center ${i === last ? "font-semibold text-ink" : ""}`}
          >
            {t.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Spending by month</caption>
        <tbody>
          {trend.map((t) => (
            <tr key={t.month}>
              <th scope="row">{t.label}</th>
              <td>{money(t.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
