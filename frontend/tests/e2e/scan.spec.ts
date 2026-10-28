import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * The scanner end to end in a real browser: the photo-quality check runs for
 * real on real image files; only the server's answers are mocked.
 */

const token = "deterministic-e2e-token";
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

type Reply = { status: number; json: unknown };

async function signedIn(
  page: Page,
  uploadReplies: Reply[],
  scanReplies: unknown[] = [],
  manualExpense?: Record<string, unknown>
) {
  const uploads: string[] = [];
  let manualSaved = false;
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/me") {
      return route.fulfill({
        json: {
          id: "u",
          email: "e2e@example.com",
          full_name: "E2E",
          timezone: "UTC",
          intent: "personal",
        },
      });
    }
    if (url.pathname === "/api/v1/receipts/upload") {
      uploads.push(route.request().headers()["content-type"] ?? "");
      const reply = uploadReplies.shift() ?? { status: 500, json: { detail: "no more replies" } };
      return route.fulfill({ status: reply.status, json: reply.json });
    }
    if (url.pathname === "/api/v1/receipts/guess-category") {
      return route.fulfill({ json: { category: "bars" } });
    }
    if (url.pathname === "/api/v1/receipts/manual" && route.request().method() === "POST") {
      manualSaved = true;
      return route.fulfill({ status: 201, json: manualExpense });
    }
    if (/^\/api\/v1\/receipts\/[^/]+\/scan$/.test(url.pathname)) {
      return route.fulfill({ json: scanReplies.length > 1 ? scanReplies.shift() : scanReplies[0] });
    }
    if (url.pathname === "/api/v1/receipts/") {
      return route.fulfill({
        headers: { "X-Total-Count": manualSaved ? "1" : "0" },
        json: manualSaved && manualExpense ? [manualExpense] : [],
      });
    }
    if (url.pathname.startsWith("/api/v1/receipts") || url.pathname === "/api/v1/insights") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 404, json: { detail: "unmocked" } });
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app");
  await page.getByRole("button", { name: "Scan a receipt" }).click();
  await expect(page.getByRole("dialog", { name: "Receipt camera" })).toBeVisible();
  await page.getByRole("button", { name: "More scan options" }).click();
  await expect(page.getByRole("dialog", { name: "Add a receipt" })).toBeVisible();
  return uploads;
}

const added = (merchant: string) => ({
  status: 201,
  json: { id: "r1", status: "extracted", merchant, total: 41.2, budget_alerts: [], line_items: [] },
});

const scanner = (page: Page) => page.getByRole("dialog");

test("a sharp receipt photo goes straight onto the tab", async ({ page }) => {
  const uploads = await signedIn(page, [added("Corner Market")]);
  await page.getByTestId("scan-photos").setInputFiles(fixture("receipt-sharp.jpg"));
  const sheet = scanner(page);
  await expect(sheet.getByRole("heading", { name: "1 added to your tab" })).toBeVisible();
  await expect(sheet.getByText("Corner Market", { exact: true })).toBeVisible();
  await expect(sheet.getByText("$41.20", { exact: true })).toBeVisible();
  // Only what the server said: no made-up budget or Apple Pay news.
  await expect(sheet.getByText(/budget/i)).toHaveCount(0);
  await expect(sheet.getByText(/Apple Pay/)).toHaveCount(0);
  expect(uploads).toHaveLength(1);
});

