import { describe, expect, it } from "vitest";

import { newUiPath } from "@/lib/routes";

describe("newUiPath", () => {
  it("keeps Tabby activity inside the New UI", () => {
    expect(newUiPath("/app/tabby")).toBe("/app?tab=tabby");
    expect(newUiPath("/app/groups/roommates")).toBe("/app?tab=circles&group=roommates");
    expect(newUiPath("/app/receipts/receipt-1")).toBe("/app?receipt=receipt-1");
    expect(newUiPath("/app/insights")).toBe("/app?panel=insights");
    expect(newUiPath("/app/receipts/receipt-1/split")).toBe("/app?receipt=receipt-1");
    expect(newUiPath("/app/tabby/wrap?month=2026-09")).toBe("/app");
  });

  it("does not rewrite external or already-new links", () => {
    expect(newUiPath("https://example.com")).toBe("https://example.com");
    expect(newUiPath("/app?tab=tabby")).toBe("/app?tab=tabby");
  });
});
