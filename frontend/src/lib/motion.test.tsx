import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RollingMoney } from "@/components/newui/parts";
import { gsap, haptic, prefersReducedMotion, rewind, useMotion } from "@/lib/motion";

function mediaSays(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      // gsap.matchMedia asks for the negation too.
      matches: query.startsWith("not") ? !reduced : reduced,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reduced motion", () => {
  it("reports what matchMedia says", () => {
    mediaSays(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(renderHook(() => useMotion()).result.current).toBe("reduced");
  });

  it("is full otherwise, and when matchMedia doesn't exist", () => {
    mediaSays(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(renderHook(() => useMotion()).result.current).toBe("full");
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(renderHook(() => useMotion()).result.current).toBe("full");
  });
});

describe("RollingMoney", () => {
  it("shows the final value at once with reduced motion", () => {
    mediaSays(true);
    render(<RollingMoney value={1234.5} currency="USD" />);
    expect(screen.getByRole("img").textContent).toBe("$1,234.50");
    expect(screen.getByRole("img", { name: "$1,234.50" })).toBeTruthy();
  });

  it("gives screen readers the final value while the digits are still rolling", () => {
    mediaSays(false);
    render(<RollingMoney value={80} from={200} currency="USD" />);
    const money = screen.getByRole("img", { name: "$80.00" });
    expect(money.getAttribute("aria-live")).toBe("off");
    expect(money.textContent).toBe("$200.00");
  });

  it("lands on the exact value, and rolls from the old one on change", async () => {
    mediaSays(false);
    const { rerender } = render(<RollingMoney value={10.1} currency="USD" />);
    await waitFor(() => expect(screen.getByRole("img").textContent).toBe("$10.10"), {
      timeout: 2000,
    });
    rerender(<RollingMoney value={20} currency="USD" />);
    expect(screen.getByRole("img").textContent).toBe("$10.10");
  });

  it("has no cents to show for a currency without them", () => {
    mediaSays(true);
    render(<RollingMoney value={1500} currency="JPY" />);
    expect(screen.getByRole("img").textContent).toBe("¥1,500");
  });
});

describe("rewind", () => {
  it("resolves even if the timeline is killed before it finishes", async () => {
    const timeline = gsap.timeline().to({ x: 0 }, { x: 1, duration: 0.05 });
    const done = rewind(timeline);
    timeline.kill();
    await expect(done).resolves.toBeUndefined();
  });

  it("resolves at once with no timeline, as under reduced motion", async () => {
    await expect(rewind(null)).resolves.toBeUndefined();
  });
});

describe("haptic", () => {
  it("does nothing where vibration isn't available", () => {
    vi.stubGlobal("navigator", {});
    expect(() => haptic("success")).not.toThrow();
  });
});
