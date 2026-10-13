"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { InsightsCard } from "@/components/InsightsCard";
import { SpendCharts } from "@/components/SpendCharts";
import { ErrorNote, Meter, PageSkeleton, Section, Slip, SlipLine } from "@/components/ui";
import {
  type BudgetState,
  type DashboardSummary,
  type Receipt,
  type UploadResult,
} from "@/lib/api";
import {
  FAILED_LIST,
  HOME_LIST,
  HOME_PREVIEW,
  useMe,
  useReceiptPreview,
  useSummary,
} from "@/lib/data";
import { amount, categoryLabel, greeting, money } from "@/lib/format";
import { routes } from "@/lib/routes";
import { UPLOADED_EVENT } from "@/lib/upload";

type Attention = {
  key: string;
  href: string;
  title: string;
  sub: string;
  value: string;
  tone: "blush" | "mint" | "gold";
};

/** Things that need the person, most urgent first. Empty means all clear. */
function attentionItems(
  summary: DashboardSummary | null,
  failed: Receipt[],
  failedTotal: number
): Attention[] {
  const items: Attention[] = [];
  for (const r of failed.slice(0, 2)) {
    items.push({
      key: `failed-${r.id}`,
      href: routes.receipt(r.id),
      title: "We couldn't read a receipt",
      sub: "Retry it or type it in",
      value: "Fix",
      tone: "blush",
    });
  }
  if (failedTotal > 2) {
    items.push({
      key: "failed-more",
      href: `${routes.tab}?status=failed`,
      title: `${failedTotal - 2} more couldn't be read`,
      sub: "See them on your tab",
      value: "Open",
      tone: "blush",
    });
  }
  for (const b of summary?.budget_health.filter((x) => x.over_budget).slice(0, 2) ?? []) {
    items.push({
      key: `over-${b.category}`,
      href: routes.budgets,
      title: `${categoryLabel(b.category)} is over budget`,
      sub: `${money(b.spent)} of ${money(b.limit)}`,
      value: `${Math.round(b.percent_used)}%`,
      tone: "gold",
    });
  }
  if (summary && summary.pending_review > 0) {
    items.push({
      key: "review",
      href: `${routes.tab}?status=extracted`,
      title: `${summary.pending_review} receipt${summary.pending_review === 1 ? "" : "s"} to check`,
      sub: "Confirm what Cotab read",
      value: "Review",
      tone: "mint",
    });
  }
  return items;
}

function changeVsLastMonth(summary: DashboardSummary): string | null {
  const t = summary.monthly_trend;
  if (t.length < 2) return null;
  const prev = t[t.length - 2].amount;
  const curr = t[t.length - 1].amount;
  if (prev <= 0) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return "About the same as last month so far";
  return `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than last month so far`;
}

const toneClass = { blush: "bg-blush", mint: "bg-mint", gold: "bg-gold/60" } as const;

