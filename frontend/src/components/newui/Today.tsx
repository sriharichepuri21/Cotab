"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useMemo, useState, type FormEvent } from "react";

import { suggestionsFor } from "@/components/ChatDrawer";
import { askTabby } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { shopName } from "@/lib/brands";
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
import { categoryLabel, monthProgress } from "@/lib/format";
import { moved, planMove, type PlanMove } from "@/lib/plan";
import { budgetMood, tabbyArt } from "@/lib/tabby";

import { byCurrency, moneyLines, peopleIn, useMyTabs, type Owed } from "./bills";
import { lastSeven, monthOf, shiftMonth, spendByDay, spentThrough } from "./calendar";
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
import { useSettling } from "./SendMoney";

/** Home: what's safe to spend, four ways in, who owes you and how the week went,
 *  Tabby's brief beside it, then anything worth noticing or deciding and the latest
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
  goOwed: (person?: string) => void;
  openReceipt: (r: Receipt) => void;
}) {
  const { data: user } = useMe();
  const summaryQ = useSummary(6);
  const budgets = useBudgets().data ?? [];
  const insights = useInsights().data ?? [];
  const review = useReviewQueue().data ?? [];
  const recentQ = useReceiptPreview(HOME_LIST, 3);
  const { youGet, youPay, loaders, onLoad, loading: tabsLoading, error: tabsError } = useMyTabs();
  const { remind, sheets } = useSettling(onLoad);
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
  const mood = overall ? budgetMood(overall.spent, overall.limit, done) : "hi";
  const move = planMove(budgets, done);
  const tight = move?.to ?? null;
  const insight = !tight ? insights[0] : undefined;
  const recent = (recentQ.data?.rows ?? []).map(receiptFromApi);
  const needs = review[0];
  const thisMonth = monthOf(now);
  const lastMonth = shiftMonth(thisMonth, -1);
  const thisMonthRows = useMonthReceipts(thisMonth).data;
  const lastMonthRows = useMonthReceipts(lastMonth).data;
  const lastMonthName = new Date(`${lastMonth}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });
  const compared = (() => {
    if (!thisMonthRows || !lastMonthRows?.length) return null;
    const so = spentThrough(spendByDay(thisMonthRows, currency), thisMonth, now.getDate());
    const then = spentThrough(spendByDay(lastMonthRows, currency), lastMonth, now.getDate());
    // Nothing yet last month by this date says nothing about this month.
    if (then <= 0) return null;
    const gap = Math.round((so - then) * 100) / 100;
    if (Math.abs(gap) < 1) return `About the same as this point in ${lastMonthName}.`;
    return `${money(Math.abs(gap))} ${gap < 0 ? "less" : "more"} than this point in ${lastMonthName}.`;
  })();

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
      {sheets}
      <main className="px-5 pb-36 pt-5">
        <header className="flex items-center gap-2.5">
          <button onClick={goProfile} aria-label="Open profile" className="shrink-0">
            <Cat mood={user?.avatar_mood || "cool"} size={32} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold">Today</h1>
            <p className="text-[12px] text-glass-soft">
              {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
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

        {summaryQ.error && (
          <p
            role="alert"
            className="mt-6 rounded-[16px] glass-tint-neg p-4 text-[13px] text-glass-neg"
          >
            Couldn&apos;t load your month. Check your connection and pull down to try again.
          </p>
        )}

        <div className="today-grid">
          <Lead
            {...(overall ? {} : { onClick: goBudgets, "aria-label": "Set a monthly plan" })}
            className="today-hero safe-hero mt-2.5 block w-full text-left lg:mt-0"
          >
            <div className="ticket">
              <div className="ticket-main">
                <p className="text-[12px] font-medium text-glass-soft">
                  {overall ? "Safe to spend" : `Spent in ${monthName}`}
                </p>
                <p className="mt-0.5 text-[52px] tabular-nums">
                  {summary ? (
                    <RollingMoney
                      value={overall ? left : spent}
                      currency={currency}
                      centsClassName="text-[22px]"
                    />
                  ) : (
                    "—"
                  )}
                </p>
                {overall ? (
                  <>
                    <PaceBar used={overall.spent / overall.limit} pace={done} />
                    <p className="mt-1 flex justify-between text-[12px] tabular-nums text-glass-soft">
                      <span>{money(spent)} spent</span>
                      <span>of {money(overall.limit)}</span>
                    </p>
                  </>
                ) : (
                  summary && <p className="mt-1 text-[12px]">Set a monthly plan</p>
                )}
              </div>
              {overall && (
                <div className="ticket-stub">
                  <p className="text-[12px] font-medium">
                    {overall.spent > overall.limit ? "Over plan" : "Each day"}
                  </p>
                  <p className="ticket-stub-figure tabular-nums">
                    {overall.spent > overall.limit
                      ? money(overall.spent - overall.limit)
                      : money(left / Math.max(1, daysLeft))}
                  </p>
                  <span className="days-chip">
                    {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                  </span>
                </div>
              )}
            </div>
          </Lead>
          <div className="today-side">
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
                onClick={() => goOwed()}
                className="owed-tile ios-surface rounded-[22px] p-4 text-left"
                aria-label="See who owes you"
              >
                <span className="text-[13px] text-glass-ink2">Owed to you</span>
                <b className="mt-1 block text-[22px] font-medium tracking-[-0.03em]">
                  {youGet.length
                    ? moneyLines(byCurrency(youGet)).join(" + ")
                    : tabsError || tabsLoading
                      ? "—"
                      : scanMoney(0, currency)}
                </b>
                <span className="owed-side">
                  <span className="flex -space-x-1">
                    {peopleIn(youGet)
                      .slice(0, 4)
                      .map((p) => (
                        <span
                          key={p.key}
                          className="stack-ring"
                          data-tip={`${p.name} · ${moneyLines(byCurrency(p.rows)).join(" + ")}`}
                        >
                          <Person name={p.name} size={24} />
                        </span>
                      ))}
                  </span>
                  <span className="text-[12px] text-glass-soft">
                    {youGet.length || tabsLoading ? "" : tabsError ? "Couldn't load" : "All square"}
                  </span>
                </span>
              </button>
              <WeekCard currency={currency} onClick={goInsights} now={now} />
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
            <TabbyBrief
              line={
                !summary
                  ? "Reading your month…"
                  : overall
                    ? overall.spent > overall.limit
                      ? `You're ${money(overall.spent - overall.limit)} over this month's plan.`
                      : (compared ?? "You're on plan so far.")
                    : "Set a monthly plan and I'll keep pace for you."
              }
              mood={mood}
            />
            <BudgetsToWatch budgets={budgets} money={money} goBudgets={goBudgets} />
            <WhoToChase owed={youGet} remind={remind} goOwed={goOwed} />
          </div>
          <div className="today-recent">
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
                      Is this {shopName(needs.merchant) || "receipt"} right?
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

/** The month as one bar: spent so far, with a marker where the month is. */
function PaceBar({ used, pace }: { used: number; pace: number }) {
  return (
    <div className="pace-bar mt-2.5" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(1, used)) * 100}%` }} />
      <b style={{ left: `${Math.max(0, Math.min(1, pace)) * 100}%` }} />
    </div>
  );
}

/** The budgets with money gone from them, closest to their limit first. */
function BudgetsToWatch({
  budgets,
  money,
  goBudgets,
}: {
  budgets: BudgetState[];
  money: (n: number) => string;
  goBudgets: () => void;
}) {
  const watch = budgets
    .filter((b) => b.level !== "total" && b.spent > 0)
    .sort((a, b) => b.percent_used - a.percent_used)
    .slice(0, 3);
  if (!watch.length) return null;
  return (
    <section className="today-list mt-3" aria-label="Budgets to watch">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[19px] font-semibold">Budgets to watch</h2>
        <button onClick={goBudgets} className="text-[12px] font-bold underline underline-offset-4">
          All budgets
        </button>
      </div>
      <div className="ios-surface mt-1 rounded-[24px] px-4">
        {watch.map((b) => (
          <button key={b.budget_id} onClick={goBudgets} className="today-budget">
            <span className="flex items-baseline justify-between gap-3">
              <b className="truncate">
                {b.level === "category" ? categoryLabel(b.target) : b.label}
              </b>
              <span className="tabular-nums">
                {money(b.spent)} of {money(b.limit)}
              </span>
            </span>
            <span className="today-budget-track">
              <i
                className={b.over_budget ? "glass-hot" : "budget-fill"}
                style={{ width: `${Math.min(b.percent_used, 100)}%` }}
              />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Up to three people who owe you. Someone on several tabs opens their list instead. */
function WhoToChase({
  owed,
  remind,
  goOwed,
}: {
  owed: Owed[];
  remind: (o: Owed) => void;
  goOwed: (person?: string) => void;
}) {
  const everyone = peopleIn(owed);
  const people = everyone.slice(0, 3);
  if (!people.length) return null;
  return (
    <section className="today-list mt-3" aria-label="Who to chase">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[19px] font-semibold">Who to chase</h2>
        {everyone.length > people.length && (
          <button
            onClick={() => goOwed()}
            className="text-[12px] font-bold underline underline-offset-4"
          >
            All {everyone.length}
          </button>
        )}
      </div>
      <div className="ios-surface mt-1 rounded-[24px] px-4">
        {people.map((p) => (
          <div key={p.key} className="today-person">
            <button onClick={() => goOwed(p.key)} className="today-person-open">
              <Person name={p.name} size={24} />
              <b className="min-w-0 flex-1 truncate">{p.name}</b>
              <span className="tabular-nums">{moneyLines(byCurrency(p.rows)).join(" + ")}</span>
            </button>
            {p.rows.length === 1 ? (
              <button
                onClick={() => remind(p.rows[0])}
                aria-label={`Remind ${p.name}`}
                className="today-remind"
              >
                Remind
              </button>
            ) : (
              <Icon name="chevron_right" size={16} className="text-glass-soft" />
            )}
          </div>
        ))}
      </div>
    </section>
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
      className="owed-tile ios-surface rounded-[22px] p-4 text-left"
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
  const [asking, setAsking] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    askTabby(question.trim());
    setQuestion("");
  }
  return (
    <section className="brief ios-surface mt-2.5 rounded-[24px] p-4" aria-label="Tabby's brief">
      <form onSubmit={submit} className="flex items-center gap-2.5">
        <Cat mood={mood} size={30} />
        <div className="min-w-0 flex-1">
          <p className="tabby-says">{line}</p>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => setAsking(true)}
            placeholder="Ask Tabby"
            aria-label="Ask Tabby"
            className="ask-input"
          />
        </div>
        {question.trim() && (
          <button
            type="submit"
            aria-label="Send to Tabby"
            className="ask-send grid h-8 w-8 shrink-0 place-items-center rounded-full"
          >
            <Icon name="arrow_upward" size={16} />
          </button>
        )}
      </form>
      {asking && (
        <div className="ask-more">
          {suggestionsFor("/app")
            .slice(0, 3)
            .map((q) => (
              <button key={q} onClick={() => askTabby(q)}>
                {q}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
