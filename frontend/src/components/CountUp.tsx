"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A figure that rolls to its value, like a total settling on an iPhone.
 * Counts from wherever it last was, so an update rolls from the old figure.
 */
export function CountUp({
  value,
  render,
  ms = 900,
}: {
  value: number;
  render: (shown: number) => ReactNode;
  ms?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(start + (value - start) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, ms]);

  return <>{render(Math.round(shown * 100) / 100)}</>;
}
