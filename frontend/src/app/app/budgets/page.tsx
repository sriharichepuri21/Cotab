"use client";

import { useCallback, useState } from "react";

import {
  Button,
  buttonClass,
  ErrorNote,
  Field,
  fieldClass,
  Meter,
  PageHeader,
  PageSkeleton,
  Section,
} from "@/components/ui";
import {
  CATEGORIES,
  createBudget,
  deleteBudget,
  updateBudget,
  type BudgetLevel,
  type BudgetPeriod,
  type BudgetState,
} from "@/lib/api";
import { invalidate, mutate } from "@/lib/cache";
import { keys, useBudgets, useFacets } from "@/lib/data";
import { amount, categoryLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

const LEVEL_HELP: Record<BudgetLevel, string> = {
  total: "Everything you spend in the period.",
  category: "Everything in one category, like groceries.",
  merchant: "Any store whose name contains this.",
  item: "Counts only the matching items, not the whole receipt.",
};

export default function BudgetsPage() {
  const budgetsQ = useBudgets();
  const budgets = budgetsQ.data ?? [];
  const { data: facets } = useFacets();
  const loading = budgetsQ.loading;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [level, setLevel] = useState<BudgetLevel>("category");
  const [target, setTarget] = useState("groceries");
  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [limit, setLimit] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Budgets feed the Home cards too, so refresh both after any change. */
  const refresh = useCallback(async () => {
    invalidate("summary");
    await budgetsQ.refresh();
  }, [budgetsQ]);

  // Switching level changes what `target` means, so reset it to something valid
  // rather than carrying "groceries" over into a merchant budget.
  function onLevelChange(next: BudgetLevel) {
    setLevel(next);
    setTarget(next === "category" ? "groceries" : "");
  }

  function resetForm() {
    setEditingId(null);
    setLevel("category");
    setTarget("groceries");
    setPeriod("monthly");
    setLimit("");
  }

  function startEdit(budget: BudgetState) {
    setEditingId(budget.budget_id);
    setLevel(budget.level);
    setTarget(budget.target);
    setPeriod(budget.period);
    setLimit(String(budget.limit));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(limit);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { level, target, period, amount: value };
      if (editingId) await updateBudget(editingId, input);
      else await createBudget(input);
      resetForm();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    // Remove it from the list at once; restore it if the server refuses.
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

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        <PageSkeleton rows={3} />
      </main>
    );
  }

  const levelWord: Record<BudgetLevel, string> = {
    total: "Everything",
    category: "Category",
    merchant: "Store",
    item: "Item",
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title="Budgets"
        sub="Checked every time a receipt lands on your tab."
        back={{ href: routes.home, label: "Home" }}
      />

      {(error || budgetsQ.error) && <ErrorNote>{error ?? budgetsQ.error?.message}</ErrorNote>}

      <Section title="This period">
        {budgets.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-sm">
            No budgets yet. Set one below and Cotab will tell you when you get close.
          </p>
        ) : (
          <ul className="border-t border-ink/15">
            {budgets.map((b) => (
              <li key={b.budget_id} className="border-b border-line/70 py-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold capitalize">{b.label}</span>
                    <span className="block text-sm text-muted">
                      {levelWord[b.level]}, {b.period}.{" "}
                      {b.remaining >= 0
                        ? `${money(b.remaining)} left`
                        : `${money(Math.abs(b.remaining))} over`}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-sm ${b.over_budget ? "font-semibold text-rose" : ""}`}
                  >
                    {amount(b.spent)} / {amount(b.limit)}
                  </span>
                </div>
                <Meter percent={b.percent_used} />
                <div className="mt-2 flex gap-4">
                  <button
                    type="button"
                    onClick={() => startEdit(b)}
                    disabled={busy}
                    aria-label={`Edit budget ${b.label}`}
                    className="min-h-11 text-sm font-semibold underline underline-offset-4 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.budget_id)}
                    disabled={busy}
                    aria-label={`Delete budget ${b.label}`}
                    className="min-h-11 text-sm font-semibold text-rose underline underline-offset-4 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={editingId ? "Change this budget" : "Set a budget"}>
        <form onSubmit={onSubmit} className="rounded-card bg-mint/60 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Watch">
              <select
                value={level}
                onChange={(e) => onLevelChange(e.target.value as BudgetLevel)}
                aria-label="Budget level"
                className={fieldClass}
              >
                <option value="total">Everything I spend</option>
                <option value="category">One category</option>
                <option value="merchant">One store</option>
                <option value="item">One kind of item</option>
              </select>
            </Field>

            {level !== "total" && (
              <Field label={level === "category" ? "Category" : "Name contains"}>
                {level === "category" ? (
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    aria-label="Budget target"
                    className={fieldClass}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={level === "merchant" ? "Costco" : "coffee"}
                    aria-label="Budget target"
                    list={level === "merchant" ? "merchant-list" : undefined}
                    className={fieldClass}
                  />
                )}
              </Field>
            )}

            <Field label="Every">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
                aria-label="Budget period"
                className={fieldClass}
              >
                <option value="weekly">Week</option>
                <option value="monthly">Month</option>
                <option value="yearly">Year</option>
              </select>
            </Field>

            <Field label="Up to">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="50"
                aria-label="Budget amount"
                className={`${fieldClass} font-mono`}
              />
            </Field>
          </div>

          <datalist id="merchant-list">
            {(facets?.merchants ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <p className="mt-3 text-sm">{LEVEL_HELP[level]}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={buttonClass.primary}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add budget"}
            </button>
            {editingId && (
              <Button variant="ghost" onClick={resetForm} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Section>
    </main>
  );
}
