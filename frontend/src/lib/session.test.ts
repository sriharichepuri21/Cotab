import { describe, expect, it } from "vitest";

import { afterConfirmed } from "./session";

describe("afterConfirmed", () => {
  const ready = { phone: "+14155550998", intent: "personal" as const };

  it("opens the app, or the page a link was going to", () => {
    expect(afterConfirmed(ready, null)).toBe("/app");
    expect(afterConfirmed(ready, "/app/groups")).toBe("/app/groups");
  });

  it("preserves public share destinations", () => {
    expect(afterConfirmed(ready, "/share/invite-code")).toBe("/share/invite-code");
  });
});
