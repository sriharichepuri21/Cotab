"use client";

import { useEffect, useState } from "react";

import { SLOW_EVENT } from "@/lib/api";

/**
 * A quiet banner for the one slow moment we can't avoid: the free server
 * waking up after a long idle spell. Without it a 30-second wait looks like
 * a frozen app; with it, people know to hang on.
 */
export function ServerWaking() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setSlow(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(SLOW_EVENT, on);
    return () => window.removeEventListener(SLOW_EVENT, on);
  }, []);
  if (!slow) return null;
  return (
    <div
      role="status"
      className="rise fixed inset-x-4 top-4 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-card bg-ink px-4 py-3 text-sm text-paper"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-gold"
      />
      <span>
        <strong className="font-semibold">Waking Cotab up.</strong> After a quiet spell this takes
        up to a minute. Your request will go through.
      </span>
    </div>
  );
}
