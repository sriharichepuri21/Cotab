"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's mood art is already small WebP */

import { useState } from "react";

import { tabbyArt } from "@/lib/tabby";
import { splitBill, type SplitLine } from "./split";

const PEOPLE = [
  { id: "alex", name: "You", initial: "Y" },
  { id: "maya", name: "Maya", initial: "M" },
  { id: "ben", name: "Ben", initial: "B" },
];
const START: SplitLine[] = [
  { name: "Carne asada tacos", cents: 1350, who: ["alex"] },
  { name: "Fish tacos", cents: 1200, who: ["maya"] },
  { name: "Chips & guacamole", cents: 900, who: ["alex", "maya", "ben"] },
  { name: "Fries", cents: 550, who: [] },
  { name: "Horchata ×2", cents: 800, who: ["maya", "ben"] },
  { name: "Bean burrito", cents: 1175, who: ["ben"] },
];
const SUBTOTAL = START.reduce((a, l) => a + l.cents, 0);
const TAX = Math.round(SUBTOTAL * 0.08875);

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Tap who had what; shares and tax update to the cent. */
export function SplitDemo() {
  const [lines, setLines] = useState(START);
  const { owed, unclaimed } = splitBill(
    lines,
    PEOPLE.map((p) => p.id),
    TAX
  );
  const open = lines.filter((l) => !l.who.length);
  const toggle = (i: number, id: string) =>
    setLines((ls) =>
      ls.map((l, k) =>
        k !== i
          ? l
          : { ...l, who: l.who.includes(id) ? l.who.filter((w) => w !== id) : [...l.who, id] }
      )
    );

  return (
    <div className="split-demo" data-ui>
      <div className="slip split-slip" data-ui>
        <p className="rc-head">
          LUNA TAQUERIA
          <span>FRI OCT 24 · TABLE 6</span>
        </p>
        <ul className="split-lines">
          {lines.map((l, i) => (
            <li key={l.name} className={l.who.length ? "" : "is-open"}>
              <span className="rc-row">
                <span>{l.name}</span>
                <span>{(l.cents / 100).toFixed(2)}</span>
              </span>
              <span className="who" role="group" aria-label={`Who had ${l.name}`}>
                {PEOPLE.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`who-chip who-${p.id}`}
                    aria-pressed={l.who.includes(p.id)}
                    aria-label={`${p.name} had ${l.name}`}
                    onClick={() => toggle(i, p.id)}
                  >
                    {p.initial}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="rc-row rc-sub">
          <span>Subtotal</span>
          <span>{(SUBTOTAL / 100).toFixed(2)}</span>
        </p>
        <p className="rc-row rc-sub">
          <span>Tax 8.875%</span>
          <span>{(TAX / 100).toFixed(2)}</span>
        </p>
        <p className="rc-row rc-total">
          <span>Total</span>
          <span>{usd(SUBTOTAL + TAX)}</span>
        </p>
      </div>

      <div className="split-result" aria-live="polite">
        <img
          src={tabbyArt(open.length ? "hmm" : "celebrate", 640)}
          alt={open.length ? "Tabby, puzzled" : "Tabby, celebrating"}
          width={320}
          height={320}
          className="split-cat"
        />
        <p className="split-status">
          {open.length
            ? `${open.map((l) => l.name).join(", ")}: nobody yet. Tap a name.`
            : "Every cent has a name."}
        </p>
        <dl className="split-owed">
          <div>
            <dt>Maya owes you</dt>
            <dd>{usd(owed.maya)}</dd>
          </div>
          <div>
            <dt>Ben owes you</dt>
            <dd>{usd(owed.ben)}</dd>
          </div>
          <div>
            <dt>Your share</dt>
            <dd>{usd(owed.alex)}</dd>
          </div>
          {unclaimed > 0 && (
            <div className="is-open">
              <dt>Still unclaimed</dt>
              <dd>{usd(unclaimed)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
