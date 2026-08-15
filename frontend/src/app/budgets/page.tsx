"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { BudgetBar } from "@/components/BudgetBar";
import {
  ApiError,
  CATEGORIES,
  createBudget,
  deleteBudget,
  getFacets,
  isAuthed,
  listBudgets,
  type BudgetLevel,
  type BudgetPeriod,
  type BudgetState,
  type Facets,
} from "@/lib/api";

const FIELD =
  "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

const LEVEL_HELP: Record<BudgetLevel, string> = {
  total: "Everything you spend in the period.",
  category: "One category, e.g. groceries.",
  merchant: "Matches any merchant containing this text.",
  item: "Matches line items containing this text — counts only those items, not the whole receipt.",
};

export default function BudgetsPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<BudgetState[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [level, setLevel] = useState<BudgetLevel>("category");
  const [target, setTarget] = useState("groceries");
  const [period, setPeriod] = useState<BudgetPeriod>("monthly");
  const [amount, setAmount] = useState("");

  /** A 401 means the session ended — send them to log in rather than leaving
   *  them on a page of stale budgets with "Not authenticated" and no way out.
   *  Every call on this page routes through here; having it on the initial load
   *  only is what stranded people mid-session. */
  const handleAuthError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        router.replace("/login?expired=1");
        return true;
      }
      return false;
    },
    [router]
  );

  const refresh = useCallback(async () => {
    try {
      setBudgets(await listBudgets());
      setError(null);
    } catch (e) {
      if (handleAuthError(e)) return;
      setError((e as Error).message);
    }
  }, [handleAuthError]);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace("/login");
      return;
    }
    (async () => {
      await refresh();
      try {
        setFacets(await getFacets());
      } catch {
        setFacets(null); // merchant suggestions are a nicety, not a requirement
      }
      setLoading(false);
    })();
  }, [refresh, router]);

  // Switching level changes what `target` means, so reset it to something valid
  // rather than carrying "groceries" over into a merchant budget.
  function onLevelChange(next: BudgetLevel) {
    setLevel(next);
    setTarget(next === "category" ? "groceries" : "");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createBudget({ level, target, period, amount: value });
      setAmount("");
      await refresh();
    } catch (e) {
      if (handleAuthError(e)) return;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    try {
      await deleteBudget(id);
      await refresh();
    } catch (e) {
      if (handleAuthError(e)) return;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Budgets</h1>
            <p className="text-sm text-gray-500">
              Limits are checked every time you upload a receipt.
            </p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← Back
          </Link>
        </header>

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            New budget
          </h2>
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Level</span>
              <select
                value={level}
                onChange={(e) => onLevelChange(e.target.value as BudgetLevel)}
                aria-label="Budget level"
                className={FIELD}
              >
                <option value="total">Total</option>
                <option value="category">Category</option>
                <option value="merchant">Merchant</option>
                <option value="item">Item</option>
              </select>
            </label>

            {level !== "total" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">
                  {level === "category" ? "Category" : "Matches"}
                </span>
                {level === "category" ? (
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    aria-label="Budget target"
                    className={FIELD}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
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
                    className={FIELD}
                  />
                )}
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Period</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
                aria-label="Budget period"
                className={FIELD}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50"
                aria-label="Budget amount"
                className={`${FIELD} w-28`}
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Add budget"}
            </button>
          </form>

          <datalist id="merchant-list">
            {(facets?.merchants ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <p className="mt-3 text-xs text-gray-500">{LEVEL_HELP[level]}</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Your budgets
          </h2>
          {budgets.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No budgets yet. Add one above and it&apos;ll be checked on every
              upload.
            </p>
          ) : (
            <ul className="space-y-5">
              {budgets.map((b) => (
                <li key={b.budget_id} className="flex items-start gap-3">
                  <div className="flex-1">
                    <BudgetBar state={b} />
                  </div>
                  <button
                    onClick={() => onDelete(b.budget_id)}
                    disabled={busy}
                    aria-label={`Delete budget ${b.label}`}
                    className="mt-0.5 rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-60"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
