"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Icon } from "@/components/ui";
import type { ChatProposal, PlanResult, TabbyMood } from "@/lib/api";
import {
  durations,
  eases,
  gsap,
  haptic,
  prefersReducedMotion,
  rewind,
  shake,
  stagger,
  useGSAP,
} from "@/lib/motion";
import { catSrc } from "@/lib/tabby";
import { newUiPath } from "@/lib/routes";

export type PlanState = "working" | "executed" | "cancelled" | "undoing" | "undone" | "replaced";

const FACE: Record<PlanState | "ready", TabbyMood> = {
  ready: "thinking",
  working: "working",
  executed: "done",
  cancelled: "hmm",
  undoing: "working",
  undone: "oops",
  replaced: "thinking",
};

const TITLE: Record<PlanState | "ready", string> = {
  ready: "Tabby's plan",
  working: "Working on it…",
  executed: "Done",
  cancelled: "Cancelled",
  undoing: "Undoing…",
  undone: "Undone",
  replaced: "Replaced",
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
  /** `rewound` settles when the ticks have played back; refresh after that. */
  onUndo: (rewound: Promise<void>) => void;
  onOpen: () => void;
}) {
  const steps = proposal.steps?.length ? proposal.steps : [proposal.summary];
  const phase = state ?? "ready";
  const busy = phase === "working" || phase === "undoing";
  const done = phase === "executed";
  const open = result?.open ?? undefined;
  const scope = useRef<HTMLElement>(null);
  const ticks = useRef<gsap.core.Timeline | null>(null);
  const was = useRef(phase);
  const [undoFailed, setUndoFailed] = useState(false);

  useGSAP(
    () => {
      if (phase !== "ready" || prefersReducedMotion()) return;
      gsap.from(scope.current, {
        y: 24,
        opacity: 0,
        duration: durations.base,
        ease: eases.spring,
        clearProps: "transform,opacity",
      });
      gsap.from("li", {
        y: 8,
        opacity: 0,
        duration: durations.base,
        ease: eases.out,
        stagger: stagger.lines,
        delay: durations.fast,
        clearProps: "transform,opacity",
      });
    },
    { scope }
  );

  useGSAP(
    () => {
      const before = was.current;
      was.current = phase;
      if (phase !== "executed") return;
      const undoBounced = before === "undoing";
      setUndoFailed(undoBounced);
      if (before === "working") haptic("success");
      if (prefersReducedMotion()) return;
      if (undoBounced) {
        // Some steps may be undone and some not: restore without ticking again.
        ticks.current?.pause().progress(1);
        shake("li");
        return;
      }
      // One timeline for the ticks and their rewind. Built here, once the steps
      // really are done; Undo plays this same one backwards.
      ticks.current = gsap
        .timeline({ paused: true })
        .from("[data-tick]", {
          scale: 0,
          duration: durations.base,
          ease: eases.spring,
          stagger: stagger.lines,
        })
        .to("[data-portrait]", { y: -8, duration: durations.fast, ease: eases.out }, 0)
        .to("[data-portrait]", { y: 0, duration: durations.fast, ease: eases.spring });
      // Seen already (the chat reopened): keep the ticks ready, don't replay them.
      if (before === "working") ticks.current.play();
      else ticks.current.progress(1);
      return () => {
        ticks.current = null;
      };
    },
    { scope, dependencies: [phase] }
  );

  // The ticks stay while Undo rewinds them, over the numbers they cover.
  const ticked = done || phase === "undoing";

  return (
    <section
      ref={scope}
      aria-label="Tabby's plan"
      className="mt-3 overflow-hidden rounded-[18px] bg-paper ring-1 ring-ink/[0.06]"
    >
      <header className="flex items-center gap-3 px-3.5 pt-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-portrait
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
                    : phase === "replaced"
                      ? "The newer plan below replaces this one"
                      : "One moment"}
          </p>
        </div>
      </header>

      <ol className="mt-2.5 flex flex-col gap-1.5 px-3.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[14px] leading-snug">
            <span
              aria-hidden
              className={`relative mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[12px] font-extrabold ${
                ["undone", "cancelled", "replaced"].includes(phase)
                  ? "bg-ink/[0.07] text-faint"
                  : "bg-gold text-forest"
              }`}
            >
              {i + 1}
              {ticked && (
                <span
                  data-tick
                  className={`absolute inset-0 grid place-items-center rounded-full text-white ${
                    undoFailed ? "bg-rose" : "bg-good"
                  }`}
                >
                  <Icon name={undoFailed ? "error" : "check"} size={15} />
                </span>
              )}
            </span>
            <span
              className={`min-w-0 flex-1 font-semibold ${
                ["undone", "cancelled", "replaced"].includes(phase) ? "text-faint line-through" : ""
              }`}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>

      <div
        className={`mt-3 flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-3 ${
          ["undone", "cancelled", "replaced"].includes(phase) ? "hidden" : ""
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
                href={newUiPath(open)}
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
                onClick={() => onUndo(rewind(ticks.current))}
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
