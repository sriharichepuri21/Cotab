import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "@/lib/api";

let pathname = "/app";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type Emit = (e: ChatEvent) => void;
const streamChat = vi.fn();
const confirmChatProposal = vi.fn();
const undoTabbyRun = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    isAuthed: () => true,
    streamChat: (...a: unknown[]) => streamChat(...a),
    confirmChatProposal: (id: string) => confirmChatProposal(id),
    cancelChatProposal: vi.fn(),
    undoTabbyRun: (id: string) => undoTabbyRun(id),
  };
});
vi.mock("@/lib/data", () => ({
  invalidateSpending: vi.fn(),
  invalidateSplits: vi.fn(),
  invalidateTabby: vi.fn(),
}));

import { ChatDrawer, suggestionsFor } from "./ChatDrawer";

function openDrawer() {
  render(<ChatDrawer />);
  act(() => {
    window.dispatchEvent(new CustomEvent("rw:chat", { detail: "" }));
  });
}

beforeEach(() => {
  pathname = "/app";
  streamChat.mockReset();
  confirmChatProposal.mockReset();
  undoTabbyRun.mockReset();
});
afterEach(cleanup);

describe("Ask Tabby", () => {
  it("offers questions to start with", () => {
    openDrawer();
    expect(screen.getByRole("button", { name: "How much have I spent this month?" })).toBeTruthy();
  });

  it("suggests questions about the page you're on", () => {
    expect(suggestionsFor("/app/receipts/abc")[0]).toBe("What's on this receipt?");
    expect(suggestionsFor("/app/budgets")[0]).toBe("Am I on track with my budgets?");
  });

  it("shows the answer as it streams, with what it's doing meanwhile", async () => {
    let emit: Emit = () => {};
    let finish: () => void = () => {};
    streamChat.mockImplementation(
      (_q: string, _s: string | null, _c: unknown, onEvent: Emit) =>
        new Promise<void>((resolve) => {
          emit = onEvent;
          finish = resolve;
        })
    );
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "How much have I spent this month?" }));
    expect(await screen.findByText("Thinking…")).toBeTruthy();

    act(() => emit({ type: "status", text: "Adding up your spending…" }));
    expect(screen.getByText("Adding up your spending…")).toBeTruthy();

    act(() => emit({ type: "delta", text: "Mostly **groceries**" }));
    act(() => emit({ type: "delta", text: ": $180.00." }));
    act(() => emit({ type: "done", session_id: "s1" }));
    await act(async () => finish());

    expect(screen.getByText("groceries").tagName).toBe("STRONG");
    expect(screen.queryByText(/How was this answered/)).toBeNull();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("sends with Enter and continues the same conversation", async () => {
    streamChat.mockImplementation(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "Sure." });
        onEvent({ type: "done", session_id: "s9" });
      }
    );
    openDrawer();
    const box = screen.getByLabelText("Ask Tabby", { selector: "textarea" });
    fireEvent.change(box, { target: { value: "first" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    await screen.findByText("Sure.");
    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(streamChat.mock.calls[1][1]).toBe("s9");
  });

  it("asks before changing anything, and confirms with a button", async () => {
    streamChat.mockImplementation(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "Here's the budget. Confirm it below." });
        onEvent({
          type: "proposal",
          proposal: {
            id: "p1",
            tool_name: "add_budget",
            summary: "Set a USD 150.00 monthly dining budget?",
            payload: {},
            status: "pending",
            expires_at: "",
          },
        });
        onEvent({ type: "done", session_id: "s1" });
      }
    );
    confirmChatProposal.mockResolvedValue({ status: "executed", result: {} });
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Where could I cut back?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Done")).toBeTruthy();
    expect(confirmChatProposal).toHaveBeenCalledWith("p1");
  });

  it("shows a plan as a checklist, runs it with one tap, and undoes it", async () => {
    streamChat.mockImplementation(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "Here's the plan." });
        onEvent({
          type: "proposal",
          proposal: {
            id: "p2",
            tool_name: "plan",
            summary: "2 steps",
            steps: ["Split Costco, Oct 3 with Ben.", "Split Costco, Oct 22 with Ben."],
            payload: {},
            status: "pending",
            expires_at: "",
          },
        });
        onEvent({ type: "links", links: [{ label: "Splits", href: "/app/groups" }] });
        onEvent({ type: "done", session_id: "s1" });
      }
    );
    confirmChatProposal.mockResolvedValue({
      status: "executed",
      result: { run_id: "r1", undoable: true, open: "/app/groups/g1", steps: [] },
    });
    undoTabbyRun.mockResolvedValue({ run_id: "r1", undone: 2 });
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Where could I cut back?" }));
    expect(await screen.findByText("Split Costco, Oct 22 with Ben.")).toBeTruthy();
    expect(screen.getByText("2 steps, one tap")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Splits" })).toHaveProperty(
      "href",
      expect.stringContaining("/app?tab=circles")
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Everything is back how it was")).toBeTruthy();
    expect(undoTabbyRun).toHaveBeenCalledWith("r1");
  });

  it("remembers at once, with an undo", async () => {
    streamChat.mockImplementation(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "Got it, I'll remember that." });
        onEvent({ type: "done_now", summary: "Remember: Ben is your roommate", run_id: "m1" });
        onEvent({ type: "done", session_id: "s1" });
      }
    );
    undoTabbyRun.mockResolvedValue({ run_id: "m1", undone: 1 });
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Where could I cut back?" }));
    expect(await screen.findByText("Remember: Ben is your roommate")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undoTabbyRun).toHaveBeenCalledWith("m1"));
  });

  it("says plainly when a question didn't go through", async () => {
    streamChat.mockRejectedValue(new TypeError("Failed to fetch"));
    openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Where could I cut back?" }));
    expect(await screen.findByText(/didn't go through/)).toBeTruthy();
  });

  it("asks when unsure, and a tapped answer is sent as the reply", async () => {
    streamChat.mockImplementationOnce(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "I found paneer on two Costco trips. Which one?" });
        onEvent({ type: "choices", options: ["Costco, Oct 22 ($9.99)", "Costco, Oct 3 ($9.99)"] });
        onEvent({ type: "done", session_id: "s1" });
      }
    );
    streamChat.mockImplementationOnce(
      async (_q: string, _s: string | null, _c: unknown, onEvent: Emit) => {
        onEvent({ type: "delta", text: "Here's the split." });
        onEvent({
          type: "proposal",
          proposal: {
            id: "p1",
            tool_name: "split_purchase",
            summary: "Split Gopi paneer ($9.99) with Ben. Ben owes you $4.99.",
            payload: {},
            status: "pending",
            expires_at: "",
          },
        });
        onEvent({ type: "done", session_id: "s1" });
      }
    );
    confirmChatProposal.mockResolvedValue({
      status: "executed",
      result: { open: "/app/groups/g1" },
    });
    openDrawer();
    fireEvent.change(screen.getByLabelText("Ask Tabby", { selector: "textarea" }), {
      target: { value: "split the paneer with Ben" },
    });
    fireEvent.submit(screen.getByLabelText("Ask Tabby", { selector: "textarea" }).closest("form")!);
    const choice = await screen.findByRole("button", { name: "Costco, Oct 22 ($9.99)" });
    fireEvent.click(choice);
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(streamChat.mock.calls[1][0]).toBe("Costco, Oct 22 ($9.99)");
    expect(streamChat.mock.calls[1][1]).toBe("s1");

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("link", { name: "Open it" })).toHaveProperty(
      "href",
      expect.stringContaining("/app?tab=circles&group=g1")
    );
  });
});
