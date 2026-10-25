import { expect, test, type Page } from "@playwright/test";

const token = "deterministic-e2e-token";

async function mockApi(
  page: Page,
  intent: string | null = null,
  { phone: startPhone = "+14155550123" }: { phone?: string | null } = {}
) {
  // A new account starts unconfirmed; "123456" is the code in the email.
  let verified = true;
  // A new account has no mobile number until the step after the code.
  let phone: string | null = startPhone;
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/v1/auth/providers") {
      await route.fulfill({ json: { google_client_id: null, apple_client_id: null } });
      return;
    }
    if (path === "/api/v1/auth/register") {
      verified = false;
      phone = null;
      await route.fulfill({
        json: { access_token: token, email_verified: false, new_account: true },
      });
      return;
    }
    if (path === "/api/v1/auth/password/forgot") {
      await route.fulfill({ json: { sent: true, email: "e2e@example.com" } });
      return;
    }
    if (path === "/api/v1/auth/password/reset") {
      if (request.postDataJSON()?.code !== "654321") {
        await route.fulfill({ status: 400, json: { detail: "That code isn't right." } });
        return;
      }
      await route.fulfill({
        json: { access_token: token, email_verified: true, new_account: false },
      });
      return;
    }
    if (path === "/api/v1/auth/login") {
      await route.fulfill({
        json: { access_token: token, email_verified: verified, new_account: false },
      });
      return;
    }
    const user = {
      id: "e2e-user",
      email: "e2e@example.com",
      full_name: "E2E User",
      timezone: "UTC",
      intent,
      email_verified: verified,
      phone,
    };
    if (path === "/api/v1/auth/me/phone") {
      if (request.postDataJSON()?.phone !== "(415) 555-0123") {
        await route.fulfill({
          status: 400,
          json: { detail: "That doesn't look like a real US number. Check the digits." },
        });
        return;
      }
      phone = "+14155550123";
      await route.fulfill({ json: { ...user, phone } });
      return;
    }
    if (path === "/api/v1/auth/verify-email") {
      if (request.postDataJSON()?.code !== "123456") {
        await route.fulfill({
          status: 400,
          json: { detail: "That code isn't right. 4 tries left." },
        });
        return;
      }
      verified = true;
      await route.fulfill({ json: { ...user, email_verified: true } });
      return;
    }
    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: user });
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

test("registers, confirms the emailed code and reaches the intent picker", async ({ page }) => {
  await mockApi(page);
  await page.goto("/register");

  await page.getByLabel("Your name").fill("E2E User");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await expect(page.getByText("That code isn't right. 4 tries left.")).toBeVisible();
  await page.getByLabel("6-digit code").fill("123456");

  await expect(page).toHaveURL(/\/phone$/);
  await expect(page.getByRole("heading", { name: "Add your mobile number" })).toBeVisible();
  await page.getByLabel("Mobile number").fill("4155550123");
  await expect(page.getByLabel("Mobile number")).toHaveValue("(415) 555-0123");
  await page.getByRole("button", { name: "Continue" }).click();

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

test("an account without a mobile number is asked for one before the app", async ({ page }) => {
  await mockApi(page, "personal", { phone: null });
  await page.addInitScript((value) => sessionStorage.setItem("rw_token", value), token);
  await page.goto("/app/budgets");

  await expect(page).toHaveURL(/\/phone\?next=%2Fapp%2Fbudgets$/);
  await page.getByLabel("Mobile number").fill("(212) 555-01");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByLabel("Mobile number").fill("4155550123");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\/budgets$/);
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
  await page.goto("/app");

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

test("the landing page leads new visitors to sign up", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Receipts, read for you." })
  ).toBeVisible();
  await page.getByRole("link", { name: "Get started free" }).first().click();
  await expect(page).toHaveURL(/\/register$/);
});

test("the landing page offers signed-in visitors their tab", async ({ page }) => {
  await page.addInitScript((value) => sessionStorage.setItem("rw_token", value), token);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open your tab" })).toHaveAttribute("href", "/app");
});

test("forgot password: email, the emailed code and a new password, then signed in", async ({
  page,
}) => {
  await mockApi(page, "personal");
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Email")).toHaveValue("e2e@example.com");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.getByLabel("6-digit code").fill("111111");
  await page.getByLabel("New password").fill("new-horse-2");
  await page.getByRole("button", { name: "Save and log in" }).click();
  await expect(page.getByText("That code isn't right.")).toBeVisible();

  await page.getByLabel("6-digit code").fill("654321");
  await page.getByRole("button", { name: "Save and log in" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
