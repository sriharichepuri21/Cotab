import { expect, test, type Page } from "@playwright/test";

/** Insights: month by month, from the server's figures. */

const token = "deterministic-e2e-token";

const trend = [
  { month: "2026-05", amount: 1104 },
  { month: "2026-06", amount: 987 },
  { month: "2026-07", amount: 1320 },
  { month: "2026-08", amount: 1012 },
  { month: "2026-09", amount: 800 },
  { month: "2026-10", amount: 948.3 },
];

const months: Record<string, Array<{ name: string; amount: number }>> = {
  "2026-10": [
    { name: "groceries", amount: 500 },
    { name: "dining", amount: 448.3 },
  ],
  "2026-09": [{ name: "travel", amount: 800 }],
};

async function open(page: Page) {
  const seen: { dismissed?: string; receiptQuery?: string } = {};
  let insights = [
    {
      id: "i1",
      kind: "trend",
      title: "Dining is up 40%.",
      body: "Mostly shared dinners.",
      data: {},
      severity: "info",
      observed_at: "2026-10-20",
    },
  ];
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (data: unknown, status = 200, headers = {}) =>
      route.fulfill({ status, json: data, headers });
    if (url.pathname === "/api/v1/auth/me")
      return json({
        id: "u",
        email: "e2e@example.com",
        full_name: "E2E",
        timezone: "UTC",
        intent: "personal",
      });
    if (url.pathname === "/api/v1/analytics/summary")
      return json({
        this_month: {
          start_date: "2026-10-01",
          end_date: "2026-10-31",
          receipt_count: 9,
          total_spent: 948.3,
          currency: "USD",
        },
        top_category: null,
        top_merchant: null,
        categories: months["2026-10"],
        merchants: [],
        monthly_trend: trend,
        budget_health: [],
        budget_alerts: [],
        pending_review: 0,
      });
    if (url.pathname === "/api/v1/analytics/month") {
      const m = url.searchParams.get("month")!;
      const amount = trend.find((t) => t.month === m)?.amount ?? 0;
      return json({
        month: m,
        totals: {
          start_date: `${m}-01`,
          end_date: `${m}-30`,
          receipt_count: 1,
          total_spent: amount,
          currency: "USD",
        },
        categories: months[m] ?? [],
        merchants: [],
      });
    }
    if (url.pathname === "/api/v1/insights") return json(insights);
    if (url.pathname === "/api/v1/insights/i1/dismiss") {
      seen.dismissed = "i1";
      insights = [];
      return json({ ok: true });
    }
    if (url.pathname === "/api/v1/receipts/") {
      seen.receiptQuery = url.search;
      return json(
        [
          {
            id: "r9",
            merchant: "Alaska Air",
            category: "travel",
            total: 800,
            currency: "USD",
            status: "reviewed",
            purchased_at: "2026-09-12T10:00:00Z",
            line_items: [],
          },
        ],
        200,
        { "X-Total-Count": "1", "Access-Control-Expose-Headers": "X-Total-Count" }
      );
    }
    if (url.pathname === "/api/v1/receipts/r9")
      return json({
        id: "r9",
        merchant: "Alaska Air",
        category: "travel",
        total: 800,
        subtotal: 800,
        tax: 0,
        currency: "USD",
        status: "reviewed",
        confidence: 1,
        purchased_at: "2026-09-12T10:00:00Z",
        line_items: [],
      });
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?panel=insights");
  return seen;
}

test("this month's figures, change from last month, and the server's finding", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Dining is up 40%." })).toBeVisible();
  await expect(page.getByText("$948.30").first()).toBeVisible();
  await expect(page.getByText("+$148.30 vs Sep")).toBeVisible();
  await expect(page.getByRole("button", { name: /Groceries/ })).toContainText("$500.00");
  // No demo figures or made-up advice.
  await expect(page.getByText("Move $20")).toHaveCount(0);
  await expect(page.getByText("$540.83")).toHaveCount(0);
});

test("picking a month shows that month and what counted in it", async ({ page }) => {
  const seen = await open(page);
  await page.getByRole("radio", { name: /^September/ }).click();
  await expect(page.getByText("Spent in September")).toBeVisible();
  await expect(page.getByRole("heading", { name: "$212.00 less than August." })).toBeVisible();
  await page.getByRole("button", { name: /Travel/ }).click();
  const sheet = page.getByRole("dialog", { name: "Travel · September" });
  await sheet.getByRole("button", { name: /Alaska Air/ }).click();
  expect(seen.receiptQuery).toContain("category=travel");
  expect(seen.receiptQuery).toContain("start_date=2026-09-01");
  expect(seen.receiptQuery).toContain("end_date=2026-09-30");
  await expect(page).toHaveURL(/receipt=r9/);
  await expect(page.getByRole("heading", { level: 1, name: "Alaska Air" })).toBeVisible();
});
