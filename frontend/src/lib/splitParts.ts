/** Splitting by exact amounts, percentages or shares: what each person typed,
 *  whether it adds up, and the live "left to assign" line. The server checks
 *  everything again; this only keeps Save honest while you type. */

import { money } from "./format";

export type PartsMode = "exact" | "percent" | "shares";

export const isPartsMode = (mode: string): mode is PartsMode =>
  mode === "exact" || mode === "percent" || mode === "shares";

export interface PartsCheck {
  /** Numbers to send; people who left it empty are 0. */
  parts: Record<string, number>;
  /** Adds up, so it can be saved. */
  ok: boolean;
  /** "$7.57 left to assign", "15% left", "4 shares"... */
  note: string;
}

/** What shows in a person's box: shares start at 1 each, the rest empty. */
export const shown = (mode: PartsMode, typed: Record<string, string>, name: string) =>
  typed[name] ?? (mode === "shares" ? "1" : "");

/** A typed number in whole units (cents, hundredths of a percent, shares);
 *  null when it isn't one. Empty is 0. */
function units(text: string, mode: PartsMode): number | null {
  const clean = text.trim().replace(/^\$/, "").replace(/%$/, "");
  if (!clean) return 0;
  const places = mode === "shares" ? 0 : 2;
  if (!new RegExp(`^\\d*\\.?\\d{0,${places}}$`).test(clean) || clean === ".") return null;
  return Math.round(Number(clean) * 10 ** places);
}

const percent = (hundredths: number) => `${Number((hundredths / 100).toFixed(2))}%`;

export function checkParts(
  mode: PartsMode,
  totalCents: number,
  names: string[],
  typed: Record<string, string>,
  currency = "USD"
): PartsCheck {
  const parts: Record<string, number> = {};
  let added = 0;
  let bad = false;
  for (const name of names) {
    const amount = units(shown(mode, typed, name), mode);
    if (amount === null) bad = true;
    else {
      added += amount;
      parts[name] = mode === "shares" ? amount : amount / 100;
    }
  }
  if (bad) {
    const what =
      mode === "shares" ? "whole numbers" : mode === "exact" ? "dollars and cents" : "numbers";
    return { parts, ok: false, note: `Use ${what} only.` };
  }
  if (mode === "shares") {
    return {
      parts,
      ok: added > 0,
      note: added > 0 ? `${added} share${added === 1 ? "" : "s"}` : "Give someone a share.",
    };
  }
  const left = (mode === "exact" ? totalCents : 10000) - added;
  const say = (n: number) => (mode === "exact" ? money(n / 100, currency) : percent(n));
  if (left === 0) return { parts, ok: true, note: "All assigned" };
  return {
    parts,
    ok: false,
    note:
      left > 0
        ? `${say(left)} ${mode === "exact" ? "left to assign" : "left"}`
        : `${say(-left)} over`,
  };
}

/** Typed boxes from a saved split's parts (Edit split). */
export function typedFrom(parts: Record<string, number> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(parts ?? {}).map(([name, n]) => [name, String(n)]));
}
