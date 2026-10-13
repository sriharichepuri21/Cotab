"use client";

import { useEffect, useRef } from "react";

const SEEN_KEY = "cotab_intro_seen";

/**
 * Runs before first paint, so a returning visitor or someone who prefers
 * reduced motion never sees the intro screen flash. It sets
 * <html data-intro="play" | "skip">, which the CSS in globals.css reads.
 */
const decide = `(function(){try{var d=document.documentElement;var s=sessionStorage.getItem("${SEEN_KEY}");var r=window.matchMedia("(prefers-reduced-motion: reduce)").matches;d.dataset.intro=s||r?"skip":"play";}catch(e){document.documentElement.dataset.intro="skip";}})();`;

const HOLD_MS = 1900; // logo finishes drawing
const FLY_MS = 700; // logo travels into the header

/**
 * The landing page's opening: the Cotab mark prints out large in the middle
 * of the screen, then shrinks into its place in the header while the page
 * fades in underneath. Plays once per browser session; any tap or key skips.
 */
export function LogoIntro() {
  const overlay = useRef<HTMLDivElement>(null);
  const brand = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.intro !== "play") return;

    let finished = false;
    let flying = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = () => {
      if (finished) return;
      finished = true;
      root.dataset.intro = "done";
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private mode: it just plays again next time */
      }
    };

    const fly = () => {
      if (flying) return;
      flying = true;
      timers.forEach(clearTimeout);
      const target = document.getElementById("nav-logo")?.getBoundingClientRect();
      const from = brand.current?.getBoundingClientRect();
      root.dataset.intro = "fly";
      if (target && from && brand.current) {
        const scale = target.width / from.width;
        const dx = target.left - from.left;
        const dy = target.top - from.top;
        brand.current.animate(
          [
            { transform: "translate(0, 0) scale(1)" },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          ],
          { duration: FLY_MS, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" }
        );
      }
      overlay.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FLY_MS - 150,
        delay: 150,
        easing: "ease-out",
        fill: "forwards",
      });
      timers.push(setTimeout(finish, FLY_MS + 20));
    };

    // The drawing is pure CSS and starts at first paint, so time the hold
    // from page load, not from when this script happens to run.
    timers.push(setTimeout(fly, Math.max(0, HOLD_MS - performance.now())));
    const skip = () => fly();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: decide }} />
      <div
        ref={overlay}
        className="intro fixed inset-0 z-50 grid place-items-center bg-paper"
        aria-hidden="true"
      >
        {/* Same proportions as <Logo />, drawn k times larger, so the flight
            into the header is a pure scale and lines up exactly. */}
        <div ref={brand} className="intro-brand flex origin-top-left items-center text-ink">
          <span className="intro-tile grid place-items-center bg-gold">
            <svg viewBox="0 0 64 64" className="intro-mark">
              <path
                className="intro-slip"
                d="M10 16a10 10 0 0 1 10-10h24a10 10 0 0 1 10 10v36l-4 4.6-3.6-4-4.1 5-3.9-4.4-4.4 4.8-3.7-4.6-4.2 5-4-4.5-3.7 4.1L10 54z"
                fill="currentColor"
              />
              <circle className="intro-hole" cx="32" cy="12.5" r="2.3" fill="rgb(var(--c-gold))" />
              <path
                className="intro-draw intro-c"
                d="M33.5 27.5A8.5 8.5 0 1 0 33.5 38.5"
                pathLength={1}
                fill="none"
                stroke="rgb(var(--c-gold))"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <circle
                className="intro-draw intro-o"
                cx="38"
                cy="33"
                r="5.6"
                pathLength={1}
                fill="none"
                stroke="rgb(var(--c-gold))"
                strokeWidth="5"
              />
              <path
                className="intro-draw intro-stripe"
                d="M51.6 22v24"
                pathLength={1}
                stroke="rgb(var(--c-rose))"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="intro-word flex overflow-hidden font-bold tracking-tight">
            {"cotab".split("").map((ch, i) => (
              <span
                key={i}
                className="intro-letter"
                style={{ animationDelay: `${1.05 + i * 0.07}s` }}
              >
                {ch}
              </span>
            ))}
          </span>
        </div>
      </div>
    </>
  );
}
