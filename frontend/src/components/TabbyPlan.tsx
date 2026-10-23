"use client";

import Link from "next/link";

import { Icon } from "@/components/ui";
import type { ChatProposal, PlanResult, TabbyMood } from "@/lib/api";
import { catSrc } from "@/lib/tabby";

export type PlanState = "working" | "executed" | "cancelled" | "undoing" | "undone";

const FACE: Record<PlanState | "ready", TabbyMood> = {
  ready: "thinking",
  working: "working",
  executed: "done",
  cancelled: "hmm",
  undoing: "working",
  undone: "oops",
};

const TITLE: Record<PlanState | "ready", string> = {
  ready: "Tabby's plan",
  working: "Working on it…",
  executed: "Done",
  cancelled: "Cancelled",
  undoing: "Undoing…",
  undone: "Undone",
};

/**
 * What Tabby is about to do, as a checklist with one Approve; then Tabby at
 * work, each step ticked, and Undo for the whole thing.
 */
export function TabbyPlan({
  proposal,
  state,
  result,
  onApprove,
  onCancel,
  onUndo,
  onOpen,
}: {
  proposal: ChatProposal;
  state?: PlanState;
  result?: PlanResult;
  onApprove: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onOpen: () => void;
}) {
  const steps = proposal.steps?.length ? proposal.steps : [proposal.summary];
  const phase = state ?? "ready";
  const busy = phase === "working" || phase === "undoing";
  const done = phase === "executed";
  const open = result?.open ?? undefined;

  return (
    <section
      aria-label="Tabby's plan"
      className="mt-3 overflow-hidden rounded-[18px] bg-paper ring-1 ring-ink/[0.06]"
    >
      <header className="flex items-center gap-3 px-3.5 pt-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={catSrc(FACE[phase])}
          alt=""
          className={`h-14 w-14 shrink-0 object-contain ${busy ? "tabby-hop" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold tracking-[-0.01em]" aria-live="polite">
            {TITLE[phase]}
          </p>
          <p className="text-[13px] font-medium text-faint">
            {phase === "ready"
              ? steps.length > 1
                ? `${steps.length} steps, one tap`
                : "Nothing changes until you approve"
              : phase === "executed"
                ? result?.undoable
                  ? "You can undo it any time"
                  : "This one can't be undone"
                : phase === "undone"
                  ? "Everything is back how it was"
                  : phase === "cancelled"
                    ? "Nothing was changed"
                    : "One moment"}
          </p>
        </div>
      </header>

      <ol className="mt-2.5 flex flex-col gap-1.5 px-3.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[14px] leading-snug">
            <span
              aria-hidden
              className={`mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[12px] font-extrabold ${
                done
                  ? "bg-good text-white"
                  : phase === "undone" || phase === "cancelled"
                    ? "bg-ink/[0.07] text-faint"
                    : "bg-gold text-forest"
              }`}
            >
              {done ? <Icon name="check" size={15} /> : i + 1}
            </span>
            <span
              className={`min-w-0 flex-1 font-semibold ${
                phase === "undone" || phase === "cancelled" ? "text-faint line-through" : ""
              }`}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>

      <div
        className={`mt-3 flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-3 ${
          phase === "undone" || phase === "cancelled" ? "hidden" : ""
        }`}
      >
        {phase === "ready" && (
          <>
            <button
              type="button"
              onClick={onApprove}
              className="press min-h-10 rounded-full bg-forest px-5 font-bold text-paper"
            >
              {steps.length > 1 ? "Approve all" : "Approve"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="press min-h-10 rounded-full bg-card px-4 font-bold ring-1 ring-ink/[0.08]"
            >
              Cancel
            </button>
          </>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm font-semibold text-muted">
            <span className="chat-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            {phase === "working" ? "Tabby is on it" : "Putting things back"}
          </p>
        )}
        {done && (
          <>
            {open && (
              <Link
                href={open}
                onClick={onOpen}
                className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-forest px-4 font-bold text-paper"
              >
                Open it
                <Icon name="arrow_forward" size={18} />
              </Link>
            )}
            {result?.undoable && result.run_id && (
              <button
                type="button"
                onClick={onUndo}
                className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-card px-4 font-bold ring-1 ring-ink/[0.08]"
              >
                <Icon name="undo" size={18} />
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
