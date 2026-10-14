"use client";

import { ArrowUp, Square, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  ApiError,
  cancelChatProposal,
  type ChatProposal,
  confirmChatProposal,
  isAuthed,
  streamChat,
} from "@/lib/api";
import { invalidateSpending, invalidateSplits } from "@/lib/data";
import { Markdown } from "@/lib/markdown";

type Entry = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** What the assistant is doing right now ("Looking through your receipts…"). */
  status?: string;
  streaming?: boolean;
  proposal?: ChatProposal | null;
  actionState?: "executed" | "cancelled" | "working";
};

function pageContext(pathname: string): Record<string, string> {
  const receipt = pathname.match(/^\/app\/receipts\/([^/]+)/)?.[1];
  const group = pathname.match(/^\/app\/groups\/([^/]+)/)?.[1];
  return {
    page: pathname,
    ...(receipt ? { receipt_id: receipt } : {}),
    ...(group ? { group_id: group } : {}),
  };
}

/** Questions worth one tap, depending on where the person is. */
export function suggestionsFor(pathname: string): string[] {
  if (/^\/app\/receipts\/[^/]+/.test(pathname))
    return [
      "What's on this receipt?",
      "How often do I shop here?",
      "Split this evenly with a friend",
    ];
  if (pathname.startsWith("/app/budgets"))
    return [
      "Am I on track with my budgets?",
      "Which budget is closest to its limit?",
      "Suggest a sensible dining budget",
    ];
  if (pathname.startsWith("/app/groups"))
    return ["Who owes me money?", "What do I owe, and to whom?", "How do splits work?"];
  return [
    "How much have I spent this month?",
    "Where does most of my money go?",
    "How does this month compare to last month?",
    "Where could I cut back?",
    "How do I forward email receipts?",
  ];
}

const FAILED = "That didn't go through. Check your connection and try again.";

