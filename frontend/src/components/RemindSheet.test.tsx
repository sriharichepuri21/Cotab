import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemindSheet, remindedLabel, reminderText } from "./RemindSheet";

afterEach(cleanup);

describe("reminding a friend", () => {
  it("writes a message with the amount, pay links and the tab's link", () => {
    const text = reminderText({
      friend: "Ben",
      me: "Ada",
      amount: 12.5,
      currency: "USD",
      links: [
        { method: "venmo", label: "Venmo", url: "https://venmo.com/ada" },
        { method: "zelle", label: "Zelle", url: null, copy: "ada@x.com" },
      ],
      shareUrl: "https://www.cotab.center/share/abc",
    });
    expect(text).toBe(
      [
        "Hi Ben! Friendly reminder from Ada: you owe $12.50 on our Cotab tab.",
        "Pay with Venmo: https://venmo.com/ada",
        "Zelle: ada@x.com",
        "Open the tab: https://www.cotab.center/share/abc",
      ].join("\n")
    );
  });

  it("says when you last reminded them", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(remindedLabel(null, now)).toBeNull();
    expect(remindedLabel("2026-10-22T09:00:00Z", now)).toBe("Reminded today");
    expect(remindedLabel("2026-10-21T09:00:00Z", now)).toBe("Reminded yesterday");
    expect(remindedLabel("2026-10-18T09:00:00Z", now)).toBe("Reminded 4 days ago");
  });

  it("uses Cotab notification as the primary delivery when the friend enabled it", () => {
    render(
      <RemindSheet
        groupId="tab-1"
        friend={{ id: "maya", name: "Maya", notify: true }}
        me="Alex"
        amount={18.5}
        currency="USD"
        text="Reminder"
        onClose={vi.fn()}
        onSent={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Notify Maya" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /Notify in Cotab/ })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("explains and selects sharing when Cotab notifications are unavailable", () => {
    render(
      <RemindSheet
        groupId="tab-1"
        friend={{ id: "maya", name: "Maya", notify: false }}
        me="Alex"
        amount={18.5}
        currency="USD"
        text="Reminder"
        onClose={vi.fn()}
        onSent={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Notify in Cotab/ })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "Share reminder" })).toHaveProperty(
      "disabled",
      false
    );
  });
});
