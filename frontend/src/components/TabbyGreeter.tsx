"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's art is served as is */
import { useEffect, useState } from "react";

/**
 * Tabby, large and centred at the top of sign-in and onboarding, waving. He
 * fades out at the legs so the form seems to grow out of the floor beneath him.
 *
 * The wave is a short transparent WebM loop. Safari can't play WebM with
 * transparency, and people who ask for less motion shouldn't get a loop, so
 * both get the still waving Tabby instead.
 */
export function TabbyGreeter({ compact = false }: { compact?: boolean }) {
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const webm = document.createElement("video").canPlayType('video/webm; codecs="vp9"') !== "";
    setMoving(webm && !safari && !calm);
  }, []);

  return (
    <div className={`tabby-greeter ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {moving ? (
        <video
          src="/tabby-wave.webm"
          poster="/cat-v3-stock/png/hi.png"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      ) : (
        <img src="/cat-v3-stock/png/hi.png" alt="" className="is-still" />
      )}
    </div>
  );
}
