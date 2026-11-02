import { describe, expect, it } from "vitest";

import { receiptFromApi, scanMoney } from "./parts";

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

describe("receiptFromApi", () => {
  const api = { id: "r", merchant: "Blue Bottle", total: 5, category: "dining", line_items: [] };

  it("says where a receipt came from when it wasn't scanned", () => {
    expect(receiptFromApi({ ...api, source: "tap" } as never).note).toContain("Apple Pay");
    expect(receiptFromApi({ ...api, source: "email" } as never).note).toContain("Email");
    expect(receiptFromApi({ ...api, source: "photo" } as never).note).toContain("0 items");
  });
});
