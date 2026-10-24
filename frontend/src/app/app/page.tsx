"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CatAvatar, TabbyStand } from "@/components/Tabby";
import { ErrorNote, Icon, Meter, PageSkeleton } from "@/components/ui";
import {
  dismissInsight,
  undoTabbyRun,
  type BudgetState,
  type DashboardSummary,
  type Insight,
  type Receipt,
  type TabbyMood,
  type UploadResult,
} from "@/lib/api";
import { mutate } from "@/lib/cache";
import {
  FAILED_LIST,
  HOME_LIST,
  HOME_PREVIEW,
  invalidateSpending,
  invalidateSplits,
  invalidateTabby,
  keys,
  useInsights,
  useMe,
  useNetBalances,
  useReceiptPreview,
  useSummary,
} from "@/lib/data";
import {
  categoryLabel,
  categoryStyle,
  dayLabel,
  greeting,
  money,
  monthProgress,
  splitMoney,
} from "@/lib/format";
import { routes } from "@/lib/routes";
import { OPEN_SCANNER_EVENT } from "@/lib/scanQueue";
import { budgetMood, friendTabby, userTabby } from "@/lib/tabby";
import { UPLOADED_EVENT } from "@/lib/upload";

type Attention = {
  key: string;
  href: string;
  title: string;
  sub: string;
  icon: string;
  tile: string;
  ink: string;
};

/** Things that need the person, most urgent first. Empty means all clear. */
function attentionItems(
  summary: DashboardSummary | null,
  failed: Receipt[],
  failedTotal: number
): Attention[] {
  const items: Attention[] = [];
  const bad = { icon: "error", tile: "#FCE6E9", ink: "#C8373C" };
  for (const r of failed.slice(0, 2)) {
    items.push({
      key: `failed-${r.id}`,
      href: routes.receipt(r.id),
      title: "We couldn't read a receipt",
      sub: "Retry it or type it in",
      ...bad,
    });
  }
  if (failedTotal > 2) {
    items.push({
      key: "failed-more",
      href: `${routes.tab}?status=failed`,
      title: `${failedTotal - 2} more couldn't be read`,
      sub: "See them in your receipts",
      ...bad,
    });
  }
  for (const b of summary?.budget_health.filter((x) => x.over_budget).slice(0, 2) ?? []) {
    items.push({
      key: `over-${b.category}`,
      href: routes.budgets,
      title: `${b.level === "total" ? "Your budget" : categoryLabel(b.category)} is over`,
      sub: `${money(b.spent)} of ${money(b.limit)}, ${Math.round(b.percent_used)}%`,
      icon: "trending_up",
      tile: "#FBEFD3",
      ink: "#8A5A00",
    });
  }
  if (summary && summary.pending_review > 0) {
    items.push({
      key: "review",
      href: `${routes.tab}?status=extracted`,
      title: `${summary.pending_review} receipt${summary.pending_review === 1 ? "" : "s"} to check`,
      sub: "Confirm what Tabby read",
      icon: "fact_check",
      tile: "#E2F1E5",
      ink: "#2F7D49",
    });
  }
  return items;
}

/** Spending so far this month against the same point last month. */
function paceVsLastMonth(summary: DashboardSummary): { diff: number; month: string } | null {
  const t = summary.monthly_trend;
  if (t.length < 2 || t[t.length - 2].amount <= 0) return null;
  const last = t[t.length - 2];
  const { done } = monthProgress();
  const month = new Date(`${last.month}-15`).toLocaleDateString("en-US", { month: "long" });
  return { diff: t[t.length - 1].amount - last.amount * done, month };
}

const BUBBLE: Partial<Record<TabbyMood, (left: string) => string>> = {
  cool: (left) => `Looking sharp. ${left} left and you're on pace.`,
  hmm: (left) => `Hmm, spending is ahead of the month. ${left} left.`,
  "over-budget": () => "Nearly at your limit. Easy does it this week.",
  "out-of-cash": () => "That's the budget gone for this month.",
};

