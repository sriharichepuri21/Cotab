import { expect, test, type Page } from "@playwright/test";

/** Opening, correcting and deleting a receipt in the app, against a mocked API. */

const token = "deterministic-e2e-token";

const receipt = {
  id: "r1",
  merchant: "Corner Market",
  purchased_at: "2026-10-24T18:30:00Z",
  total: 28,
  subtotal: 23.99,
  tax: 4.01,
  currency: "USD",
  category: "groceries",
  status: "extracted",
  confidence: 0.91,
  source: "photo",
  my_share: null,
  line_items: [
    {
      id: "l1",
      description: "OAT MILK",
      item_name: "Oat milk",
      quantity: 1,
      unit_price: 3.99,
      total_price: 3.99,
    },
    {
      id: "l2",
      description: "SOURDOUGH",
      item_name: "Sourdough",
      quantity: 2,
      unit_price: 10,
      total_price: 20,
    },
  ],
};

async function open(page: Page) {
  const seen: { review?: Record<string, unknown>; deleted?: boolean } = {};
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/v1/auth/me")
      return route.fulfill({
        json: {
          id: "u",
          email: "e2e@example.com",
          full_name: "E2E",
          timezone: "UTC",
          intent: "personal",
        },
      });
    if (url.pathname === "/api/v1/receipts/r1" && method === "GET")
      return route.fulfill({ json: receipt });
    if (url.pathname === "/api/v1/receipts/r1" && method === "DELETE") {
      seen.deleted = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname === "/api/v1/receipts/r1/image")
      return route.fulfill({ status: 404, json: { detail: "No image" } });
    if (url.pathname === "/api/v1/receipts/r1/review") {
      seen.review = route.request().postDataJSON();
      const body = seen.review as { merchant: string; total: number; category: string };
      return route.fulfill({ json: { ...receipt, ...body, status: "reviewed" } });
    }
    if (url.pathname.startsWith("/api/v1/receipts")) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: "unmocked" } });
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?receipt=r1");
  await expect(page.getByRole("heading", { level: 1, name: "Corner Market" })).toBeVisible();
  return seen;
}

test("a receipt shows what was really read", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Oat milk")).toBeVisible();
  await expect(page.getByText("2 × Sourdough")).toBeVisible();
  await expect(page.getByText("Tax, tip and fees")).toBeVisible();
  await expect(page.getByText("91% confidence")).toBeVisible();
  // No photo on the server: no button that opens a made-up one.
  await expect(page.getByText("Original receipt")).toHaveCount(0);
  await expect(page.getByText("Dinner items")).toHaveCount(0);
});

test("correcting a receipt saves cent-exact amounts and shows the result", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: "Edit receipt" }).click();
  await page.getByLabel("Store").fill("Corner Market & Deli");
  await page.getByLabel("Item 1 price").fill("4.10");
  // Items now $24.10 against a $23.99 subtotal: it says so.
  await expect(
    page.getByText("Items add up to $24.10, but the subtotal says $23.99.")
  ).toBeVisible();
  await page.getByLabel("Subtotal", { exact: true }).fill("24.10");
  await page.getByLabel("Total", { exact: true }).fill("28.11");
  await expect(page.getByText("Items, charges and total add up.")).toBeVisible();

  await page.getByLabel("Item 1 price").fill("4.105");
  await expect(page.getByRole("button", { name: "Save receipt changes" })).toBeDisabled();
  await page.getByLabel("Item 1 price").fill("4.10");

  await page.getByRole("button", { name: "Save receipt changes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Corner Market & Deli" })).toBeVisible();
  expect(seen.review).toMatchObject({
    merchant: "Corner Market & Deli",
    subtotal: 24.1,
    tax: 4.01,
    total: 28.11,
    category: "groceries",
  });
  const lines = (seen.review as { line_items: Array<Record<string, unknown>> }).line_items;
  expect(lines[0]).toMatchObject({ id: "l1", total_price: 4.1, unit_price: 4.1 });
  expect(lines[1]).toMatchObject({ id: "l2", quantity: 2, total_price: 20, unit_price: 10 });
});

test("the category list is the app's real categories", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit receipt" }).click();
  const options = await page.getByLabel("Category").locator("option").allTextContents();
  expect(options).toContain("Drinks");
  expect(options).not.toContain("Bills");
});

test("deleting asks first, then removes the receipt", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: "Delete receipt" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this receipt?" });
  await confirm.getByRole("button", { name: "Keep it" }).click();
  expect(seen.deleted).toBeUndefined();
  await page.getByRole("button", { name: "Delete receipt" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Corner Market" })).toHaveCount(0);
  expect(seen.deleted).toBe(true);
});
