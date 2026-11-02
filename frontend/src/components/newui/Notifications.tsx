"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useEffect, useState } from "react";
import { shopName } from "@/lib/brands";
import { tabbyArt } from "@/lib/tabby";

import { Icon } from "@/components/ui";
import type { BudgetState, Insight, Receipt as ApiReceipt, TabbyRun } from "@/lib/api";
import { useBudgets, useInsights, useReviewQueue, useTabbyActivity } from "@/lib/data";
import { categoryLabel, dayLabel } from "@/lib/format";
import { BackHeader, scanMoney } from "./parts";

export type Notice = {
  id: string;
  icon: string;
  tone: "coral" | "sky" | "sand" | "lime";
  title: string;
  body: string;
  at: string | null;
  action: string;
  go: "receipt" | "budgets" | "insights" | "tabby";
  receiptId?: string;
};

const READ_KEY = "cotab-read-notices";
const WEEK = 7 * 86_400_000;

function loadRead(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRead(ids: string[]) {
  try {
    // Only the newest few hundred matter; old ids belong to notices long gone.
    localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-300)));
  } catch {
    // Private windows can refuse storage; read marks then last this visit.
  }
}

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return dayLabel(iso);
}

const budgetName = (b: BudgetState) => (b.level === "category" ? categoryLabel(b.label) : b.label);

/**
 * What's worth a look, from what the app already knows: receipts Tabby
 * wasn't sure about, budgets past an alert, the server's insights, and
 * rules Tabby ran this week. Newest first.
 */
export function buildNotices(
  review: ApiReceipt[],
  budgets: BudgetState[],
  insights: Insight[],
  runs: TabbyRun[],
  now = Date.now()
): Notice[] {
  const notices: Notice[] = [];
  for (const r of review.slice(0, 3))
    notices.push({
      id: `review:${r.id}`,
      icon: "receipt_long",
      tone: "coral",
      title: `Check the ${shopName(r.merchant) || "new"} receipt`,
      body: "Tabby wasn't sure about part of it. A quick look keeps your totals right.",
      at: r.purchased_at,
      action: "Review receipt",
      go: "receipt",
      receiptId: r.id,
    });
  for (const b of budgets) {
    if (b.threshold_reached === null && !b.over_budget) continue;
    notices.push({
      // A new period, or the next threshold, is a new notice.
      id: `budget:${b.budget_id}:${b.period_start}:${b.threshold_reached ?? "over"}`,
      icon: "donut_large",
      tone: "sand",
      title: b.over_budget
        ? `${budgetName(b)} is ${scanMoney(-b.remaining, undefined)} over`
        : `${budgetName(b)} has ${scanMoney(b.remaining, undefined)} left`,
      body: `${Math.round(b.percent_used)}% of its ${b.period} plan is used.`,
      at: null,
      action: "See budgets",
      go: "budgets",
    });
  }
  for (const i of insights.slice(0, 2))
    notices.push({
      id: `insight:${i.id}`,
      icon: "insights",
      tone: "lime",
      title: i.title,
      body: i.body,
      at: i.observed_at,
      action: "See insight",
      go: "insights",
    });
  for (const run of runs) {
    if (run.source !== "rule" || run.status === "undone") continue;
    if (!run.at || now - new Date(run.at).getTime() > WEEK) continue;
    notices.push({
      id: `run:${run.run_id}`,
      icon: "pets",
      tone: "sky",
      title: "Tabby ran one of your rules",
      body: run.steps.map((s) => s.summary).join(". "),
      at: run.at,
      action: "See what Tabby did",
      go: "tabby",
    });
  }
  const time = (n: Notice) => (n.at ? new Date(n.at).getTime() : now);
  return notices.sort((a, b) => time(b) - time(a));
}

