import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setMemberPhone = vi.fn();
vi.mock("@/lib/api", () => ({
  setMemberPhone: (...a: unknown[]) => setMemberPhone(...a),
}));

import type { SplitSummaryMember } from "@/lib/api";

import { MemberInvite, memberStatusLabel } from "./MemberInvite";

const ben = (over: Partial<SplitSummaryMember> = {}): SplitSummaryMember => ({
  id: "m-ben",
  name: "Ben",
  joined: false,
  status: "not_on_cotab",
  phone: "+14155550123",
  ...over,
});

function show(member: SplitSummaryMember, onSaved = vi.fn()) {
  render(
    <MemberInvite
      member={member}
      groupId="g1"
      shareCode="abc"
      tab={{ name: "Lake trip", kind: "group" }}
      from="Ada"
      onSaved={onSaved}
    />
  );
  return onSaved;
}

beforeEach(() => {
  setMemberPhone.mockReset();
});
afterEach(cleanup);

describe("MemberInvite", () => {
  it("texts an invite to someone not on Cotab, from your own phone", () => {
    show(ben());
    const link = screen.getByRole("link", { name: "Text invite" }).getAttribute("href")!;
    expect(link.startsWith("sms:+14155550123")).toBe(true);
    expect(decodeURIComponent(link)).toContain(
      "Ada added you to Lake trip on Cotab. See what's on it and join: http://localhost:3000/share/abc?as=m-ben"
    );
  });

  it("emails the invite to someone added by email only", () => {
    show(ben({ status: "no_phone", phone: null, email: "ben@x.com" }));
    const href = screen.getByRole("link", { name: "Email invite" }).getAttribute("href")!;
    expect(href.startsWith("mailto:ben@x.com?subject=Ada%20added%20you%20on%20Cotab")).toBe(true);
    expect(decodeURIComponent(href)).toContain("/share/abc?as=m-ben");
  });

  it("adds a number for someone added by name only", async () => {
    setMemberPhone.mockResolvedValue({});
    const onSaved = show(ben({ status: "no_phone", phone: null }));
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    const field = screen.getByLabelText("Ben's mobile number");
    fireEvent.change(field, { target: { value: "4155550123" } });
    expect((field as HTMLInputElement).value).toBe("(415) 555-0123");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(setMemberPhone).toHaveBeenCalledWith("g1", "m-ben", "(415) 555-0123");
  });

  it("shows why a number couldn't be saved", async () => {
    setMemberPhone.mockImplementation(async () => {
      throw new Error("That number is already in this split, as Cara.");
    });
    show(ben({ status: "no_phone", phone: null }));
    fireEvent.click(screen.getByRole("button", { name: "Add number" }));
    fireEvent.change(screen.getByLabelText("Ben's mobile number"), {
      target: { value: "4155550123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That number is already in this split, as Cara."
    );
  });

  it("has nothing to offer for someone who has joined", () => {
    const { container } = render(
      <MemberInvite
        member={ben({ joined: true, status: "joined" })}
        groupId="g1"
        shareCode="abc"
        tab={{ name: "Lake trip" }}
        from="Ada"
        onSaved={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the number only to the tab's owner", () => {
    expect(memberStatusLabel(ben(), true)).toBe("(415) 555-0123. Not on Cotab yet");
    expect(memberStatusLabel(ben(), false)).toBe("Not on Cotab yet");
    expect(memberStatusLabel(ben({ status: "joined", joined: true }), true)).toBe("On Cotab");
  });
});
