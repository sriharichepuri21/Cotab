"use client";

import { ArrowUp, Square, X } from "lucide-react";
import { CatAvatar } from "@/components/Tabby";
import { Cat } from "@/components/newui/parts";
import { TabbyPlan, type PlanState } from "@/components/TabbyPlan";
import { Icon } from "@/components/ui";
import type { ChatLink, PlanResult, TabbyMood } from "@/lib/api";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { tabbyArt } from "@/lib/tabby";

import {
  ApiError,
  cancelChatProposal,
  type ChatProposal,
  confirmChatProposal,
  downloadFile,
  isAuthed,
  streamChat,
  undoTabbyRun,
} from "@/lib/api";
import { invalidateSpending, invalidateSplits, invalidateTabby } from "@/lib/data";
import { newUiPath, routes } from "@/lib/routes";
import { Markdown } from "@/lib/markdown";

type Entry = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** What the assistant is doing right now ("Looking through your receipts…"). */
  status?: string;
  streaming?: boolean;
  proposal?: ChatProposal | null;
  actionState?: PlanState;
  /** What running the plan did, with its undo id. */
  result?: PlanResult;
  /** Answers Tabby offered to tap when it needed to clarify something. */
  choices?: string[];
  /** Buttons to pages or downloads under the reply. */
  links?: ChatLink[];
  /** Things Tabby did at once (remembering), each with Undo. */
  doneNow?: Array<{ summary: string; run_id: string; undone?: boolean }>;
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
      "Split this evenly with a friend",
      "This should be in dining",
    ];
  if (pathname.startsWith("/app/budgets"))
    return [
      "Am I on track with my budgets?",
      "Raise my grocery budget to $500",
      "Suggest a sensible dining budget",
    ];
  if (pathname.startsWith("/app/groups"))
    return [
      "Who owes me money?",
      "Split my last Costco trip with Ben",
      "Make a group for our Tahoe trip",
    ];
  return [
    "How much have I spent this month?",
    "Split my last Costco trip with a friend",
    "Fix the receipts that need checking",
    "Where could I cut back?",
    "Export this month as a spreadsheet",
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
          else if (event.type === "proposal")
            setEntries((all) =>
              all.map((e) =>
                e.id === answerId
                  ? { ...e, proposal: event.proposal }
                  : e.proposal && !e.actionState
                    ? { ...e, actionState: "replaced" }
                    : e
              )
            );
          else if (event.type === "choices") patch(answerId, () => ({ choices: event.options }));
          else if (event.type === "links") patch(answerId, () => ({ links: event.links }));
          else if (event.type === "done_now") {
            patch(answerId, (e) => ({
              doneNow: [...(e.doneNow ?? []), { summary: event.summary, run_id: event.run_id }],
            }));
            invalidateTabby();
          } else if (event.type === "done") setSession(event.session_id);
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
        const done = await confirmChatProposal(proposal.id);
        refresh();
        patch(entry.id, () => ({ actionState: "executed", result: done.result }));
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

  async function undo(entry: Entry) {
    const runId = entry.result?.run_id;
    if (!runId) return;
    patch(entry.id, () => ({ actionState: "undoing" }));
    try {
      await undoTabbyRun(runId);
      refresh();
      patch(entry.id, () => ({ actionState: "undone" }));
    } catch (error) {
      patch(entry.id, (e) => ({
        actionState: "executed",
        text: `${e.text}\n\n${error instanceof Error ? error.message : FAILED}`,
      }));
    }
  }

  async function undoNow(entry: Entry, runId: string) {
    try {
      await undoTabbyRun(runId);
      invalidateTabby();
      patch(entry.id, (e) => ({
        doneNow: e.doneNow?.map((d) => (d.run_id === runId ? { ...d, undone: true } : d)),
      }));
    } catch {
      // Already undone or gone: nothing to show.
    }
  }

  function refresh() {
    invalidateSpending();
    invalidateSplits();
    invalidateTabby();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  }

  const suggestions = suggestionsFor(pathname);
  const lastEntry = entries[entries.length - 1];
  const lastState = [...entries].reverse().find((e) => e.actionState)?.actionState;
  const face: TabbyMood = busy
    ? "thinking"
    : lastState === "working" || lastState === "undoing"
      ? "working"
      : lastState === "executed"
        ? "done"
        : lastState === "undone"
          ? "oops"
          : lastEntry?.doneNow?.length
            ? "remember"
            : "hi";

  return (
    <>
      {/* Inside the app shell the Ask tab opens the drawer, so the floating
          button would only cover content. */}
      {!pathname.startsWith("/app") &&
        !["/login", "/register", "/verify", "/phone", "/welcome", "/forgot"].includes(pathname) && (
          <button
            aria-label="Ask Tabby"
            onClick={() => setOpen(true)}
            className="press fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-forest py-1.5 pl-1.5 pr-5 text-sm font-bold text-paper shadow-[0_16px_30px_-12px_rgb(15_61_49/0.7)]"
          >
            <CatAvatar choice={{ look: "hoodie", mood: "hi", bg: "mood" }} size={34} />
            Ask Tabby
          </button>
        )}
      {open && (
        <div
          className="tabby-night fixed inset-0 z-50 flex justify-end bg-ink/35 backdrop-blur-[2px]"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <aside
            aria-label="Ask Tabby"
            className="sheet flex h-[100dvh] w-full max-w-md flex-col bg-paper shadow-2xl"
          >
            <header className="flex items-center gap-3 px-4 pb-3 pt-4">
              <span className="aura-ring">
                <Cat mood={face} size={44} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[19px] font-extrabold leading-tight tracking-[-0.03em]">
                  Ask Tabby
                </h2>
                <p className="text-[13px] font-medium text-faint">
                  {busy ? "Tabby is on it…" : "Ask, or give me a task"}
                </p>
              </div>
              <Link
                href={routes.tabby}
                onClick={() => setOpen(false)}
                aria-label="What Tabby did"
                className="grid size-10 place-items-center rounded-full bg-card text-muted shadow-[0_0_0_1px_rgb(12_17_14/0.06)] hover:text-ink"
              >
                <Icon name="history" size={22} />
              </Link>
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  className="min-h-10 rounded-full bg-card px-3 text-[13px] font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.06)]"
                >
                  New chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="grid size-10 place-items-center rounded-full bg-card text-muted shadow-[0_0_0_1px_rgb(12_17_14/0.06)] hover:text-ink"
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tabbyArt("thinking")}
                    alt=""
                    className="tabby-hop tabby-v3-figure h-40 w-auto self-center"
                  />
                  <p className="rounded-[20px] rounded-tl-md bg-card px-4 py-3 text-[16px] font-semibold leading-snug">
                    Hi! Ask me about your spending, or tell me what to do: split a purchase, fix a
                    receipt, change a budget. I&apos;ll show you the plan before anything changes.
                  </p>
                  <div className="flex flex-col items-start gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="press min-h-11 rounded-full bg-card px-4 py-2 text-left text-[14px] font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.06)] hover:bg-gold/40"
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
                        className="ml-10 self-end whitespace-pre-wrap rounded-[20px] rounded-br-md bg-forest px-4 py-2.5 text-[15px] font-medium text-paper"
                      >
                        {entry.text}
                      </p>
                    ) : (
                      <div
                        key={entry.id}
                        className="mr-4 flex items-start gap-2.5 text-[15px] leading-relaxed"
                      >
                        <span className="mt-1 shrink-0">
                          <Cat mood={entry.streaming ? "thinking" : "hi"} size={28} />
                        </span>
                        <div className="min-w-0 flex-1 rounded-[20px] rounded-tl-md bg-card px-4 py-3">
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
                          {entry.choices && entry.choices.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {entry.choices.map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  disabled={busy || entry.id !== lastEntry?.id}
                                  onClick={() => ask(choice)}
                                  className="press rounded-full bg-paper px-3.5 py-2 text-left text-[13px] font-bold text-forest ring-1 ring-forest/20 hover:bg-gold/40 disabled:opacity-50"
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                          )}
                          {entry.doneNow?.map((d) => (
                            <p
                              key={d.run_id}
                              className="mt-3 flex items-center gap-2 rounded-[14px] bg-paper px-3 py-2 text-[13px] font-semibold"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <Cat mood={d.undone ? "oops" : "remember"} size={28} />
                              <span
                                className={`min-w-0 flex-1 ${d.undone ? "text-faint line-through" : ""}`}
                              >
                                {d.summary}
                              </span>
                              {!d.undone && (
                                <button
                                  type="button"
                                  onClick={() => undoNow(entry, d.run_id)}
                                  className="font-bold text-forest underline underline-offset-2"
                                >
                                  Undo
                                </button>
                              )}
                            </p>
                          ))}
                          {entry.proposal && (
                            <TabbyPlan
                              proposal={entry.proposal}
                              state={entry.actionState}
                              result={entry.result}
                              onApprove={() => act(entry, true)}
                              onCancel={() => act(entry, false)}
                              onUndo={() => undo(entry)}
                              onOpen={() => setOpen(false)}
                            />
                          )}
                          {entry.links && entry.links.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {entry.links.map((link) =>
                                link.filename ? (
                                  <button
                                    key={link.href}
                                    type="button"
                                    onClick={() =>
                                      downloadFile(link.href, link.filename!).catch(() =>
                                        patch(entry.id, (e) => ({
                                          text: `${e.text}\n\nThe download didn't start. Try again.`,
                                        }))
                                      )
                                    }
                                    className="press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-forest px-4 text-[14px] font-bold text-paper"
                                  >
                                    <Icon name="download" size={18} />
                                    {link.label}
                                  </button>
                                ) : (
                                  <Link
                                    key={link.href}
                                    href={newUiPath(link.href)}
                                    onClick={() => setOpen(false)}
                                    className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-paper px-4 text-[14px] font-bold text-forest ring-1 ring-forest/20"
                                  >
                                    {link.label}
                                    <Icon name="arrow_forward" size={18} />
                                  </Link>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <form
              className="bg-paper p-3 pb-[max(12px,env(safe-area-inset-bottom))]"
              onSubmit={(event) => {
                event.preventDefault();
                ask(input);
              }}
            >
              <div className="flex items-end gap-2 rounded-[26px] bg-card p-1.5 shadow-[0_0_0_1px_rgb(12_17_14/0.06),0_10px_24px_-14px_rgb(12_17_14/0.25)] focus-within:ring-4 focus-within:ring-gold/60">
                <label htmlFor="chat-question" className="sr-only">
                  Ask Tabby
                </label>
                <textarea
                  id="chat-question"
                  ref={field}
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={2000}
                  placeholder="Ask Tabby…"
                  className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-snug outline-none focus-visible:outline-none"
                />
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop answering"
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-paper"
                  >
                    <Square size={14} fill="currentColor" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={!input.trim()}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-forest text-gold disabled:opacity-30"
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