export function Notifications({
  back,
  openReceipt,
  goBudgets,
  goInsights,
  goTabby,
}: {
  back: () => void;
  openReceipt: (id: string) => void;
  goBudgets: () => void;
  goInsights: () => void;
  goTabby: () => void;
}) {
  const review = useReviewQueue();
  const budgets = useBudgets();
  const insights = useInsights();
  const runs = useTabbyActivity();
  const [read, setRead] = useState<string[]>([]);
  useEffect(() => setRead(loadRead()), []);

  const loading = !review.data && !budgets.data && !insights.data && !runs.data;
  const failed = review.error ?? budgets.error ?? insights.error ?? runs.error;
  const notices = buildNotices(
    review.data ?? [],
    budgets.data ?? [],
    insights.data ?? [],
    runs.data ?? []
  );
  const unread = notices.filter((n) => !read.includes(n.id)).length;
  const markRead = (ids: string[]) =>
    setRead((current) => {
      const next = [...current, ...ids.filter((id) => !current.includes(id))];
      saveRead(next);
      return next;
    });
  const open = (notice: Notice) => {
    markRead([notice.id]);
    if (notice.go === "receipt" && notice.receiptId) openReceipt(notice.receiptId);
    if (notice.go === "budgets") goBudgets();
    if (notice.go === "insights") goInsights();
    if (notice.go === "tabby") goTabby();
  };

  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader title="Notifications" back={back} />
      <section className="ios-surface mt-7 grid grid-cols-[minmax(0,1fr)_92px] items-end overflow-hidden rounded-[22px] pl-5">
        <div className="relative z-10 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-glass-soft">
            {loading ? "Checking" : unread ? `${unread} worth a look` : "You're all caught up"}
          </p>
          <h2 className="mt-2 text-[21px] font-semibold leading-[1.12] tracking-[-.035em]">
            Only the money updates that matter.
          </h2>
        </div>
        <img
          src={tabbyArt(unread ? "hmm" : "done")}
          alt="Tabby keeping watch over your updates"
          className="tabby-v3-figure h-[124px] w-full object-contain object-bottom"
        />
      </section>
      {failed && (
        <p role="alert" className="mt-4 text-[12px] font-semibold text-glass-neg">
          Couldn&apos;t load everything: {failed.message}
        </p>
      )}
      <div className="mt-7 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-glass-soft">Recent</p>
        {unread > 0 && (
          <button
            onClick={() => markRead(notices.map((n) => n.id))}
            className="min-h-10 text-[12px] font-bold text-glass-pos"
          >
            Mark all read
          </button>
        )}
      </div>
      {notices.length ? (
        <section className="ios-surface mt-3 overflow-hidden rounded-[22px] px-4">
          {notices.map((notice, index) => {
            const isRead = read.includes(notice.id);
            return (
              <button
                key={notice.id}
                onClick={() => open(notice)}
                className={`relative flex w-full gap-3 py-4 text-left ${index ? "border-t border-black/[0.07]" : ""}`}
              >
                {!isRead && (
                  <span className="absolute right-0 top-4 h-2 w-2 rounded-full glass-danger">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
                <span
                  className={`demo-${notice.tone} grid h-11 w-11 shrink-0 place-items-center rounded-[14px]`}
                >
                  <Icon name={notice.icon} size={20} />
                </span>
                <span className={`min-w-0 flex-1 pr-4 ${isRead ? "opacity-55" : ""}`}>
                  <span className="flex items-start justify-between gap-2">
                    <b className="text-[14px] leading-snug">{notice.title}</b>
                    <small className="shrink-0 text-[10px] font-semibold text-glass-soft">
                      {ago(notice.at)}
                    </small>
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-glass-soft">
                    {notice.body}
                  </span>
                  <span className="mt-2 block text-[11px] font-bold text-glass-pos">
                    {notice.action} →
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ) : (
        <p className="ios-surface rounded-[14px] p-4 text-[13px] text-glass-ink2">
          {loading ? "Loading…" : "Nothing needs you right now."}
        </p>
      )}
      <p className="mx-auto mt-5 max-w-[280px] text-center text-[11px] leading-relaxed text-glass-soft">
        Tabby keeps routine activity quiet and surfaces only what needs a decision.
      </p>
    </main>
  );
}
