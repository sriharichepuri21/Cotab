import { describe, expect, it } from "vitest";

import { friendTabby } from "./tabby";

describe("friendTabby", () => {
  it("gives every name a real Tabby, long names included", () => {
    for (const name of ["Ben", "Ben Lee", "Ben Carter", "Cara", "Dev", "Priyanka Venkataraman"])
      expect(friendTabby(name).mood).toBeTruthy();
  });
});
