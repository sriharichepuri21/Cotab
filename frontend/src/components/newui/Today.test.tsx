import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateBudget = vi.fn();
vi.mock("@/lib/api", () => ({ updateBudget: (...a: unknown[]) => updateBudget(...a) }));
const invalidate = vi.fn();
vi.mock("@/lib/cache", () => ({ invalidate: (...a: unknown[]) => invalidate(...a) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const budget = (id: string, label: string, limit: number, spent: number) => ({
  budget_id: id,
  label,
  level: "category",
  target: label.toLowerCase(),
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
});
const data = {
  budgets: [budget("d", "Dining", 150, 140), budget("g", "Groceries", 300, 10)],
  review: [
    {
      id: "r9",
      merchant: "Trader Joe's",
      total: 34,
      currency: "USD",
      confidence: 0.82,
      category: "groceries",
      line_items: [{}, {}, {}],
      purchased_at: null,
    },
  ],
  summary: {
    this_month: { total_spent: 540.83, currency: "USD" },
    budget_health: [{ level: "total", period: "monthly", limit: 700, spent: 540.83 }],
  },
};
vi.mock("@/lib/data", () => ({
  HOME_LIST: {},
  useMe: () => ({ data: { avatar_mood: "cool" } }),
  useSummary: () => ({ data: data.summary }),
  useBudgets: () => ({ data: data.budgets }),
  useInsights: () => ({ data: [] }),
  useReviewQueue: () => ({ data: data.review }),
  useReceiptPreview: () => ({ data: { rows: [] }, loading: false }),
  useGroups: () => ({ data: [{ id: "t1" }] }),
  useGroup: () => ({
    data: {
      me: "m-me",
      group_name: "Lake trip",
      currency: "USD",
      members: [{ id: "m-me" }, { id: "m-ben" }],
      suggested_settlements: [{ from_id: "m-ben", to_id: "m-me", amount: 10.2 }],
    },
  }),
}));

import { Today } from "./Today";

function show(openReceipt = vi.fn()) {
  render(
    <Today
      goActivity={vi.fn()}
      goCircles={vi.fn()}
      goInsights={vi.fn()}
      goBudgets={vi.fn()}
      goProfile={vi.fn()}
      goNotifications={vi.fn()}
      dark={false}
      toggleTheme={vi.fn()}
      openReceipt={openReceipt}
    />
  );
  return openReceipt;
}

beforeEach(() => {
  updateBudget.mockReset();
  invalidate.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12)); // Oct 24: 80% of the month gone
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("Today", () => {
  it("shows what's safe to spend from the monthly plan", () => {
    show();
    expect(screen.getByText("SAFE TO SPEND")).toBeTruthy();
    expect(screen.getByText("$159")).toBeTruthy(); // $700 - $540.83
    expect(screen.getByText("7 days left")).toBeTruthy();
  });

  it("moves $20 from a plan under its pace into the tight one, as two budget updates", async () => {
    updateBudget.mockResolvedValue({});
    show();
    expect(screen.getByText("Dining has $10.00 left.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move $20.00 here" }));
    fireEvent.click(screen.getByRole("button", { name: "Move $20.00" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith("budgets", "summary", "insights"));
    expect(updateBudget.mock.calls).toEqual([
      ["d", { level: "category", target: "dining", period: "monthly", amount: 170 }],
      ["g", { level: "category", target: "groceries", period: "monthly", amount: 280 }],
    ]);
  });

  it("puts the first plan back if the second can't change", async () => {
    updateBudget
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce({});
    show();
    fireEvent.click(screen.getByRole("button", { name: "Move $20.00 here" }));
    fireEvent.click(screen.getByRole("button", { name: "Move $20.00" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(updateBudget.mock.calls[2]).toEqual([
      "d",
      { level: "category", target: "dining", period: "monthly", amount: 150 },
    ]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("asks about the least certain receipt and opens it", () => {
    const openReceipt = show();
    expect(screen.getByText("1 open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Is this Trader Joe's right\?/ }));
    expect(openReceipt).toHaveBeenCalledWith(expect.objectContaining({ id: "r9" }));
    expect(screen.getByText(/Tabby is 82% sure · 3 items/)).toBeTruthy();
  });

  it("shows what's owed on an open tab and links to it", () => {
    show();
    const tab = screen.getByRole("link", { name: /Lake trip/ });
    expect(tab.getAttribute("href")).toBe("/app/groups/t1");
    expect(tab.textContent).toContain("$10.20 owed to you");
  });
});