test("a manual alcohol expense saves for real and appears in Activity", async ({ page }) => {
  const saved = {
    id: "manual-1",
    merchant: "Wine for dinner",
    merchant_raw: "",
    total: 55,
    subtotal: 55,
    tax: 0,
    currency: "USD",
    category: "bars",
    status: "reviewed",
    source: "manual",
    confidence: 1,
    purchased_at: "2026-10-25T12:00:00Z",
    line_items: [],
    my_share: null,
    split_group_id: null,
  };
  await signedIn(page, [], [], saved);
  const sheet = scanner(page);
  await sheet.getByText("Add without a receipt").click();
  await sheet.getByLabel("What was it for?").fill("Wine for dinner");
  await expect(sheet.getByText(/suggested Bars & alcohol/)).toBeVisible();

  await sheet.getByRole("button", { name: /Category Bars & alcohol/ }).click();
  await expect(sheet.getByRole("radio")).toHaveCount(12);
  await sheet.getByRole("radio", { name: /Bars & alcohol/ }).click();
  await sheet.getByLabel("Total amount").fill("5500");
  await expect(sheet.getByLabel("Total amount")).toHaveValue("55.00");

  const savedRequest = page.waitForRequest(
    (request) => request.url().endsWith("/api/v1/receipts/manual") && request.method() === "POST"
  );
  await sheet.getByRole("button", { name: "Add $55.00 expense" }).click();
  const body = (await savedRequest).postDataJSON();
  expect(body).toMatchObject({ description: "Wine for dinner", amount: 55, category: "bars" });
  await expect(sheet.getByText("Saved without a receipt image")).toBeVisible();

  await sheet.getByRole("button", { name: "View in Activity" }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await expect(page.getByText("Wine for dinner")).toBeVisible();
});

test("a blurry photo is caught on the phone before uploading", async ({ page }) => {
  const uploads = await signedIn(page, [added("Corner Market")]);
  await page.getByTestId("scan-camera").setInputFiles(fixture("receipt-blurry.jpg"));
  const sheet = scanner(page);
  await expect(sheet.getByText("This photo looks blurry")).toBeVisible();
  await expect(sheet.getByText(/One or more photos need a look/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Remove / })).toBeVisible();
  expect(uploads).toHaveLength(0);

  await sheet.getByRole("button", { name: "Use selected photos and read" }).click();
  await expect(sheet.getByText("Corner Market", { exact: true })).toBeVisible();
  await expect(sheet.getByText("$41.20", { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(1);
});

test("something that isn't a receipt is refused with a way to try again", async ({ page }) => {
  await signedIn(page, [
    {
      status: 422,
      json: {
        detail: {
          code: "not_a_receipt",
          message:
            "That doesn't look like a receipt, so nothing was added. Try again with a photo of the receipt itself.",
        },
      },
    },
  ]);
  await page.getByTestId("scan-camera").setInputFiles(fixture("not-a-receipt.jpg"));
  const sheet = scanner(page);
  await expect(sheet.getByRole("heading", { name: "These receipts need attention" })).toBeVisible();
  await expect(sheet.getByText("Not a receipt")).toBeVisible();
  await expect(sheet.getByText(/nothing was added/).first()).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Take another photo" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Scan another" })).toBeVisible();
});

test("several receipts at once, including a PDF and a duplicate", async ({ page }) => {
  const uploads = await signedIn(page, [
    added("Corner Market"),
    added("Safeway"),
    {
      status: 409,
      json: {
        detail: {
          code: "duplicate",
          message: "This receipt is already on your tab.",
          receipt_id: "old",
        },
      },
    },
  ]);
  await page
    .getByTestId("scan-files")
    .setInputFiles([
      fixture("receipt-sharp.jpg"),
      fixture("invoice.pdf"),
      fixture("not-a-receipt.jpg"),
    ]);
  const sheet = scanner(page);
  // The duplicate is not counted as added, and links to the receipt it repeats.
  await expect(sheet.getByRole("heading", { name: "2 added to your tab" })).toBeVisible();
  await expect(sheet.getByText("Already on your tab")).toBeVisible();
  expect(uploads).toHaveLength(3);

  await sheet.getByRole("button", { name: "Open it" }).click();
  await expect(page).toHaveURL(/\/app\?receipt=old$/);
});

test("a scan is saved at once and fills in when the read finishes", async ({ page }) => {
  const reading = { id: "r1", state: "reading", receipt: null };
  const done = {
    id: "r1",
    state: "added",
    receipt: {
      id: "r1",
      status: "extracted",
      merchant: "Corner Market",
      total: 41.2,
      line_items: [],
    },
    code: null,
    message: "",
    budget_alerts: [],
    possible_duplicate_of: null,
  };
  await signedIn(
    page,
    [
      {
        status: 201,
        json: { id: "r1", status: "processing", merchant: "", total: 0, line_items: [] },
      },
    ],
    [reading, reading, done]
  );
  await page.getByTestId("scan-photos").setInputFiles(fixture("receipt-sharp.jpg"));
  const sheet = scanner(page);
  await expect(sheet.getByRole("heading", { name: "Tabby is reading" })).toBeVisible();
  await expect(sheet.getByText(/reading continues in the background/)).toBeVisible();
  await expect(sheet.getByText("Corner Market", { exact: true })).toBeVisible();
  await expect(sheet.getByText("$41.20", { exact: true })).toBeVisible();
});

test("a budget the scan pushed past a line is shown as the server reported it", async ({
  page,
}) => {
  await signedIn(page, [
    {
      status: 201,
      json: {
        id: "r1",
        status: "extracted",
        merchant: "Corner Market",
        total: 41.2,
        line_items: [],
        matched_tap: true,
        budget_alerts: [
          {
            budget_id: "b1",
            label: "groceries",
            level: "category",
            target: "groceries",
            period: "monthly",
            limit: 200,
            spent: 210.5,
            remaining: -10.5,
            percent_used: 105.3,
            over_budget: true,
            period_start: "2026-10-01",
            period_end: "2026-10-31",
            thresholds: [80, 100, 120],
            threshold_reached: 100,
          },
        ],
      },
    },
  ]);
  await page.getByTestId("scan-photos").setInputFiles(fixture("receipt-sharp.jpg"));
  const sheet = scanner(page);
  await expect(sheet.getByText("groceries budget")).toBeVisible();
  await expect(sheet.getByText("$10.50 over")).toBeVisible();
  await expect(sheet.getByText("Matched your Apple Pay tap")).toBeVisible();
});
