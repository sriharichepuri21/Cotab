import { expect, test, type Page } from "@playwright/test";

const token = "deterministic-e2e-token";

/** 120 receipts on the server, newest first, served a page at a time. */
const ALL = Array.from({ length: 120 }, (_, i) => ({
  id: `r${i}`,
  merchant: i === 3 ? "Starbucks" : `Shop ${i}`,
  purchased_at: new Date(Date.UTC(2026, 9, 13) - i * 86_400_000).toISOString(),
  total: 10 + i,
  subtotal: 10 + i,
  tax: 0,
  currency: "USD",
  category: "groceries",
  status: "reviewed",
  confidence: 1,
  source: i === 3 ? "tap" : i === 5 ? "email" : "photo",
  line_items: [],
}));

async function signedIn(page: Page) {
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    // Cotab's requests carry credentials, so the origin must be named, not "*".
    const cors = {
      "Access-Control-Allow-Origin": route.request().headers()["origin"] ?? "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-Total-Count",
    };
    if (url.pathname === "/api/v1/auth/me") {
      return route.fulfill({
        headers: cors,
        json: {
          id: "u",
          email: "e2e@example.com",
          full_name: "E2E",
          timezone: "UTC",
          intent: "personal",
        },
      });
    }
    if (url.pathname === "/api/v1/receipts/") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return route.fulfill({
        headers: { ...cors, "X-Total-Count": String(ALL.length) },
        json: ALL.slice(offset, offset + limit),
      });
    }
    if (url.pathname === "/api/v1/capture/status") {
      return route.fulfill({
        headers: cors,
        json: { keys: [], last_tap_at: null, taps_this_month: 0 },
      });
    }
    if (url.pathname === "/api/v1/inbox") {
      return route.fulfill({
        headers: cors,
        json: {
          enabled: true,
          address: "e2e-k3x9@in.cotab.app",
          account_email: "e2e@example.com",
          senders: [],
          recent: [
            {
              id: "m1",
              subject: "(#123456789) Gmail Forwarding Confirmation",
              from_address: "forwarding-noreply@google.com",
              status: "ignored",
              reason:
                "Gmail confirmation code: 123456789. Enter it in Gmail's forwarding settings.",
              receipt_id: null,
              created_at: "2026-10-13T10:00:00Z",
            },
          ],
        },
      });
    }
    if (url.pathname === "/api/v1/capture/keys" && route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        headers: cors,
        json: {
          id: "k1",
          name: "iPhone",
          prefix: "ctb_abcd",
          created_at: "2026-10-13T10:00:00Z",
          last_used_at: null,
          key: "ctb_abcdSECRET",
        },
      });
    }
    return route.fulfill({ status: 404, headers: cors, json: { detail: "unmocked" } });
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
}

test("Activity reaches every receipt, a page at a time", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/tab");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Any time" }).click();
  await page.getByRole("button", { name: /^Show \d+ expenses?/ }).click();
  await expect(page.getByText(/^50 of 120 expenses/)).toBeVisible();
  await expect(page.locator("main .receipt-row")).toHaveCount(50);

  await page.getByRole("button", { name: "Show more" }).click();
  await expect(page.getByText(/^100 of 120 expenses/)).toBeVisible();
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(page.locator("main .receipt-row")).toHaveCount(120);
});

test("an Apple Pay tap is labelled in Activity", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app?tab=activity");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Any time" }).click();
  await page.getByRole("button", { name: /^Show \d+ expenses?/ }).click();
  await expect(page.locator("main .receipt-row").filter({ hasText: "Apple Pay" })).not.toHaveCount(
    0
  );
});

test("settings walks through setting up Apple Pay taps", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: /Receipt capture/ }).click();
  await page.getByRole("button", { name: "Set up Apple Pay taps" }).click();
  await expect(page.getByText(/Cotab won't show it again/)).toBeVisible();
  await expect(page.getByText("Bearer ctb_abcdSECRET")).toBeVisible();
  await expect(page.getByText("http://127.0.0.1:8000/api/v1/capture/tap")).toBeVisible();
  await expect(page.getByText("Get Contents of URL")).toBeVisible();
});

test("an emailed receipt is labelled in Activity", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app?tab=activity");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Any time" }).click();
  await page.getByRole("button", { name: /^Show \d+ expenses?/ }).click();
  await expect(page.locator("main .receipt-row").filter({ hasText: "Email" })).not.toHaveCount(0);
});

test("settings shows the forwarding address and Gmail's confirmation code", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: /Receipt capture/ }).click();
  await expect(page.getByRole("heading", { name: "Forward receipts by email" })).toBeVisible();
  await expect(page.getByText("e2e-k3x9@in.cotab.app")).toBeVisible();
  await expect(page.getByText(/Gmail confirmation code: 123456789/)).toBeVisible();
});
