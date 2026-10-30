"use client";

import { useEffect, useState } from "react";

/**
 * One word that changes letter by letter: the new letters drop in one after another
 * while the old word falls away beneath them.
 */
export function MorphWord({ words, every = 2800 }: { words: string[]; every?: number }) {
  const [at, setAt] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () =>
        setAt((i) => {
          setPrev(i);
          return (i + 1) % words.length;
        }),
      every
    );
    return () => window.clearInterval(id);
  }, [words.length, every]);

  const letters = (w: string) =>
    Array.from(w).map((ch, i) => (
      <span key={i} style={{ ["--i" as string]: i }}>
        {ch === " " ? "\u00a0" : ch}
      </span>
    ));

  return (
    <span className="mword">
      <span className="sr-only">{words[at]}</span>
      <span className="mword-on" key={`on-${at}`} aria-hidden="true">
        {letters(words[at])}
      </span>
      {prev !== null && (
        <span className="mword-out" key={`out-${prev}-${at}`} aria-hidden="true">
          {letters(words[prev])}
        </span>
      )}
    </span>
  );
}
