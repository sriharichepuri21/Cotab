import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();
let pathname = "/app";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push }),
}));

const authed = { value: true };
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  clearToken: vi.fn(),
  isAuthed: () => authed.value,
  logout: vi.fn(async () => undefined),
}));

const scanAndUpload = vi.fn();
vi.mock("@/lib/upload", () => ({ scanAndUpload: (f: File) => scanAndUpload(f) }));

import { AppShell } from "./AppShell";

beforeEach(() => {
  pathname = "/app";
  authed.value = true;
  replace.mockReset();
  push.mockReset();
  scanAndUpload.mockReset();
});

afterEach(cleanup);

describe("AppShell", () => {
  it("sends signed-out visitors to sign in and renders nothing", () => {
    authed.value = false;
    render(<AppShell>secret</AppShell>);
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("shows the page inside both navigations when signed in", async () => {
    render(<AppShell>page body</AppShell>);
    expect(await screen.findByText("page body")).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(2);
  });

  it("marks the tab for the current page", async () => {
    pathname = "/app/budgets";
    render(<AppShell>x</AppShell>);
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current.every((el) => el.textContent?.includes("Budgets"))).toBe(true);
  });

  it("treats receipt pages as part of the Tab", async () => {
    pathname = "/app/receipts/abc";
    render(<AppShell>x</AppShell>);
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((el) => el.textContent?.trim() === "Tab")).toBe(true);
  });

  it("puts Home, Tab, House and Ask around Scan on phones", async () => {
    render(<AppShell>x</AppShell>);
    await screen.findByText("x");
    const bars = screen.getAllByRole("navigation", { name: "Main" });
    const phone = bars[bars.length - 1];
    expect(phone.textContent?.replace(/\s+/g, "")).toBe("HomeTabHouseAsk");
  });

  it("opens the chat drawer from Ask", async () => {
    const heard = vi.fn();
    window.addEventListener("rw:chat", heard);
    render(<AppShell>x</AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: "Ask" }));
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("rw:chat", heard);
  });

  it("uploads from the Scan button and confirms by merchant", async () => {
    scanAndUpload.mockResolvedValue({ status: "extracted", merchant: "Corner Market" });
    const { container } = render(<AppShell>x</AppShell>);
    await screen.findByText("x");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["img"], "r.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(scanAndUpload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Corner Market"));
  });

  it("says plainly when a scan could not be read", async () => {
    scanAndUpload.mockResolvedValue({ status: "failed", merchant: "" });
    const { container } = render(<AppShell>x</AppShell>);
    await screen.findByText("x");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["i"], "r.jpg")] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("couldn't read"));
  });
});
