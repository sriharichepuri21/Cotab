"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardSummary } from "@/lib/api";

/**
 * Charts are client-only and sized by ResponsiveContainer, which needs a parent
 * with a real height — hence the fixed h-64 wrappers. Without that the SVG
 * collapses to zero height and renders nothing, silently.
 */

// Colour-blind-safe qualitative ramp; distinguishable without relying on hue
// alone since each slice is also labelled.
const SLICE_COLORS = [
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#c2410c",
  "#15803d",
  "#a16207",
  "#be123c",
  "#4b5563",
];

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
  const categories = summary.categories.slice(0, 8);

  const hasTrend = trend.some((t) => t.amount > 0);
  const hasCategories = categories.length > 0;
  if (!hasTrend && !hasCategories) return null;

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Monthly spending</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend} // left:0 — a negative left margin pulled the Y axis off-canvas and clipped
              // the currency symbol at mobile widths.
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v) => axisMoney(Number(v), cur)}
              />
              <Tooltip
                formatter={(v) => money(Number(v), cur)}
                labelFormatter={(l) => String(l)}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Where it went this month</h2>
        {hasCategories ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius="45%"
                  outerRadius="75%"
                  paddingAngle={2}
                  // Labels outside the donut: inside-slice text is unreadable on
                  // mobile once a category drops below ~10%.
                  label={({ name }) => name}
                  labelLine={false}
                >
                  {categories.map((c, i) => (
                    <Cell key={c.name} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, n) => [money(Number(v), cur), String(n)]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-gray-400">
            No spending recorded this month yet.
          </p>
        )}
      </section>
    </div>
  );
}
