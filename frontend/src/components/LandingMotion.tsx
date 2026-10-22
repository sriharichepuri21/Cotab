"use client";

import Script from "next/script";

type LandingWindow = Window & { cotabLanding?: () => void };

/** Runs the landing page's motion each time the page is shown. */
export function LandingMotion() {
  return (
    <Script
      src="/landing-motion.js"
      strategy="afterInteractive"
      onReady={() => (window as LandingWindow).cotabLanding?.()}
    />
  );
}
