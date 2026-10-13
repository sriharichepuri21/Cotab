import { expect, test, type Page } from "@playwright/test";

const token = "deterministic-e2e-token";

async function mockApi(page: Page, intent: string | null = null) {
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/auth/register") {
      await route.fulfill({ json: { access_token: token, refresh_token: token } });
      return;
    }
    if (path === "/api/v1/auth/login") {
      await route.fulfill({ json: { access_token: token, refresh_token: token } });
      return;
    }
    if (path === "/api/v1/auth/me") {
      await route.fulfill({
        json: {
          id: "e2e-user",
          email: "e2e@example.com",
          full_name: "E2E User",
          timezone: "UTC",
          intent,
        },
      });
      return;
    }
    if (path === "/api/v1/auth/set-intent") {
      await route.fulfill({
        json: {
          id: "e2e-user",
          email: "e2e@example.com",
          full_name: "E2E User",
          timezone: "UTC",
          intent: "personal",
        },
      });
      return;
    }
    if (path === "/api/v1/receipts/" || path === "/api/v1/insights") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `Unmocked API: ${path}` } });
  });
}

test("registers and reaches the intent picker", async ({ page }) => {
  await mockApi(page);
  await page.goto("/register");

  await page.getByLabel("Your name").fill("E2E User");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "What brings you here?" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("rw_token"))).toBe(token);
});

test("logs in and sends unfinished onboarding to welcome", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");

  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("One quick thing")).toBeVisible();
});

test("submits the selected onboarding intent", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript((value) => sessionStorage.setItem("rw_token", value), token);
  await page.goto("/welcome");

  const intentRequest = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/set-intent")
  );
  await page.getByRole("button", { name: /Track my personal expenses/ }).click();
  const response = await intentRequest;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toEqual({ intent: "personal" });
});

test("an authenticated user lands in the app shell", async ({ page }) => {
  await mockApi(page, "personal");
  await page.addInitScript((value) => sessionStorage.setItem("rw_token", value), token);
  await page.goto("/");

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: /^Good (morning|afternoon|evening), E2E$/ })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeAttached();
  await expect(page.getByLabel("Scan a receipt").first()).toBeAttached();
});

test("a signed-out visitor is sent from the app to sign in", async ({ page }) => {
  await mockApi(page);
  await page.goto("/app/budgets");
  await expect(page).toHaveURL(/\/login$/);
});
