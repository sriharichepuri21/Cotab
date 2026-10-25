"use client";

import { useCallback, useEffect, useState } from "react";

import { CatAvatar } from "@/components/Tabby";
import { Button, ErrorNote, Icon, PageHeader, PageSkeleton, fieldClass } from "@/components/ui";
import {
  CATEGORIES,
  createBudget,
  deleteBudget,
  updateBudget,
  type BudgetLevel,
  type BudgetPeriod,
  type BudgetState,
  type TabbyMood,
} from "@/lib/api";
import { invalidate, mutate } from "@/lib/cache";
import { keys, useBudgets, useFacets } from "@/lib/data";
import { categoryLabel, categoryStyle, money } from "@/lib/format";
import { routes } from "@/lib/routes";

const PERIOD_WORD: Record<BudgetPeriod, string> = {
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

const LEVELS: Array<{ id: BudgetLevel; title: string; sub: string; icon: string }> = [
  { id: "total", title: "Everything", sub: "All you spend", icon: "account_balance_wallet" },
  { id: "category", title: "A category", sub: "Like groceries", icon: "category" },
  { id: "merchant", title: "A store", sub: "Like Costco", icon: "storefront" },
  { id: "item", title: "An item", sub: "Like coffee", icon: "local_cafe" },
];

/** How far through its period a budget is, 0–1. */
function periodDone(b: BudgetState, now = Date.now()) {
  const start = new Date(b.period_start).getTime();
  const end = new Date(b.period_end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

function daysLeft(b: BudgetState, now = Date.now()) {
  const end = new Date(b.period_end).getTime();
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 86_400_000)) : 0;
}

type Status = { label: string; mood: TabbyMood; cls: string; bar: string };
function status(b: BudgetState): Status {
  const share = b.limit ? b.spent / b.limit : 0;
  if (b.over_budget || share >= 1)
    return { label: "Over", mood: "over-budget", cls: "bg-blush text-rose", bar: "#C8373C" };
  if (share > periodDone(b) + 0.1 || share >= 0.9)
    return {
      label: "Close",
      mood: "hmm",
      cls: "bg-[#FBEFD3] text-[#8A5A00]",
      bar: "#E8A33B",
    };
  return { label: "On track", mood: "cool", cls: "bg-mint text-good", bar: "#0F3D31" };
}

function look(b: { level: BudgetLevel; target: string }) {
  if (b.level === "total") return categoryStyle("total");
  if (b.level === "category") return categoryStyle(b.target);
  if (b.level === "merchant") return { icon: "storefront", tile: "#E2EEF9", ink: "#1F5C99" };
  return { icon: "shopping_cart", tile: "#ECE8FA", ink: "#5B3FB8" };
}

type Draft = {
  id: string | null;
  level: BudgetLevel;
  target: string;
  period: BudgetPeriod;
  limit: string;
};
const NEW: Draft = {
  id: null,
  level: "category",
  target: "groceries",
  period: "monthly",
  limit: "",
};

export default function BudgetsPage() {
  const budgetsQ = useBudgets();
  const budgets = budgetsQ.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  /** Budgets feed Home and Insights too, so refresh those after any change. */
  const refresh = useCallback(async () => {
    invalidate("summary");
    await budgetsQ.refresh();
  }, [budgetsQ]);

  async function onDelete(id: string) {
    setMenu(null);
    const before = budgets;
    mutate<BudgetState[]>(keys.budgets, (v = []) => v.filter((b) => b.budget_id !== id));
    try {
      await deleteBudget(id);
      invalidate("summary");
    } catch (e) {
      mutate(keys.budgets, before);
      setError((e as Error).message);
    }
  }

  if (budgetsQ.loading) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        <PageSkeleton rows={3} />
      </main>
    );
  }

  const states = budgets.map(status);
  const onTrack = states.filter((s) => s.label === "On track").length;
  const worst =
    states.find((s) => s.label === "Over") ?? states.find((s) => s.label !== "On track");
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const overOne = budgets.find((_, i) => states[i].label === "Over");
  const closeOne = budgets.find((_, i) => states[i].label === "Close");
  const headline = !budgets.length
    ? "Give me a number to watch and I'll tell you when you're getting close."
    : overOne
      ? `${cap(overOne.label)} is over by ${money(Math.abs(overOne.remaining))}.${
          closeOne ? ` ${cap(closeOne.label)} is getting close too.` : ""
        }`
      : closeOne
        ? `${cap(closeOne.label)} is spending faster than the ${PERIOD_WORD[closeOne.period]} is going.`
        : "Everything's on pace. Nice work.";

  return (
    <main className="mx-auto max-w-2xl px-5 pb-12 pt-6 md:px-8 md:pt-10">
      <PageHeader
        title="Budgets"
        back={{ href: routes.insights, label: "Insights" }}
        action={
          <button
            type="button"
            onClick={() => setDraft({ ...NEW })}
            className="press inline-flex h-11 items-center gap-1.5 rounded-full bg-forest pl-3 pr-4 text-sm font-bold text-paper"
          >
            <Icon name="add" size={20} className="text-gold" />
            New
          </button>
        }
      />

      {(error || budgetsQ.error) && <ErrorNote>{error ?? budgetsQ.error?.message}</ErrorNote>}

      <section className="relative -mt-2 flex items-center gap-4 overflow-hidden rounded-[28px] bg-forest p-5 text-[#F3F6F1]">
        <span
          aria-hidden="true"
          className="absolute -right-[60px] -top-[90px] h-[300px] w-[220px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
        />
        <CatAvatar
          choice={{
            look: "hoodie",
            mood: worst?.mood ?? (budgets.length ? "cool" : "hi"),
            bg: "mood",
          }}
          size={64}
          ring="#0F3D31"
          className="relative"
        />
        <div className="relative min-w-0 flex-1">
          {budgets.length > 0 && (
            <p className="text-[28px] font-extrabold leading-none tracking-[-0.04em]">
              {onTrack}
              <span className="text-[16px] font-semibold text-[#F3F6F1]/60">
                {" "}
                / {budgets.length} on track
              </span>
            </p>
          )}
          <p
            className={`text-[14px] font-semibold text-[#F3F6F1]/80 ${budgets.length ? "mt-1.5" : ""}`}
          >
            {headline}
          </p>
        </div>
      </section>

      {budgets.length === 0 ? (
        <button
          type="button"
          onClick={() => setDraft({ ...NEW })}
          className="press mt-4 flex w-full items-center gap-3 rounded-card border-[1.5px] border-dashed border-[#B9C0BB] p-4 text-left"
        >
          <span className="grid h-[46px] w-[46px] place-items-center rounded-[15px] bg-forest text-gold">
            <Icon name="add" size={24} />
          </span>
          <span>
            <span className="block text-[15px] font-bold">Set your first budget</span>
            <span className="block text-[13px] text-faint">
              A monthly total, or groceries, coffee, a store…
            </span>
          </span>
        </button>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {budgets.map((b, i) => {
            const s = states[i];
            const style = look(b);
            const done = periodDone(b);
            const left = daysLeft(b);
            return (
              <li key={b.budget_id} className="relative rounded-card bg-card p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
                    style={{ background: style.tile, color: style.ink }}
                  >
                    <Icon name={style.icon} fill size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-extrabold capitalize tracking-[-0.01em]">
                      {b.level === "category" ? categoryLabel(b.label) : b.label}
                    </p>
                    <p className="text-[12px] font-semibold text-faint">
                      Every {PERIOD_WORD[b.period]} · {left} day{left === 1 ? "" : "s"} left
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${s.cls}`}>
                    {s.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Options for ${b.label}`}
                    aria-expanded={menu === b.budget_id}
                    onClick={() => setMenu(menu === b.budget_id ? null : b.budget_id)}
                    className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-ink/[0.05]"
                  >
                    <Icon name="more_horiz" size={22} />
                  </button>
                </div>

                <div className="mt-4 flex items-end justify-between gap-3">
                  <p className="text-[24px] font-extrabold leading-none tracking-[-0.04em]">
                    {b.remaining >= 0 ? money(b.remaining) : money(Math.abs(b.remaining))}
                    <span className="ml-1.5 text-[13px] font-semibold tracking-normal text-faint">
                      {b.remaining >= 0 ? "left" : "over"}
                    </span>
                  </p>
                  <p className="text-[13px] font-bold text-muted">
                    {money(b.spent)}{" "}
                    <span className="font-semibold text-faint">of {money(b.limit)}</span>
                  </p>
                </div>
                <div className="relative mt-2.5 h-2.5 rounded-full bg-ink/[0.07]">
                  <span
                    className="bar-fill absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.min(100, b.percent_used)}%`, background: s.bar }}
                  />
                  <span
                    aria-hidden="true"
                    title="Where you'd be at an even pace"
                    className="absolute -bottom-1 -top-1 w-0.5 rounded bg-ink/40"
                    style={{ left: `${done * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-faint">
                  {Math.round(b.percent_used)}% used · {Math.round(done * 100)}% of the{" "}
                  {PERIOD_WORD[b.period]} gone
                </p>

                {menu === b.budget_id && (
                  <div className="rise absolute right-3 top-12 z-10 w-44 overflow-hidden rounded-[16px] bg-card shadow-[0_16px_40px_-12px_rgb(12_17_14/0.35)] ring-1 ring-ink/5">
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(null);
                        setDraft({
                          id: b.budget_id,
                          level: b.level,
                          target: b.target,
                          period: b.period,
                          limit: String(b.limit),
                        });
                      }}
                      aria-label={`Edit budget ${b.label}`}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-bold hover:bg-paper"
                    >
                      <Icon name="edit" size={18} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(b.budget_id)}
                      aria-label={`Delete budget ${b.label}`}
                      className="flex w-full items-center gap-2.5 border-t border-line px-4 py-3 text-left text-sm font-bold text-rose hover:bg-blush/50"
                    >
                      <Icon name="delete" size={18} /> Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <BudgetSheet
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await refresh();
          }}
        />
      )}
    </main>
  );
}

const QUICK: Record<BudgetPeriod, number[]> = {
  weekly: [25, 50, 100, 200],
  monthly: [50, 100, 250, 500],
  yearly: [100, 500, 1000, 2500],
};

function BudgetSheet({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: facets } = useFacets();
  const set = (patch: Partial<Draft>) => setD((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const value = Number(d.limit);
  const what =
    d.level === "total"
      ? "everything you spend"
      : d.level === "category"
        ? categoryLabel(d.target).toLowerCase()
        : d.target.trim()
          ? `${d.level === "merchant" ? "anything at" : ""} ${d.target.trim()}`.trim()
          : d.level === "merchant"
            ? "a store"
            : "an item";
  const sentence =
    value > 0
      ? `Tabby will watch ${what}, up to ${money(value)} a ${PERIOD_WORD[d.period]}, and tell you when you're getting close.`
      : `Pick an amount and Tabby will watch ${what} every ${PERIOD_WORD[d.period]}.`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if ((d.level === "merchant" || d.level === "item") && !d.target.trim()) {
      setError(d.level === "merchant" ? "Which store?" : "Which item?");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { level: d.level, target: d.target.trim(), period: d.period, amount: value };
      if (d.id) await updateBudget(d.id, input);
      else await createBudget(input);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={d.id ? "Change this budget" : "New budget"}
        onSubmit={save}
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-paper md:max-w-lg md:rounded-[28px]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">
            {d.id ? "Change this budget" : "New budget"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-card"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <p className="mt-2 text-[13px] font-bold text-muted">What should Tabby watch?</p>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Budget level">
            {LEVELS.map((l) => {
              const on = d.level === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() =>
                    set({ level: l.id, target: l.id === "category" ? "groceries" : "" })
                  }
                  className={`flex items-center gap-2.5 rounded-[18px] border-2 bg-card p-3 text-left transition ${
                    on ? "border-forest" : "border-transparent"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-[12px] ${on ? "bg-forest text-gold" : "bg-paper text-ink"}`}
                  >
                    <Icon name={l.icon} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-extrabold">{l.title}</span>
                    <span className="block truncate text-[11px] font-semibold text-faint">
                      {l.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {d.level === "category" && (
            <>
              <p className="mt-5 text-[13px] font-bold text-muted">Category</p>
              <div
                className="mt-2 flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Budget target"
              >
                {CATEGORIES.map((c) => {
                  const on = d.target === c;
                  const st = categoryStyle(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set({ target: c })}
                      className={`inline-flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-bold transition ${
                        on ? "bg-forest text-paper" : "bg-card text-ink"
                      }`}
                    >
                      <span
                        className="grid h-6 w-6 place-items-center rounded-full"
                        style={on ? undefined : { background: st.tile, color: st.ink }}
                      >
                        <Icon name={st.icon} fill size={15} />
                      </span>
                      {categoryLabel(c)}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {(d.level === "merchant" || d.level === "item") && (
            <>
              <p className="mt-5 text-[13px] font-bold text-muted">
                {d.level === "merchant" ? "Store name contains" : "Item name contains"}
              </p>
              <input
                value={d.target}
                onChange={(e) => set({ target: e.target.value })}
                placeholder={d.level === "merchant" ? "Costco" : "coffee"}
                aria-label="Budget target"
                list={d.level === "merchant" ? "merchant-list" : undefined}
                className={`${fieldClass} mt-2`}
              />
              <datalist id="merchant-list">
                {(facets?.merchants ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}

          <p className="mt-5 text-[13px] font-bold text-muted">Every</p>
          <div
            className="mt-2 flex gap-1 rounded-full bg-card p-1"
            role="radiogroup"
            aria-label="Budget period"
          >
            {(["weekly", "monthly", "yearly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={d.period === p}
                onClick={() => set({ period: p })}
                className={`h-10 flex-1 rounded-full text-sm font-bold capitalize transition ${
                  d.period === p ? "bg-forest text-paper" : "text-faint"
                }`}
              >
                {PERIOD_WORD[p]}
              </button>
            ))}
          </div>

          <p className="mt-5 text-[13px] font-bold text-muted">Up to</p>
          <label className="mt-2 flex items-center gap-1 rounded-[18px] border border-ink/10 bg-card px-4 focus-within:border-forest focus-within:ring-4 focus-within:ring-gold/60">
            <span className="text-[28px] font-extrabold text-faint">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={d.limit}
              onChange={(e) => set({ limit: e.target.value })}
              placeholder="0"
              aria-label="Budget amount"
              className="h-16 w-full bg-transparent text-[32px] font-extrabold tracking-[-0.03em] outline-none placeholder:text-ink/20"
            />
          </label>
          <div className="mt-2 flex gap-2">
            {QUICK[d.period].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => set({ limit: String(q) })}
                className={`flex-1 rounded-full py-2 text-[13px] font-bold ${
                  Number(d.limit) === q ? "bg-gold text-forest" : "bg-card text-muted"
                }`}
              >
                ${q.toLocaleString("en-US")}
              </button>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-[18px] bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_48%,#FFFFFF_100%)] p-3.5">
            <CatAvatar choice={{ look: "hoodie", mood: "cool", bg: "mood" }} size={40} soft />
            <p className="text-[13px] font-semibold leading-snug">{sentence}</p>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-line bg-paper px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : d.id ? "Save changes" : "Add budget"}
          </Button>
        </div>
      </form>
    </div>
  );
}
