import { describe, expect, it } from "vitest";

import { routes } from "./routes";

describe("routes", () => {
  it("keeps every signed-in page under /app", () => {
    expect(routes.home).toBe("/app");
    expect(routes.budgets.startsWith("/app/")).toBe(true);
    expect(routes.groups.startsWith("/app/")).toBe(true);
    expect(routes.receipt("r1")).toBe("/app/receipts/r1");
    expect(routes.splitReceipt("r1")).toBe("/app/receipts/r1/split");
    expect(routes.group("g1")).toBe("/app/groups/g1");
  });

  it("keeps public pages outside /app", () => {
    for (const path of [routes.landing, routes.login, routes.register, routes.share("c")]) {
      expect(path.startsWith("/app")).toBe(false);
    }
  });
});
