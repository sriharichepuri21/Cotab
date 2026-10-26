"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import Link from "next/link";
import { useState } from "react";

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
import { monthProgress } from "@/lib/format";
import { moved, planMove, type PlanMove } from "@/lib/plan";
import { routes } from "@/lib/routes";
import { budgetMood } from "@/lib/tabby";

import {
  Cat,
  DemoSheet,
  ReceiptRow,
  Ticket,
  cats,
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
  const [whole, cents] = money(overall ? left : spent).split(".");
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
      <main className="px-5 pb-32 pt-5">
        <header className="flex items-center gap-3">
          <button onClick={goProfile} aria-label="Open profile">
            <Cat mood={user?.avatar_mood || "cool"} size={45} />
          </button>
          <div className="flex-1">
            <p className="text-[12px] font-semibold uppercase text-[#77776f]">
              {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Your money, today</h1>
          </div>
          <div className="flex gap-2">
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
              {review.length > 0 && (
                <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#eef1ee] bg-[#ff453a]" />
              )}
            </button>
          </div>
        </header>

        {summaryQ.error && (
          <p
            role="alert"
            className="mt-6 rounded-[16px] bg-[#f7e9e3] p-4 text-[13px] text-[#a74132]"
          >
            Couldn&apos;t load your month. Check your connection and pull down to try again.
          </p>
        )}

        <button
          onClick={overall ? goInsights : goBudgets}
          className="mt-7 block w-full text-left"
          aria-label={overall ? "Open spending insights" : "Set a monthly plan"}
        >
          <p className="text-[12px] font-semibold text-[#77776f]">
            {overall ? "SAFE TO SPEND" : `SPENT IN ${monthName.toUpperCase()}`}
          </p>
          <div className="mt-1 flex items-end justify-between">
            <p className="text-[52px] font-semibold leading-none tracking-[-0.06em]">
              {summary ? whole : "—"}
              {summary && <span className="text-[30px] text-[#9c9c95]">.{cents}</span>}
            </p>
            {overall ? (
              <span className="mb-1 rounded-full bg-[#e6f3e5] px-3 py-1.5 text-[12px] font-bold text-[#286036]">
                {daysLeft} day{daysLeft === 1 ? "" : "s"} left
              </span>
            ) : (
              summary && (
                <span className="mb-1 rounded-full bg-black/[0.05] px-3 py-1.5 text-[12px] font-bold">
                  Set a monthly plan
                </span>
              )
            )}
          </div>
          {overall && (
            <>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/[0.07]">
                <div
                  className="h-full rounded-full bg-[#103e33]"
                  style={{ width: `${Math.min(100, (overall.spent / overall.limit) * 100)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 divide-x divide-black/10">
                <span>
                  <small className="block text-[10px] font-semibold text-[#77776f]">
                    Spent this month
                  </small>
                  <b className="mt-0.5 block text-[16px] tabular-nums">{money(spent)}</b>
                </span>
                <span className="pl-4 text-right">
                  <small className="block text-[10px] font-semibold text-[#77776f]">
                    {monthName} plan
                  </small>
                  <b className="mt-0.5 block text-[16px] tabular-nums">{money(overall.limit)}</b>
                </span>
              </div>
            </>
          )}
        </button>

        {(tight || insight) && (
          <Ticket className="demo-soft-gloss mt-7 overflow-hidden rounded-[20px] border border-black/[0.07] p-5">
            <div className="relative grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
              <div className="home-insight-copy relative z-20">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#50713a]">
                  Worth noticing
                </p>
                {tight ? (
                  <>
                    <h2 className="mt-2 text-[21px] font-semibold leading-[1.08] tracking-[-0.035em]">
                      {tight.over_budget
                        ? `${tight.label} is ${money(tight.spent - tight.limit)} over.`
                        : `${tight.label} has ${money(tight.remaining)} left.`}
                    </h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-[#62625d]">
                      {Math.round(tight.percent_used)}% of its {monthName} plan, {daysLeft} day
                      {daysLeft === 1 ? "" : "s"} to go.
                    </p>
                    {move && (
                      <button
                        onClick={() => {
                          setMoveError("");
                          setSheet(move);
                        }}
                        className="mt-4 border-b border-[#103e33] pb-0.5 text-[13px] font-bold text-[#103e33]"
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
                      <p className="mt-2 text-[13px] leading-relaxed text-[#62625d]">
                        {insight.body}
                      </p>
                      <button
                        onClick={goInsights}
                        className="mt-4 border-b border-[#103e33] pb-0.5 text-[13px] font-bold text-[#103e33]"
                      >
                        See insights
                      </button>
                    </>
                  )
                )}
              </div>
              <div className="tabby-v3-stage tabby-v3-stage-card relative flex min-h-[154px] items-end justify-center">
                <img
                  src={`/cat-v3-stock/png/${tight?.over_budget ? "over-budget" : tight ? "hmm" : "thinking"}.png`}
                  alt=""
                  className="tabby-v3-figure relative z-10 h-[154px] w-full object-contain object-bottom"
                />
              </div>
            </div>
          </Ticket>
        )}

        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Needs a decision</h2>
            <span
              className={`text-[12px] font-bold ${needs ? "text-[#a74132]" : "text-[#286036]"}`}
            >
              {needs ? `${review.length} open` : "All clear"}
            </span>
          </div>
          {needs ? (
            <button
              onClick={() => openReceipt(receiptFromApi(needs))}
              className="mt-3 flex w-full items-center gap-3 rounded-[18px] bg-[#f7e9e3] p-4 text-left"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fffefa] text-[#a74132]">
                <Icon name="receipt_long" size={20} />
              </span>
              <span className="flex-1">
                <b className="block text-[14px]">Is this {needs.merchant || "receipt"} right?</b>
                <span className="text-[12px] text-[#715f59]">
                  Tabby is {Math.round((needs.confidence ?? 0) * 100)}% sure ·{" "}
                  {needs.line_items?.length ?? 0} items
                </span>
              </span>
              <span className="font-bold">
                {scanMoney(needs.total, needs.currency || currency)}
              </span>
            </button>
          ) : (
            <p className="mt-3 rounded-[18px] bg-[#e6f3e5] p-4 text-[13px] font-semibold text-[#286036]">
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
            <div className="ios-surface mt-3 rounded-[20px] px-4">
              {recent.map((r, i) => (
                <div key={r.id} className={i ? "border-t border-black/[0.07]" : ""}>
                  <ReceiptRow item={r} onClick={() => openReceipt(r)} />
                </div>
              ))}
            </div>
          ) : (
            !recentQ.loading && (
              <p className="ios-surface mt-3 rounded-[20px] p-4 text-[13px]">
                Nothing yet. Scan a receipt or add one by hand.
              </p>
            )
          )}
        </section>

        {groups.length > 0 && (
          // Hidden when every tab is settled (each card hides itself then).
          <section className="mt-8 [&:not(:has(a.open-tab))]:hidden">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[19px] font-semibold tracking-[-0.03em]">Open tabs</h2>
              <button
                onClick={goCircles}
                className="text-[12px] font-bold underline underline-offset-4"
              >
                See all
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {groups.slice(0, 3).map((g) => (
                <OpenTab key={g.id} id={g.id} />
              ))}
            </div>
          </section>
        )}
      </main>

      {sheet && (
        <DemoSheet
          title={`Move room into ${sheet.to.label}`}
          subtitle={`This changes your ${monthName} plans, not your spending.`}
          close={() => setSheet(null)}
        >
          <section className="rounded-[20px] bg-[#edf9b7] p-4">
            <div className="flex items-center gap-3">
              <Cat mood={mood} size={54} />
              <div className="flex-1">
                <b className="block text-[17px]">
                  {sheet.to.label} {money(sheet.to.limit)} → {money(moved(sheet).to)}
                </b>
                <span className="text-[12px] text-[#526346]">
                  {sheet.from.label} {money(sheet.from.limit)} → {money(moved(sheet).from)}
                </span>
              </div>
            </div>
          </section>
          {moveError && (
            <p role="alert" className="mt-4 text-[13px] font-semibold text-[#a74132]">
              {moveError}
            </p>
          )}
          <button
            disabled={moving}
            onClick={() => confirmMove(sheet)}
            className="mt-6 w-full rounded-full bg-[#103e33] py-3.5 text-[14px] font-bold text-white disabled:opacity-60"
          >
            {moving ? "Moving…" : `Move ${money(sheet.amount)}`}
          </button>
        </DemoSheet>
      )}
    </>
  );
}

/** One tab on Home: what's open on it for you. Settled tabs show nothing. */
function OpenTab({ id }: { id: string }) {
  const tab = useGroup(id).data;
  if (!tab?.me) return null;
  const toMe = tab.suggested_settlements.filter((r) => r.to_id === tab.me);
  const fromMe = tab.suggested_settlements.filter((r) => r.from_id === tab.me);
  const net = toMe.reduce((s, r) => s + r.amount, 0) - fromMe.reduce((s, r) => s + r.amount, 0);
  const open = toMe.length + fromMe.length;
  if (!open) return null;
  const currency = tab.currency || "USD";
  return (
    <Link
      href={routes.group(id)}
      className="open-tab block w-full rounded-[20px] bg-[#dff0ff] p-4 text-left"
    >
      <div className="flex items-start">
        <div className="flex flex-1 -space-x-2">
          {tab.members.slice(0, 4).map((m, i) => (
            <span key={m.id} className="rounded-full ring-2 ring-[#dff0ff]">
              <Cat mood={cats[i % cats.length]} size={36} />
            </span>
          ))}
        </div>
        <b>
          {net >= 0
            ? `${scanMoney(net, currency)} owed to you`
            : `You owe ${scanMoney(-net, currency)}`}
        </b>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <b className="block">{tab.group_name}</b>
          <span className="text-[12px] text-[#45667b]">
            {open} {open === 1 ? "payment" : "payments"} to settle
          </span>
        </div>
        <Icon name="arrow_forward" size={20} />
      </div>
    </Link>
  );
}
