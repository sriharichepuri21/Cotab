import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();
let pathname = "/app/tab";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push }),
}));

const authed = { value: true };
vi.mock("@/lib/api", () => ({
  isAuthed: () => authed.value,
  UNAUTHED_EVENT: "rw:unauthed",
  VERIFY_EVENT: "rw:verify",
}));

const currentUser = {
  value: { intent: "personal" } as
    | { intent: string | null; email_verified?: boolean; phone?: string | null }
    | undefined,
};
const invalidateSpending = vi.fn();
vi.mock("@/lib/data", () => ({
  useMe: () => ({ data: currentUser.value }),
  invalidateSpending: () => invalidateSpending(),
  prefetchTabs: vi.fn(),
}));

vi.mock("@/lib/upload", () => ({
  UPLOADED_EVENT: "rw:uploaded",
}));

import { AppShell } from "./AppShell";

beforeEach(() => {
  pathname = "/app/tab";
  authed.value = true;
  replace.mockReset();
  push.mockReset();
  invalidateSpending.mockReset();
  currentUser.value = { intent: "personal" };
});

afterEach(cleanup);

describe("AppShell", () => {
  it("shows only the page: the app draws its own navigation", () => {
    render(
      <AppShell>
        <p>new home</p>
      </AppShell>
    );
    expect(screen.getByText("new home")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("sends signed-out visitors to sign in and renders nothing", () => {
    authed.value = false;
    render(<AppShell>secret</AppShell>);
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("sends an account with an unconfirmed email to the code screen", async () => {
    currentUser.value = { intent: "personal", email_verified: false };
    pathname = "/app/tab";
    render(<AppShell>x</AppShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/verify?next=%2Fapp%2Ftab"));
  });

  it("keeps the open screen for the way back from the code screen", async () => {
    currentUser.value = { intent: "personal", email_verified: false };
    pathname = "/app";
    window.history.pushState({}, "", "/app?panel=budgets");
    render(<AppShell>x</AppShell>);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/verify?next=%2Fapp%3Fpanel%3Dbudgets")
    );
    window.history.pushState({}, "", "/");
  });

  it("sends someone who hasn't picked what they use Cotab for to onboarding", async () => {
    currentUser.value = { intent: null };
    render(<AppShell>x</AppShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
  });

  it("asks for a mobile number before onboarding or the app", async () => {
    currentUser.value = { intent: null, phone: null };
    pathname = "/app/groups";
    render(<AppShell>x</AppShell>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/phone?next=%2Fapp%2Fgroups"));
    expect(replace).not.toHaveBeenCalledWith("/welcome");
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
