import { describe, expect, it } from "vitest";

import type { BudgetState } from "@/lib/api";

import { moved, planMove, roomUnderPace, tightest } from "./plan";

function budget(over: Partial<BudgetState>): BudgetState {
  const limit = over.limit ?? 100;
  const spent = over.spent ?? 0;
  return {
    budget_id: over.target ?? "b",
    label: over.target ?? "b",
    level: "category",
    target: "b",
    period: "monthly",
    limit,
    spent,
    remaining: limit - spent,
    percent_used: (spent / limit) * 100,
    over_budget: spent > limit,
    period_start: "",
    period_end: "",
    thresholds: [80, 100, 120],
    threshold_reached: null,
    ...over,
  };
}

describe("Move money between plans", () => {
  const dining = budget({ budget_id: "d", target: "dining", limit: 150, spent: 120 });
  const groceries = budget({ budget_id: "g", target: "groceries", limit: 210, spent: 90 });
  const coffee = budget({ budget_id: "c", target: "coffee", limit: 40, spent: 35 });

  it("tops up the plan that's most used, 70% or more", () => {
    expect(tightest([dining, groceries, coffee])?.budget_id).toBe("c");
    expect(tightest([groceries])).toBeNull();
  });

  it("takes room only from a plan running under its pace", () => {
    // Day 24 of 30: groceries is expected at $168 and has spent $90.
    expect(roomUnderPace(groceries, 0.8)).toBe(78);
    expect(planMove([dining, groceries], 0.8)).toEqual({ to: dining, from: groceries, amount: 20 });
    // Nothing is under pace enough to lend $10: no suggestion.
    const tight = budget({ budget_id: "t", target: "travel", limit: 100, spent: 75 });
    expect(planMove([dining, tight], 0.8)).toBeNull();
  });

  it("only moves between monthly category plans", () => {
    const yearly = { ...groceries, period: "yearly" as const };
    const overall = { ...groceries, budget_id: "o", level: "total" as const };
    expect(planMove([dining, yearly, overall], 0.8)).toBeNull();
  });

  it("keeps the combined total, to the cent", () => {
    const a = budget({ budget_id: "a", limit: 150.1 });
    const b = budget({ budget_id: "b", limit: 210.2 });
    expect(moved({ to: a, from: b, amount: 20 })).toEqual({ to: 170.1, from: 190.2 });
  });
});
