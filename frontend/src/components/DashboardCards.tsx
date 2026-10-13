import Link from "next/link";

import type { DashboardSummary } from "@/lib/api";
import { routes } from "@/lib/routes";

/**
 * The four numbers worth seeing before anything else.
 *
 * Each card states what it is even when it has no data, rather than rendering a
 * blank tile — "No spend yet" is information; an empty box looks broken.
 */

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      // narrowSymbol: "US$296.59" truncated inside the card on mobile.
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown/garbage currency code from an OCR'd receipt shouldn't crash the page.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function Card({
  label,
  value,
  sub,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn";
  href?: string;
}) {
  const body = (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm transition ${
        tone === "warn" ? "border-amber-300" : "border-gray-200"
      } ${href ? "hover:border-blue-400 hover:shadow" : ""}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 truncate text-sm text-gray-500">{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardCards({ summary }: { summary: DashboardSummary }) {
  const { this_month, top_category, top_merchant, pending_review } = summary;
  const cur = this_month.currency;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card
        label="This month"
        value={money(this_month.total_spent, cur)}
        sub={`${this_month.receipt_count} receipt${this_month.receipt_count === 1 ? "" : "s"}`}
      />
      <Card
        label="Top category"
        value={top_category ? top_category.name : "—"}
        sub={top_category ? money(top_category.amount, cur) : "No spend yet"}
      />
      <Card
        label="Top merchant"
        value={top_merchant ? top_merchant.name : "—"}
        sub={top_merchant ? money(top_merchant.amount, cur) : "No spend yet"}
      />
      {summary.budget_alerts.length > 0 ? (
        <Card
          label="Budget alerts"
          value={String(summary.budget_alerts.length)}
          sub={summary.budget_alerts[0].label}
          tone="warn"
          href={routes.budgets}
        />
      ) : (
        <Card
          label="Pending review"
          value={String(pending_review)}
          sub={pending_review ? "Tap to review" : "All caught up"}
          tone={pending_review > 0 ? "warn" : "default"}
          href={pending_review > 0 ? `${routes.home}?status=extracted` : undefined}
        />
      )}
    </div>
  );
}

export function BudgetHealth({ summary }: { summary: DashboardSummary }) {
  if (!summary.budget_health.length) {
    // No budgets at all: point at the feature rather than rendering nothing,
    // since an absent section is indistinguishable from a broken one.
    return (
      <section className="mb-6 rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-gray-500">
          No budgets yet — set one and every upload gets checked against it.
        </p>
        <Link
          href={routes.budgets}
          className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Set a budget
        </Link>
      </section>
    );
  }
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Budget health</h2>
        <Link
          href={routes.budgets}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Manage
        </Link>
      </div>
      <ul className="space-y-3">
        {summary.budget_health.map((b) => (
          <li key={b.category}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="capitalize text-gray-700">{b.category}</span>
              <span
                className={`tabular-nums ${
                  b.over_budget ? "font-semibold text-red-600" : "text-gray-500"
                }`}
              >
                {money(b.spent, summary.this_month.currency)} /{" "}
                {money(b.limit, summary.this_month.currency)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${b.over_budget ? "bg-red-500" : "bg-blue-500"}`}
                // Cap the bar at 100% so an overspend doesn't overflow the track;
                // the number above still shows the real figure.
                style={{ width: `${Math.min(b.percent_used, 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
