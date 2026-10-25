import { describe, expect, it } from "vitest";

import { amount, categoryLabel, dayLabel, greeting, money } from "./format";

describe("format", () => {
  const now = new Date(2026, 9, 12, 20, 0);

  it("labels days relative to today", () => {
    expect(dayLabel(new Date(2026, 9, 12, 9).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 11, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 10, 12).toISOString(), now)).toBe("Sat, Oct 10");
    expect(dayLabel(null, now)).toBe("No date");
  });

  it("formats money with the currency and receipt amounts without", () => {
    expect(money(1240.18)).toBe("$1,240.18");
    expect(amount(1240.18)).toBe("1,240.18");
  });

  it("capitalises categories and greets by time of day", () => {
    expect(categoryLabel("groceries")).toBe("Groceries");
    expect(categoryLabel("drinks")).toBe("Drinks");
    expect(categoryLabel("bars")).toBe("Bars & alcohol");
    expect(greeting(new Date(2026, 9, 12, 8))).toBe("Good morning");
    expect(greeting(now)).toBe("Good evening");
  });
});
