import { expect, test, type Page } from "@playwright/test";

/** Profile: the real account, Tabby, payment handles, export and delete. */

const token = "deterministic-e2e-token";

async function open(page: Page) {
  const seen: { patches: unknown[]; handles?: unknown; deleted?: unknown; exported?: boolean } = {
    patches: [],
  };
  let me = {
    id: "u",
    email: "ada@example.com",
    full_name: "Ada Lovelace",
    timezone: "America/Los_Angeles",
    intent: "splits",
    phone: "+14155550100",
    email_verified: true,
    has_password: true,
    avatar_mood: "hi",
    tabby_reacts: true,
  };
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === "/api/v1/auth/me" && method === "PATCH") {
      const body = route.request().postDataJSON();
      seen.patches.push(body);
      me = { ...me, ...body };
      return json(me);
    }
    if (url.pathname === "/api/v1/auth/me") return json(me);
    if (url.pathname === "/api/v1/auth/me/pay-handles" && method === "PUT") {
      seen.handles = route.request().postDataJSON();
      return json(seen.handles);
    }
    if (url.pathname === "/api/v1/auth/me/pay-handles") return json({ venmo: "ada-l" });
    if (url.pathname === "/api/v1/exports/") {
      seen.exported = true;
      return json({ id: "x1", status: "ready", download_url: "https://files.example/x1.json" });
    }
    if (url.pathname === "/api/v1/auth/delete-account") {
      seen.deleted = route.request().postDataJSON();
      return route.fulfill({ status: 204, body: "" });
    }
    if (url.pathname === "/api/v1/auth/logout") return json({ ok: true });
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?panel=profile");
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  return seen;
}

test("preferences change the look and stay after a reload", async ({ page }) => {
  await open(page);
  const shell = page.locator(".ios-shell");
  await page.getByRole("button", { name: /Preferences/ }).click();
  await page.getByRole("radio", { name: "Night" }).click();
  await page.getByRole("radio", { name: "Ocean" }).click();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await expect(shell).toHaveAttribute("data-accent", "ocean");
});

test("the profile is the signed-in person, not a demo", async ({ page }) => {
  await open(page);
  await expect(page.getByText("ada@example.com")).toBeVisible();
  await expect(page.getByText("Demo User")).toHaveCount(0);
  await page.getByRole("button", { name: /Personal information/ }).click();
  await expect(page.getByText("(415) 555-0100").first()).toBeVisible();
  await expect(page.getByText("Me and the people I live with")).toBeVisible();
});

test("picking Tabby's look and turning off reactions save to the account", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: /Tabby · Hi/ }).click();
  await page.getByRole("radio", { name: "payday" }).click();
  await page.getByRole("switch").uncheck();
  await expect
    .poll(() => seen.patches)
    .toEqual([{ avatar_mood: "payday" }, { tabby_reacts: false }]);
});

test("export gives a download link, and delete needs the password", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: /Data and privacy/ }).click();
  await page.getByRole("button", { name: "Download my data" }).click();
  await expect(page.getByRole("link", { name: "Save the file" })).toHaveAttribute(
    "href",
    "https://files.example/x1.json"
  );
  await page.getByRole("button", { name: "Delete my account" }).click();
  const confirm = page.getByRole("button", { name: "Delete everything" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type your password to confirm").fill("hunter2");
  await confirm.click();
  await expect(page).toHaveURL(/\/login$/);
  expect(seen.deleted).toEqual({ password: "hunter2" });
});

test("signing out goes to sign in", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});
