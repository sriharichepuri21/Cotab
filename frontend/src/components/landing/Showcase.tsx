"use client";
/* eslint-disable @next/next/no-img-element -- real app screens, already small WebP */

import { useState } from "react";

const SCREENS = [
  {
    id: "today",
    tab: "Today",
    title: "One number a day.",
    text: "Safe to spend, what is left of the plan and what needs a decision, the moment you open it.",
    alt: "Cotab Today screen: $495.87 safe to spend, $1,904.13 spent of a $2,400 October plan",
  },
  {
    id: "tabs",
    tab: "Tabs",
    title: "Who owes what.",
    text: "Every shared receipt adds to a tab. Remind with one tap, settle with Venmo, PayPal or Cash App.",
    alt: "Cotab Tabs screen: $1,123.33 coming back from five people, Ben owes $593.95",
  },
  {
    id: "tabby",
    tab: "Ask Tabby",
    title: "Answers now, changes after you say yes.",
    text: "Ask in plain words. When Tabby wants to change something, it shows you first and waits.",
    alt: "Ask Tabby screen with suggested questions such as How much have I spent this month",
  },
];

/** The real app, one screen at a time. */
export function Showcase() {
  const [at, setAt] = useState(0);
  const s = SCREENS[at];
  return (
    <div className="show">
      <div className="show-plate" data-scroll>
        {SCREENS.map((x, i) => (
          <img
            key={x.id}
            src={`/landing/app-${x.id}.webp`}
            alt={x.alt}
            width={585}
            height={1266}
            loading="lazy"
            className={i === at ? "is-on" : ""}
            aria-hidden={i !== at}
          />
        ))}
      </div>
      <div className="show-copy">
        <div className="show-tabs" role="tablist" aria-label="App screens">
          {SCREENS.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`show-${x.id}`}
              aria-selected={i === at}
              aria-controls="show-panel"
              tabIndex={i === at ? 0 : -1}
              onClick={() => setAt(i)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                const n = (at + d + SCREENS.length) % SCREENS.length;
                setAt(n);
                document.getElementById(`show-${SCREENS[n].id}`)?.focus();
              }}
            >
              {x.tab}
            </button>
          ))}
        </div>
        <div id="show-panel" role="tabpanel" aria-labelledby={`show-${s.id}`}>
          <h2 id="app-title" className="show-title">
            {s.title}
          </h2>
          <p className="show-text">{s.text}</p>
        </div>
      </div>
    </div>
  );
}
