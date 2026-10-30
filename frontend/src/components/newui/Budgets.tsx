"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useState } from "react";
import { tabbyArt } from "@/lib/tabby";

import { Icon } from "@/components/ui";
import {
  CATEGORIES,
  createBudget,
  deleteBudget,
  updateBudget,
  type BudgetLevel,
  type BudgetPeriod,
  type BudgetState,
} from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { useBudgets } from "@/lib/data";
import { categoryLabel, categoryStyle } from "@/lib/format";
import { parseCents } from "./money";
import { BackHeader, scanMoney, tileStyle } from "./parts";

const KIND: Record<BudgetLevel, string> = {
  total: "Overall",
  category: "Category",
  merchant: "Store",
  item: "Item",
};
const LEVELS: Array<[BudgetLevel, string, string, string]> = [
  ["total", "Overall spending", "Your share of every purchase", "account_balance_wallet"],
  ["category", "A category", "Dining, groceries, drinks…", "category"],
  ["merchant", "A store", "Costco, DoorDash, Blue Bottle…", "storefront"],
  ["item", "Specific items", "Coffee, takeout, subscriptions…", "shopping_basket"],
];
const EVERY: Record<BudgetPeriod, string> = {
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};

const budgetName = (b: BudgetState) =>
  b.level === "category" ? categoryLabel(b.label) : b.level === "total" ? b.label : b.label;

/** Where a budget stands: over, close (past its first alert), or on pace. */
function standing(b: BudgetState) {
  if (b.over_budget) return "over" as const;
  if (b.percent_used >= (b.thresholds[0] ?? 80)) return "close" as const;
  return "ok" as const;
}

function daysLeft(b: BudgetState) {
  const end = new Date(`${b.period_end}T23:59:59`);
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
}

/** When a new period starts, from today. */
function resets(period: BudgetPeriod, today = new Date()) {
  if (period === "weekly") return "Resets Monday";
  if (period === "yearly") return `Resets Jan 1`;
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `Resets ${next.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * Budgets: overall, category, store and item, weekly to yearly, with the
 * server's own figures (your share after splits) and its alert thresholds.
 */
export function Budgets({ back }: { back: () => void }) {
  const { data, error } = useBudgets();
  const [editing, setEditing] = useState<BudgetState | "new" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const budgets = [...(data ?? [])].sort(
    (a, b) => Number(b.over_budget) - Number(a.over_budget) || b.percent_used - a.percent_used
  );
  const focused = budgets.find((b) => b.budget_id === selected) ?? budgets[0];
  const focusedState = focused ? standing(focused) : "ok";
  const mood = focusedState === "over" ? "over-budget" : focusedState === "close" ? "hmm" : "cool";

  return (
    <>
      <main className="px-5 pb-12 pt-5">
        <BackHeader
          title="Budgets"
          back={back}
          action={
            <button
              onClick={() => setEditing("new")}
              className="min-h-10 rounded-full glass-cta px-4 py-2.5 text-[12px] font-bold text-white"
            >
              + New
            </button>
          }
        />
        <div className="relative mt-[34px]">
          <img
            src={tabbyArt(mood)}
            alt=""
            className="hero-peek pointer-events-none absolute -top-[34px] right-3 z-10 h-[76px] w-[76px] object-contain object-bottom"
          />
          <section className="demo-gloss rounded-[22px] p-4 text-white">
            <div className="relative z-10">
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
                {focused ? `${budgetName(focused)} · ${EVERY[focused.period]}` : "Budgets"}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold leading-[1.05] tracking-[-.045em]">
                {!data
                  ? error
                    ? "Couldn't load budgets."
                    : "Checking your budgets…"
                  : !focused
                    ? "No budgets yet."
                    : focusedState === "over"
                      ? `${scanMoney(-focused.remaining, undefined)} over limit.`
                      : focusedState === "close"
                        ? `${scanMoney(focused.remaining, undefined)} left.`
                        : "Comfortably on pace."}
              </h2>
              <p className="mt-3 text-[12px] leading-relaxed text-white/65">
                {!focused
                  ? "Set one for everything, a category, a store or an item."
                  : focusedState === "over"
                    ? "Review what counted, or change the limit."
                    : focusedState === "close"
                      ? `Past ${focused.threshold_reached ?? focused.thresholds[0]}% with ${daysLeft(focused)} days to go.`
                      : `${scanMoney(focused.spent, undefined)} of ${scanMoney(focused.limit, undefined)} so far.`}
              </p>
            </div>
          </section>
        </div>

        {budgets.length > 0 && (
          <>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[.14em] text-glass-soft">
              Your budgets
            </p>
            <section className="ios-surface mt-3 overflow-hidden rounded-[22px] px-4">
              {budgets.map((b, index) => {
                const s = standing(b);
                const on = focused?.budget_id === b.budget_id;
                const style = categoryStyle(b.level === "category" ? b.target : "total");
                return (
                  <div
                    key={b.budget_id}
                    className={`py-4 ${index ? "border-t border-black/[0.07]" : ""}`}
                  >
                    <button
                      onClick={() => setSelected(b.budget_id)}
                      aria-expanded={on}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="cat-tile grid h-11 w-11 place-items-center rounded-[14px]"
                          style={tileStyle(style)}
                        >
                          <Icon
                            name={
                              b.level === "item"
                                ? "shopping_basket"
                                : b.level === "merchant"
                                  ? "storefront"
                                  : style.icon
                            }
                            size={20}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[14px]">{budgetName(b)}</b>
                          <span className="budget-meta block text-[11px] text-glass-soft">
                            {KIND[b.level]} · {scanMoney(b.spent, undefined)} of{" "}
                            {scanMoney(b.limit, undefined)} · {daysLeft(b)} days left
                          </span>
                        </span>
                        <span
                          className={`budget-chip rounded-full px-2.5 py-1 text-[10px] font-bold ${s === "ok" ? "glass-tint-pos text-glass-pos" : "glass-tint-neg text-glass-neg"}`}
                        >
                          {s === "over"
                            ? `Over ${scanMoney(-b.remaining, undefined)}`
                            : s === "close"
                              ? "Close"
                              : "On pace"}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${budgetName(b)} used`}
                        aria-valuenow={Math.round(b.percent_used)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="ml-14 mt-3 h-2 overflow-hidden rounded-full bg-black/[0.07]"
                      >
                        <div
                          className={`h-full rounded-full ${s === "ok" ? "glass-cta" : "glass-hot"}`}
                          style={{ width: `${Math.min(b.percent_used, 100)}%` }}
                        />
                      </div>
                    </button>
                    {on && (
                      <div className="ml-14 mt-3 flex gap-2">
                        <button
                          onClick={() => setEditing(b)}
                          className="min-h-9 rounded-full bg-black/[0.05] px-3 text-[11px] font-bold"
                        >
                          Edit budget
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </>
        )}
        {data && !budgets.length && (
          <button
            onClick={() => setEditing("new")}
            className="mt-4 w-full rounded-[20px] border border-dashed border-black/15 p-5 text-left"
          >
            <b className="block text-[14px]">Set your first budget</b>
            <span className="text-[12px] text-glass-soft">
              Tabby tells you at 80%, 100% and 120%.
            </span>
          </button>
        )}
        <section className="budgets-help mt-4 rounded-[20px] glass-tint p-4">
          <div className="flex gap-3">
            <Icon name="info" size={20} />
            <div>
              <b className="block text-[13px]">What counts?</b>
              <p className="mt-1 text-[11px] leading-relaxed text-glass-pos">
                Budgets use your share after splits. Item budgets count matching receipt lines, not
                the whole purchase.
              </p>
            </div>
          </div>
        </section>
      </main>
      {editing && (
        <BudgetSheet
          budget={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          saved={(id) => {
            setEditing(null);
            if (id) setSelected(id);
          }}
        />
      )}
    </>
  );
}

