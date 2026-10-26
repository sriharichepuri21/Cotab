import { describe, expect, it } from "vitest";

import { scanMoney } from "./parts";

describe("scanMoney", () => {
  it("formats in the receipt's currency", () => {
    expect(scanMoney(41.2, "USD")).toBe("$41.20");
    expect(scanMoney(41.2, "EUR")).toBe("€41.20");
  });

  it("falls back to USD when a receipt has no currency, as the backend does", () => {
    expect(scanMoney(41.2, undefined)).toBe("$41.20");
    expect(scanMoney(41.2, null)).toBe("$41.20");
    expect(scanMoney(41.2, "")).toBe("$41.20");
  });
});
