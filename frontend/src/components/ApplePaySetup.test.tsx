import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCaptureStatus = vi.fn();
const createCaptureKey = vi.fn();
const revokeCaptureKey = vi.fn();
vi.mock("@/lib/api", () => ({
  TAP_URL: "https://api.example.com/api/v1/capture/tap",
  getCaptureStatus: () => getCaptureStatus(),
  createCaptureKey: (n: string) => createCaptureKey(n),
  revokeCaptureKey: (id: string) => revokeCaptureKey(id),
  filtersToParams: () => new URLSearchParams(),
}));

import { clearCache } from "@/lib/cache";

import { ApplePaySetup } from "./ApplePaySetup";

const key = {
  id: "k1",
  name: "iPhone",
  prefix: "ctb_abcd",
  created_at: "2026-10-13T10:00:00Z",
  last_used_at: null,
};

beforeEach(() => {
  clearCache();
  getCaptureStatus.mockReset();
  createCaptureKey.mockReset();
  revokeCaptureKey.mockReset();
});
afterEach(cleanup);

describe("Apple Pay setup", () => {
  it("makes a key and walks through the shortcut with it", async () => {
    getCaptureStatus.mockResolvedValue({ keys: [], last_tap_at: null, taps_this_month: 0 });
    createCaptureKey.mockResolvedValue({ ...key, key: "ctb_secretvalue123" });
    render(<ApplePaySetup />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up Apple Pay taps" }));
    expect(await screen.findByText(/Cotab won't show it again/)).toBeTruthy();
    expect(screen.getByText("Bearer ctb_secretvalue123")).toBeTruthy();
    expect(screen.getByText("https://api.example.com/api/v1/capture/tap")).toBeTruthy();
    expect(screen.getByText(/Waiting for your first tap/)).toBeTruthy();
  });

  it("shows taps arriving and lets an old phone's key be removed", async () => {
    getCaptureStatus
      .mockResolvedValueOnce({
        keys: [{ ...key, last_used_at: "2026-10-13T18:42:00Z" }],
        last_tap_at: "2026-10-13T18:42:00Z",
        taps_this_month: 12,
      })
      // After removal the server no longer lists it.
      .mockResolvedValue({ keys: [], last_tap_at: "2026-10-13T18:42:00Z", taps_this_month: 12 });
    revokeCaptureKey.mockResolvedValue(undefined);
    render(<ApplePaySetup />);
    expect(await screen.findByText(/12 taps this month/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(revokeCaptureKey).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove" })).toBeNull());
  });
});
