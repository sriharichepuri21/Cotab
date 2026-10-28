import { describe, expect, it } from "vitest";

import { share, splitBill } from "./split";

describe("share", () => {
  it("hands every cent out", () => {
    expect(share(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(share(530, [1350, 0])).toEqual([530, 0]);
    expect(share(530, [0, 0])).toEqual([0, 0]);
  });
});

describe("splitBill", () => {
  const lines = [
    { name: "Tacos", cents: 1350, who: ["A"] },
    { name: "Chips", cents: 900, who: ["A", "M", "B"] },
    { name: "Fries", cents: 550, who: [] },
  ];

  it("keeps unclaimed lines and their tax apart, and the parts add up", () => {
    const { owed, unclaimed } = splitBill(lines, ["A", "M", "B"], 249);
    expect(owed.A + owed.M + owed.B + unclaimed).toBe(1350 + 900 + 550 + 249);
    expect(unclaimed).toBeGreaterThan(550);
    // equal shares; the odd tax cent lands on one of them
    expect(Math.abs(owed.M - owed.B)).toBeLessThanOrEqual(1);
  });

  it("leaves nothing unclaimed once every line has a name", () => {
    const all = lines.map((l) => ({ ...l, who: l.who.length ? l.who : ["B"] }));
    const { owed, unclaimed } = splitBill(all, ["A", "M", "B"], 249);
    expect(unclaimed).toBe(0);
    expect(owed.A + owed.M + owed.B).toBe(3049);
  });
});
