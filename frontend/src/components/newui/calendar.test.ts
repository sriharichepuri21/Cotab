import { describe, expect, it } from "vitest";

import type { InsightReceipt } from "@/lib/api";

import { heat, lastSeven, monthCells, shiftMonth, spendByDay, spentThrough } from "./calendar";

const r = (purchased_at: string, my_share: number, total = my_share, currency = "USD") =>
  ({ purchased_at, my_share, total, currency }) as InsightReceipt;

describe("spendByDay", () => {
  it("adds your share by the receipt's own date, and keeps cents exact", () => {
    const days = spendByDay([r("2026-10-05T23:30:00Z", 0.1, 9), r("2026-10-05", 0.2)], "USD");
    expect(days.get("2026-10-05")?.total).toBe(0.3);
  });

  it("lists another currency on its day without adding it in", () => {
    const day = spendByDay([r("2026-10-05", 10), r("2026-10-05", 90, 90, "EUR")], "USD");
    expect(day.get("2026-10-05")).toMatchObject({ total: 10 });
    expect(day.get("2026-10-05")?.rows).toHaveLength(2);
  });
});

describe("monthCells", () => {
  it("pads to the right weekday: Oct 2026 starts on a Thursday", () => {
    const cells = monthCells("2026-10");
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });
});

it("heat ranks the days, so one huge day doesn't flatten the rest", () => {
  const month = [10, 20, 30, 1500];
  expect(month.map((t) => heat(t, month))).toEqual([1, 2, 3, 4]);
  expect(heat(0, [0, 10])).toBe(2); // only another currency that day still shows
  expect(heat(5, [])).toBe(0);
});

it("shiftMonth crosses years", () => {
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
});

it("lastSeven reaches back across a month boundary", () => {
  const days = spendByDay([r("2026-09-30", 12)], "USD");
  const week = lastSeven(days, new Date(2026, 9, 3));
  expect(week[0].day).toBe("2026-09-27");
  expect(week.find((d) => d.day === "2026-09-30")?.total).toBe(12);
});

describe("spentThrough", () => {
  const days = spendByDay([r("2026-10-05", 10.1), r("2026-10-24", 5.2), r("2026-11-02", 7)], "USD");

  it("adds a month's spending up to and including the day", () => {
    expect(spentThrough(days, "2026-10", 5)).toBe(10.1);
    expect(spentThrough(days, "2026-10", 24)).toBe(15.3);
  });

  it("stops at the month, and runs out in a shorter one", () => {
    expect(spentThrough(days, "2026-11", 1)).toBe(0);
    expect(spentThrough(days, "2026-10", 31)).toBe(15.3);
  });
});
