import { expect, test } from "@playwright/test";

/** Changing a split starts from how it was split, and saving replaces it. */

const token = "deterministic-e2e-token";

test("changing a split opens with its payer, mode and amounts, and replaces it", async ({
  page,
}) => {
  const saved: Array<Record<string, unknown>> = [];
  await page.route("http://127.0.0.1:8000/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/api/v1/auth/me")
      return json({
        id: "u",
        email: "e2e@example.com",
        full_name: "E2E",
        timezone: "UTC",
        intent: "personal",
      });
    if (path === "/api/v1/receipts/r1")
      return json({
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
        my_share: 2.43,
        split_group_id: "g1",
        line_items: [],
      });
    if (path === "/api/v1/splits/groups")
      return json([
        {
          id: "g1",
          name: "You & Ben",
          share_code: "abc",
          share_url: "http://127.0.0.1:3000/join/abc",
          kind: "direct",
          members: [
            { id: "m1", name: "E2E", account: "u" },
            { id: "m2", name: "Ben", account: "u-ben" },
          ],
        },
      ]);
    if (path === "/api/v1/splits/groups/g1/summary")
      return json({
        group_id: "g1",
        group_name: "You & Ben",
        share_code: "abc",
        members: [],
        member_count: 2,
        total_spend: 10,
        suggested_settlements: [],
        splits: [
          {
            split_id: "s1",
            receipt_id: "r1",
            merchant: "Corner Market",
            purchased_at: null,
            currency: "USD",
            total: 10,
            mode: "exact",
            tax_mode: "pro_rata",
            paid_by: "Ben",
            parts: { E2E: 2.43, Ben: 7.57 },
            shares: [],
          },
        ],
      });
    if (path === "/api/v1/splits/people") return json([]);
    if (path === "/api/v1/splits/preview")
      return json({
        total: 10,
        items_total: 10,
        extra: 0,
        currency: "USD",
        shares: (body?.parts as Record<string, number>) ?? {},
      });
    if (path === "/api/v1/splits/groups/g1/splits") {
      saved.push(body ?? {});
      return json({ split_id: "s2", shares: {} });
    }
    return json({ detail: "unmocked" }, 404);
  });
  await page.addInitScript((t) => sessionStorage.setItem("rw_token", t), token);
  await page.goto("/app?receipt=r1");

  await page.getByRole("button", { name: "Change split" }).click();
  await expect(page.getByText("Change it here; saving replaces the old split.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Ben" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Exact amounts/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByLabel("You's amount")).toHaveValue("2.43");
  await expect(page.getByLabel("Ben's amount")).toHaveValue("7.57");

  await page.getByLabel("You's amount").fill("3.00");
  await page.getByLabel("Ben's amount").fill("7.00");
  await page.getByRole("button", { name: "Save changes to this split" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({
    receipt_id: "r1",
    paid_by: "Ben",
    mode: "exact",
    parts: { E2E: 3, Ben: 7 },
    replace: true,
  });
});
