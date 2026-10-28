import { describe, expect, it } from "vitest";

import type { User } from "@/lib/api";

import { DEFAULT_TABBY, friendTabby, userTabby } from "./tabby";

describe("friendTabby", () => {
  it("gives every name a real Tabby, long names included", () => {
    for (const name of ["Ben", "Ben Lee", "Ben Carter", "Cara", "Dev", "Priyanka Venkataraman"])
      expect(friendTabby(name).mood).toBeTruthy();
  });
});

describe("userTabby", () => {
  it("draws the default Tabby for a look or mood Cotab doesn't have", () => {
    const user = { avatar_look: "classic", avatar_mood: "happy" } as unknown as User;
    expect(userTabby(user)).toMatchObject({ look: DEFAULT_TABBY.look, mood: DEFAULT_TABBY.mood });
  });

  it("keeps a saved look and mood that exist", () => {
    const user = { avatar_look: "beanie", avatar_mood: "cool" } as User;
    expect(userTabby(user)).toMatchObject({ look: "beanie", mood: "cool" });
  });
});
