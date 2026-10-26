import { expect, test, type Page } from "@playwright/test";

/** Notifications come from the real review queue, budgets and Tabby's rules. */

const token = "deterministic-e2e-token";

async function open(page: Page, quiet = false) {
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/api/v1/auth/me")
      return json({
        id: "u",
        email: "e2e@example.com",
        full_name: "E2E",
        timezone: "UTC",
        intent: "personal",
      });
    const costco = {
      id: "r1",
      merchant: "Costco",
      purchased_at: new Date().toISOString(),
      total: 84.2,
      subtotal: 80,
      tax: 4.2,
      currency: "USD",
      category: "groceries",
      status: "needs_review",
      confidence: 0.6,
      line_items: [],
    };
    if (path === "/api/v1/receipts/r1") return json(costco);
    if (path === "/api/v1/receipts/review-queue") return json(quiet ? [] : [costco]);
    if (path === "/api/v1/budgets/")
      return json(
        quiet
          ? []
          : [
              {
                budget_id: "b1",
                label: "dining",
                level: "category",
                target: "dining",
                period: "monthly",
                limit: 100,
                spent: 85,
                remaining: 15,
                percent_used: 85,
                over_budget: false,
                period_start: "2026-10-01",
                period_end: "2026-10-31",
                thresholds: [80, 100, 120],
                threshold_reached: 80,
              },
            ]
      );
    if (path === "/api/v1/insights" || path === "/api/v1/tabby/activity") return json([]);
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?panel=notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
}

test("shows real notices, never the demo ones, and opens what they're about", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Check the Costco receipt")).toBeVisible();
  await expect(page.getByText("Dining has $15.00 left")).toBeVisible();
  await expect(page.getByText("2 worth a look")).toBeVisible();
  await expect(page.getByText("Cara paid you $3.40")).toHaveCount(0);

  await page.getByRole("button", { name: /Check the Costco receipt/ }).click();
  await expect(page).toHaveURL(/receipt=r1/);
  await expect(page.getByText("$84.20").first()).toBeVisible();
});

test("mark all read stays read on this device", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Check the Costco receipt")).toBeVisible();
  await expect(page.getByText("You're all caught up")).toBeVisible();
});

test("says so when nothing needs you", async ({ page }) => {
  await open(page, true);
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});
