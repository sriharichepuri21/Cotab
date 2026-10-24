import { describe, expect, it } from "vitest";

import { inviteMessage, inviteUrl, smsHref } from "./invite";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0";

describe("invite", () => {
  it("links to the tab as that person", () => {
    expect(inviteUrl("https://cotab.app", "abc123", "m-1")).toBe(
      "https://cotab.app/share/abc123?as=m-1"
    );
  });

  it("names the tab, or says it's between the two of you", () => {
    expect(inviteMessage("Ada", { name: "Lake trip", kind: "group" }, "L")).toBe(
      "Ada added you to Lake trip on Cotab. See what's on it and join: L"
    );
    expect(inviteMessage("Ada", { name: "You & Ben", kind: "direct" }, "L")).toContain(
      "Ada started a tab with you on Cotab."
    );
  });

  it("fills in the text the way each phone expects", () => {
    expect(smsHref("+14155550123", "Hi & bye", IPHONE)).toBe(
      "sms:+14155550123&body=Hi%20%26%20bye"
    );
    expect(smsHref("+14155550123", "Hi", ANDROID)).toBe("sms:+14155550123?body=Hi");
  });
});
