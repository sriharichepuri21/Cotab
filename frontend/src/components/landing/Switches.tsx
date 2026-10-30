"use client";

import { useState } from "react";

const BANDS = [
  {
    say: "Warn before a budget runs out",
    then: "Dining is at 85%: $212.40 of $250, with four days to go.",
    on: true,
  },
  {
    say: "Notice when a price quietly creeps up",
    then: "Oat milk went from $4.29 to $4.79 at Trader Joe’s.",
    on: false,
  },
  {
    say: "Gently remind friends who still owe you",
    then: "Priya gets a friendly reminder on Friday for $101.80.",
    on: true,
  },
  {
    say: "Optional Sunday summary of the week",
    then: "Last week: $212.40 across nine receipts, $31 under plan.",
    on: false,
  },
];

/** Plain sentences, each with the switch Tabby would flip. */
export function Switches() {
  const [on, setOn] = useState(BANDS.map((b) => b.on));
  return (
    <ul className="bands">
      {BANDS.map((b, i) => (
        <li key={b.say} className={`band band-${i}${on[i] ? " is-on" : ""}`}>
          <div className="band-text">
            <p className="band-say" id={`band-${i}`}>
              {b.say}
            </p>
            <p className="band-then" hidden={!on[i]}>
              {b.then}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on[i]}
            aria-labelledby={`band-${i}`}
            className="switch"
            data-ui
            onClick={() => setOn((s) => s.map((v, k) => (k === i ? !v : v)))}
          >
            <span className="knob" />
          </button>
        </li>
      ))}
    </ul>
  );
}
