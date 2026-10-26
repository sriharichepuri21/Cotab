import type { BudgetState } from "@/lib/api";

/**
 * "Move $20 here": a monthly category budget that is nearly used up, and
 * another that is running under its pace and can lend it room. Moving changes
 * the two plans, never the spending, and keeps their combined total.
 */
export type PlanMove = { to: BudgetState; from: BudgetState; amount: number };

const cents = (dollars: number) => Math.round(dollars * 100);

/** Room a budget has left under its pace this far into the month, in dollars. */
export function roomUnderPace(b: BudgetState, monthDone: number): number {
  return (cents(b.limit * monthDone) - cents(b.spent)) / 100;
}

/** The budget most worth topping up (70% or more used), if any. */
export function tightest(budgets: BudgetState[]): BudgetState | null {
  const monthly = budgets.filter((b) => b.level === "category" && b.period === "monthly");
  const tight = monthly.filter((b) => b.limit > 0 && b.percent_used >= 70);
  return tight.sort((a, b) => b.percent_used - a.percent_used)[0] ?? null;
}

export function planMove(budgets: BudgetState[], monthDone: number): PlanMove | null {
  const to = tightest(budgets);
  if (!to) return null;
  const donors = budgets
    .filter((b) => b.level === "category" && b.period === "monthly" && b.budget_id !== to.budget_id)
    .map((b) => ({ b, room: roomUnderPace(b, monthDone) }))
    .filter(({ room }) => room >= 10)
    .sort((a, b) => b.room - a.room);
  if (!donors.length) return null;
  const { b: from, room } = donors[0];
  // A round amount people can picture: $20, or $10 when that's all there is.
  return { to, from, amount: room >= 20 ? 20 : 10 };
}

/** The two budgets' new amounts, cent-exact. */
export function moved({ to, from, amount }: PlanMove): { to: number; from: number } {
  return {
    to: (cents(to.limit) + cents(amount)) / 100,
    from: (cents(from.limit) - cents(amount)) / 100,
  };
}
