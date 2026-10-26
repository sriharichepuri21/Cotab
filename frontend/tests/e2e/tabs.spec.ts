import { expect, test, type Page } from "@playwright/test";

/** Tabs: real balances per tab and currency, paying and undoing, sharing. */

const token = "deterministic-e2e-token";

const member = (id: string, name: string, account: string | null = null) => ({
  id,
  name,
  email: null,
  joined: !!account,
  account,
  pay_methods: [],
  own_handles: !account,
  handles: {},
  avatar: null,
  notify: false,
  status: account ? "joined" : "no_phone",
});

function lake(paid = false) {
  return {
    group_id: "g1",
    group_name: "Lake trip",
    kind: "group",
    share_code: "lake",
    currency: "USD",
    is_owner: true,
    me: "m1",
    members: [member("m1", "E2E", "u"), member("m2", "Ben"), member("m3", "Priya", "u-p")],
    member_count: 3,
    total_spend: 60,
    splits: [],
    suggested_settlements: [
      {
        from: "Ben",
        to: "E2E",
        from_id: "m2",
        to_id: "m1",
        amount: 3.4,
        pay_links: [],
        last_reminded_at: null,
      },
      ...(paid
        ? []
        : [
            {
              from: "E2E",
              to: "Priya",
              from_id: "m1",
              to_id: "m3",
              amount: 18.5,
              pay_links: [
                { method: "venmo", label: "Venmo", url: "https://venmo.com/u/priya?amount=18.50" },
              ],
              last_reminded_at: null,
            },
          ]),
    ],
    settlements: paid
      ? [
          {
            id: "p1",
            from: "E2E",
            to: "Priya",
            amount: 18.5,
            method: "venmo",
            created_at: "2026-10-26T01:00:00Z",
          },
        ]
      : [],
  };
}

const paris = {
  group_id: "g2",
  group_name: "Paris",
  kind: "group",
  share_code: "paris",
  currency: "EUR",
  is_owner: true,
  me: "n1",
  members: [member("n1", "E2E", "u"), member("n2", "Ana")],
  member_count: 2,
  total_spend: 10,
  splits: [],
  suggested_settlements: [
    {
      from: "Ana",
      to: "E2E",
      from_id: "n2",
      to_id: "n1",
      amount: 5,
      pay_links: [],
      last_reminded_at: null,
    },
  ],
  settlements: [],
};

async function open(page: Page) {
  const seen: { settled?: Record<string, unknown>; undone?: string } = {};
  let paid = false;
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
    if (url.pathname === "/api/v1/splits/groups")
      return json([
        {
          id: "g1",
          name: "Lake trip",
          share_code: "lake",
          share_url: "",
          members: [],
          kind: "group",
        },
        { id: "g2", name: "Paris", share_code: "paris", share_url: "", members: [], kind: "group" },
      ]);
    if (url.pathname === "/api/v1/splits/groups/g1/summary") return json(lake(paid));
    if (url.pathname === "/api/v1/splits/groups/g2/summary") return json(paris);
    if (url.pathname === "/api/v1/splits/groups/g1/settlements" && method === "POST") {
      seen.settled = route.request().postDataJSON();
      paid = true;
      return json(lake(true));
    }
    if (url.pathname === "/api/v1/splits/groups/g1/settlements/p1" && method === "DELETE") {
      seen.undone = "p1";
      paid = false;
      return json(lake(false));
    }
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?tab=circles");
  return seen;
}

test("tabs show what you owe and are owed, never adding up currencies", async ({ page }) => {
  await open(page);
  await expect(page.getByText("One payment needs you.")).toBeVisible();
  await expect(page.getByText("Pay Priya for Lake trip.")).toBeVisible();
  const owed = page.getByRole("button", { name: /Owed to you/ });
  await expect(owed).toContainText("$3.40");
  await expect(owed).toContainText("€5.00");
  await expect(page.getByRole("button", { name: /You owe/ })).toContainText("$18.50");
  await expect(page.getByRole("heading", { name: "Lake trip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Paris" })).toBeVisible();
  // No demo people.
  await expect(page.getByText("Cara")).toHaveCount(0);
});

test("paying opens their app, records only when you say so, and can be undone", async ({
  page,
}) => {
  const seen = await open(page);
  await page.getByText("One payment needs you.").click();
  const sheet = page.getByRole("dialog", { name: "Pay Priya $18.50" });
  await expect(sheet.getByRole("link", { name: "Pay with Venmo" })).toHaveAttribute(
    "href",
    "https://venmo.com/u/priya?amount=18.50"
  );
  expect(seen.settled).toBeUndefined();
  await sheet.getByRole("button", { name: "I've paid Priya" }).click();
  const done = page.getByRole("dialog", { name: "Payment recorded" });
  await expect(done.getByText("You paid Priya $18.50.")).toBeVisible();
  expect(seen.settled).toEqual({
    from_member_id: "m1",
    to_member_id: "m3",
    amount: 18.5,
    method: "venmo",
    currency: "USD",
  });
  await done.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Payment undone.")).toBeVisible();
  expect(seen.undone).toBe("p1");
});

test("a tab's link is its public share page", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Tab history and payments →" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Lake trip" });
  await expect(sheet.getByText("Ben pays you")).toBeVisible();
  await expect(sheet.getByLabel("Tab link")).toHaveValue(/\/share\/lake$/);
  await expect(sheet.getByRole("button", { name: "Remind Ben" })).toBeVisible();
});
