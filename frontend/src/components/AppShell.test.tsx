import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    code?: string;
    extra: Record<string, unknown>;
    constructor(status: number, message: string, code?: string, extra = {}) {
      super(message);
      this.status = status;
      this.code = code;
      this.extra = extra;
    }
  },
  clearToken: vi.fn(),
  isAuthed: () => authed.value,
  logout: vi.fn(async () => undefined),
  UNAUTHED_EVENT: "rw:unauthed",
  uploadReceipt: (...a: unknown[]) => uploadReceipt(...a),
  deleteReceipt: vi.fn(),
}));
const uploadReceipt = vi.fn();

const currentUser = { value: { intent: "personal" } as { intent: string | null } | undefined };
const invalidateSpending = vi.fn();
vi.mock("@/lib/data", () => ({
  useMe: () => ({ data: currentUser.value }),
  invalidateSpending: () => invalidateSpending(),
  prefetchTabs: vi.fn(),
}));

vi.mock("@/lib/upload", () => ({
  UPLOADED_EVENT: "rw:uploaded",
  compressImage: async () => new Blob(["small"], { type: "image/webp" }),
}));

import { ApiError } from "@/lib/api";
import { resetQueue } from "@/lib/scanQueue";

import { AppShell } from "./AppShell";

beforeEach(() => {
  pathname = "/app";
  authed.value = true;
  replace.mockReset();
  push.mockReset();
  uploadReceipt.mockReset();
  resetQueue();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  invalidateSpending.mockReset();
  currentUser.value = { intent: "personal" };
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

  it("opens the scanner with three ways to add receipts", async () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Scan a receipt" }))[0]);
    const dialog = screen.getByRole("dialog", { name: "Add receipts" });
    for (const label of ["Take a photo", "Choose from Photos", "Upload a file"]) {
      expect(within(dialog).getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("reads a picked photo, then closes and says it's on the tab", async () => {
    uploadReceipt.mockResolvedValue({ id: "r1", status: "extracted", merchant: "Corner Market" });
    render(<AppShell>x</AppShell>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Scan a receipt" }))[0]);
    const input = screen.getByTestId("scan-photos") as HTMLInputElement;
    const file = new File(["img"], "r.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Corner Market is on your tab")
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the scanner open and explains when it isn't a receipt", async () => {
    uploadReceipt.mockRejectedValue(
      new ApiError(422, "That doesn't look like a receipt, so nothing was added.", "not_a_receipt")
    );
    render(<AppShell>x</AppShell>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Scan a receipt" }))[0]);
    fireEvent.change(screen.getByTestId("scan-camera"), {
      target: { files: [new File(["img"], "r.jpg", { type: "image/jpeg" })] },
    });
    const dialog = screen.getByRole("dialog", { name: "Add receipts" });
    await waitFor(() => expect(within(dialog).getByText("Not a receipt")).toBeTruthy());
    expect(within(dialog).getByText(/nothing was added/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Choose a photo" })).toBeTruthy();
  });

  it("sends someone who hasn't picked what they use Cotab for to onboarding", async () => {
    currentUser.value = { intent: null };
    render(<AppShell>x</AppShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
  });

  it("sends people to sign in when their session expires on any page", async () => {
    render(<AppShell>x</AppShell>);
    await screen.findByText("x");
    window.dispatchEvent(new Event("rw:unauthed"));
    expect(replace).toHaveBeenCalledWith("/login?expired=1");
  });

  it("refreshes spending everywhere after a scan lands", async () => {
    render(<AppShell>x</AppShell>);
    await screen.findByText("x");
    window.dispatchEvent(new CustomEvent("rw:uploaded"));
    expect(invalidateSpending).toHaveBeenCalledTimes(1);
  });
});
