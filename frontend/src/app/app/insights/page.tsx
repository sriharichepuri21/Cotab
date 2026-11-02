"use client";

import Link from "next/link";
import { useState } from "react";

import { CatAvatar } from "@/components/Tabby";
import { ErrorNote, Icon, PageSkeleton } from "@/components/ui";
import { shopName } from "@/lib/brands";
import type { BudgetState, TabbyMood } from "@/lib/api";
import { useBudgets, useSummary } from "@/lib/data";
import { categoryLabel, categoryStyle, money, monthProgress } from "@/lib/format";
import { routes } from "@/lib/routes";

const RANGES = [
  { months: 3, label: "3M" },
  { months: 6, label: "6M" },
  { months: 12, label: "1Y" },
];

function monthName(ym: string, style: "short" | "long" = "short") {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: style,
    timeZone: "UTC",
  });
}

/** Whole dollars for chart labels: "$1,240". */
function round(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

export default function InsightsPage() {
  const [months, setMonths] = useState(6);
  const summaryQ = useSummary(months);
  const budgets = useBudgets().data ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const summary = summaryQ.data;

  if (!summary) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        {summaryQ.error ? <ErrorNote>{summaryQ.error.message}</ErrorNote> : <PageSkeleton />}
      </main>
    );
  }

  const currency = summary.this_month.currency;
  const trend = summary.monthly_trend;
  const index = picked !== null && picked < trend.length ? picked : trend.length - 1;
  const selected = trend[index];
  const prev = index > 0 ? trend[index - 1] : null;
  const delta = prev && prev.amount > 0 ? (selected.amount - prev.amount) / prev.amount : null;
  const top = Math.max(1, ...trend.map((t) => t.amount));
  const avg = trend.length ? trend.reduce((s, t) => s + t.amount, 0) / trend.length : 0;
  const cats = summary.categories.filter((c) => c.amount > 0);
  const catTotal = cats.reduce((s, c) => s + c.amount, 0) || 1;
  const shown = cats.slice(0, 4);
  const rest = cats.slice(4).reduce((s, c) => s + c.amount, 0);
  const slices = rest > 0 ? [...shown, { name: "other", amount: rest }] : shown;
  const isNow = index === trend.length - 1;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-8 md:px-8 md:pt-10">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-[30px]">Insights</h1>
        <Link
          href={routes.tab}
          className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-sm font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.05)]"
        >
          <Icon name="receipt_long" size={20} />
          All receipts
        </Link>
      </header>

      <div
        role="tablist"
        aria-label="Time range"
        className="mt-5 grid grid-cols-3 rounded-full bg-ink/[0.05] p-1"
      >
        {RANGES.map((r) => (
          <button
            key={r.months}
            type="button"
            role="tab"
            aria-selected={months === r.months}
            onClick={() => {
              setMonths(r.months);
              setPicked(null);
            }}
            className={`h-9 rounded-full text-sm font-bold transition ${
              months === r.months
                ? "bg-card text-ink shadow-[0_2px_8px_-2px_rgb(12_17_14/0.15)]"
                : "text-faint"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-card bg-card p-5">
        <p className="text-sm font-semibold text-muted">
          {isNow
            ? `Spent so far in ${monthName(selected.month, "long")}`
            : `Spent in ${monthName(selected.month, "long")}`}
        </p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[38px] font-extrabold leading-none tracking-[-0.05em]">
            {money(selected.amount, currency)}
          </span>
          {delta !== null && Math.abs(delta) >= 0.01 && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                delta < 0 ? "bg-mint text-good" : "bg-blush text-rose"
              }`}
            >
              {delta < 0 ? "↓" : "↑"} {Math.abs(Math.round(delta * 100))}% vs{" "}
              {monthName(prev!.month)}
            </span>
          )}
        </div>
        <div className="relative mt-6 flex h-40 items-end gap-2">
          {avg > 0 && (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-dashed border-ink/20"
                style={{ bottom: `${(avg / top) * 100}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute right-0 -translate-y-full pb-0.5 text-[11px] font-bold text-faint"
                style={{ bottom: `${(avg / top) * 100}%` }}
              >
                avg
              </span>
            </>
          )}
          {trend.map((t, i) => {
            const on = i === index;
            return (
              <button
                key={t.month}
                type="button"
                onClick={() => setPicked(i)}
                aria-label={`${monthName(t.month, "long")}: ${money(t.amount, currency)}`}
                aria-pressed={on}
                className="relative flex h-full flex-1 items-end"
              >
                <span
                  className={`bar-grow relative block w-full rounded-[10px] ${on ? "bg-forest" : "bg-[#E4E8E3] hover:bg-[#D5DBD5]"}`}
                  style={{ height: `${Math.max(3, (t.amount / top) * 100)}%` }}
                >
                  {on && (
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2 py-1 text-[11px] font-bold text-white">
                      {round(t.amount, currency)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          {trend.map((t, i) => (
            <span
              key={t.month}
              className={`flex-1 text-center text-xs ${i === index ? "font-extrabold text-ink" : "font-semibold text-faint"}`}
            >
              {trend.length > 6 ? monthName(t.month).charAt(0) : monthName(t.month)}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-card bg-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold tracking-[-0.02em]">Where it went</h2>
          <span className="text-sm font-semibold text-faint">This month</span>
        </div>
        {slices.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing this month yet.</p>
        ) : (
          <>
            <div
              role="img"
              aria-label={slices
                .map((c) => `${categoryLabel(c.name)} ${Math.round((c.amount / catTotal) * 100)}%`)
                .join(", ")}
              className="mt-4 flex h-3.5 gap-1 overflow-hidden"
            >
              {slices.map((c) => (
                <span
                  key={c.name}
                  className="bar-fill rounded-full"
                  style={{
                    width: `${(c.amount / catTotal) * 100}%`,
                    background: categoryStyle(c.name).bar,
                  }}
                />
              ))}
            </div>
            <ul className="mt-4">
              {slices.map((c, i) => (
                <li
                  key={c.name}
                  className={`flex items-center gap-3 py-2.5 ${i ? "border-t border-line" : ""}`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: categoryStyle(c.name).bar }}
                  />
                  <Link
                    href={`${routes.tab}?category=${encodeURIComponent(c.name)}`}
                    className="flex-1 text-[15px] font-bold"
                  >
                    {categoryLabel(c.name)}
                  </Link>
                  <span className="text-[15px] font-extrabold">{money(c.amount, currency)}</span>
                  <span className="w-10 text-right text-[13px] font-semibold text-faint">
                    {Math.round((c.amount / catTotal) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {summary.merchants.length > 0 && (
        <section className="mt-4 rounded-card bg-card p-5">
          <h2 className="text-lg font-extrabold tracking-[-0.02em]">Top places</h2>
          <ul className="mt-2">
            {summary.merchants.slice(0, 5).map((m, i) => (
              <li
                key={m.name}
                className={`flex items-center gap-3 py-2.5 ${i ? "border-t border-line" : ""}`}
              >
                <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-paper text-sm font-extrabold">
                  {shopName(m.name).charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-[15px] font-bold">{shopName(m.name)}</span>
                <span className="text-[15px] font-extrabold">{money(m.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Budgets</h2>
        <Link
          href={routes.budgets}
          className="text-sm font-bold text-forest underline underline-offset-[3px]"
        >
          {budgets.length ? "Manage" : "Set one"}
        </Link>
      </div>
      {budgets.length === 0 ? (
        <Link
          href={routes.budgets}
          className="press mt-3 flex items-center gap-3 rounded-card border-[1.5px] border-dashed border-[#B9C0BB] p-4"
        >
          <CatAvatar choice={{ look: "hoodie", mood: "hi", bg: "mood" }} size={46} soft />
          <span>
            <span className="block text-[15px] font-bold">Give Tabby a number to watch</span>
            <span className="block text-[13px] text-faint">
              A monthly total, or one for coffee, groceries, anything.
            </span>
          </span>
        </Link>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {budgets.map((b) => (
            <BudgetTile key={b.budget_id} budget={b} />
          ))}
        </div>
      )}
    </main>
  );
}

function BudgetTile({ budget: b }: { budget: BudgetState }) {
  const style = categoryStyle(b.level === "total" ? "total" : b.target);
  const { done } = monthProgress();
  const share = b.limit ? b.spent / b.limit : 0;
  const mood: TabbyMood | null = b.over_budget ? "over-budget" : share > done + 0.1 ? "hmm" : null;
  const fill = b.over_budget ? "#C8373C" : mood === "hmm" ? "#E8A33B" : "#0F3D31";
  return (
    <Link href={routes.budgets} className="press rounded-card bg-card p-4">
      <div className="flex items-center justify-between">
        <span
          className="grid h-9 w-9 place-items-center rounded-[12px]"
          style={{ background: style.tile, color: style.ink }}
        >
          <Icon name={style.icon} fill size={20} />
        </span>
        {mood ? (
          <CatAvatar
            choice={{ look: "hoodie", mood, bg: "mood" }}
            size={30}
            label={b.over_budget ? "Over budget" : "Getting close"}
          />
        ) : (
          <span className="text-xs font-bold text-faint">{Math.round(b.percent_used)}%</span>
        )}
      </div>
      <p className="mt-3 truncate text-sm font-bold">{b.label}</p>
      <p className="mt-0.5 text-[15px] font-extrabold">
        {money(b.spent)}{" "}
        <span className="text-xs font-semibold text-faint">/ {money(b.limit)}</span>
      </p>
      <div className="mt-2.5 h-1.5 rounded-full bg-ink/[0.07]">
        <span
          className="bar-fill block h-full rounded-full"
          style={{ width: `${Math.min(100, b.percent_used)}%`, background: fill }}
        />
      </div>
    </Link>
  );
}
