import { expect, test, type Page } from "@playwright/test";

/** Budgets: the server's own figures, create, edit and delete. */

const token = "deterministic-e2e-token";

const state = (
  id: string,
  level: string,
  target: string,
  label: string,
  limit: number,
  spent: number
) => ({
  budget_id: id,
  label,
  level,
  target,
  period: "monthly",
  limit,
  spent,
  remaining: Math.round((limit - spent) * 100) / 100,
  percent_used: Math.round((spent / limit) * 1000) / 10,
  over_budget: spent > limit,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  thresholds: [80, 100, 120],
  threshold_reached: spent / limit >= 1 ? 100 : null,
});

async function open(page: Page) {
  const seen: { created?: unknown; updated?: unknown; deleted?: string } = {};
  let budgets = [
    state("b1", "total", "", "Monthly total", 1500, 948.3),
    state("b2", "category", "dining", "dining", 200, 231.4),
  ];
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === "/api/v1/auth/me")
      return json({
        id: "u",
        email: "e2e@example.com",
        full_name: "E2E",
        timezone: "UTC",
        intent: "personal",
      });
    if (url.pathname === "/api/v1/budgets/" && method === "GET") return json(budgets);
    if (url.pathname === "/api/v1/budgets/" && method === "POST") {
      const body = route.request().postDataJSON();
      seen.created = body;
      budgets = [...budgets, state("b3", body.level, body.target, body.target, body.amount, 0)];
      return json({ id: "b3", ...body }, 201);
    }
    if (url.pathname === "/api/v1/budgets/b2" && method === "PATCH") {
      seen.updated = route.request().postDataJSON();
      budgets = budgets.map((b) =>
        b.budget_id === "b2" ? state("b2", "category", "dining", "dining", 250, 231.4) : b
      );
      return json({ id: "b2" });
    }
    if (url.pathname === "/api/v1/budgets/b2" && method === "DELETE") {
      seen.deleted = "b2";
      budgets = budgets.filter((b) => b.budget_id !== "b2");
      return route.fulfill({ status: 204, body: "" });
    }
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?panel=budgets");
  return seen;
}

test("the budget that's over comes first, with the server's figures", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "$31.40 over limit." })).toBeVisible();
  await expect(page.getByText("Over $31.40")).toBeVisible();
  await expect(page.getByText(/\$948\.30 of \$1,500\.00/)).toBeVisible();
  // No demo budgets.
  await expect(page.getByText("Coffee")).toHaveCount(0);
});

test("a new category budget saves cent-exact with the chosen alerts", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("button", { name: "+ New" }).click();
  const sheet = page.getByRole("dialog", { name: "Set a budget" });
  await sheet.getByRole("radio", { name: /A category/ }).click();
  await sheet.getByRole("radio", { name: "Drinks", exact: true }).click();
  const save = sheet.getByRole("button", { name: "Add monthly budget" });
  await expect(save).toBeDisabled();
  await sheet.getByLabel("Monthly limit").fill("49.995");
  await expect(save).toBeDisabled();
  await sheet.getByLabel("Monthly limit").fill("50");
  await sheet.getByRole("button", { name: "120%" }).click();
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(seen.created).toEqual({
    level: "category",
    target: "drinks",
    period: "monthly",
    amount: 50,
    alert_thresholds: "80,100",
  });
});

test("a budget can be changed and deleted", async ({ page }) => {
  const seen = await open(page);
  await page
    .getByRole("button", { name: /Dining/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Edit budget" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit budget" });
  await sheet.getByLabel("Monthly limit").fill("250");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "$18.60 left." })).toBeVisible();
  expect(seen.updated).toMatchObject({ level: "category", target: "dining", amount: 250 });

  await page.getByRole("button", { name: "Edit budget" }).click();
  await page.getByRole("button", { name: "Delete budget" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Dining")).toHaveCount(0);
  expect(seen.deleted).toBe("b2");
});