/** Create or change a budget; the server merges a duplicate scope. */
function BudgetSheet({
  budget,
  close,
  saved,
}: {
  budget: BudgetState | null;
  close: () => void;
  saved: (id: string | null) => void;
}) {
  const [level, setLevel] = useState<BudgetLevel>(budget?.level ?? "total");
  const [target, setTarget] = useState(budget?.target ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "monthly");
  const [amount, setAmount] = useState(budget ? String(budget.limit) : "");
  const [thresholds, setThresholds] = useState<number[]>(budget?.thresholds ?? [80, 100, 120]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cents = parseCents(amount);
  const valid =
    cents !== null &&
    cents > 0 &&
    thresholds.length > 0 &&
    (level === "total" || target.trim().length > 0);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError("");
    const body = {
      level,
      target: level === "total" ? "" : target.trim(),
      period,
      amount: (cents as number) / 100,
      alert_thresholds: thresholds.join(","),
    };
    try {
      const out = budget ? await updateBudget(budget.budget_id, body) : await createBudget(body);
      invalidate("budgets", "summary");
      saved((out as { id?: string }).id ?? null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!budget) return;
    setBusy(true);
    try {
      await deleteBudget(budget.budget_id);
      invalidate("budgets", "summary");
      saved(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={budget ? "Edit budget" : "Set a budget"}
      className="app-overlay fixed inset-0 z-50 mx-auto max-w-[467px] bg-black/50"
    >
      <section className="ios-surface full-sheet flex h-full flex-col overflow-hidden sm:rounded-[30px]">
        <div className="flex items-start justify-between border-b border-black/[0.07] px-5 pb-4 pt-5">
          <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">
            {budget ? "Edit budget" : "Set a budget"}
          </h2>
          <button
            onClick={close}
            aria-label="Close budget setup"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-5">
          <p className="text-[12px] font-bold">What should Tabby watch?</p>
          <div role="radiogroup" aria-label="What to watch" className="mt-3 space-y-2">
            {LEVELS.map(([key, title, sub, icon]) => (
              <button
                key={key}
                role="radio"
                aria-checked={level === key}
                onClick={() => {
                  setLevel(key);
                  if (key !== level) setTarget(key === "category" ? "dining" : "");
                }}
                className={`budget-level flex w-full items-center gap-3 rounded-[17px] border p-3 text-left ${level === key ? "is-on border-glass-ink" : "border-black/[0.08] bg-black/[0.025]"}`}
              >
                <span className="grid h-10 w-10 place-items-center rounded-[13px] bg-black/[0.05]">
                  <Icon name={icon} size={20} />
                </span>
                <span className="flex-1">
                  <b className="block text-[13px]">{title}</b>
                  <span className="text-[10px] text-glass-soft">{sub}</span>
                </span>
                {level === key && <Icon name="check_circle" fill size={20} />}
              </button>
            ))}
          </div>
          {level === "category" && (
            <section className="mt-6">
              <p className="text-[12px] font-bold">Which category?</p>
              <div role="radiogroup" aria-label="Category" className="mt-3 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={target === c}
                    onClick={() => setTarget(c)}
                    className={`min-h-9 rounded-full px-3 text-[11px] font-bold ${target === c ? "glass-cta text-white" : "bg-black/[0.05]"}`}
                  >
                    {categoryLabel(c)}
                  </button>
                ))}
              </div>
            </section>
          )}
          {(level === "merchant" || level === "item") && (
            <section className="mt-6">
              <label className="text-[12px] font-bold" htmlFor="budget-target">
                {level === "merchant" ? "Which store?" : "What item should match?"}
              </label>
              <input
                id="budget-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={level === "merchant" ? "Costco" : "coffee"}
                className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[14px] outline-none"
              />
              <p className="mt-2 text-[10px] text-glass-soft">
                {level === "merchant"
                  ? "Every receipt whose store name contains this counts."
                  : "Only receipt lines that match count, not the rest of the receipt. Coffee also counts lattes, espresso and cold brew."}
              </p>
            </section>
          )}
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-bold" htmlFor="budget-amount">
                {period[0].toUpperCase() + period.slice(1)} limit
              </label>
              <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold">
                {resets(period)}
              </span>
            </div>
            <div
              role="radiogroup"
              aria-label="How often"
              className="mt-3 grid grid-cols-3 rounded-full bg-black/[0.05] p-1"
            >
              {(["weekly", "monthly", "yearly"] as const).map((option) => (
                <button
                  key={option}
                  role="radio"
                  aria-checked={period === option}
                  onClick={() => setPeriod(option)}
                  className={`min-h-9 rounded-full text-[11px] font-bold capitalize ${period === option ? "glass-surface text-glass-pos shadow-sm" : "text-glass-soft"}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <label
              className={`mt-2 flex items-center rounded-[18px] border bg-black/[0.035] px-4 ${cents === null ? "border-[#c84c3d]" : "border-black/10"}`}
            >
              <span className="text-[26px] font-semibold text-glass-soft">$</span>
              <input
                id="budget-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-invalid={cents === null}
                className="h-16 min-w-0 flex-1 bg-transparent px-2 text-[30px] font-semibold tracking-[-.04em] outline-none"
              />
            </label>
          </section>
          <section className="mt-6 rounded-[18px] bg-black/[0.04] p-4">
            <p className="text-[12px] font-bold">Tell me at</p>
            <div className="mt-3 flex gap-1.5">
              {[80, 100, 120].map((t) => (
                <button
                  key={t}
                  aria-pressed={thresholds.includes(t)}
                  onClick={() =>
                    setThresholds((current) =>
                      current.includes(t)
                        ? current.filter((v) => v !== t)
                        : [...current, t].sort((a, b) => a - b)
                    )
                  }
                  className={`min-h-9 rounded-full px-3 text-[11px] font-bold ${thresholds.includes(t) ? "glass-cta text-white" : "bg-black/[0.05] text-glass-soft"}`}
                >
                  {t}%
                </button>
              ))}
            </div>
            {!thresholds.length && (
              <p className="mt-2 text-[11px] text-glass-neg">Pick at least one.</p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-glass-soft">
              Your share after splits counts. Saving the same budget again changes it rather than
              adding a second one.
            </p>
          </section>
          {budget && (
            <div className="mt-5">
              {confirmDelete ? (
                <div className="receipt-delete-confirm rounded-[16px] glass-tint-neg p-4 text-[12px] text-glass-neg">
                  <b className="block text-[13px]">Delete this budget?</b>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="min-h-11 rounded-full bg-white/70 font-bold text-glass-ink"
                    >
                      Keep it
                    </button>
                    <button
                      onClick={remove}
                      disabled={busy}
                      className="min-h-11 rounded-full glass-danger font-bold text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="min-h-11 w-full text-[12px] font-bold text-glass-neg underline underline-offset-4"
                >
                  Delete budget
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-[12px] font-semibold text-glass-neg">
              {error}
            </p>
          )}
        </div>
        <div className="sheet-footer fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[467px] px-5 pb-5 pt-4">
          <button
            onClick={save}
            disabled={!valid || busy}
            className="w-full rounded-full glass-cta py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : budget ? "Save changes" : `Add ${period} budget`}
          </button>
        </div>
      </section>
    </div>
  );
}
