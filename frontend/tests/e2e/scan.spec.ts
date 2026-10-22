import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * The scanner end to end in a real browser: the photo-quality check runs for
 * real on real image files; only the server's answers are mocked.
 */

const token = "deterministic-e2e-token";
const fixture = (name: string) => path.join(__dirname, "fixtures", name);

type Reply = { status: number; json: unknown };

async function signedIn(page: Page, uploadReplies: Reply[], scanReplies: unknown[] = []) {
  const uploads: string[] = [];
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
    if (/^\/api\/v1\/receipts\/[^/]+\/scan$/.test(url.pathname)) {
      return route.fulfill({ json: scanReplies.length > 1 ? scanReplies.shift() : scanReplies[0] });
    }
    if (url.pathname.startsWith("/api/v1/receipts") || url.pathname === "/api/v1/insights") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 404, json: { detail: "unmocked" } });
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app");
  // Phones use the round Scan button in the tab bar, wider screens the
  // sidebar's "Scan receipts"; click whichever this screen shows.
  await page
    .locator('[aria-label="Scan a receipt"]:visible, button:has-text("Scan receipts"):visible')
    .first()
    .click();
  return uploads;
}

const added = (merchant: string) => ({
  status: 201,
  json: { id: "r1", status: "extracted", merchant, total: 41.2, budget_alerts: [], line_items: [] },
});

test("a sharp receipt photo goes straight onto the tab", async ({ page }) => {
  const uploads = await signedIn(page, [added("Corner Market")]);
  await page.getByTestId("scan-photos").setInputFiles(fixture("receipt-sharp.jpg"));
  await expect(page.getByRole("status")).toContainText("Corner Market is on your tab");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(uploads).toHaveLength(1);
});

test("a blurry photo is caught on the phone before uploading", async ({ page }) => {
  const uploads = await signedIn(page, [added("Corner Market")]);
  await page.getByTestId("scan-camera").setInputFiles(fixture("receipt-blurry.jpg"));
  const dialog = page.getByRole("dialog", { name: "Add receipts" });
  await expect(dialog.getByText("This photo looks blurry")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retake" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose another" })).toBeVisible();
  expect(uploads).toHaveLength(0);

  await dialog.getByRole("button", { name: "Use it anyway" }).click();
  await expect(page.getByRole("status")).toContainText("Corner Market is on your tab");
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
  const dialog = page.getByRole("dialog", { name: "Add receipts" });
  await expect(dialog.getByText("Not a receipt")).toBeVisible();
  await expect(dialog.getByText(/nothing was added/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose a photo" })).toBeVisible();
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
  const dialog = page.getByRole("dialog", { name: "Add receipts" });
  await expect(dialog.getByText("Already on your tab")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open it" })).toHaveAttribute(
    "href",
    "/app/receipts/old"
  );
  await expect(dialog.getByText("Done")).toBeVisible();
  expect(uploads).toHaveLength(3);
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
  const dialog = page.getByRole("dialog", { name: "Add receipts" });
  await expect(dialog.getByText("Saved. Reading every line…")).toBeVisible();
  await expect(dialog.getByText(/You can close this/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Corner Market is on your tab");
});
