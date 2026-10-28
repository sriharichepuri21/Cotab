"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useState, type FormEvent } from "react";

import { suggestionsFor } from "@/components/ChatDrawer";
import { CountUp } from "@/components/CountUp";
import { askTabby } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { updateBudget, type BudgetState } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import {
  HOME_LIST,
  useBudgets,
  useGroup,
  useGroups,
  useInsights,
  useMe,
  useReceiptPreview,
  useReviewQueue,
  useSummary,
} from "@/lib/data";
import { greeting, monthProgress } from "@/lib/format";
import { moved, planMove, type PlanMove } from "@/lib/plan";
import { budgetMood, tabbyArt } from "@/lib/tabby";

import {
  Cat,
  DemoSheet,
  ReceiptRow,
  Ticket,
  Person,
  receiptFromApi,
  scanMoney,
  type Receipt,
} from "./parts";

/** Home: what's safe to spend, the one thing worth noticing, what needs a
 *  decision, the latest receipts and open tabs. All from the account. */
export function Today({
  goActivity,
  goCircles,
  goInsights,
  goBudgets,
  goProfile,
  goNotifications,
  openTab,
  dark,
  toggleTheme,
  openReceipt,
}: {
  goActivity: () => void;
  goCircles: () => void;
  goInsights: () => void;
  goBudgets: () => void;
  goProfile: () => void;
  goNotifications: () => void;
  openTab: (id: string) => void;
  dark: boolean;
  toggleTheme: () => void;
  openReceipt: (r: Receipt) => void;
}) {
  const { data: user } = useMe();
  const summaryQ = useSummary(6);
  const budgets = useBudgets().data ?? [];
  const insights = useInsights().data ?? [];
  const review = useReviewQueue().data ?? [];
  const recentQ = useReceiptPreview(HOME_LIST, 3);
  const groups = useGroups().data ?? [];
  const [sheet, setSheet] = useState<PlanMove | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");

  const summary = summaryQ.data;
  const currency = summary?.this_month.currency ?? "USD";
  const money = (n: number) => scanMoney(n, currency);
  const { done, daysLeft } = monthProgress();
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long" });
  const overall = summary?.budget_health.find((b) => b.level === "total" && b.period === "monthly");
  const spent = summary?.this_month.total_spent ?? 0;
  const left = overall ? Math.max(0, overall.limit - overall.spent) : 0;
  const firstName = (user?.full_name ?? "").trim().split(/\s+/)[0];
  const mood = overall ? budgetMood(overall.spent, overall.limit, done) : "hi";
  const move = planMove(budgets, done);
  const tight = move?.to ?? null;
  const insight = !tight ? insights[0] : undefined;
  const recent = (recentQ.data?.rows ?? []).map(receiptFromApi);
  const needs = review[0];

  async function confirmMove(plan: PlanMove) {
    setMoving(true);
    setMoveError("");
    const next = moved(plan);
    const scope = (b: BudgetState) => ({ level: b.level, target: b.target, period: b.period });
    try {
      await updateBudget(plan.to.budget_id, { ...scope(plan.to), amount: next.to });
      try {
        await updateBudget(plan.from.budget_id, { ...scope(plan.from), amount: next.from });
      } catch (e) {
        // Put the first one back so the two plans still add up.
        await updateBudget(plan.to.budget_id, { ...scope(plan.to), amount: plan.to.limit });
        throw e;
      }
      invalidate("budgets", "summary", "insights");
      setSheet(null);
    } catch (e) {
      setMoveError((e as Error).message || "Couldn't move it. Nothing changed.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <main className="px-5 pb-36 pt-5">
        <header className="flex items-center gap-3">
          <button onClick={goProfile} aria-label="Open profile" className="aura-ring shrink-0">
            <Cat mood={user?.avatar_mood || "cool"} size={44} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-glass-soft">
              {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
            <h1 className="truncate text-[20px] font-semibold tracking-[-0.035em]">
              {greeting(now)}
              {firstName ? `, ${firstName}` : ""}
            </h1>
          </div>
          <div className="flex gap-2 lg:hidden">
            <button
              onClick={toggleTheme}
              className="ios-round-control grid h-10 w-10 place-items-center rounded-full"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              <Icon name={dark ? "light_mode" : "dark_mode"} size={19} />
            </button>
            <button
              onClick={goNotifications}
              className="ios-round-control relative grid h-10 w-10 place-items-center rounded-full"
              aria-label={review.length ? `Notifications, ${review.length} new` : "Notifications"}
            >
              <Icon name="notifications_none" size={20} />
              {review.length > 0 && <span className="notify-dot" />}
            </button>
          </div>
        </header>

        <div className="lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div>
            {summaryQ.error && (
              <p
                role="alert"
                className="mt-6 rounded-[16px] glass-tint-neg p-4 text-[13px] text-glass-neg"
              >
                Couldn&apos;t load your month. Check your connection and pull down to try again.
              </p>
            )}

            <div className="relative mt-10">
              <img
                src={tabbyArt(mood)}
                alt=""
                className="hero-peek pointer-events-none absolute -top-[46px] right-3 z-10 h-[92px] w-[92px] object-contain object-bottom"
              />
              <button
                onClick={overall ? goInsights : goBudgets}
                className="safe-hero ios-surface block w-full rounded-[22px] p-4 text-left"
                aria-label={overall ? "Open spending insights" : "Set a monthly plan"}
              >
                <p className="text-[11px] font-semibold tracking-[0.16em] text-glass-soft">
                  {overall ? "SAFE TO SPEND" : `SPENT IN ${monthName.toUpperCase()}`}
                </p>
                <p className="mt-2 text-[52px] font-semibold leading-none tracking-[-0.06em]">
                  {summary ? (
                    <CountUp
                      value={overall ? left : spent}
                      render={(shown) => {
                        const [w, c] = money(shown).split(".");
                        return (
                          <>
                            {w}
                            <span className="text-[30px] text-glass-soft">.{c}</span>
                          </>
                        );
                      }}
                    />
                  ) : (
                    "—"
                  )}
                </p>
                {overall ? (
                  <>
                    <PaceTicks used={overall.spent / overall.limit} pace={done} />
                    <div className="mt-4 flex items-end justify-between">
                      <span>
                        <small className="block text-[10px] font-semibold text-glass-soft">
                          Spent this month
                        </small>
                        <b className="mt-0.5 block text-[16px] tabular-nums">{money(spent)}</b>
                      </span>
                      <span className="days-chip rounded-full glass-tint-pos px-3 py-1.5 text-[12px] font-bold text-glass-pos">
                        {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                      </span>
                      <span className="text-right">
                        <small className="block text-[10px] font-semibold text-glass-soft">
                          {monthName} plan
                        </small>
                        <b className="mt-0.5 block text-[16px] tabular-nums">
                          {money(overall.limit)}
                        </b>
                      </span>
                    </div>
                  </>
                ) : (
                  summary && (
                    <span className="mt-4 inline-block rounded-full bg-black/[0.05] px-3 py-1.5 text-[12px] font-bold">
                      Set a monthly plan
                    </span>
                  )
                )}
              </button>
            </div>

            <TabbyBrief
              line={
                !summary
                  ? "Reading your month…"
                  : overall
                    ? overall.spent > overall.limit
                      ? `You're ${money(overall.spent - overall.limit)} over this month's plan.`
                      : `${money(left / Math.max(1, daysLeft))} a day keeps you on plan for the next ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`
                    : "Set a monthly plan and I'll keep pace for you."
              }
              mood={mood}
            />

            <section className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={goInsights}
                className="bento-tile ios-surface rounded-[22px] p-4 text-left"
                aria-label="Open Insights, monthly trends and spending categories"
              >
                <span className="ios-theme-glyph grid size-9 place-items-center rounded-full">
                  <Icon name="insights" size={19} />
                </span>
                <b className="mt-3 block text-[15px]">Insights</b>
                <span className="block text-[11px] leading-snug text-glass-soft">
                  Monthly trends and spending categories
                </span>
                <Sparkline points={(summary?.monthly_trend ?? []).map((t) => t.amount)} />
              </button>
              <button
                onClick={goBudgets}
                className="bento-tile ios-surface rounded-[22px] p-4 text-left"
                aria-label="Open plans"
              >
                <span className="ios-theme-glyph grid size-9 place-items-center rounded-full">
                  <Icon name="account_balance_wallet" size={19} />
                </span>
                <b className="mt-3 block text-[15px]">Plans</b>
                <span className="block text-[11px] leading-snug text-glass-soft">
                  {budgets.length
                    ? `${budgets.length} active${tight ? ` · ${tight.label} is tight` : " · all on pace"}`
                    : "Set a limit and Tabby keeps pace"}
                </span>
                <span className="mt-3 inline-block text-[12px] font-bold text-glass-pos">
                  {budgets.length ? "Review" : "Start one"} →
                </span>
              </button>
            </section>

            {(tight || insight) && (
              <Ticket className="demo-soft-gloss mt-4 overflow-hidden rounded-[24px] p-5">
                <div className="relative grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
                  <div className="home-insight-copy relative z-20">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-glass-pos">
                      Worth noticing
                    </p>
                    {tight ? (
                      <>
                        <h2 className="mt-2 text-[21px] font-semibold leading-[1.08] tracking-[-0.035em]">
                          {tight.over_budget
                            ? `${tight.label} is ${money(tight.spent - tight.limit)} over.`
                            : `${tight.label} has ${money(tight.remaining)} left.`}
                        </h2>
                        <p className="mt-2 text-[13px] leading-relaxed text-glass-ink2">
                          {Math.round(tight.percent_used)}% of its {monthName} plan, {daysLeft} day
                          {daysLeft === 1 ? "" : "s"} to go.
                        </p>
                        {move && (
                          <button
                            onClick={() => {
                              setMoveError("");
                              setSheet(move);
                            }}
                            className="mt-4 border-b border-glass-ink pb-0.5 text-[13px] font-bold text-glass-pos"
                          >
                            Move {money(move.amount)} here
                          </button>
                        )}
                      </>
                    ) : (
                      insight && (
                        <>
                          <h2 className="mt-2 text-[21px] font-semibold leading-[1.08] tracking-[-0.035em]">
                            {insight.title}
                          </h2>
                          <p className="mt-2 text-[13px] leading-relaxed text-glass-ink2">
                            {insight.body}
                          </p>
                          <button
                            onClick={goInsights}
                            className="mt-4 border-b border-glass-ink pb-0.5 text-[13px] font-bold text-glass-pos"
                          >
                            See insights
                          </button>
                        </>
                      )
                    )}
                  </div>
                  <div className="tabby-v3-stage tabby-v3-stage-card relative flex min-h-[154px] items-end justify-center">
                    <img
                      src={tabbyArt(
                        tight?.over_budget ? "over-budget" : tight ? "hmm" : "thinking"
                      )}
                      alt=""
                      className="tabby-v3-figure relative z-10 h-[154px] w-full object-contain object-bottom"
                    />
                  </div>
                </div>
              </Ticket>
            )}
          </div>
          <div className="lg:mt-10 lg:[&>section:first-child]:mt-0">
            <section className="mt-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Needs a decision</h2>
                <span
                  className={`text-[12px] font-bold ${needs ? "text-glass-neg" : "text-glass-pos"}`}
                >
                  {needs ? `${review.length} open` : "All clear"}
                </span>
              </div>
              {needs ? (
                <button
                  onClick={() => openReceipt(receiptFromApi(needs))}
                  className="mt-3 flex w-full items-center gap-3 rounded-[20px] glass-tint-neg p-4 text-left"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full glass-surface text-glass-neg">
                    <Icon name="receipt_long" size={20} />
                  </span>
                  <span className="flex-1">
                    <b className="block text-[14px]">
                      Is this {needs.merchant || "receipt"} right?
                    </b>
                    <span className="text-[12px] text-glass-ink2">
                      Tabby is {Math.round((needs.confidence ?? 0) * 100)}% sure ·{" "}
                      {needs.line_items?.length ?? 0} items
                    </span>
                  </span>
                  <span className="font-bold">
                    {scanMoney(needs.total, needs.currency || currency)}
                  </span>
                </button>
              ) : (
                <p className="mt-3 rounded-[20px] glass-tint-pos p-4 text-[13px] font-semibold text-glass-pos">
                  Every receipt is checked.
                </p>
              )}
            </section>

            <section className="mt-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Recent</h2>
                <button
                  onClick={goActivity}
                  className="text-[12px] font-bold underline underline-offset-4"
                >
                  All activity
                </button>
              </div>
              {recent.length ? (
                <div className="ios-surface mt-3 rounded-[24px] px-4">
                  {recent.map((r, i) => (
                    <div key={r.id} className={i ? "ios-divider" : ""}>
                      <ReceiptRow item={r} onClick={() => openReceipt(r)} />
                    </div>
                  ))}
                </div>
              ) : (
                !recentQ.loading && (
                  <p className="ios-surface mt-3 rounded-[24px] p-4 text-[13px]">
                    Nothing yet. Scan a receipt or add one by hand.
                  </p>
                )
              )}
            </section>

            {groups.length > 0 && (
              // Hidden when every tab is settled (each card hides itself then).
              <section className="mt-8 [&:not(:has(.open-tab))]:hidden">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Open tabs</h2>
                  <button
                    onClick={goCircles}
                    className="text-[12px] font-bold underline underline-offset-4"
                  >
                    See all
                  </button>
                </div>
                <div className="snap-row -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:overflow-visible lg:px-0">
                  {groups.slice(0, 5).map((g) => (
                    <OpenTab key={g.id} id={g.id} open={openTab} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {sheet && (
        <DemoSheet
          title={`Move room into ${sheet.to.label}`}
          subtitle={`This changes your ${monthName} plans, not your spending.`}
          close={() => setSheet(null)}
        >
          <section className="rounded-[20px] glass-tint-pos p-4">
            <div className="flex items-center gap-3">
              <Cat mood={mood} size={54} />
              <div className="flex-1">
                <b className="block text-[17px]">
                  {sheet.to.label} {money(sheet.to.limit)} → {money(moved(sheet).to)}
                </b>
                <span className="text-[12px] text-glass-pos">
                  {sheet.from.label} {money(sheet.from.limit)} → {money(moved(sheet).from)}
                </span>
              </div>
            </div>
          </section>
          {moveError && (
            <p role="alert" className="mt-4 text-[13px] font-semibold text-glass-neg">
              {moveError}
            </p>
          )}
          <button
            disabled={moving}
            onClick={() => confirmMove(sheet)}
            className="mt-6 w-full rounded-full glass-cta py-3.5 text-[14px] font-bold text-white disabled:opacity-60"
          >
            {moving ? "Moving…" : `Move ${money(sheet.amount)}`}
          </button>
        </DemoSheet>
      )}
    </>
  );
}

/** The month as an instrument: one tick per slice of the plan, a marker where
 *  the month is, and amber ticks for whatever is spent ahead of that pace. */
function PaceTicks({ used, pace }: { used: number; pace: number }) {
  const count = 32;
  const on = Math.round(Math.max(0, Math.min(1, used)) * count);
  const mark = Math.min(count - 1, Math.round(Math.max(0, pace) * count));
  return (
    <div className="pace-ticks mt-5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          className={`${i < on ? (i > mark ? "hot" : "on") : ""} ${i === mark ? "mark" : ""}`}
        />
      ))}
    </div>
  );
}

/** A few months of spending as a line of bars, for the Insights tile. */
function Sparkline({ points }: { points: number[] }) {
  const top = Math.max(...points, 1);
  if (!points.length) return null;
  return (
    <span className="spark mt-3 flex h-8 items-end gap-1" aria-hidden="true">
      {points.map((p, i) => (
        <i
          key={i}
          className={i === points.length - 1 ? "is-now" : ""}
          style={{ height: `${Math.max(12, (p / top) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** Tabby's one-line read of the month, and a way to ask him anything. The
 *  answer comes from the app's chat, which shows a plan and waits for approval
 *  before it changes anything. */
function TabbyBrief({ line, mood }: { line: string; mood: string }) {
  const [question, setQuestion] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    askTabby(question.trim());
    setQuestion("");
  }
  return (
    <section className="brief ios-surface mt-4 rounded-[24px] p-4" aria-label="Tabby's brief">
      <div className="flex items-start gap-3">
        <span className="aura-ring shrink-0">
          <Cat mood={mood} size={34} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="ai-kicker">
            <Icon name="auto_awesome" size={12} /> Tabby&apos;s brief
          </p>
          <p className="mt-1 text-[14px] font-medium leading-snug">{line}</p>
        </div>
      </div>
      <form
        onSubmit={submit}
        className="ask-bar mt-3 flex items-center gap-2 rounded-full pl-4 pr-1.5"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask Tabby anything…"
          aria-label="Ask Tabby"
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
        />
        <button
          type="submit"
          aria-label="Send to Tabby"
          disabled={!question.trim()}
          className="ask-send grid h-9 w-9 shrink-0 place-items-center rounded-full glass-cta text-white disabled:opacity-40"
        >
          <Icon name="arrow_upward" size={18} />
        </button>
      </form>
      <div className="snap-row -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {suggestionsFor("/app")
          .slice(0, 4)
          .map((q) => (
            <button
              key={q}
              onClick={() => askTabby(q)}
              className="ask-chip shrink-0 rounded-full px-3 py-2 text-[12px] font-semibold"
            >
              {q}
            </button>
          ))}
      </div>
    </section>
  );
}

/** One tab on Home: what's open on it for you. Settled tabs show nothing. */
function OpenTab({ id, open: openTab }: { id: string; open: (id: string) => void }) {
  const tab = useGroup(id).data;
  if (!tab?.me) return null;
  const toMe = tab.suggested_settlements.filter((r) => r.to_id === tab.me);
  const fromMe = tab.suggested_settlements.filter((r) => r.from_id === tab.me);
  const net = toMe.reduce((s, r) => s + r.amount, 0) - fromMe.reduce((s, r) => s + r.amount, 0);
  const open = toMe.length + fromMe.length;
  if (!open) return null;
  const currency = tab.currency || "USD";
  return (
    <button
      onClick={() => openTab(id)}
      className="open-tab ios-surface block w-[78%] shrink-0 snap-start lg:w-full rounded-[24px] glass-tint p-4 text-left"
    >
      <div className="flex -space-x-1">
        {tab.members.slice(0, 4).map((m, i) => (
          <span key={m.id} className="rounded-full ring-2 ring-[#dff0ff]">
            <Person name={m.name} size={34} />
          </span>
        ))}
      </div>
      <b className="mt-3 block text-[17px] tracking-[-0.02em]">
        {net >= 0
          ? `${scanMoney(net, currency)} owed to you`
          : `You owe ${scanMoney(-net, currency)}`}
      </b>
      <div className="mt-1 flex items-end justify-between">
        <div>
          <b className="block text-[13px] font-semibold">{tab.group_name}</b>
          <span className="text-[12px] text-glass-pos">
            {open} {open === 1 ? "payment" : "payments"} to settle
          </span>
        </div>
        <Icon name="arrow_forward" size={20} />
      </div>
    </button>
  );
}
