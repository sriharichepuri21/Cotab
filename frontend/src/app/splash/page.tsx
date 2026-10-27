"use client";

import { useEffect, useState } from "react";

import { AppSplash } from "@/components/AppSplash";
import { CotabLogo } from "@/components/CotabLogo";

/**
 * Plays the launch splash on its own, with no sign-in and no skip rules, so it
 * can be checked on any device or deployment. The app's own splash plays when
 * the signed-in app opens.
 */
export default function SplashPreview() {
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setPlaying(false), 1800);
    return () => window.clearTimeout(timer);
  }, [playing, run]);

  return (
    <main className="auth-night grid min-h-screen place-items-center px-6 text-center">
      {playing && <AppSplash key={run} />}
      <div className="grid justify-items-center gap-5">
        <CotabLogo height={40} className="text-[#f4f6ea]" />
        <p className="max-w-xs text-[15px] opacity-80">
          That was the launch splash. If you saw the rings close and the word cotab appear, it works
          on this device.
        </p>
        <button
          type="button"
          onClick={() => {
            setRun((n) => n + 1);
            setPlaying(true);
          }}
          className="min-h-12 rounded-full bg-forest px-6 font-bold text-white"
        >
          Play it again
        </button>
      </div>
    </main>
  );
}
