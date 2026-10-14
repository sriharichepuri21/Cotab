import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getInbox = vi.fn();
const addInboxSender = vi.fn();
const removeInboxSender = vi.fn();
const newInboxAddress = vi.fn();
vi.mock("@/lib/api", () => ({
  getInbox: () => getInbox(),
  addInboxSender: (e: string) => addInboxSender(e),
  removeInboxSender: (id: string) => removeInboxSender(id),
  newInboxAddress: () => newInboxAddress(),
  filtersToParams: () => new URLSearchParams(),
}));

import { clearCache } from "@/lib/cache";

import { ForwardingSetup } from "./ForwardingSetup";

const inbox = {
  enabled: true,
  address: "sam-k3x9@in.cotab.app",
  account_email: "sam@example.com",
  senders: [],
  recent: [],
};

beforeEach(() => {
  clearCache();
  for (const f of [getInbox, addInboxSender, removeInboxSender, newInboxAddress]) f.mockReset();
});
afterEach(cleanup);

describe("Email forwarding setup", () => {
  it("stays hidden until the server has email switched on", async () => {
    getInbox.mockResolvedValue({ enabled: false, account_email: "sam@example.com" });
    const { container } = render(<ForwardingSetup />);
    await waitFor(() => expect(getInbox).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("shows the address and lets another sender be added and removed", async () => {
    getInbox.mockResolvedValue(inbox);
    addInboxSender.mockResolvedValue({
      ...inbox,
      senders: [{ id: "s1", email: "work@company.com" }],
    });
    removeInboxSender.mockResolvedValue(inbox);
    render(<ForwardingSetup />);

    expect(await screen.findByText("sam-k3x9@in.cotab.app")).toBeTruthy();
    expect(screen.getByText("sam@example.com")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Another address you forward from"), {
      target: { value: " work@company.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("work@company.com")).toBeTruthy();
    expect(addInboxSender).toHaveBeenCalledWith("work@company.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("work@company.com")).toBeNull());
    expect(removeInboxSender).toHaveBeenCalledWith("s1");
  });

  it("explains what happened to recent emails", async () => {
    getInbox.mockResolvedValue({
      ...inbox,
      recent: [
        {
          id: "e1",
          subject: "Your Amazon order",
          from_address: "sam@example.com",
          status: "added",
          reason: "",
          receipt_id: "r1",
          created_at: "2026-10-13T10:00:00Z",
        },
        {
          id: "e2",
          subject: "Weekly deals",
          from_address: "sam@example.com",
          status: "skipped",
          reason: "This doesn't look like a receipt",
          receipt_id: null,
          created_at: "2026-10-13T09:00:00Z",
        },
      ],
    });
    render(<ForwardingSetup />);
    expect(await screen.findByText("Your Amazon order")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByText("This doesn't look like a receipt")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open" })).toHaveLength(1);
  });

  it("asks before replacing the address", async () => {
    getInbox.mockResolvedValue(inbox);
    newInboxAddress.mockResolvedValue({ ...inbox, address: "sam-p2q7@in.cotab.app" });
    render(<ForwardingSetup />);
    fireEvent.click(await screen.findByRole("button", { name: "Getting spam? Get a new address" }));
    expect(screen.getByText(/current address will stop working/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get a new address" }));
    expect(await screen.findByText("sam-p2q7@in.cotab.app")).toBeTruthy();
  });
});
