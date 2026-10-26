import { describe, expect, it } from "vitest";

import { afterConfirmed } from "./session";

describe("afterConfirmed", () => {
  const ready = { phone: "+14155550998", intent: "personal" as const };

  it("opens the new UI for normal and legacy app destinations", () => {
    expect(afterConfirmed(ready, null)).toBe("/mobile-demo");
    expect(afterConfirmed(ready, "/app/groups")).toBe("/mobile-demo");
  });

  it("preserves public share destinations", () => {
    expect(afterConfirmed(ready, "/share/invite-code")).toBe("/share/invite-code");
  });
});
