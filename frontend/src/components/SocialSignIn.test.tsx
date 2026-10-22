import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviders = vi.fn();
vi.mock("@/lib/api", () => ({
  getProviders: () => getProviders(),
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
}));

const fresh = async () => {
  vi.resetModules();
  return (await import("./SocialSignIn")).SocialSignIn;
};

const ids = { google_client_id: "g.apps.googleusercontent.com", apple_client_id: null };

beforeEach(() => {
  getProviders.mockReset();
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Continue with Google", () => {
  it("still appears when the server was asleep for the first check", async () => {
    getProviders.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(ids);
    const SocialSignIn = await fresh();
    render(<SocialSignIn mode="signin" onSignedIn={() => undefined} onError={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByLabelText("Continue with Google")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
    expect(getProviders).toHaveBeenCalledTimes(2);
  });

  it("shows at once on a later visit, from the remembered answer", async () => {
    window.localStorage.setItem("cotab:providers", JSON.stringify(ids));
    getProviders.mockReturnValue(new Promise(() => undefined)); // server still waking
    const SocialSignIn = await fresh();
    render(<SocialSignIn mode="signup" onSignedIn={() => undefined} onError={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
  });

  it("stays hidden when the server says Google isn't set up", async () => {
    getProviders.mockResolvedValue({ google_client_id: null, apple_client_id: null });
    const SocialSignIn = await fresh();
    render(<SocialSignIn mode="signin" onSignedIn={() => undefined} onError={() => undefined} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByLabelText("Continue with Google")).toBeNull();
  });
});
