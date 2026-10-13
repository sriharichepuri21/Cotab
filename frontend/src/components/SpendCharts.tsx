"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DashboardSummary } from "@/lib/api";

/**
 * Charts are client-only and sized by ResponsiveContainer, which needs a parent
 * with a real height — hence the fixed h-64 wrappers. Without that the SVG
 * collapses to zero height and renders nothing, silently.
 */

// Cotab palette, read from the CSS tokens so charts follow the theme.
const INK = "rgb(var(--c-ink))";
const GOLD = "rgb(var(--c-gold))";
const MUTED = "rgb(var(--c-muted))";

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

/** Axis ticks get compact notation too ("$1.2K"), so a big month still fits. */
function axisMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return `${amount}`;
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
                    className={`h-full rounded-full ${i === 0 ? "bg-gold ring-1 ring-ink" : "bg-ink"}`}
                    style={{ width: `${Math.max(3, (c.amount / top) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasTrend && (
        <div>
          <h3 className="mb-3 font-semibold">Month by month</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trend}
                // left:0 — a negative left margin pulled the Y axis off-canvas
                // and clipped the currency symbol at mobile widths.
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: MUTED }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: MUTED }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => axisMoney(Number(v), cur)}
                />
                <Tooltip
                  cursor={{ fill: "rgb(var(--c-ink) / 0.05)" }}
                  formatter={(v) => money(Number(v), cur)}
                  labelFormatter={(l) => String(l)}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 6,
                    border: `1px solid ${INK}`,
                    color: INK,
                  }}
                />
                <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                  {trend.map((t, i) => (
                    <Cell
                      key={t.month}
                      fill={i === trend.length - 1 ? GOLD : INK}
                      stroke={INK}
                      strokeWidth={i === trend.length - 1 ? 1 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
