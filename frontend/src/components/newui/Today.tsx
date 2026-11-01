"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useMemo, useState, type FormEvent } from "react";

import { suggestionsFor } from "@/components/ChatDrawer";
import { askTabby } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { updateBudget, type BudgetState } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import {
  HOME_LIST,
  useBudgets,
  useInsights,
  useMe,
  useMonthReceipts,
  useReceiptPreview,
  useReviewQueue,
  useSummary,
} from "@/lib/data";
import { greeting, monthProgress } from "@/lib/format";
import { moved, planMove, type PlanMove } from "@/lib/plan";
import { budgetMood, tabbyArt } from "@/lib/tabby";

import { byCurrency, moneyLines, peopleIn, useMyTabs } from "./bills";
import { lastSeven, monthOf, shiftMonth, spendByDay } from "./calendar";
import {
  Cat,
  DemoSheet,
  Person,
  ReceiptRow,
  RollingMoney,
  Ticket,
  receiptFromApi,
  scanMoney,
  type Receipt,
} from "./parts";

/** Home: what's safe to spend, four ways in, who owes you and how the week went,
 *  Tabby's brief, then anything worth noticing or deciding and the latest
 *  receipts. All from the account. */
export function Today({
  goActivity,
  goCircles,
  goInsights,
  goBudgets,
  goProfile,
  goNotifications,
  goSend,
  goOwed,
  openReceipt,
}: {
  goActivity: () => void;
  goCircles: () => void;
  goInsights: () => void;
  goBudgets: () => void;
  goProfile: () => void;
  goNotifications: () => void;
  goSend: () => void;
  goOwed: () => void;
  openReceipt: (r: Receipt) => void;
}) {
  const { data: user } = useMe();
  const summaryQ = useSummary(6);
  const budgets = useBudgets().data ?? [];
  const insights = useInsights().data ?? [];
  const review = useReviewQueue().data ?? [];
  const recentQ = useReceiptPreview(HOME_LIST, 3);
  const { youGet, youPay, loaders } = useMyTabs();
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
  const Lead = overall ? "div" : "button";
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
      {loaders}
      <main className="px-5 pb-36 pt-5">
        <header className="flex items-center gap-3">
          <button onClick={goProfile} aria-label="Open profile" className="aura-ring shrink-0">
            <Cat mood={user?.avatar_mood || "cool"} size={36} />
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
          <button
            onClick={goNotifications}
            className="ios-round-control relative grid h-10 w-10 place-items-center rounded-full lg:hidden"
            aria-label={review.length ? `Notifications, ${review.length} new` : "Notifications"}
          >
            <Icon name="notifications_none" size={20} />
            {review.length > 0 && <span className="notify-dot" />}
          </button>
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

            <Lead
              {...(overall ? {} : { onClick: goBudgets, "aria-label": "Set a monthly plan" })}
              className="safe-hero ios-surface mt-5 block w-full rounded-[24px] p-5 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-glass-soft">
                    {overall ? "SAFE TO SPEND" : `SPENT IN ${monthName.toUpperCase()}`}
                  </p>
                  <p className="mt-3 text-[52px] font-semibold leading-none tracking-[-0.06em]">
                    {summary ? (
                      <RollingMoney
                        value={overall ? left : spent}
                        currency={currency}
                        centsClassName="text-[30px] text-glass-soft"
                      />
                    ) : (
                      "—"
                    )}
                  </p>
                  {overall && (
                    <p className="mt-2 text-[13px] text-glass-ink2">
                      {overall.spent > overall.limit
                        ? `${money(overall.spent - overall.limit)} over this month's plan`
                        : `${money(left / Math.max(1, daysLeft))} a day is safe`}
                    </p>
                  )}
                </div>
              </div>
              {overall ? (
                <>
                  <PaceTicks used={overall.spent / overall.limit} pace={done} />
                  <div className="mt-4 flex items-end justify-between">
                    <span>
                      <small className="block text-[11px] text-glass-soft">Spent this month</small>
                      <b className="mt-0.5 block text-[16px] tabular-nums">{money(spent)}</b>
                    </span>
                    <span className="days-chip rounded-full px-3 py-1.5">
                      {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                    </span>
                    <span className="text-right">
                      <small className="block text-[11px] text-glass-soft">{monthName} plan</small>
                      <b className="mt-0.5 block text-[16px] tabular-nums">
                        {money(overall.limit)}
                      </b>
                    </span>
                  </div>
                </>
              ) : (
                summary && (
                  <span className="days-chip mt-4 inline-block rounded-full px-3 py-1.5">
                    Set a monthly plan
                  </span>
                )
              )}
            </Lead>

            <nav aria-label="Shortcuts" className="quick-row mt-3">
              <Shortcut label="Insights" icon="insights" onClick={goInsights} />
              <Shortcut label="Budgets" icon="account_balance_wallet" onClick={goBudgets} />
              <Shortcut label="Splits" icon="group" onClick={goCircles} />
              <Shortcut
                label="Send money"
                icon="north_east"
                onClick={goSend}
                dot={youPay.length > 0}
              />
            </nav>

            <section className="mt-3 grid grid-cols-2 gap-3">
              <button
                onClick={goOwed}
                className="ios-surface flex min-h-[112px] flex-col rounded-[22px] p-4 text-left"
                aria-label="See who owes you"
              >
                <span className="text-[13px] text-glass-ink2">Owed to you</span>
                <b className="mt-1 block text-[22px] font-medium tracking-[-0.03em]">
                  {youGet.length
                    ? moneyLines(byCurrency(youGet)).join(" + ")
                    : scanMoney(0, currency)}
                </b>
                <span className="mt-auto flex items-center pt-3">
                  <span className="flex -space-x-1">
                    {peopleIn(youGet)
                      .slice(0, 4)
                      .map((p) => (
                        <span
                          key={p.key}
                          className="stack-ring"
                          data-tip={`${p.name} · ${moneyLines(byCurrency(p.rows)).join(" + ")}`}
                        >
                          <Person name={p.name} size={30} />
                        </span>
                      ))}
                  </span>
                  <span className="text-[12px] text-glass-soft">
                    {youGet.length ? "" : "All square"}
                  </span>
                </span>
              </button>
              <WeekCard currency={currency} onClick={goInsights} now={now} />
            </section>

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
            {needs && (
              <section className="mt-8">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Needs a decision</h2>
                  <span className="text-[12px] font-bold text-glass-neg">{review.length} open</span>
                </div>
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
              </section>
            )}

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

function Shortcut({
  label,
  icon,
  onClick,
  dot = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  dot?: boolean;
}) {
  return (
    <button onClick={onClick} className="quick ios-surface">
      <span className="quick-glyph">
        <Icon name={icon} size={20} />
      </span>
      {dot && <span className="notify-dot" />}
      {label}
    </button>
  );
}

/** Your share over the last seven days, one bar a day, today in ink. */
function WeekCard({
  currency,
  onClick,
  now,
}: {
  currency: string;
  onClick: () => void;
  now: Date;
}) {
  const thisMonth = monthOf(now);
  const reachesBack = now.getDate() < 7;
  const rows = useMonthReceipts(thisMonth).data;
  const before = useMonthReceipts(reachesBack ? shiftMonth(thisMonth, -1) : null).data;
  const week = useMemo(
    () => lastSeven(spendByDay([...(before ?? []), ...(rows ?? [])], currency), now),
    // `now` is new on every render; the day is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [before, rows, currency, now.toDateString()]
  );
  const top = Math.max(...week.map((d) => d.total), 1);
  const total = week.reduce((sum, d) => sum + d.total, 0);
  return (
    <button
      onClick={onClick}
      className="ios-surface flex min-h-[112px] flex-col rounded-[22px] p-4 text-left"
      aria-label={`This week: ${scanMoney(total, currency)}. Open Insights`}
    >
      <span className="text-[13px] text-glass-ink2">This week</span>
      <b className="mt-1 block text-[22px] font-medium tracking-[-0.03em]">
        {scanMoney(total, currency)}
      </b>
      <span className="week-bars mt-auto pt-3" aria-hidden="true">
        {week.map((d, i) => (
          <i
            key={d.day}
            className={`${d.total ? "has" : ""} ${i === 6 ? "is-today" : ""}`}
            style={{ height: `${Math.max(12, (d.total / top) * 100)}%` }}
          />
        ))}
      </span>
    </button>
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
          <p className="tabby-says mt-1">{line}</p>
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
