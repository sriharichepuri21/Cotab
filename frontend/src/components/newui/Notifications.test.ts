import { describe, expect, it } from "vitest";

import type { BudgetState, Insight, Receipt, TabbyRun } from "@/lib/api";
import { buildNotices } from "./Notifications";

const now = new Date("2026-10-26T12:00:00Z").getTime();

const receipt = { id: "r1", merchant: "Costco", purchased_at: "2026-10-26T10:00:00Z" } as Receipt;
const budget = (over: boolean, threshold: number | null): BudgetState => ({
  budget_id: "b1",
  label: "dining",
  level: "category",
  target: "dining",
  period: "monthly",
  limit: 100,
  spent: over ? 112.5 : 85,
  remaining: over ? -12.5 : 15,
  percent_used: over ? 112.5 : 85,
  over_budget: over,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  thresholds: [80, 100, 120],
  threshold_reached: threshold,
});
const run = (at: string, source = "rule", status = "done") =>
  ({
    run_id: `run-${at}`,
    at,
    source,
    status,
    undoable: true,
    steps: [{ position: 1, summary: "Split Costco with Ben", status: "done", open: null }],
  }) as unknown as TabbyRun;

describe("buildNotices", () => {
  it("is empty when nothing needs a look", () => {
    expect(buildNotices([], [budget(false, null)], [], [], now)).toEqual([]);
  });

  it("asks to check receipts Tabby wasn't sure about, and opens that receipt", () => {
    const [n] = buildNotices([receipt], [], [], [], now);
    expect(n.title).toBe("Check the Costco receipt");
    expect(n.go).toBe("receipt");
    expect(n.receiptId).toBe("r1");
  });

  it("names budgets past an alert, with the real amount left or over", () => {
    expect(buildNotices([], [budget(false, 80)], [], [], now)[0].title).toBe(
      "Dining has $15.00 left"
    );
    const over = buildNotices([], [budget(true, 100)], [], [], now)[0];
    expect(over.title).toBe("Dining is $12.50 over");
    // Crossing the next threshold is a new notice, so it shows unread again.
    expect(over.id).not.toBe(buildNotices([], [budget(false, 80)], [], [], now)[0].id);
  });

  it("shows rules Tabby ran this week, not chats, undone runs or old ones", () => {
    const notices = buildNotices(
      [],
      [],
      [],
      [
        run("2026-10-25T09:00:00Z"),
        run("2026-10-25T08:00:00Z", "chat"),
        run("2026-10-24T08:00:00Z", "rule", "undone"),
        run("2026-10-10T08:00:00Z"),
      ],
      now
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toBe("Split Costco with Ben");
  });

  it("puts the newest first", () => {
    const insight = {
      id: "i1",
      title: "Dining is up",
      body: "",
      observed_at: "2026-10-20T00:00:00Z",
    } as Insight;
    const titles = buildNotices([receipt], [], [insight], [run("2026-10-25T09:00:00Z")], now).map(
      (n) => n.title
    );
    expect(titles).toEqual([
      "Check the Costco receipt",
      "Tabby ran one of your rules",
      "Dining is up",
    ]);
  });
});
