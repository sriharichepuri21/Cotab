"use client";

import { useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Flip } from "gsap/Flip";
import { SplitText } from "gsap/SplitText";

/** The single source of motion: plugins, tokens, reduced motion and haptics. */

if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, Flip, SplitText, CustomEase);
// Lists can be legitimately empty, e.g. a run with no ticks to rewind.
gsap.config({ nullTargetWarn: false });

export { gsap, useGSAP, SplitText };

export const durations = { fast: 0.18, base: 0.32, slow: 0.6, celebrate: 1.2 };
export const eases = { out: "power3.out", spring: "back.out(1.6)", inOut: "power2.inOut" };
export const stagger = { lines: 0.06 };

const REDUCE = "(prefers-reduced-motion: reduce)";

export type MotionMode = "full" | "reduced";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCE).matches);
}

/** Full or reduced, kept up to date if the setting changes while the app is open. */
export function useMotion(): MotionMode {
  const [mode, setMode] = useState<MotionMode>(() => (prefersReducedMotion() ? "reduced" : "full"));
  useGSAP(() => {
    if (!window.matchMedia) return;
    const media = gsap.matchMedia();
    media.add({ reduced: REDUCE, full: `not all and ${REDUCE}` }, (context) =>
      setMode(context.conditions?.reduced ? "reduced" : "full")
    );
    return () => media.revert();
  });
  return mode;
}

const HAPTICS = { tap: 6, success: [12, 40, 18], warn: [30, 40, 30] };

export function haptic(kind: keyof typeof HAPTICS) {
  if (typeof navigator !== "undefined") navigator.vibrate?.(HAPTICS[kind]);
}

/** A list of `each`-spaced steps that a long list can't stretch past a second. */
export const listStagger = (count: number) => Math.min(stagger.lines, 1 / Math.max(1, count));

/**
 * Plays a timeline backwards and resolves when it has finished. The timer means
 * work waiting on this still runs if the timeline is killed by an unmount.
 */
export function rewind(timeline?: gsap.core.Timeline | null): Promise<void> {
  if (!timeline) return Promise.resolve();
  return new Promise((resolve) => {
    timeline.eventCallback("onReverseComplete", () => resolve());
    timeline.reverse();
    window.setTimeout(resolve, timeline.duration() * 1000 + 100);
  });
}

/** A short "no": for steps that failed, never a tick. */
export function shake(targets: gsap.TweenTarget) {
  return gsap.to(targets, {
    keyframes: { x: [0, -5, 5, -3, 3, 0] },
    duration: durations.base,
    clearProps: "transform",
  });
}

/** The white flash and the shutter's squash. The flash lives on <body> because
 *  the camera can unmount before 120ms when the photo encodes quickly. */
export function shutter(button: HTMLElement | null) {
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    button,
    { scale: 0.9 },
    { scale: 1, duration: durations.fast, ease: eases.spring, clearProps: "transform" }
  );
  const flash = document.createElement("div");
  flash.setAttribute("aria-hidden", "true");
  flash.style.cssText =
    "position:fixed;inset:0;z-index:80;margin:0 auto;max-width:467px;background:#fff;pointer-events:none";
  document.body.append(flash);
  gsap.to(flash, { opacity: 0, duration: 0.12, ease: "none", onComplete: () => flash.remove() });
}

const CONFETTI = ["#cde77f", "#f2b84b", "#fff4d9"];

/** 24 lime, amber and cream bits thrown from `host`; gone after 1.2s. */
export function confetti(host: HTMLElement) {
  const fall = durations.celebrate * 0.65;
  for (let i = 0; i < 24; i++) {
    const bit = document.createElement("i");
    bit.style.cssText = `position:absolute;width:6px;height:10px;border-radius:2px;background:${CONFETTI[i % 3]}`;
    host.append(bit);
    const up = gsap.utils.random(-150, -40);
    gsap
      .timeline()
      .to(
        bit,
        {
          x: gsap.utils.random(-150, 150),
          rotation: gsap.utils.random(-420, 420),
          duration: durations.celebrate,
          ease: "power2.out",
        },
        0
      )
      .to(bit, { y: up, duration: durations.celebrate - fall, ease: "power2.out" }, 0)
      .to(bit, { y: up + 130, duration: fall, ease: "power2.in" }, durations.celebrate - fall)
      .to(bit, { opacity: 0, duration: 0.3 }, durations.celebrate - 0.3);
  }
  gsap.delayedCall(durations.celebrate, () => host.replaceChildren());
}

let held: { id?: string; state: Flip.FlipState } | null = null;

/** Remember where a receipt row's icon and total are, as it opens. */
export function holdFlip(id: string | undefined, row: HTMLElement) {
  const shared = row.querySelectorAll("[data-flip-id]");
  if (shared.length !== 2) {
    held = null;
    return;
  }
  const state = Flip.getState(shared);
  // Flip measures from the top of the document, but the receipt opens scrolled
  // to the top: without this a scrolled list's flight starts off screen.
  state.elementStates.forEach((element) => (element.matrix.f -= window.scrollY));
  held = { id, state };
}

/** Fly the held icon and total into `page`, or fade it in if they can't both be found. */
export function flipOrFade(id: string | undefined, page: HTMLElement) {
  // Strict Mode's second run finds nothing, so in dev this is only ever a fade.
  const from = held;
  held = null;
  if (prefersReducedMotion()) return;
  const shared = page.querySelectorAll("[data-flip-id]");
  if (!from || from.id !== id || shared.length !== 2) {
    gsap.from(page, { opacity: 0, duration: durations.fast, clearProps: "opacity" });
    return;
  }
  // NewApp does this after mount, which would move the flight mid-way.
  window.scrollTo({ top: 0, behavior: "instant" });
  // See glass.css: the ticket's mask is off for the flight and its rise-in never runs.
  page.dataset.flipping = "";
  page.dataset.flew = "";
  Flip.from(from.state, {
    targets: shared,
    scale: true,
    zIndex: 10,
    duration: 0.45,
    ease: eases.out,
    onComplete: () => delete page.dataset.flipping,
  });
}
