import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { newUiPath } from "@/lib/routes";

vi.mock("next/link", () => ({ default: () => null }));

afterEach(cleanup);

describe("newUiPath", () => {
  it("keeps Tabby activity inside the New UI", () => {
    expect(newUiPath("/app/tabby")).toBe("/app?tab=tabby");
    expect(newUiPath("/app/groups/roommates")).toBe("/app?tab=circles&group=roommates");
    expect(newUiPath("/app/receipts/receipt-1")).toBe("/app?receipt=receipt-1");
    expect(newUiPath("/app/insights")).toBe("/app?panel=insights");
    expect(newUiPath("/app/receipts/receipt-1/split")).toBe("/app?receipt=receipt-1");
    expect(newUiPath("/app/tabby/wrap?month=2026-09")).toBe("/app");
  });

  it("does not rewrite external or already-new links", () => {
    expect(newUiPath("https://example.com")).toBe("https://example.com");
    expect(newUiPath("/app?tab=tabby")).toBe("/app?tab=tabby");
  });
});

describe("stepLook", () => {
  it("never shows a failed undo or an interrupted step as done", async () => {
    const { stepLook } = await import("@/components/TabbyPanels");
    expect(stepLook("undo_failed").note).toBe("Couldn't be undone");
    expect(stepLook("interrupted").note).toMatch(/part-way/);
    expect(stepLook("undo_failed").icon).not.toBe("check_circle");
    expect(stepLook("done").icon).toBe("check_circle");
    expect(stepLook("rolled_back").text).toMatch(/line-through/);
  });
});

describe("Activity", () => {
  it("never gives a step that went wrong the success tick or its animation", async () => {
    const { Activity } = await import("@/components/TabbyPanels");
    const steps = (["done", "undo_failed", "interrupted"] as const).map((status, position) => ({
      position,
      summary: status,
      status,
      open: null,
      undoable: true,
    }));
    const { container } = render(
      <Activity
        runs={[
          {
            run_id: "r",
            at: "2026-10-25T10:00:00Z",
            source: "chat",
            status: "needs_attention",
            undoable: true,
            steps,
          } as never,
        ]}
      />
    );
    const marked = (kind: string) =>
      Array.from(container.querySelectorAll(`[data-step="${kind}"]`), (el) =>
        el.textContent?.replace("check_circle", "")
      );
    expect(marked("ok")).toEqual(["done"]);
    expect(marked("bad").length).toBe(2);
    container.querySelectorAll('[data-step="bad"]').forEach((el) => {
      expect(el.textContent).not.toContain("check_circle");
      expect(el.querySelector(".text-rose")).toBeTruthy();
    });
  });
});
