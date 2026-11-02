import { expect, test, type Page } from "@playwright/test";

const ANSWER = [
  { type: "delta", text: "You've spent **$412.30** this month, " },
  { type: "delta", text: "$38 less than by this point last month.\n\n" },
  {
    type: "delta",
    text: "| Category | Spent |\n|---|---|\n| Groceries | $180.00 |\n| Dining | $96.10 |\n| Transport | $55.00 |\n\n",
  },
  { type: "delta", text: "Dining is where you could trim most." },
  { type: "done", session_id: "s1" },
];

async function signedIn(page: Page) {
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const cors = {
      "Access-Control-Allow-Origin": route.request().headers()["origin"] ?? "*",
      "Access-Control-Allow-Credentials": "true",
    };
    if (url.pathname === "/api/v1/auth/me")
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
    if (url.pathname === "/api/v1/chat/stream")
      return route.fulfill({
        headers: { ...cors, "Content-Type": "application/x-ndjson" },
        body: ANSWER.map((e) => JSON.stringify(e)).join("\n") + "\n",
      });
    return route.fulfill({ headers: cors, json: [] });
  });
  await page.addInitScript(() => sessionStorage.setItem("rw_token", "deterministic-e2e-token"));
}

test("asking a question shows a formatted answer and nothing technical", async ({ page }) => {
  await signedIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: /^Ask/ }).first().click();
  const drawer = page.getByRole("complementary", { name: "Ask Tabby" });
  await drawer.getByRole("button", { name: "How much have I spent this month?" }).click();

  await expect(drawer.locator("strong", { hasText: "$412.30" })).toBeVisible();
  await expect(drawer.locator("table tbody tr")).toHaveCount(3);
  await expect(drawer.getByText("Dining is where you could trim most.")).toBeVisible();
  await expect(drawer.getByText(/How was this answered|SELECT|tool/i)).toHaveCount(0);

  // Typing and Enter sends the next question.
  await drawer.getByLabel("Ask Tabby", { exact: true }).fill("And last month?");
  await drawer.getByLabel("Ask Tabby", { exact: true }).press("Enter");
  await expect(drawer.getByText("And last month?")).toBeVisible();
});

test.describe("with motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a plan's Approve then Undo still run, and the ticks rewind", async ({ page }) => {
    const calls: string[] = [];
    let release = () => {};
    const undoHeld = new Promise<void>((resolve) => (release = resolve));
    await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const headers = {
        "Access-Control-Allow-Origin": route.request().headers()["origin"] ?? "*",
        "Access-Control-Allow-Credentials": "true",
      };
      if (url.pathname === "/api/v1/auth/me")
        return route.fulfill({
          headers,
          json: {
            id: "u",
            email: "e2e@example.com",
            full_name: "E2E",
            timezone: "UTC",
            intent: "personal",
          },
        });
      if (url.pathname === "/api/v1/chat/stream")
        return route.fulfill({
          headers: { ...headers, "Content-Type": "application/x-ndjson" },
          body:
            [
              {
                type: "proposal",
                proposal: {
                  id: "p1",
                  tool_name: "plan",
                  summary: "Tidy Costco",
                  steps: ["Split Costco with Ben", "Move $20 into dining"],
                  payload: {},
                  status: "pending",
                  expires_at: "2099-01-01T00:00:00Z",
                },
              },
              { type: "done", session_id: "s1" },
            ]
              .map((e) => JSON.stringify(e))
              .join("\n") + "\n",
        });
      if (url.pathname === "/api/v1/chat/proposals/p1/confirm") {
        calls.push("confirm");
        return route.fulfill({
          headers,
          json: { status: "executed", result: { run_id: "run1", undoable: true } },
        });
      }
      if (url.pathname === "/api/v1/tabby/runs/run1/undo") {
        calls.push("undo");
        await undoHeld;
        return route.fulfill({ headers, json: { ok: true } });
      }
      return route.fulfill({ status: 404, headers, json: { detail: "unmocked" } });
    });
    await page.addInitScript(() => sessionStorage.setItem("rw_token", "deterministic-e2e-token"));

    await page.goto("/app?tab=tabby");
    await page.getByRole("button", { name: /How much have I spent this month\?/ }).click();
    const drawer = page.getByRole("complementary", { name: "Ask Tabby" });
    await drawer.locator("textarea").press("Enter");

    const plan = drawer.getByRole("region", { name: "Tabby's plan" });
    await plan.getByRole("button", { name: "Approve all" }).click();
    await expect(plan.getByText("Done", { exact: true })).toBeVisible();
    const ticks = plan.locator("[data-tick]");
    await expect(ticks).toHaveCount(2);
    await expect(ticks.last()).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    // The undo is sent straight away; the ticks rewind while it runs.
    await plan.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => calls).toEqual(["confirm", "undo"]);
    await expect(ticks.first()).toHaveCSS("transform", "matrix(0, 0, 0, 0, 0, 0)");
    release();

    await expect(plan.getByText("Undone", { exact: true })).toBeVisible();
    await expect(plan.getByText("Everything is back how it was")).toBeVisible();
    await expect(plan.locator("[data-tick]")).toHaveCount(0);
  });
});
