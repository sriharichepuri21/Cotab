import { expect, test, type Page } from "@playwright/test";

/** Splitting a saved receipt from the app, against a mocked API. */

const token = "deterministic-e2e-token";

const receipt = {
  id: "r1",
  merchant: "Corner Market",
  purchased_at: "2026-10-24T18:30:00Z",
  total: 10,
  subtotal: 10,
  tax: 0,
  currency: "USD",
  category: "groceries",
  status: "extracted",
  confidence: 0.9,
  source: "photo",
  my_share: null,
  line_items: [
    { id: "l1", description: "OAT MILK", quantity: 1, unit_price: 4, total_price: 4 },
    { id: "l2", description: "BREAD", quantity: 1, unit_price: 6, total_price: 6 },
  ],
};

const tab = {
  id: "g1",
  name: "You & Ben",
  share_code: "abc",
  share_url: "http://127.0.0.1:3000/join/abc",
  kind: "direct",
  members: [
    { id: "m1", name: "E2E", account: "u" },
    { id: "m2", name: "Ben", account: "u-ben" },
  ],
};

async function open(page: Page, splitReplies: Array<{ status: number; json: unknown }> = []) {
  const seen: {
    direct?: Record<string, unknown>;
    splits: Array<Record<string, unknown>>;
    previews: Array<Record<string, unknown>>;
  } = { splits: [], previews: [] };
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    switch (url.pathname) {
      case "/api/v1/auth/me":
        return json({
          id: "u",
          email: "e2e@example.com",
          full_name: "E2E",
          timezone: "UTC",
          intent: "personal",
        });
      case "/api/v1/receipts/r1":
        return json(receipt);
      case "/api/v1/splits/groups":
        return json([]);
      case "/api/v1/splits/people":
        return json([
          {
            ref: "p-ben",
            account: "u-ben",
            name: "Ben",
            phone: null,
            hint: "•••0199",
            on_cotab: true,
            tabs: 1,
          },
        ]);
      case "/api/v1/splits/preview": {
        seen.previews.push(body ?? {});
        const parts = body?.parts as Record<string, number> | undefined;
        if (body?.mode === "exact") {
          const added = Object.values(parts ?? {}).reduce((a, b) => a + b, 0);
          if (Math.round(added * 100) !== 1000)
            return json({
              total: 10,
              items_total: 10,
              extra: 0,
              currency: "USD",
              message: "These add up to less than $10.00.",
            });
          return json({ total: 10, items_total: 10, extra: 0, currency: "USD", shares: parts });
        }
        return json({
          total: 10,
          items_total: 10,
          extra: 0,
          currency: "USD",
          shares: { E2E: 5, Ben: 5 },
        });
      }
      case "/api/v1/splits/direct":
        seen.direct = body ?? {};
        return json(tab);
      case "/api/v1/splits/groups/g1/splits": {
        seen.splits.push(body ?? {});
        const reply = splitReplies.shift() ?? { status: 200, json: { split_id: "s1", shares: {} } };
        return json(reply.json, reply.status);
      }
      default:
        if (url.pathname.startsWith("/api/v1/receipts")) return json([], 404);
        return json({ detail: "unmocked" }, 404);
    }
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?receipt=r1");
  await page.getByRole("button", { name: "Split this" }).click();
  return seen;
}

async function addBen(page: Page) {
  await page.getByRole("button", { name: "Add someone", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add someone" });
  await sheet.getByRole("button", { name: /^Ben/ }).click();
  await expect(sheet).toHaveCount(0);
}

test("split by exact amounts with someone you've split with before", async ({ page }) => {
  const seen = await open(page);
  // Nobody to split with yet: nothing to save.
  await expect(page.getByRole("button", { name: "Add someone to split with" })).toBeDisabled();
  await addBen(page);
  await expect(page.getByText("Ben", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Exact amounts/ }).click();
  const save = page.getByRole("button", { name: "Split $10.00 with Ben" });
  await expect(page.getByText("$10.00 left to assign")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("You's amount").fill("2.43");
  await page.getByLabel("Ben's amount").fill("7.57");
  await expect(page.getByText("All assigned")).toBeVisible();
  await expect(page.getByText("Adds to $10.00")).toBeVisible();
  await expect(save).toBeEnabled();

  await save.click();
  await expect(page.getByText("Split on You & Ben.")).toBeVisible();
  // The exact person picked (from_member), not just a name.
  expect(seen.direct).toEqual({ my_name: "E2E", members: [{ name: "Ben", from_member: "p-ben" }] });
  expect(seen.splits[0]).toMatchObject({
    receipt_id: "r1",
    paid_by: "E2E",
    mode: "exact",
    parts: { E2E: 2.43, Ben: 7.57 },
    replace: false,
  });
});

test("someone else paid, split by item", async ({ page }) => {
  const seen = await open(page);
  await addBen(page);
  await page
    .getByRole("radiogroup", { name: "Who paid" })
    .getByRole("radio", { name: "Ben" })
    .click();
  await page.getByRole("button", { name: /By item/ }).click();
  await expect(page.getByText("2 left to pick")).toBeVisible();
  await page.getByRole("button", { name: "OAT MILK for You" }).click();
  await page.getByRole("button", { name: "BREAD for Ben" }).click();
  await expect(page.getByText(/left to pick/)).toHaveCount(0);
  await page.getByRole("button", { name: "Split $10.00 with Ben" }).click();
  await expect(page.getByText("Split on You & Ben.")).toBeVisible();
  expect(seen.splits[0]).toMatchObject({
    paid_by: "Ben",
    mode: "itemized",
    tax_mode: "pro_rata",
    assignments: { E2E: ["l1"], Ben: ["l2"] },
  });
});

test("a receipt already split on that tab can be replaced there", async ({ page }) => {
  const seen = await open(page, [
    { status: 409, json: { detail: "This receipt is already in the group" } },
  ]);
  await addBen(page);
  await page.getByRole("button", { name: "Split $10.00 with Ben" }).click();
  await expect(page.getByText("This receipt is already in the group")).toBeVisible();
  await page.getByRole("button", { name: "Replace the split on You & Ben" }).click();
  await expect(page.getByText("Split on You & Ben.")).toBeVisible();
  expect(seen.splits.map((s) => s.replace)).toEqual([false, true]);
});
