import { describe, expect, it } from "vitest";

import { checkParts, isPartsMode, shown, typedFrom } from "./splitParts";

const names = ["Ada", "Ben", "Cara"];

describe("splitParts", () => {
  it("knows the three modes", () => {
    expect(["exact", "percent", "shares"].every(isPartsMode)).toBe(true);
    expect(isPartsMode("even")).toBe(false);
    expect(isPartsMode("itemized")).toBe(false);
  });

  it("says how much is left to assign, to the cent", () => {
    const check = checkParts("exact", 1000, names, { Ada: "2.43" });
    expect(check).toEqual({
      parts: { Ada: 2.43, Ben: 0, Cara: 0 },
      ok: false,
      note: "$7.57 left to assign",
    });
  });

  it("says how much is over", () => {
    const check = checkParts("exact", 1000, names, { Ada: "6", Ben: "6" });
    expect(check.note).toBe("$2.00 over");
    expect(check.ok).toBe(false);
  });

  it("accepts amounts that add up exactly (no float drift)", () => {
    const check = checkParts("exact", 30, names, { Ada: "0.10", Ben: "0.20" });
    expect(check.ok).toBe(true);
    expect(check.note).toBe("All assigned");
  });

  it("checks percentages against 100", () => {
    expect(checkParts("percent", 1000, names, { Ada: "50", Ben: "35" }).note).toBe("15% left");
    expect(checkParts("percent", 1000, names, { Ada: "60", Ben: "50.5" }).note).toBe("10.5% over");
    const done = checkParts("percent", 1000, names, { Ada: "33.34", Ben: "33.33", Cara: "33.33" });
    expect(done.ok).toBe(true);
  });

  it("counts shares, starting everyone at 1", () => {
    expect(shown("shares", {}, "Ada")).toBe("1");
    expect(shown("exact", {}, "Ada")).toBe("");
    expect(checkParts("shares", 1000, names, {})).toMatchObject({ ok: true, note: "3 shares" });
    expect(checkParts("shares", 1000, names, { Ada: "2", Ben: "1", Cara: "1" }).note).toBe(
      "4 shares"
    );
    expect(checkParts("shares", 1000, ["Ada"], { Ada: "1" }).note).toBe("1 share");
  });

  it("needs at least one share", () => {
    const check = checkParts("shares", 1000, names, { Ada: "0", Ben: "0", Cara: "0" });
    expect(check).toMatchObject({ ok: false, note: "Give someone a share." });
  });

  it("refuses things that aren't numbers, fractions of a cent, fractional shares", () => {
    expect(checkParts("exact", 1000, names, { Ada: "abc" }).ok).toBe(false);
    expect(checkParts("exact", 1000, names, { Ada: "1.005" }).note).toBe(
      "Use dollars and cents only."
    );
    expect(checkParts("shares", 1000, names, { Ada: "1.5" }).note).toBe("Use whole numbers only.");
    expect(checkParts("exact", 1000, names, { Ada: "-5" }).ok).toBe(false);
    expect(checkParts("percent", 1000, names, { Ada: "." }).ok).toBe(false);
  });

  it("allows a $ or % the person typed", () => {
    expect(checkParts("exact", 1000, ["Ada"], { Ada: "$10" }).ok).toBe(true);
    expect(checkParts("percent", 1000, ["Ada"], { Ada: "100%" }).ok).toBe(true);
  });

  it("prefills the boxes from a saved split", () => {
    expect(typedFrom({ Ada: 2.43, Ben: 7.57 })).toEqual({ Ada: "2.43", Ben: "7.57" });
    expect(typedFrom(undefined)).toEqual({});
  });
});
