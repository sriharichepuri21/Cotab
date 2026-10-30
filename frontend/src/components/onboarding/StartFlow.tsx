"use client";

import { ArrowLeft, ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { GlassRings } from "@/components/landing/GlassRings";
import { routes } from "@/lib/routes";
import { GlassDefs } from "./Glass";
import { GaugeVisual, OrbitVisual, SafeVisual, SplitVisual } from "./Visuals";

const CARDS = [
  ["Snap or forward", "A photo, a PDF, or the email receipt from any shop."],
  ["Every line, read", "Item, price and category, checked against the total."],
  ["Split to the cent", "Tax shared by what each person had."],
];

const STEPS = [
  {
    wide: "Every receipt,",
    serif: "read.",
    text: "Snap the paper, upload a PDF or forward the email. Tabby reads every line.",
    visual: <OrbitVisual />,
  },
  {
    wide: "Budgets that",
    serif: "keep up.",
    text: "A plan for the month, a shop or one item, updated the moment a receipt is read.",
    visual: <GaugeVisual />,
  },
  {
    wide: "Split without",
    serif: "the awkward.",
    text: "Tap who had what. Friends pay you with Venmo, PayPal, Cash App or Zelle.",
    visual: <SplitVisual />,
  },
  {
    wide: "Nothing moves",
    serif: "without you.",
    text: "Tabby suggests, you approve. Export or delete everything, any time.",
    visual: <SafeVisual />,
  },
];
const LAST = STEPS.length + 1;

/** Tabby's film, cut out: HEVC keeps the transparency in Safari, VP9 everywhere else. */
function useWaveClip() {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ua = navigator.userAgent;
    // Every iPhone/iPad browser is Safari's engine underneath (VP9 alpha shows black there).
    const safari =
      /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua) ||
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setSrc(`/landing/cut/tabby-wave${safari ? ".mov" : ".webm"}`);
  }, []);
  return src;
}

/** The tour before sign-up: a welcome, four things Tabby does, and the way in. */
export function StartFlow() {
  const router = useRouter();
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState(1);
  const clip = useWaveClip();
  const touch = useRef<number | null>(null);

  const go = (to: number) => {
    if (to < 0 || to > LAST) return;
    setDir(to > at ? 1 : -1);
    setAt(to);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const step = at > 0 && at <= STEPS.length ? STEPS[at - 1] : null;

  return (
    <main
      className="ob"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 60) go(at + (dx < 0 ? 1 : -1));
      }}
    >
      <GlassDefs />
      <div className="ob-light" aria-hidden="true" />

      {at > 0 && (
        <header className="ob-top">
          <button
            type="button"
            className="ob-round"
            aria-label={at === 1 ? "Back to the start" : "Back"}
            onClick={() => go(at - 1)}
          >
            <ArrowLeft />
          </button>
          <ol className="ob-progress" aria-label={`Step ${at} of ${LAST}`}>
            {Array.from({ length: LAST }, (_, i) => (
              <li key={i} className={i < at ? "is-done" : ""} />
            ))}
          </ol>
          <button
            type="button"
            className="ob-round"
            aria-label="Close"
            onClick={() => router.push(routes.landing)}
          >
            <X />
          </button>
        </header>
      )}

      <div className="ob-screen" key={at} style={{ ["--dir" as string]: dir }}>
        {at === 0 && (
          <>
            <div className="ob-welcome">
              <div className="ob-mark">
                <GlassRings uid="ob-mark" />
              </div>
              <h1 className="ob-title">
                <span className="wide">The AI agent</span>
                <span className="serif">for your receipts.</span>
              </h1>
            </div>
            <ul className="ob-cards" aria-label="What Tabby does">
              {CARDS.map(([title, text], i) => (
                <li key={title} style={{ ["--i" as string]: i }}>
                  <span className="ob-card-mark" aria-hidden="true" />
                  <b>{title}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <div className="ob-actions">
              <button type="button" className="ob-cta" onClick={() => go(1)}>
                Get started
                <ArrowRight aria-hidden="true" />
              </button>
              <p className="ob-alt">
                Already have an account? <Link href={routes.login}>Sign in</Link>
              </p>
            </div>
          </>
        )}

        {step && (
          <>
            <div className="ob-visual">{step.visual}</div>
            <div className="ob-copy">
              <h1 className="ob-title">
                <span className="wide">{step.wide}</span>
                <span className="serif">{step.serif}</span>
              </h1>
              <p>{step.text}</p>
            </div>
            <div className="ob-actions">
              <button type="button" className="ob-cta" onClick={() => go(at + 1)}>
                Continue
                <ArrowRight aria-hidden="true" />
              </button>
              <button type="button" className="ob-skip" onClick={() => go(LAST)}>
                Skip the tour
              </button>
            </div>
          </>
        )}

        {at === LAST && (
          <>
            <div className="ob-visual">
              <div className="ob-tabby">
                <span className="ob-shadow" aria-hidden="true" />
                <video
                  src={clip}
                  poster="/landing/cut/tabby-wave.webp"
                  muted
                  loop
                  autoPlay
                  playsInline
                  width={720}
                  height={720}
                  aria-label="Tabby waving hello"
                />
              </div>
            </div>
            <div className="ob-copy">
              <h1 className="ob-title">
                <span className="wide">Almost</span>
                <span className="serif">there.</span>
              </h1>
              <p>
                Make an account and snap your first receipt. It takes a minute, and it&apos;s free.
              </p>
            </div>
            <div className="ob-actions">
              <Link className="ob-cta" href={routes.register}>
                Create your account
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link className="ob-ghost" href={routes.login}>
                I already have an account
              </Link>
              <p className="ob-fine">
                Sign up with Google, Apple or your email on the next screen.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
