import { describe, expect, it } from "vitest";

import { formatUsPhone, looksComplete, prettyPhone } from "./phone";

describe("phone", () => {
  it("formats a US number as it's typed", () => {
    expect(formatUsPhone("")).toBe("");
    expect(formatUsPhone("4")).toBe("(4");
    expect(formatUsPhone("4155")).toBe("(415) 5");
    expect(formatUsPhone("4155550")).toBe("(415) 555-0");
    expect(formatUsPhone("4155550123")).toBe("(415) 555-0123");
  });

  it("accepts pasted numbers in any shape, with or without +1", () => {
    expect(formatUsPhone("+1 415-555-0123")).toBe("(415) 555-0123");
    expect(formatUsPhone("1 (415) 555.0123")).toBe("(415) 555-0123");
    expect(formatUsPhone("415555012399")).toBe("(415) 555-0123");
  });

  it("knows when ten digits are in", () => {
    expect(looksComplete("(415) 555-012")).toBe(false);
    expect(looksComplete("(415) 555-0123")).toBe(true);
    expect(looksComplete("+1 415 555 0123")).toBe(true);
  });

  it("shows a stored number the familiar way", () => {
    expect(prettyPhone("+14155550123")).toBe("(415) 555-0123");
    expect(prettyPhone(null)).toBe("");
  });
});
