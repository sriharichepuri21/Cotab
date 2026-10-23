"use client";

/* eslint-disable @next/next/no-img-element -- small local webps, already sized */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Confetti } from "@/components/Tabby";
import { ErrorNote, Icon, PageSkeleton } from "@/components/ui";
import type { MonthWrap } from "@/lib/api";
import { useMonthWrap } from "@/lib/data";
import { categoryLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

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

function Wrap() {
  const month = useSearchParams().get("month") || lastMonth();
  const { data, error, loading } = useMonthWrap(month);
  const [shared, setShared] = useState("");

  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorNote>Couldn&apos;t load the wrap-up: {error.message}</ErrorNote>;
  if (!data) return null;
  const w = data;
  const change = w.change;

  async function share() {
    const text = wrapText(w);
    try {
      if (navigator.share) {
        await navigator.share({ title: `My ${w.label}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShared("Copied. Paste it anywhere.");
    } catch {
      // Closing the share sheet isn't an error.
    }
  }

  if (!w.receipts) {
    return (
      <div className="rounded-card bg-card p-6 text-center">
        <img src="/cat/thinking.webp" alt="" className="mx-auto h-32" />
        <p className="mt-3 text-lg font-extrabold">Nothing on your tab for {w.label}</p>
        <p className="mt-1 text-[15px] text-muted">Scan a few receipts and come back next month.</p>
      </div>
    );
  }

  return (
    <>
      <article className="relative overflow-hidden rounded-[32px] bg-forest px-6 pb-7 pt-7 text-[#F3F6F1] shadow-[0_28px_40px_-24px_rgb(15_61_49/0.8)]">
        <Confetti />
        <p className="relative text-sm font-bold text-gold">{w.label}</p>
        <h1 className="relative mt-1 text-[30px] font-extrabold leading-[1.05] tracking-[-0.04em]">
          Your month,
          <br />
          wrapped up
        </h1>
        <img
          src="/cat/celebrate.webp"
          alt="Tabby cheering with a trophy"
          className="tabby-hop relative mx-auto mt-2 h-44"
        />
        <p className="relative text-center text-[52px] font-extrabold leading-none tracking-[-0.055em]">
          {money(w.total, w.currency)}
        </p>
        <p className="relative mt-2 text-center text-sm font-semibold text-[#F3F6F1]/70">
          across {w.receipts} receipt{w.receipts === 1 ? "" : "s"}
          {change !== null && Math.abs(change) >= 1 && (
            <>
              {" "}
              · {money(Math.abs(change), w.currency)} {change < 0 ? "less" : "more"} than the month
              before
            </>
          )}
        </p>
        <dl className="relative mt-6 grid grid-cols-2 gap-2.5">
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
      </article>
      <div className="mt-4 flex gap-2.5">
        <button
          type="button"
          onClick={share}
          className="press flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-forest font-bold text-paper"
        >
          <Icon name="ios_share" size={20} />
          Share
        </button>
        <Link
          href={routes.insights}
          className="press flex min-h-12 flex-1 items-center justify-center rounded-full bg-card font-bold ring-1 ring-ink/[0.08]"
        >
          See details
        </Link>
      </div>
      {shared && (
        <p role="status" className="mt-2 text-center text-sm font-semibold text-good">
          {shared}
        </p>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[18px] bg-[#F3F6F1]/[0.08] px-3.5 py-3">
      <dt className="text-xs font-semibold text-[#F3F6F1]/60">{label}</dt>
      <dd className="mt-0.5 truncate text-[17px] font-extrabold">{value}</dd>
      {sub && <dd className="text-xs font-semibold text-[#F3F6F1]/60">{sub}</dd>}
    </div>
  );
}

export default function WrapPage() {
  return (
    <main className="mx-auto max-w-md px-5 pb-12 pt-7 md:pt-10">
      <Link
        href={routes.tabby}
        className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-muted"
      >
        <Icon name="arrow_back" size={18} />
        Tabby
      </Link>
      <Suspense fallback={<PageSkeleton />}>
        <Wrap />
      </Suspense>
    </main>
  );
}