export function ChatDrawer() {
  const pathname = usePathname();
  const context = useMemo(() => pageContext(pathname), [pathname]);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    setMounted(true);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setOpen(true);
      if (detail) setInput(detail);
    };
    window.addEventListener("rw:chat", handler);
    return () => window.removeEventListener("rw:chat", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Follow the answer as it streams in, unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // Grow the box with what's typed, up to a few lines.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input, open]);

  const patch = useCallback((id: number, change: (e: Entry) => Partial<Entry>) => {
    setEntries((all) => all.map((e) => (e.id === id ? { ...e, ...change(e) } : e)));
  }, []);

  if (!mounted || !isAuthed()) return null;

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const answerId = nextId.current + 1;
    nextId.current += 2;
    setEntries((all) => [
      ...all,
      { id: answerId - 1, role: "user", text: question },
      { id: answerId, role: "assistant", text: "", streaming: true },
    ]);
    setInput("");
    setBusy(true);
    pinned.current = true;
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat(
        question,
        session,
        context,
        (event) => {
          if (event.type === "delta")
            patch(answerId, (e) => ({ text: e.text + event.text, status: undefined }));
          else if (event.type === "status") patch(answerId, () => ({ status: event.text }));
          else if (event.type === "proposal") patch(answerId, () => ({ proposal: event.proposal }));
          else if (event.type === "done") setSession(event.session_id);
        },
        controller.signal
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof ApiError && error.status !== 500 ? error.message : FAILED;
      patch(answerId, (e) => ({ text: e.text ? `${e.text}\n\n${message}` : message }));
    } finally {
      patch(answerId, () => ({ streaming: false, status: undefined }));
      abort.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abort.current?.abort();
  }

  function newChat() {
    stop();
    setEntries([]);
    setSession(null);
    field.current?.focus();
  }

  async function act(entry: Entry, confirm: boolean) {
    const proposal = entry.proposal!;
    patch(entry.id, () => ({ actionState: "working" }));
    try {
      if (confirm) {
        await confirmChatProposal(proposal.id);
        invalidateSpending();
        invalidateSplits();
        patch(entry.id, () => ({ actionState: "executed" }));
      } else {
        await cancelChatProposal(proposal.id);
        patch(entry.id, () => ({ actionState: "cancelled" }));
      }
    } catch (error) {
      patch(entry.id, (e) => ({
        actionState: undefined,
        text: `${e.text}\n\n${error instanceof Error ? error.message : FAILED}`,
      }));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  }

  const suggestions = suggestionsFor(pathname);

  return (
    <>
      {/* Inside the app shell the Ask tab opens the drawer, so the floating
          button would only cover content. */}
      {!pathname.startsWith("/app") && (
        <button
          aria-label="Open Cotab chat"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-button bg-ink px-5 py-3 text-sm font-semibold text-paper shadow-lg"
        >
          Ask Cotab
        </button>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-ink/25"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <aside
            aria-label="Ask Cotab"
            className="flex h-[100dvh] w-full max-w-md flex-col bg-paper shadow-2xl"
          >
            <header className="flex items-center gap-2 border-b border-ink px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl leading-tight">Ask Cotab</h2>
                <p className="text-sm text-muted">Your spending, and how Cotab works</p>
              </div>
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  className="min-h-11 px-2 text-sm font-semibold underline underline-offset-4"
                >
                  New chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="grid size-11 place-items-center rounded-button text-muted hover:text-ink"
              >
                <X size={22} aria-hidden />
              </button>
            </header>

            <div
              ref={scroller}
              role="log"
              aria-live="polite"
              aria-busy={busy}
              onScroll={(e) => {
                const el = e.currentTarget;
                pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              className="flex-1 overflow-y-auto px-4 py-5"
            >
              {entries.length === 0 ? (
                <div className="flex flex-col gap-4">
                  <p className="text-lg leading-snug">
                    Ask anything about what you&apos;ve spent, your budgets, splits, or how to use
                    Cotab.
                  </p>
                  <div className="flex flex-col items-start gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="min-h-11 rounded-button border border-line bg-card px-3 py-2 text-left text-[15px] hover:border-ink"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {entries.map((entry) =>
                    entry.role === "user" ? (
                      <p
                        key={entry.id}
                        className="ml-10 self-end whitespace-pre-wrap rounded-card rounded-br-sm bg-ink px-3.5 py-2.5 text-[15px] text-paper"
                      >
                        {entry.text}
                      </p>
                    ) : (
                      <div key={entry.id} className="mr-4 text-[15px] leading-relaxed">
                        {entry.text && <Markdown text={entry.text} />}
                        {entry.streaming && (
                          <p
                            className={`flex items-center gap-2 text-sm text-muted ${entry.text ? "mt-2" : ""}`}
                          >
                            <span className="chat-dots" aria-hidden>
                              <span />
                              <span />
                              <span />
                            </span>
                            {entry.status ?? (entry.text ? "" : "Thinking…")}
                          </p>
                        )}
                        {entry.proposal && (
                          <div className="mt-3 rounded-card border border-ink bg-card p-3">
                            <p className="font-semibold">{entry.proposal.summary}</p>
                            {entry.actionState === "executed" ? (
                              <p className="mt-2 text-sm text-muted">Done.</p>
                            ) : entry.actionState === "cancelled" ? (
                              <p className="mt-2 text-sm text-muted">Cancelled.</p>
                            ) : (
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  disabled={entry.actionState === "working"}
                                  onClick={() => act(entry, true)}
                                  className="min-h-11 rounded-button bg-ink px-4 font-semibold text-paper disabled:opacity-50"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  disabled={entry.actionState === "working"}
                                  onClick={() => act(entry, false)}
                                  className="min-h-11 rounded-button border border-ink px-4 font-semibold disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <form
              className="border-t border-ink bg-paper p-3"
              onSubmit={(event) => {
                event.preventDefault();
                ask(input);
              }}
            >
              <div className="flex items-end gap-2 rounded-card border border-line bg-card p-1.5 focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
                <label htmlFor="chat-question" className="sr-only">
                  Ask Cotab
                </label>
                <textarea
                  id="chat-question"
                  ref={field}
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={2000}
                  placeholder="Ask about your spending…"
                  className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-snug outline-none focus-visible:outline-none"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop answering"
                    className="grid size-10 shrink-0 place-items-center rounded-button border border-ink"
                  >
                    <Square size={14} fill="currentColor" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={!input.trim()}
                    className="grid size-10 shrink-0 place-items-center rounded-button bg-ink text-paper disabled:opacity-30"
                  >
                    <ArrowUp size={20} aria-hidden />
                  </button>
                )}
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