export default function Home() {
  const { data: user } = useMe();
  const summaryQ = useSummary(6);
  const recentQ = useReceiptPreview(HOME_LIST, HOME_PREVIEW);
  const failedQ = useReceiptPreview(FAILED_LIST, 2);
  const summary = summaryQ.data ?? null;
  const recent = (recentQ.data?.rows ?? []).filter((x) => x.status !== "failed").slice(0, 5);
  const failed = failedQ.data?.rows ?? [];
  const failedTotal = failedQ.data?.total ?? 0;
  const error = summaryQ.error ?? recentQ.error;
  const [alerts, setAlerts] = useState<BudgetState[]>([]);

  // Budget alerts that a fresh scan just tripped. (Refreshing the data after
  // a scan is the app shell's job.)
  useEffect(() => {
    const onUploaded = (event: Event) => {
      const result = (event as CustomEvent<UploadResult>).detail;
      if (result?.budget_alerts?.length) setAlerts(result.budget_alerts);
    };
    window.addEventListener(UPLOADED_EVENT, onUploaded);
    return () => window.removeEventListener(UPLOADED_EVENT, onUploaded);
  }, []);

  if (!user || (summaryQ.loading && recentQ.loading)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        <PageSkeleton />
      </main>
    );
  }

  const firstName = (user?.full_name || user?.email || "").split(/[\s@]/)[0];
  const today = new Date()
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
  const needs = attentionItems(summary, failed, failedTotal);
  const change = summary ? changeVsLastMonth(summary) : null;
  const recentTotal = recent.reduce((sum, r) => sum + r.total, 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted">{today}</p>
          <h1 className="mt-1 text-2xl font-bold">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <Link
          href={routes.settings}
          aria-label="Settings"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-base font-bold text-gold"
        >
          {(firstName || "?").charAt(0).toUpperCase()}
        </Link>
      </header>

      {error && <ErrorNote>Couldn&apos;t load everything: {error.message}</ErrorNote>}

      {alerts.length > 0 && (
        <div role="status" className="rise mb-6 rounded-card border border-ink bg-gold/40 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="font-semibold">
              {alerts.length === 1
                ? "A budget just crossed a line"
                : `${alerts.length} budgets just crossed a line`}
            </p>
            <button
              type="button"
              onClick={() => setAlerts([])}
              aria-label="Dismiss budget alerts"
              className="h-8 w-8 rounded-full text-lg leading-none hover:bg-ink/10"
            >
              ×
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {alerts.map((b) => (
              <li key={b.budget_id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{b.label}</span>
                  <span>
                    {money(b.spent)} of {money(b.limit)}
                  </span>
                </div>
                <Meter percent={b.percent_used} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <section className="mb-8 rounded-card bg-gold p-5">
          <p className="font-semibold">Spent this month</p>
          <p className="mt-2 font-display text-5xl">
            {money(summary.this_month.total_spent, summary.this_month.currency)}
          </p>
          <p className="mt-2 text-sm">
            {summary.this_month.receipt_count} purchase
            {summary.this_month.receipt_count === 1 ? "" : "s"}
            {change ? `. ${change}.` : ""}
          </p>
        </section>
      )}

      <Section title="Needs you">
        {needs.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-4 text-sm">
            All clear. Nothing needs you right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {needs.map((n) => (
              <li key={n.key}>
                <Link
                  href={n.href}
                  className={`flex min-h-16 items-center gap-3 rounded-card px-4 py-3 ${toneClass[n.tone]}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{n.title}</span>
                    <span className="block text-sm">{n.sub}</span>
                  </span>
                  <span className="font-bold">{n.value}</span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Latest on your tab"
        action={
          <Link
            href={routes.tab}
            className="py-2 text-sm font-semibold underline underline-offset-4"
          >
            See full tab
          </Link>
        }
      >
        {recent.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-4 text-sm">
            Nothing yet. Tap the gold Scan button to add your first receipt.
          </p>
        ) : (
          <Slip>
            {recent.map((r) => (
              <Link key={r.id} href={routes.receipt(r.id)} className="block hover:bg-gold/30">
                <SlipLine name={r.merchant || "Receipt"} amount={amount(r.total)} />
              </Link>
            ))}
            <div className="mt-2 border-t border-dashed border-muted/60 pt-2">
              <SlipLine name="TOTAL" amount={amount(recentTotal)} strong />
            </div>
          </Slip>
        )}
      </Section>

      {summary && summary.budget_health.length > 0 && (
        <Section
          title="Budgets"
          action={
            <Link
              href={routes.budgets}
              className="py-2 text-sm font-semibold underline underline-offset-4"
            >
              Manage
            </Link>
          }
        >
          <ul className="flex flex-col gap-4">
            {summary.budget_health.slice(0, 4).map((b) => (
              <li key={b.category}>
                <div className="mb-1.5 flex justify-between gap-3 text-sm">
                  <span>{b.category === "total" ? "Everything" : categoryLabel(b.category)}</span>
                  <span className={b.over_budget ? "font-semibold text-rose" : ""}>
                    {money(b.spent)} of {money(b.limit)}
                    {b.over_budget ? ", over" : b.percent_used >= 80 ? ", close" : ""}
                  </span>
                </div>
                <Meter percent={b.percent_used} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <InsightsCard />

      {summary && summary.this_month.receipt_count > 0 && (
        <Section title="Where it went">
          <SpendCharts summary={summary} />
        </Section>
      )}
    </main>
  );
}
