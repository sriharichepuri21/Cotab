"use client";

import { useRef } from "react";

import { durations, eases, gsap, prefersReducedMotion, SplitText, useGSAP } from "@/lib/motion";

/**
 * Plain text whose words rise in from a blur. Only ever wraps a fixed string:
 * SplitText rewrites the DOM, so it can't hold anything React updates.
 */
export function RiseWords({ children }: { children: string }) {
  const scope = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // Words stay real text, so screen readers need no aria-label from SplitText.
      const split = SplitText.create(scope.current, { type: "words", aria: "none" });
      gsap.set(scope.current, { opacity: 1 });
      gsap.from(split.words, {
        y: "0.45em",
        opacity: 0,
        filter: "blur(10px)",
        duration: durations.slow,
        ease: eases.out,
        stagger: 0.08,
        onComplete: () => split.revert(),
      });
    },
    { scope }
  );
  return (
    <span ref={scope} className="rise-words">
      {children}
    </span>
  );
}
