"use client";

import { useEffect, useState } from "react";

import { CotabMark, CotabWord } from "@/components/CotabLogo";

/**
 * The first frame of the website and of the signed-in app: the mark with its
 * c opening and closing, then the name. It uses the app's launch colour (see
 * manifest.webmanifest), so it joins the phone's own splash.
 */
export function AppSplash({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Opening Cotab"
      className={`app-splash fixed inset-0 z-[80] grid place-items-center ${className}`}
    >
      <div className="grid justify-items-center gap-5">
        <CotabMark size={92} animated />
        <CotabWord height={30} className="splash-word" />
      </div>
    </div>
  );
}

/** True once the launch splash has played in this page load. */
let splashShown = false;

/**
 * True while the launch splash should hold: long enough for the c to close
 * once (about 1.7s) on the first page drawn in a fresh load, website or app.
 * Moving between pages does not repeat it, and it is skipped only for
 * automated browsers.
 */
export function useLaunchSplash() {
  const [held, setHeld] = useState(!splashShown);
  useEffect(() => {
    if (splashShown) return;
    const done = () => {
      splashShown = true;
      setHeld(false);
    };
    if (!window.matchMedia || navigator.webdriver === true) return done();
    // With reduced motion the mark stays still, so the splash is shorter.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(done, calm ? 900 : 1700);
    return () => window.clearTimeout(timer);
  }, []);
  return held;
}

/** The splash over a page that is already drawn underneath (the website). */
export function LaunchSplash() {
  // Ends itself in CSS too, so it never stays over the page without script.
  return useLaunchSplash() ? <AppSplash className="splash-self-ending" /> : null;
}
