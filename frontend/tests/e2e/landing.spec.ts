import { expect, test } from "@playwright/test";

// The suite runs with reduced motion; these cover the page as most people see it.
test.use({ contextOptions: { reducedMotion: "no-preference" } });

test("the story jumps to a step and shows that step's scene", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-story]").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Tap who had what" }).click();
  await expect(page.getByRole("heading", { name: "Tap who had what" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap who had what" })).toHaveAttribute(
    "data-on",
    ""
  );
});

test("claiming the fries puts every cent on someone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Maya had Fries" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Maya had Fries" }).click();
  await expect(page.getByText("Every cent has a name.")).toBeVisible();
});

test("the month slider follows the day", async ({ page }) => {
  await page.goto("/");
  const day = page.getByLabel("Day of the month");
  await day.scrollIntoViewIfNeeded();
  await day.fill("23");
  await expect(page.getByText("Dining is close to its limit.")).toBeVisible();
});

test("the nav reaches a panel inside the gallery", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Budgets" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Budgets down to the oat milk" })
  ).toBeInViewport();
});

test("with reduced motion every story step is on the page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Settled, no awkward text" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Snap it" })).toBeVisible();
});
