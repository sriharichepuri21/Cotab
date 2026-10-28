import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/CotabLogo", () => ({ CotabMark: () => null, CotabWord: () => null }));

// The "already played" flag lives in the module, so each test loads it fresh.
async function load({ calm = false, webdriver = false } = {}) {
  vi.resetModules();
  window.matchMedia = vi.fn().mockReturnValue({ matches: calm }) as never;
  Object.defineProperty(navigator, "webdriver", { value: webdriver, configurable: true });
  return import("./AppSplash");
}
const splash = () => screen.queryByRole("status", { name: "Opening Cotab" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("launch splash", () => {
  it("holds for 1.7s on a fresh load, then once only", async () => {
    const { LaunchSplash } = await load();
    const first = render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(1600));
    expect(splash()).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(splash()).toBeNull();
    first.unmount();
    render(<LaunchSplash />); // e.g. the website's "Open app"
    expect(splash()).toBeNull();
  });

  it("is shorter with reduced motion", async () => {
    const { LaunchSplash } = await load({ calm: true });
    render(<LaunchSplash />);
    act(() => vi.advanceTimersByTime(950));
    expect(splash()).toBeNull();
  });

  it("is skipped for automated browsers", async () => {
    const { LaunchSplash } = await load({ webdriver: true });
    render(<LaunchSplash />);
    expect(splash()).toBeNull();
  });
});
