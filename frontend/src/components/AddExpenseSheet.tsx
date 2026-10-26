"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Icon, fieldClass } from "@/components/ui";
import { CATEGORIES, addExpense, guessCategory } from "@/lib/api";
import { invalidateSpending } from "@/lib/data";
import { categoryLabel, categoryStyle, money } from "@/lib/format";
import { routes } from "@/lib/routes";

/** Pages open the sheet with this; `tabId` splits the expense on that tab next. */
export const OPEN_EXPENSE_EVENT = "rw:add-expense";

export function openAddExpense(tabId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EXPENSE_EVENT, { detail: { tabId } }));
}

type Item = { description: string; price: string };

export type ExpenseDraft = {
  description: string;
  amount: string;
  date: string; // yyyy-mm-dd
  category: string | null; // null: guessed from the description
  store: string;
  note: string;
  items: Item[];
};

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const blank = (): ExpenseDraft => ({
  description: "",
  amount: "",
  date: today(),
  category: null,
  store: "",
  note: "",
  items: [],
});

/** The items' total once any has a price; null when there are none. */
export function itemsTotal(items: Item[]): number | null {
  const priced = items.filter((i) => i.price.trim() !== "");
  if (!priced.length) return null;
  return Math.round(priced.reduce((sum, i) => sum + Number(i.price), 0) * 100) / 100;
}

/** What's stopping this from being saved, in words; null when it can be. */
export function draftProblem(d: ExpenseDraft): string | null {
  if (!d.description.trim()) return "Say what it was for, like “Dinner at Nopa”.";
  if (d.items.some((i) => !i.description.trim() !== !i.price.trim()))
    return "Give each item a name and a price.";
  if (d.items.some((i) => i.price.trim() && !Number.isFinite(Number(i.price))))
    return "Item prices need to be numbers.";
  const total = itemsTotal(d.items) ?? Number(d.amount);
  if (!(total > 0)) return "Enter an amount.";
  if (d.date > today()) return "That date is in the future.";
  return null;
}

/**
 * Add an expense by hand: cash, a bill, an order with no receipt. Saved as a
 * receipt with no photo; from a tab it goes straight on to splitting there.
 */
export function AddExpenseSheet({
  open,
  tabId,
  onClose,
}: {
  open: boolean;
  tabId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<ExpenseDraft>(blank);
  const [guess, setGuess] = useState("other");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ExpenseDraft>) => setD((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (open) {
      setD(blank());
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Pick the category from the description as it's typed (when not chosen).
  useEffect(() => {
    const text = `${d.description} ${d.store}`.trim();
    if (!open || d.category || !text) return;
    const timer = setTimeout(() => {
      guessCategory(text)
        .then((g) => setGuess(g.category))
        .catch(() => setGuess("other"));
    }, 350);
    return () => clearTimeout(timer);
  }, [open, d.description, d.store, d.category]);

  if (!open) return null;

  const fromItems = itemsTotal(d.items);
  const category = d.category ?? guess;

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = draftProblem(d);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const items = d.items
        .filter((i) => i.description.trim())
        .map((i) => ({ description: i.description.trim(), total_price: Number(i.price) }));
      const saved = await addExpense({
        description: d.description.trim(),
        amount: items.length ? undefined : Number(d.amount),
        date: d.date,
        category: d.category ?? undefined,
        store: d.store.trim() || undefined,
        note: d.note.trim() || undefined,
        items,
      });
      invalidateSpending();
      onClose();
      router.push(
        tabId ? `${routes.splitReceipt(saved.id)}?tab=${tabId}` : routes.receipt(saved.id)
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = "mt-5 text-[13px] font-bold text-muted";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center scrim-in bg-ink/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add expense"
        onSubmit={save}
        noValidate
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-paper md:max-w-lg md:rounded-[28px]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">Add expense</h2>
            <p className="text-[13px] text-faint">Cash, a bill, anything without a receipt</p>
          </div>
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
          <p className="mt-2 text-[13px] font-bold text-muted">What was it for?</p>
          <input
            value={d.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Dinner at Nopa"
            aria-label="What it was for"
            maxLength={255}
            autoFocus
            className={`${fieldClass} mt-2`}
          />

          <p className={label}>Amount</p>
          {fromItems === null ? (
            <label className="mt-2 flex items-center gap-1 rounded-[18px] border border-ink/10 bg-card px-4 focus-within:border-forest focus-within:ring-4 focus-within:ring-gold/60">
              <span className="text-[28px] font-extrabold text-faint">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={d.amount}
                onChange={(e) => set({ amount: e.target.value })}
                placeholder="0"
                aria-label="Amount"
                className="h-16 w-full bg-transparent text-[32px] font-extrabold tracking-[-0.03em] outline-none placeholder:text-ink/20"
              />
            </label>
          ) : (
            <p className="mt-2 rounded-[18px] bg-card px-4 py-4 text-[28px] font-extrabold tracking-[-0.03em]">
              {money(fromItems)}
              <span className="ml-2 text-[13px] font-bold text-faint">from the items</span>
            </p>
          )}

          <p className={label}>Date</p>
          <input
            type="date"
            value={d.date}
            max={today()}
            onChange={(e) => set({ date: e.target.value || today() })}
            aria-label="Date"
            className={`${fieldClass} mt-2`}
          />

          <p className={label}>Category</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
            {CATEGORIES.map((c) => {
              const on = category === c;
              const st = categoryStyle(c);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ category: c })}
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
          {!d.category && d.description.trim() && (
            <p className="mt-2 text-[12px] text-faint">
              Picked from what you typed. Tap to change.
            </p>
          )}

          <p className={label}>Items (optional)</p>
          <ul className="mt-2 flex flex-col gap-2">
            {d.items.map((item, i) => (
              <li key={i} className="flex gap-2">
                <input
                  value={item.description}
                  onChange={(e) =>
                    set({
                      items: d.items.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="Item"
                  aria-label={`Item ${i + 1} name`}
                  className={`${fieldClass} min-w-0 flex-1`}
                />
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={item.price}
                  onChange={(e) =>
                    set({
                      items: d.items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)),
                    })
                  }
                  placeholder="0.00"
                  aria-label={`Item ${i + 1} price`}
                  className={`${fieldClass} w-28`}
                />
                <button
                  type="button"
                  onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}
                  aria-label={`Remove item ${i + 1}`}
                  className="grid h-12 w-10 shrink-0 place-items-center rounded-full text-faint"
                >
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => set({ items: [...d.items, { description: "", price: "" }] })}
            className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest"
          >
            <Icon name="add" size={18} />
            Add an item
          </button>

          <p className={label}>Store (optional)</p>
          <input
            value={d.store}
            onChange={(e) => set({ store: e.target.value })}
            placeholder="Nopa"
            aria-label="Store"
            maxLength={255}
            className={`${fieldClass} mt-2`}
          />
          <p className={label}>Note (optional)</p>
          <textarea
            value={d.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="Ben's birthday"
            aria-label="Note"
            maxLength={1000}
            rows={2}
            className={`${fieldClass} mt-2 resize-none py-3`}
          />
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-line bg-paper px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : tabId ? "Add and split" : "Add expense"}
          </Button>
        </div>
      </form>
    </div>
  );
}
