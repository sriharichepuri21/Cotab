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
  const drawer = page.getByRole("complementary", { name: "Ask Cotab" });
  await drawer.getByRole("button", { name: "How much have I spent this month?" }).click();

  await expect(drawer.locator("strong", { hasText: "$412.30" })).toBeVisible();
  await expect(drawer.locator("table tbody tr")).toHaveCount(3);
  await expect(drawer.getByText("Dining is where you could trim most.")).toBeVisible();
  await expect(drawer.getByText(/How was this answered|SELECT|tool/i)).toHaveCount(0);

  // Typing and Enter sends the next question.
  await drawer.getByLabel("Ask Cotab", { exact: true }).fill("And last month?");
  await drawer.getByLabel("Ask Cotab", { exact: true }).press("Enter");
  await expect(drawer.getByText("And last month?")).toBeVisible();
});
