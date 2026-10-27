"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useEffect, useState } from "react";

import { Icon } from "@/components/ui";
import { dismissInsight, getMonthReceipts, type InsightReceipt } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { useInsights, useMonth, useSummary } from "@/lib/data";
import { categoryLabel, categoryStyle } from "@/lib/format";
import { BackHeader, DemoSheet, ReceiptRow, receiptFromApi, scanMoney } from "./parts";

const monthLabel = (month: string, style: "short" | "long" = "short") =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", { month: style });

/**
 * Insights: month by month, where your share of spending went. Every figure
 * is the server's (after splits); tapping a category lists what counted.
 */
export function Insights({
  back,
  goBudgets,
  openReceipt,
}: {
  back: () => void;
  goBudgets: () => void;
  openReceipt: (id: string) => void;
}) {
  const summary = useSummary(6);
  const trend = summary.data?.monthly_trend ?? [];
  const latest = trend[trend.length - 1]?.month;
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? latest ?? "";
  const detail = useMonth(month || "none");
  const insights = useInsights();
  const [category, setCategory] = useState<string | null>(null);

  const currency = detail.data?.totals.currency ?? summary.data?.this_month.currency ?? "USD";
  const money = (n: number) => scanMoney(n, currency);
  const index = trend.findIndex((t) => t.month === month);
  const total = detail.data?.totals.total_spent ?? trend[index]?.amount ?? 0;
  const before = index > 0 ? trend[index - 1] : null;
  const change = before ? Math.round((total - before.amount) * 100) / 100 : null;
  const over = (summary.data?.budget_health ?? []).some((b) => b.over_budget);
  const isNow = month === latest;
  const mood = isNow && over ? "over-budget" : change !== null && change > 0 ? "hmm" : "cool";
  const categories = detail.data?.categories ?? [];
  const biggest = Math.max(...categories.map((c) => c.amount), 0);
  const highest = Math.max(...trend.map((t) => t.amount), 0);
  const finding = isNow ? insights.data?.[0] : undefined;

  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader
        title="Insights"
        back={back}
        action={
          <button
            onClick={goBudgets}
            className="min-h-10 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
          >
            Budgets
          </button>
        }
      />
      <section className="demo-gloss mt-7 grid min-h-[240px] grid-cols-[minmax(0,1fr)_145px] items-end overflow-hidden rounded-[24px] pl-5 text-white">
        <div className="relative z-10 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
            {month ? `${monthLabel(month, "long")} finding` : "Insights"}
          </p>
          <h2 className="mt-3 text-[25px] font-semibold leading-[1.08] tracking-[-.045em]">
            {summary.error
              ? "Couldn't load your spending."
              : !summary.data
                ? "Reading your months…"
                : finding
                  ? finding.title
                  : change === null
                    ? `${money(total)} so far.`
                    : change > 0
                      ? `${money(change)} more than ${monthLabel(before!.month, "long")}.`
                      : change < 0
                        ? `${money(-change)} less than ${monthLabel(before!.month, "long")}.`
                        : `Same as ${monthLabel(before!.month, "long")}.`}
          </h2>
          <p className="mt-3 text-[12px] leading-relaxed text-white/65">
            {finding
              ? finding.body
              : categories[0]
                ? `${categoryLabel(categories[0].name)} was the biggest share. Tap a category to see why.`
                : "Nothing counted this month yet."}
          </p>
        </div>
        <div className="tabby-v3-stage tabby-v3-stage-hero relative flex h-[222px] items-end justify-center pr-2">
          <img
            src={`/cat-v3-stock/png/${mood}.png`}
            alt=""
            className="tabby-v3-figure relative z-10 h-[210px] w-full object-contain object-bottom"
          />
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              {isNow ? "Spent this month" : `Spent in ${month ? monthLabel(month, "long") : ""}`}
            </p>
            <p className="mt-1 text-[36px] font-semibold tracking-[-.05em]">{money(total)}</p>
          </div>
          {change !== null && (
            <span
              className={`text-[12px] font-bold ${change > 0 ? "text-[#a74132]" : "text-[#50713a]"}`}
            >
              {change > 0 ? "+" : change < 0 ? "−" : ""}
              {money(Math.abs(change))} vs {monthLabel(before!.month)}
            </span>
          )}
        </div>
        <div
          role="radiogroup"
          aria-label="Month"
          className="mt-5 flex h-36 items-end gap-3 border-b border-black/10 px-2"
        >
          {trend.map((t) => (
            <button
              key={t.month}
              role="radio"
              aria-checked={t.month === month}
              onClick={() => setPicked(t.month)}
              className="flex h-full flex-1 flex-col justify-end gap-2"
              aria-label={`${monthLabel(t.month, "long")}: ${money(t.amount)}`}
            >
              <div
                className={`insight-bar ${t.month === month ? "is-on" : ""} w-full rounded-t-[6px] transition-[height]`}
                style={{ height: `${highest ? Math.max(3, (t.amount / highest) * 100) : 3}%` }}
              />
              <span
                className={`insight-month text-center text-[10px] font-semibold ${t.month === month ? "is-on" : ""}`}
              >
                {monthLabel(t.month)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[19px] font-semibold tracking-[-.03em]">Where it went</h2>
          <span className="text-[12px] text-[#77776f]">Your share</span>
        </div>
        {categories.length ? (
          <div className="ios-surface mt-3 rounded-[20px] px-4">
            {categories.map(({ name, amount, count }) => {
              const style = categoryStyle(name);
              return (
                <button
                  onClick={() => setCategory(name)}
                  key={name}
                  className="block w-full border-b border-black/[0.06] py-4 text-left last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <span>
                      <b className="block font-semibold">{categoryLabel(name)}</b>
                      <small className="mt-0.5 block text-[11px] text-[#77776f]">
                        {count} {count === 1 ? "receipt" : "receipts"}
                      </small>
                    </span>
                    <span>
                      <b>{money(amount)}</b>
                      <small className="ml-2 text-[#77776f]">
                        {total ? Math.round((amount / total) * 100) : 0}%
                      </small>
                      <Icon name="chevron_right" size={15} className="ml-1 inline text-[#9c9c95]" />
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${biggest ? Math.round((amount / biggest) * 100) : 0}%`,
                        background: style.bar,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-[18px] bg-black/[0.035] px-4 py-4 text-[13px] text-[#77776f]">
            {detail.data ? "Nothing counted in this month." : "Loading…"}
          </p>
        )}
      </section>

      {(insights.data ?? []).length > (finding ? 1 : 0) && isNow && (
        <section className="mt-8 space-y-3">
          {(insights.data ?? []).slice(finding ? 1 : 0, 4).map((insight) => (
            <div key={insight.id} className="insight-card rounded-[20px] bg-[#edf9b7] p-5">
              <h2 className="text-[17px] font-semibold tracking-[-.02em] text-[#22231f]">
                {insight.title}
              </h2>
              <p className="mt-1 text-[13px] text-[#526346]">{insight.body}</p>
              <button
                onClick={async () => {
                  await dismissInsight(insight.id).catch(() => undefined);
                  invalidate("insights");
                }}
                className="mt-3 min-h-9 text-[12px] font-bold text-[#103e33] underline underline-offset-4"
              >
                Got it
              </button>
            </div>
          ))}
        </section>
      )}

      {category && (
        <CategorySheet
          category={category}
          month={month}
          total={categories.find((c) => c.name === category)?.amount ?? 0}
          currency={currency}
          close={() => setCategory(null)}
          openReceipt={(id) => {
            setCategory(null);
            openReceipt(id);
          }}
        />
      )}
    </main>
  );
}

/** What counted in a category that month: your receipts, newest first. */
function CategorySheet({
  category,
  month,
  total,
  currency,
  close,
  openReceipt,
}: {
  category: string;
  month: string;
  total: number;
  currency: string;
  close: () => void;
  openReceipt: (id: string) => void;
}) {
  const [rows, setRows] = useState<InsightReceipt[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getMonthReceipts(month, category)
      .then((receipts) => live && setRows(receipts))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [category, month]);
  return (
    <DemoSheet
      title={`${categoryLabel(category)} · ${monthLabel(month, "long")}`}
      subtitle={`${scanMoney(total, currency)} of your share. Shared receipts count only your part.`}
      close={close}
    >
      {failed ? (
        <p role="alert" className="text-[12px] text-[#a74132]">
          Couldn&apos;t load these receipts.
        </p>
      ) : !rows ? (
        <p className="text-[12px] text-[#77776f]">Loading…</p>
      ) : rows.length ? (
        <section className="space-y-3">
          {rows.map((r) => {
            const item = receiptFromApi(r);
            const open = expanded === r.id;
            return (
              <article key={r.id} className="ios-surface overflow-hidden rounded-[20px] px-4">
                <ReceiptRow item={item} onClick={() => setExpanded(open ? null : r.id)} />
                {open && (
                  <div className="ios-divider pb-4 pt-4 text-[12px]">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <dt className="text-[#77776f]">Purchase total</dt>
                        <dd className="mt-0.5 font-semibold">{scanMoney(r.total, r.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-[#77776f]">Your share</dt>
                        <dd className="mt-0.5 font-semibold">
                          {scanMoney(r.my_share ?? r.total, r.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#77776f]">Date</dt>
                        <dd className="mt-0.5 font-semibold">
                          {r.purchased_at
                            ? new Date(r.purchased_at).toLocaleDateString([], { dateStyle: "medium" })
                            : "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#77776f]">Tax and fees</dt>
                        <dd className="mt-0.5 font-semibold">{scanMoney(r.tax || 0, r.currency)}</dd>
                      </div>
                    </dl>
                    {r.line_items?.length ? (
                      <div className="mt-4">
                        <p className="font-semibold">Items</p>
                        <ul className="mt-2 space-y-2">
                          {r.line_items.map((line) => (
                            <li key={line.id} className="flex justify-between gap-4">
                              <span className="min-w-0 truncate text-[#62625d]">
                                {line.description || line.item_name || "Item"}
                              </span>
                              <b className="shrink-0">{scanMoney(line.total_price, r.currency)}</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-4 text-[#77776f]">No item details were recorded.</p>
                    )}
                    {!r.owned && (
                      <p className="mt-4 rounded-[14px] bg-black/[0.04] px-3 py-2.5 text-[#62625d]">
                        Added by a friend. Insights counts only your share of this purchase.
                      </p>
                    )}
                    {r.owned && (
                      <button
                        onClick={() => openReceipt(r.id)}
                        className="mt-4 min-h-10 w-full rounded-full bg-[#103e33] px-4 font-semibold text-white"
                      >
                        Open full receipt
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <p className="text-[12px] text-[#77776f]">
          None of your own receipts. This is your share of purchases friends paid for.
        </p>
      )}
    </DemoSheet>
  );
}
