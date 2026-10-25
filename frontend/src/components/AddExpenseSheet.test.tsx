import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const addExpense = vi.fn();
vi.mock("@/lib/api", async (real) => ({
  ...(await real<typeof import("@/lib/api")>()),
  addExpense: (...a: unknown[]) => addExpense(...a),
  guessCategory: async () => ({ category: "dining" }),
}));
vi.mock("@/lib/data", () => ({ invalidateSpending: vi.fn() }));

import { AddExpenseSheet, draftProblem, itemsTotal, type ExpenseDraft } from "./AddExpenseSheet";

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  description: "Dinner at Nopa",
  amount: "60",
  date: "2026-10-20",
  category: null,
  store: "",
  note: "",
  items: [],
  ...over,
});

beforeEach(() => {
  push.mockReset();
  addExpense.mockReset();
});
afterEach(cleanup);

describe("Add expense rules", () => {
  it("adds up the items once any has a price", () => {
    expect(itemsTotal([])).toBeNull();
    expect(itemsTotal([{ description: "Laptop", price: "" }])).toBeNull();
    expect(
      itemsTotal([
        { description: "Laptop", price: "999.99" },
        { description: "Coupon", price: "-20" },
        { description: "Sleeve", price: "0.1" },
      ])
    ).toBe(980.09);
  });

  it("says what's missing before saving", () => {
    expect(draftProblem(draft())).toBeNull();
    expect(draftProblem(draft({ description: "  " }))).toMatch(/what it was for/);
    expect(draftProblem(draft({ amount: "" }))).toBe("Enter an amount.");
    expect(draftProblem(draft({ amount: "-5" }))).toBe("Enter an amount.");
    expect(draftProblem(draft({ date: "2999-01-01" }))).toBe("That date is in the future.");
    expect(draftProblem(draft({ amount: "", items: [{ description: "Laptop", price: "" }] }))).toBe(
      "Give each item a name and a price."
    );
    // With items, their total is the amount.
    expect(
      draftProblem(draft({ amount: "", items: [{ description: "Laptop", price: "999" }] }))
    ).toBeNull();
  });
});

describe("AddExpenseSheet", () => {
  it("saves and opens the expense", async () => {
    addExpense.mockResolvedValue({ id: "r-1" });
    render(<AddExpenseSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("What it was for"), {
      target: { value: "Dinner at Nopa" },
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/receipts/r-1"));
    expect(addExpense).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Dinner at Nopa", amount: 60, items: [] })
    );
  });

  it("from a tab, goes on to split it there", async () => {
    addExpense.mockResolvedValue({ id: "r-2" });
    render(<AddExpenseSheet open tabId="tab-9" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("What it was for"), { target: { value: "Gas" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add and split" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/receipts/r-2/split?tab=tab-9"));
  });

  it("shows what's missing instead of saving", () => {
    render(<AddExpenseSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(screen.getByRole("alert").textContent).toMatch(/what it was for/);
    expect(addExpense).not.toHaveBeenCalled();
  });
});