export default function Home() {
  const { data: user } = useMe();
  const summaryQ = useSummary(6);
  const recentQ = useReceiptPreview(HOME_LIST, HOME_PREVIEW);
  const failedQ = useReceiptPreview(FAILED_LIST, 2);
  const nets = useNetBalances().data ?? [];
  const insights = useInsights().data ?? [];
  // What Tabby did or wants to do for you comes before what it noticed.
  const insight =
    ["tabby_rule", "owed", "month_wrap"]
      .map((kind) => insights.find((x) => x.kind === kind))
      .find(Boolean) ?? insights[0];
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
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        <PageSkeleton />
      </main>
    );
  }

  const firstName = (user.full_name || user.email || "").split(/[\s@]/)[0];
  const needs = attentionItems(summary, failed, failedTotal);
  const currency = summary?.this_month.currency ?? "USD";
  const [whole, cents] = splitMoney(summary?.this_month.total_spent ?? 0, currency);
  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
  const pace = summary ? paceVsLastMonth(summary) : null;
  // The card is this month's budget: only an overall monthly one fits it.
  const overall = summary?.budget_health.find((b) => b.level === "total" && b.period === "monthly");
  const { done, daysLeft } = monthProgress();
  // With reactions off, Tabby keeps the face this person picked.
  const mood: TabbyMood =
    user.tabby_reacts === false
      ? userTabby(user).mood
      : overall
        ? budgetMood(overall.spent, overall.limit, done)
        : "hi";
  // A calm morning gets Tabby's coffee pose.
  const morningMood: TabbyMood =
    new Date().getHours() < 11 && (mood === "cool" || mood === "hi") && user.tabby_reacts !== false
      ? "morning"
      : mood;
  const left = overall ? Math.max(0, overall.limit - overall.spent) : 0;
  const owed = nets.filter((n) => n.direction !== "settled");
  const bubble = overall
    ? (BUBBLE[mood]?.(money(left, currency)) ?? "Hi! Scan a receipt and I'll read every line.")
    : recent.length
      ? "Set a monthly budget and I'll keep an eye on it."
      : "Hi, I'm Tabby! Scan your first receipt and I'll read every line.";

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-7 md:px-8 md:pt-10">
      <header className="flex items-center gap-3">
        <Link href={routes.settings} aria-label="Your profile" className="press relative">
          <CatAvatar choice={userTabby(user)} size={48} ring="#FFFFFF" />
          <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-paper bg-forest text-gold">
            <Icon name="edit" size={11} />
          </span>
        </Link>
        <h1 className="flex-1 leading-tight">
          <span className="block text-[13px] font-medium text-faint">{greeting()},</span>
          <span className="block text-[17px] font-extrabold tracking-[-0.02em]">
            {firstName || "there"}
          </span>
        </h1>
        <a
          href="#needs"
          aria-label={needs.length ? `${needs.length} things need you` : "Nothing needs you"}
          className="press relative grid h-11 w-11 place-items-center rounded-full bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.05)]"
        >
          <Icon name="notifications" size={23} />
          {needs.length > 0 && (
            <span className="absolute right-3 top-[11px] h-2 w-2 rounded-full border-2 border-card bg-[#E5484D] [box-sizing:content-box]" />
          )}
        </a>
      </header>

      {error && (
        <div className="mt-6">
          <ErrorNote>Couldn&apos;t load everything: {error.message}</ErrorNote>
        </div>
      )}

      {alerts.length > 0 && (
        <div role="status" className="rise mt-6 rounded-card bg-[#FBEFD3] p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="font-extrabold">
              {alerts.length === 1
                ? "A budget just crossed a line"
                : `${alerts.length} budgets just crossed a line`}
            </p>
            <button
              type="button"
              onClick={() => setAlerts([])}
              aria-label="Dismiss budget alerts"
              className="-mr-2 -mt-2 grid h-9 w-9 place-items-center rounded-full hover:bg-ink/10"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {alerts.map((b) => (
              <li key={b.budget_id}>
                <div className="mb-1 flex justify-between text-sm font-semibold">
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

      <section className="mt-8 text-center">
        <p className="text-sm font-semibold text-muted">Spent in {monthName}</p>
        <p className="mt-2 text-[54px] font-extrabold leading-none tracking-[-0.055em]">
          {whole}
          <span className="text-[#B3B9B5]">{cents}</span>
        </p>
        {pace && Math.abs(pace.diff) >= 1 && (
          <span
            className={`mt-3.5 inline-flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-3 text-[13px] font-bold ${
              pace.diff < 0 ? "bg-mint text-good" : "bg-blush text-rose"
            }`}
          >
            <Icon name={pace.diff < 0 ? "south_east" : "north_east"} size={17} />
            {money(Math.abs(pace.diff), currency)} {pace.diff < 0 ? "under" : "over"} {pace.month}
            &apos;s pace
          </span>
        )}
      </section>

      <div className="mt-2">
        <TabbyStand
          mood={morningMood}
          look={user.avatar_look ?? "hoodie"}
          bubble={bubble}
          alt={`Tabby, feeling ${mood.replace("-", " ")}`}
        />
        <div className="card-in relative overflow-hidden rounded-[28px] bg-forest px-5 pb-5 pt-[22px] text-[#F3F6F1] shadow-[0_28px_40px_-24px_rgb(15_61_49/0.8)]">
          <span
            aria-hidden="true"
            className="absolute -right-[60px] -top-[90px] h-[300px] w-[220px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
          />
          {overall ? (
            <>
              <p className="relative text-sm font-semibold text-[#F3F6F1]/70">
                {monthName} budget{" "}
                <span className="font-bold text-gold">
                  · {daysLeft} day{daysLeft === 1 ? "" : "s"} to go
                </span>
              </p>
              <p className="relative mt-2.5 text-[34px] font-extrabold leading-none tracking-[-0.045em]">
                {money(left, currency)}{" "}
                <span className="text-[15px] font-semibold tracking-normal text-[#F3F6F1]/55">
                  left of {money(overall.limit, currency)}
                </span>
              </p>
              <div className="relative mt-[18px] h-2.5 rounded-full bg-[#F3F6F1]/[0.12]">
                <span
                  className="bar-fill absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#A9CC2E] to-gold"
                  style={{ width: `${Math.min(100, overall.percent_used)}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-[5px] -top-[5px] w-0.5 rounded bg-white"
                  style={{ left: `${done * 100}%` }}
                />
              </div>
              <div className="relative mt-2 flex justify-between text-xs font-semibold text-[#F3F6F1]/55">
                <span>{Math.round(overall.percent_used)}% used</span>
                <span>Today</span>
                <span>{money(daysLeft ? left / daysLeft : left, currency)} a day</span>
              </div>
            </>
          ) : (
            <>
              <p className="relative text-sm font-semibold text-[#F3F6F1]/70">
                No budget yet for {monthName}
              </p>
              <p className="relative mt-2.5 text-[26px] font-extrabold leading-tight tracking-[-0.035em]">
                Pick a monthly number and Tabby will pace you.
              </p>
            </>
          )}
          <div className="relative mt-5 flex gap-2.5">
            <Link
              href={routes.budgets}
              className="press flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full border border-[#F3F6F1]/[0.14] bg-[#F3F6F1]/10 text-sm font-bold"
            >
              <Icon name="donut_large" size={20} />
              {overall ? "Budgets" : "Set a budget"}
            </Link>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_SCANNER_EVENT))}
              className="press flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full border border-[#F3F6F1]/[0.14] bg-[#F3F6F1]/10 text-sm font-bold"
            >
              <Icon name="add" size={20} />
              Add
            </button>
            <Link
              href={routes.insights}
              aria-label="Insights"
              className="press grid h-[46px] w-[46px] place-items-center rounded-full bg-gold text-forest"
            >
              <Icon name="north_east" size={22} />
            </Link>
          </div>
        </div>
      </div>

      {needs.length > 0 && (
        <section id="needs" className="mt-8 scroll-mt-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em]">Needs you</h2>
          <ul className="mt-3 rounded-card bg-card px-4 py-1">
            {needs.map((n, i) => (
              <li key={n.key} className={i ? "border-t border-line" : ""}>
                <Link href={n.href} className="flex items-center gap-3 py-3.5">
                  <span
                    className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[15px]"
                    style={{ background: n.tile, color: n.ink }}
                  >
                    <Icon name={n.icon} fill size={23} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">{n.title}</span>
                    <span className="mt-0.5 block text-[13px] text-faint">{n.sub}</span>
                  </span>
                  <Icon name="chevron_right" className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">
          {owed.length ? "Your friends" : "Split with friends"}
        </h2>
        <Link
          href={routes.groups}
          className="text-sm font-bold text-forest underline underline-offset-[3px]"
        >
          Splits
        </Link>
      </div>
      <div className="-mx-5 mt-3.5 flex gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        <Link href={routes.groups} className="w-[58px] flex-none text-center">
          <span className="grid h-[58px] w-[58px] place-items-center rounded-full border-[1.5px] border-dashed border-[#B9C0BB]">
            <Icon name="add" size={24} />
          </span>
          <span className="mt-[7px] block text-[13px] font-semibold">Split</span>
        </Link>
        {owed.map((n) => (
          <Link key={n.person} href={routes.groups} className="w-[58px] flex-none text-center">
            <CatAvatar choice={friendTabby(n.person)} size={58} soft />
            <span className="mt-[7px] block truncate text-[13px] font-semibold">{n.person}</span>
            <span
              className={`block text-xs font-bold ${n.direction === "owes_you" ? "text-good" : "text-rose"}`}
            >
              {n.direction === "owes_you" ? "+" : "-"}
              {money(n.amount, currency)}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-7 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Latest</h2>
        <Link
          href={routes.tab}
          className="text-sm font-bold text-forest underline underline-offset-[3px]"
        >
          See all
        </Link>
      </div>
      {recent.length === 0 ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_SCANNER_EVENT))}
          className="press mt-3 flex w-full items-center gap-3 rounded-card border-[1.5px] border-dashed border-[#B9C0BB] p-4 text-left"
        >
          <span className="grid h-[46px] w-[46px] place-items-center rounded-[15px] bg-forest text-gold">
            <Icon name="document_scanner" />
          </span>
          <span>
            <span className="block text-[15px] font-bold">Scan your first receipt</span>
            <span className="block text-[13px] text-faint">
              A photo, a PDF or a forwarded email.
            </span>
          </span>
        </button>
      ) : (
        <ul className="mt-3 rounded-card bg-card px-4 py-1">
          {recent.map((r, i) => {
            const style = categoryStyle(r.category);
            return (
              <li key={r.id} className={i ? "border-t border-line" : ""}>
                <Link href={routes.receipt(r.id)} className="flex items-center gap-3 py-[13px]">
                  <span
                    className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[15px]"
                    style={{ background: style.tile, color: style.ink }}
                  >
                    <Icon name={style.icon} fill size={23} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">
                      {r.merchant || "Receipt"}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-faint">
                      {categoryLabel(r.category)} · {dayLabel(r.purchased_at)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[15px] font-extrabold">
                      {money(r.total, r.currency)}
                    </span>
                    {r.status === "extracted" && (
                      <span className="mt-0.5 block text-xs font-semibold text-[#8A5A00]">
                        Check it
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {insight && <TabbyNoticed insight={insight} />}
    </main>
  );
}

const NOTE_FACE: Record<string, TabbyMood> = {
  tabby_rule: "autopilot",
  owed: "need-money",
  month_wrap: "celebrate",
  price_watch: "hmm",
  budget_health: "hmm",
  anomaly: "bill-shock",
};

/**
 * One thing Tabby spotted or did, with the obvious next step: undo what a
 * rule did, remind a friend, open the wrap-up, or ask about it.
 */
function TabbyNoticed({ insight }: { insight: Insight }) {
  const [undone, setUndone] = useState(false);
  const data = insight.data as { run_id?: string; ask?: string; open?: string; person?: string };
  const face = undone ? "oops" : (NOTE_FACE[insight.kind] ?? "thinking");
  const heading =
    insight.kind === "tabby_rule" || insight.kind === "owed" || insight.kind === "month_wrap"
      ? insight.title
      : `Tabby noticed: ${insight.title}`;

  function dismiss() {
    mutate<Insight[]>(keys.insights, (v = []) => v.filter((x) => x.id !== insight.id));
    dismissInsight(insight.id).catch(() => undefined);
  }
  function ask(text: string) {
    window.dispatchEvent(new CustomEvent("rw:chat", { detail: text }));
  }
  async function undo() {
    if (!data.run_id) return;
    try {
      await undoTabbyRun(data.run_id);
      setUndone(true);
      invalidateSpending();
      invalidateSplits();
      invalidateTabby();
    } catch {
      setUndone(true);
    }
  }

  return (
    <div className="relative mt-4 rounded-card bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_48%,#FFFFFF_100%)] p-[18px]">
      <div className="flex items-center gap-3.5">
        <CatAvatar choice={{ look: "hoodie", mood: face, bg: "mood" }} size={52} soft />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold tracking-[-0.01em]">
            {undone ? "Undone" : heading}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {undone ? "Everything is back how it was." : insight.body}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Dismiss ${insight.title}`}
          onClick={dismiss}
          className="relative z-[1] grid h-9 w-9 shrink-0 place-items-center self-start rounded-full bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.06)]"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {!undone && (
        <div className="mt-3 flex flex-wrap gap-2 pl-[66px]">
          {insight.kind === "tabby_rule" && data.run_id && (
            <>
              {data.open && (
                <Link
                  href={data.open}
                  className="press inline-flex min-h-10 items-center rounded-full bg-forest px-4 text-sm font-bold text-paper"
                >
                  See it
                </Link>
              )}
              <button
                type="button"
                onClick={undo}
                className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-card px-4 text-sm font-bold ring-1 ring-ink/[0.08]"
              >
                <Icon name="undo" size={17} />
                Undo
              </button>
            </>
          )}
          {insight.kind === "owed" && data.ask && (
            <button
              type="button"
              onClick={() => ask(data.ask!)}
              className="press inline-flex min-h-10 items-center rounded-full bg-forest px-4 text-sm font-bold text-paper"
            >
              Remind {data.person ?? "them"}
            </button>
          )}
          {insight.kind === "month_wrap" && data.open && (
            <Link
              href={data.open}
              className="press inline-flex min-h-10 items-center rounded-full bg-forest px-4 text-sm font-bold text-paper"
            >
              See my month
            </Link>
          )}
          {!["tabby_rule", "owed", "month_wrap"].includes(insight.kind) && (
            <button
              type="button"
              onClick={() => ask(`Tell me more about this: ${insight.title}. ${insight.body}`)}
              className="press inline-flex min-h-10 items-center rounded-full bg-card px-4 text-sm font-bold ring-1 ring-ink/[0.08]"
            >
              Ask Tabby
            </button>
          )}
        </div>
      )}
    </div>
  );
}
