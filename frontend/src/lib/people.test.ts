import { describe, expect, it } from "vitest";

import { myNameOn } from "./people";

const LAKE_TRIP = [
  { name: "Demo", account: "u-demo" },
  { name: "Ben", account: "u-ben" },
  { name: "Cara", account: null },
  { name: "Dev" },
  { name: "Ben Lee", account: "u-benlee" },
];

describe("myNameOn", () => {
  it("finds you by account, whatever your account name is", () => {
    expect(myNameOn(LAKE_TRIP, "u-demo", "Demo User")).toBe("Demo");
  });

  it("counts a five-person tab as five ways, not six", () => {
    const me = myNameOn(LAKE_TRIP, "u-demo", "Demo User");
    const others = LAKE_TRIP.map((m) => m.name).filter((n) => n !== me);
    expect(others.length + 1).toBe(5);
  });

  it("falls back to your own name off a tab", () => {
    expect(myNameOn(undefined, "u-demo", "Demo User")).toBe("Demo User");
    expect(myNameOn(LAKE_TRIP, "u-stranger", "Ana")).toBe("Ana");
    expect(myNameOn(LAKE_TRIP, undefined, "Ana")).toBe("Ana");
  });
});
