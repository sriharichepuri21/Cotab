import { expect, test, type Page } from "@playwright/test";

/** The Tabby tab: real chat, and real activity, rules and memory. */

const token = "deterministic-e2e-token";

type Run = Record<string, unknown>;

async function open(page: Page, runs?: Run[]) {
  const seen: { undone?: string; paused?: unknown } = {};
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
    if (url.pathname === "/api/v1/tabby/activity")
      return json(
        runs ?? [
          {
            run_id: "run1",
            at: "2026-10-25T10:00:00Z",
            source: "chat",
            status: "done",
            undoable: true,
            steps: [
              {
                position: 1,
                summary: "Split Costco with Ben",
                status: "done",
                open: null,
                undoable: true,
              },
            ],
          },
        ]
      );
    if (url.pathname === "/api/v1/tabby/runs/run1/undo") {
      seen.undone = "run1";
      return json({ ok: true });
    }
    if (url.pathname === "/api/v1/tabby/rules" && method === "GET")
      return json([
        {
          id: "rule1",
          summary: "Split every Costco receipt with Ben",
          active: true,
          action: "split",
          store: "Costco",
          category: null,
          run_count: 3,
          last_run_at: null,
        },
      ]);
    if (url.pathname === "/api/v1/tabby/rules/rule1") {
      seen.paused = route.request().postDataJSON();
      return json({
        id: "rule1",
        summary: "Split every Costco receipt with Ben",
        active: false,
        action: "split",
        store: "Costco",
        category: null,
        run_count: 3,
        last_run_at: null,
      });
    }
    if (url.pathname === "/api/v1/tabby/memories")
      return json([{ id: "m1", text: "Ben is my roommate", kind: "fact", at: null }]);
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?tab=tabby");
  await expect(page.getByRole("heading", { name: "Tabby" })).toBeVisible();
  return seen;
}

test("asking opens the real chat with the question, never a scripted plan", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /How much have I spent this month\?/ }).click();
  const chat = page.getByRole("complementary", { name: "Ask Tabby" });
  await expect(chat).toBeVisible();
  await expect(chat.locator("textarea")).toHaveValue("How much have I spent this month?");
  await expect(page.getByText("Move $20 into dining")).toHaveCount(0);
});

test("what Tabby did can be undone, and rules and memory are the real ones", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("tab", { name: "activity" }).click();
  await expect(page.getByText("Split Costco with Ben")).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).first().click();
  await expect.poll(() => seen.undone).toBe("run1");

  await page.getByRole("tab", { name: "rules" }).click();
  await expect(page.getByText("Split every Costco receipt with Ben")).toBeVisible();

  await page.getByRole("tab", { name: "memories" }).click();
  await expect(page.getByText("Ben is my roommate")).toBeVisible();
});

test("an undo that failed is flagged, never shown as done, and can be retried", async ({
  page,
}) => {
  const seen = await open(page, [
    {
      run_id: "run1",
      at: "2026-10-25T10:00:00Z",
      source: "chat",
      status: "needs_attention",
      undoable: true,
      steps: [
        {
          position: 0,
          summary: "Split Costco with Ben",
          status: "undo_failed",
          detail: "Undo failed.",
          open: null,
          undoable: true,
        },
      ],
    },
  ]);
  await page.getByRole("tab", { name: "activity" }).click();
  await expect(page.getByText("Couldn't be undone: Undo failed.")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("couldn't be finished or put back");
  await page.getByRole("button", { name: "Try undo again" }).click();
  await expect.poll(() => seen.undone).toBe("run1");
});
