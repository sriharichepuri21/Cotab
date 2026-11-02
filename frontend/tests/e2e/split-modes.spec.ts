import { expect, test, type Page } from "@playwright/test";

const token = "deterministic-e2e-token";

const receipt = {
  id: "r1",
  merchant: "Costco",
  purchased_at: "2026-10-13T10:00:00Z",
  total: 10,
  subtotal: 10,
  tax: 0,
  currency: "USD",
  category: "groceries",
  status: "reviewed",
  confidence: 1,
  source: "photo",
  line_items: [],
};

const tab = {
  id: "g1",
  name: "You & Ben",
  share_code: "abc",
  share_url: "http://127.0.0.1:3000/join/abc",
  kind: "direct",
  members: [
    { id: "m1", name: "E2E" },
    { id: "m2", name: "Ben" },
  ],
};

/** The posted split, and what the preview was last asked. */
async function mockApi(page: Page) {
  const seen: { split?: Record<string, unknown>; previews: Array<Record<string, unknown>> } = {
    previews: [],
  };
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const cors = {
      "Access-Control-Allow-Origin": route.request().headers()["origin"] ?? "*",
      "Access-Control-Allow-Credentials": "true",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ headers: cors });
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    const json = (data: unknown) => route.fulfill({ headers: cors, json: data });
    switch (url.pathname) {
      case "/api/v1/auth/me":
        return json({
          id: "u",
          email: "e2e@example.com",
          full_name: "E2E",
          timezone: "UTC",
          intent: "personal",
        });
      case "/api/v1/receipts/r1":
        return json(receipt);
      case "/api/v1/splits/groups":
        return json([]);
      case "/api/v1/splits/people":
        return json([]);
      case "/api/v1/splits/suggestions/r1":
        return json({
          contacts: [],
          merchant: "Costco",
          merchant_history_count: 1,
          suggested_people: [{ name: "Ben", email: null, split_count: 2 }],
          assignments: {},
          confidence: 1,
          auto_apply: true,
        });
      case "/api/v1/splits/preview": {
        seen.previews.push(body ?? {});
        const parts = (body?.parts ?? {}) as Record<string, number>;
        const added = Object.values(parts).reduce((sum, n) => sum + n, 0);
        const base = { total: 10, items_total: 0, extra: 10, currency: "USD" };
        if (Math.round(added * 100) !== 1000)
          return json({
            ...base,
            message: `These add up to $${added.toFixed(2)}; $${(10 - added).toFixed(2)} is left to assign.`,
          });
        return json({ ...base, shares: parts });
      }
      case "/api/v1/splits/direct":
        return json(tab);
      case "/api/v1/splits/groups/g1/splits":
        seen.split = body ?? {};
        return json({ split_id: "s1", shares: { E2E: 2.43, Ben: 7.57 } });
      default:
        return route.fulfill({ status: 404, headers: cors, json: { detail: "unmocked" } });
    }
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  return seen;
}

test("old receipt and split links open the receipt in the app", async ({ page }) => {
  await mockApi(page);
  await page.goto("/app/receipts/r1");
  await expect(page).toHaveURL(/\/app\?receipt=r1/);

  await page.goto("/app/receipts/r1/split");
  await expect(page).toHaveURL(/\/app\?receipt=r1/);
  await page.getByRole("button", { name: "Split this" }).click();
  await expect(page.getByRole("button", { name: "Add someone to split with" })).toBeDisabled();
});
