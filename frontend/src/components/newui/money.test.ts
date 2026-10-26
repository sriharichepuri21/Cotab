import { describe, expect, it } from "vitest";

import { centsText, parseCents, reconcile, unitCents } from "./money";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

describe("parseCents", () => {
  it("reads amounts people type", () => {
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents("$12.50")).toBe(1250);
    expect(parseCents("1,240.18")).toBe(124018);
    expect(parseCents("-3")).toBe(-300);
    expect(parseCents(".99")).toBe(99);
    expect(parseCents("")).toBe(0);
  });

  it("refuses what isn't an amount", () => {
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("1.005")).toBeNull();
    expect(parseCents(".")).toBeNull();
    expect(parseCents("-")).toBeNull();
  });

  it("does not drift: 0.10 + 0.20 is exactly 30 cents", () => {
    expect((parseCents("0.10") ?? 0) + (parseCents("0.20") ?? 0)).toBe(30);
  });
});

describe("centsText and unitCents", () => {
  it("round-trips and splits a line to the cent", () => {
    expect(centsText(1250)).toBe("12.50");
    expect(unitCents(1000, 3)).toBe(333);
    expect(unitCents(1000, 0)).toBe(1000);
  });
});

describe("reconcile", () => {
  it("passes when items, charges and total agree", () => {
    expect(reconcile(2399, 2399, 401, 2800, usd)).toEqual({
      ok: true,
      message: "Items, charges and total add up.",
    });
  });

  it("says which number is off", () => {
    expect(reconcile(2300, 2399, 401, 2800, usd).message).toBe(
      "Items add up to $23.00, but the subtotal says $23.99."
    );
    expect(reconcile(2399, 2399, 400, 2800, usd).message).toBe(
      "Subtotal plus tax and tip is $27.99, but the total says $28.00."
    );
  });
});
