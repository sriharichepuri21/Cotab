import { describe, expect, it } from "vitest";

import type { SplitSummary } from "@/lib/api";

import { billsFor, byCurrency, friendsIn, paidPercent, peopleIn, type Owed } from "./bills";

const split = (id: string, payer: string, date: string, shares: object[], currency = "USD") =>
  ({ split_id: id, paid_by: payer, purchased_at: date, currency, shares }) as never;

const tab = (over: Partial<SplitSummary>) =>
  ({
    group_id: "t",
    group_name: "Lake trip",
    me: "m-me",
    members: [
      { id: "m-me", name: "Alex" },
      { id: "m-pri", name: "Priya", account: "u-pri" },
    ],
    splits: [],
    suggested_settlements: [],
    ...over,
  }) as SplitSummary;

const row = { from: "Alex", to: "Priya", from_id: "m-me", to_id: "m-pri", amount: 30 };

describe("billsFor", () => {
  it("keeps what the payer covered and you haven't settled, newest first", () => {
    const t = tab({
      splits: [
        split("old", "Priya", "2026-10-01", [{ member: "Alex", amount: 10, settled: false }]),
        split("new", "Priya", "2026-10-09", [{ member: "Alex", amount: 20, settled: false }]),
        split("done", "Priya", "2026-10-10", [{ member: "Alex", amount: 5, settled: true }]),
        split("yours", "Alex", "2026-10-11", [{ member: "Priya", amount: 7, settled: false }]),
      ],
    });
    expect(billsFor({ tab: t, row, index: 0 }).map((b) => b.split.split_id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("never mixes currencies into a payment", () => {
    const t = tab({
      splits: [split("eur", "Priya", "2026-10-09", [{ member: "Alex", amount: 9 }], "EUR")],
    });
    expect(billsFor({ tab: t, row, index: 0 })).toEqual([]);
  });
});

describe("peopleIn", () => {
  it("is one row for one friend on two tabs, matched by account", () => {
    const rows: Owed[] = [
      { tab: tab({ group_id: "a" }), row, index: 0 },
      { tab: tab({ group_id: "b" }), row, index: 0 },
    ];
    expect(peopleIn(rows)).toHaveLength(1);
    expect(byCurrency(rows)).toEqual({ USD: 60 });
  });

  it("lists everyone but you as friends", () => {
    expect(friendsIn([tab({})]).map((p) => p.name)).toEqual(["Priya"]);
  });
});

describe("paidPercent", () => {
  it("is 100 once nothing is left to settle, whatever the share flags say", () => {
    const shares = [{ member: "Priya", amount: 10, settled: false }];
    expect(paidPercent(tab({ splits: [split("a", "Alex", "", shares)] }))).toBe(100);
  });

  it("is the settled share of the money while something is open", () => {
    const shares = [
      { member: "Priya", amount: 25, settled: true },
      { member: "Ben", amount: 75, settled: false },
    ];
    const t = tab({ splits: [split("a", "Alex", "", shares)], suggested_settlements: [row] });
    expect(paidPercent(t)).toBe(25);
  });
});
