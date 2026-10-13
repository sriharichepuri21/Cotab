"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  cancelChatProposal,
  ChatProposal,
  ChatTrace,
  confirmChatProposal,
  isAuthed,
  sendChat,
} from "@/lib/api";
import { invalidateSpending, invalidateSplits } from "@/lib/data";

type Entry = {
  role: "user" | "assistant";
  text: string;
  trace?: ChatTrace[];
  proposal?: ChatProposal | null;
  actionState?: string;
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

export function ChatDrawer() {
  const pathname = usePathname();
  const context = useMemo(() => pageContext(pathname), [pathname]);
  const [mounted, setMounted] = useState(false),
    [open, setOpen] = useState(false),
    [input, setInput] = useState("");
  const [session, setSession] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [entries, setEntries] = useState<Entry[]>([]);
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
  if (!mounted || !isAuthed()) return null;
  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setEntries((v) => [...v, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const reply = await sendChat(question, session, context);
      setSession(reply.session_id);
      setEntries((v) => [
        ...v,
        {
          role: "assistant",
          text: reply.message,
          trace: reply.explanation,
          proposal: reply.proposal,
        },
      ]);
    } catch (error) {
      setEntries((v) => [
        ...v,
        { role: "assistant", text: error instanceof Error ? error.message : "Chat failed" },
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function act(proposal: ChatProposal, confirm: boolean) {
    try {
      const result = confirm
        ? await confirmChatProposal(proposal.id)
        : await cancelChatProposal(proposal.id);
      // A confirmed action can change receipts, budgets or splits.
      if (confirm) {
        invalidateSpending();
        invalidateSplits();
      }
      setEntries((v) =>
        v.map((entry) =>
          entry.proposal?.id === proposal.id ? { ...entry, actionState: result.status } : entry
        )
      );
    } catch (error) {
      setEntries((v) => [
        ...v,
        { role: "assistant", text: error instanceof Error ? error.message : "Action failed" },
      ]);
    }
  }
  return (
    <>
      {/* Inside the app shell the Ask tab opens the drawer, so the floating
          button would only cover content. */}
      {!pathname.startsWith("/app") && (
        <button
          aria-label="Open Cotab chat"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-md bg-ink px-5 py-3 text-sm font-semibold text-paper shadow-lg"
        >
          Ask Cotab
        </button>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/20"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <aside
            aria-label="Cotab assistant"
            className="flex h-full w-full max-w-md flex-col bg-card shadow-2xl"
          >
            <header className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="font-semibold">Ask Cotab</h2>
                <p className="text-xs text-muted">Understands this page · {pathname}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-2xl text-muted"
              >
                ×
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto bg-paper p-4">
              {entries.length === 0 && (
                <p className="rounded-lg bg-card p-3 text-sm text-muted">
                  Ask about spending, this receipt, budgets, or splits.
                </p>
              )}
              {entries.map((entry, index) => (
                <div
                  key={index}
                  className={`rounded-xl p-3 text-sm ${entry.role === "user" ? "ml-10 bg-ink text-white" : "mr-6 border bg-card"}`}
                >
                  <p className="whitespace-pre-wrap">{entry.text}</p>
                  {entry.proposal && (
                    <div className="mt-3 rounded-lg border border-gold/70 bg-gold/25 p-3 text-ink">
                      <strong>{entry.proposal.summary}</strong>
                      {entry.actionState ? (
                        <p className="mt-2 text-xs uppercase">{entry.actionState}</p>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => act(entry.proposal!, true)}
                            className="rounded bg-ink px-3 py-1.5 text-white"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => act(entry.proposal!, false)}
                            className="rounded border px-3 py-1.5"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {entry.trace && entry.trace.length > 0 && (
                    <details className="mt-3 text-xs text-muted">
                      <summary className="cursor-pointer">How was this answered?</summary>
                      <ul className="mt-2 space-y-2">
                        {entry.trace.map((trace, j) => (
                          <li key={j}>
                            <strong>{trace.tool}</strong>: {trace.result_summary}
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-ink/5 p-2">
                              {JSON.stringify(
                                { arguments: trace.arguments, data: trace.data },
                                null,
                                2
                              )}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
            <form
              className="flex gap-2 border-t p-4"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <input
                aria-label="Ask Cotab"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                placeholder="Ask about this page…"
              />
              <button
                disabled={busy}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Thinking…" : "Send"}
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
