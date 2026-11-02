"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useState } from "react";

import { Confetti } from "@/components/Tabby";
import { Icon } from "@/components/ui";
import type { MonthWrap } from "@/lib/api";
import { useMonthWrap } from "@/lib/data";
import { categoryLabel, money } from "@/lib/format";
import { tabbyArt } from "@/lib/tabby";
import { BackHeader } from "./parts";

function lastMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The month in plain lines, for sharing as text. */
function wrapText(w: MonthWrap): string {
  const lines = [
    `My ${w.label} on Cotab:`,
    `${money(w.total, w.currency)} across ${w.receipts} receipt${w.receipts === 1 ? "" : "s"}`,
  ];
  if (w.top_category) lines.push(`Most went to ${w.top_category.name}`);
  if (w.top_store) lines.push(`Top store: ${w.top_store.name} (${w.top_store.visits} visits)`);
  if (w.budgets) lines.push(`Budgets kept: ${w.budgets_kept} of ${w.budgets}`);
  if (w.tabby_tasks)
    lines.push(`Tabby did ${w.tabby_tasks} task${w.tabby_tasks === 1 ? "" : "s"} for me`);
  return lines.join("\n");
}

/** The month, wrapped up: where a notification or Tabby sends you at month end. */
export function Wrap({
  back,
  month,
  goInsights,
}: {
  back: () => void;
  month: string | null;
  goInsights: () => void;
}) {
  const { data: w, error, loading } = useMonthWrap(month || lastMonth());
  const [shared, setShared] = useState("");

  async function share(wrap: MonthWrap) {
    const text = wrapText(wrap);
    try {
      if (navigator.share) {
        await navigator.share({ title: `My ${wrap.label}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShared("Copied. Paste it anywhere.");
    } catch {
      // Closing the share sheet isn't an error.
    }
  }

  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader title="Your month" back={back} />
      {error && (
        <p role="alert" className="mt-4 text-[12px] font-semibold text-glass-neg">
          Couldn&apos;t load the wrap-up: {error.message}
        </p>
      )}
      {loading && !w && <p className="mt-6 text-[13px] text-glass-soft">Loading…</p>}
      {w && !w.receipts && (
        <section className="ios-surface mt-4 rounded-[22px] p-6 text-center">
          <img src={tabbyArt("thinking")} alt="" className="tabby-v3-figure mx-auto h-32" />
          <p className="mt-3 text-[17px] font-semibold">Nothing on your tab for {w.label}</p>
          <p className="mt-1 text-[13px] text-glass-soft">
            Scan a few receipts and come back next month.
          </p>
        </section>
      )}
      {w && w.receipts > 0 && (
        <>
          <article className="wrap-card relative mt-4 overflow-hidden rounded-[24px] p-6">
            <Confetti />
            <img
              src={tabbyArt("celebrate")}
              alt="Tabby cheering with a trophy"
              className="tabby-v3-figure absolute bottom-0 right-3 h-40"
            />
            <p className="relative text-[13px]">{w.label}</p>
            <p className="wrap-total relative mt-1">{money(w.total, w.currency)}</p>
            <p className="relative mt-2 max-w-[60%] text-[13px]">
              across {w.receipts} receipt{w.receipts === 1 ? "" : "s"}
              {w.change !== null && Math.abs(w.change) >= 1 && (
                <>
                  {" "}
                  · {money(Math.abs(w.change), w.currency)} {w.change < 0 ? "less" : "more"} than
                  the month before
                </>
              )}
            </p>
          </article>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {w.top_category && (
              <Stat
                label="Most went to"
                value={categoryLabel(w.top_category.name)}
                sub={money(w.top_category.amount, w.currency)}
              />
            )}
            {w.top_store && (
              <Stat
                label="Top store"
                value={w.top_store.name}
                sub={`${w.top_store.visits} visit${w.top_store.visits === 1 ? "" : "s"}`}
              />
            )}
            {w.budgets > 0 && (
              <Stat label="Budgets kept" value={`${w.budgets_kept} of ${w.budgets}`} />
            )}
            {(w.splits > 0 || w.settled > 0) && (
              <Stat
                label="Splits"
                value={`${w.splits}`}
                sub={w.settled ? `${money(w.settled, w.currency)} settled` : undefined}
              />
            )}
            {w.tabby_tasks > 0 && (
              <Stat
                label="Tabby did"
                value={`${w.tabby_tasks} task${w.tabby_tasks === 1 ? "" : "s"}`}
              />
            )}
          </dl>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => share(w)}
              className="glass-cta flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-bold"
            >
              <Icon name="ios_share" size={18} />
              Share
            </button>
            <button
              onClick={goInsights}
              className="ios-surface min-h-12 flex-1 rounded-full text-[14px] font-bold"
            >
              See details
            </button>
          </div>
          {shared && (
            <p role="status" className="mt-2 text-center text-[12px] font-semibold text-glass-pos">
              {shared}
            </p>
          )}
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ios-surface rounded-[18px] p-4">
      <dt className="text-[12px] text-glass-soft">{label}</dt>
      <dd className="mt-0.5 truncate text-[17px] font-semibold">{value}</dd>
      {sub && <dd className="text-[12px] text-glass-soft">{sub}</dd>}
    </div>
  );
}
