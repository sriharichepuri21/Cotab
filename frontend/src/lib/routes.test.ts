import { describe, expect, it } from "vitest";

import { routes, safeNext, withNext } from "./routes";

describe("routes", () => {
  it("uses the new mobile UI as the signed-in home", () => {
    expect(routes.home).toBe("/mobile-demo");
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

  it("only follows ?next= to share links and app pages", () => {
    expect(safeNext("/share/abc")).toBe("/share/abc");
    expect(safeNext("/app/groups/g1")).toBe("/app/groups/g1");
    expect(safeNext("/app")).toBe("/app");
    for (const bad of [
      null,
      "",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/login",
      "/apples",
    ]) {
      expect(safeNext(bad)).toBeNull();
    }
    expect(withNext("/login", "/share/a b")).toBe("/login?next=%2Fshare%2Fa%20b");
  });
});
