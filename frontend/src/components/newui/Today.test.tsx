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
  // The real cache hands back the same object until the data changes.
  groups: { data: [{ id: "t1" }] },
  tab: {
    data: {
      group_id: "t1",
      me: "m-me",
      group_name: "Lake trip",
      currency: "USD",
      members: [{ id: "m-me" }, { id: "m-ben", name: "Ben" }],
      splits: [],
      suggested_settlements: [{ from: "Ben", from_id: "m-ben", to_id: "m-me", amount: 10.2 }],
    },
  },
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
  month: [{ purchased_at: "2026-10-23", my_share: 12.5, total: 25, currency: "USD" }],
  summary: {
    this_month: { total_spent: 540.83, currency: "USD" },
    budget_health: [{ level: "total", period: "monthly", limit: 700, spent: 540.83 }],
  },
};
vi.mock("@/lib/data", () => ({
  HOME_LIST: {},
  useMe: () => ({ data: { avatar_mood: "cool" } }),
  useMonthReceipts: (month: string | null) => ({ data: month ? data.month : undefined }),
  useSummary: () => ({ data: data.summary }),
  useBudgets: () => ({ data: data.budgets }),
  useInsights: () => ({ data: [] }),
  useReviewQueue: () => ({ data: data.review }),
  useReceiptPreview: () => ({ data: { rows: [] }, loading: false }),
  useGroups: () => data.groups,
  useGroup: () => data.tab,
}));

import { Today } from "./Today";

function show(openReceipt = vi.fn(), goOwed = vi.fn(), goInsights = vi.fn()) {
  render(
    <Today
      goActivity={vi.fn()}
      goCircles={vi.fn()}
      goInsights={goInsights}
      goBudgets={vi.fn()}
      goProfile={vi.fn()}
      goNotifications={vi.fn()}
      goSend={vi.fn()}
      goOwed={goOwed}
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
    expect(screen.getByText("8 days left")).toBeTruthy();
  });

  it("gives Insights a labeled place on Home", () => {
    const goInsights = vi.fn();
    show(vi.fn(), vi.fn(), goInsights);
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(goInsights).toHaveBeenCalledOnce();
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

  it("shows what's owed to you and how the week went", () => {
    const goOwed = vi.fn();
    show(vi.fn(), goOwed);
    const owed = screen.getByRole("button", { name: "See who owes you" });
    expect(owed.textContent).toContain("Owed to you");
    fireEvent.click(owed);
    expect(goOwed).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /This week: \$12\.50/ })).toBeTruthy();
  });
});
