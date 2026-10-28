/** The landing page's split demo: who pays what, to the cent. */

export type SplitLine = { name: string; cents: number; who: string[] };

/** Hands `cents` out in proportion to `weights`; the leftover cents go to the largest remainders. */
export function share(cents: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  const exact = weights.map((w) => (cents * w) / total);
  const out = exact.map(Math.floor);
  let left = cents - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

/**
 * Each person's share of the bill, tax included in proportion to what they had.
 * Lines nobody has claimed yet stay in `unclaimed`, so the parts always add up to the total.
 */
export function splitBill(lines: SplitLine[], people: string[], taxCents: number) {
  const sub = Object.fromEntries(people.map((p) => [p, 0]));
  let unclaimed = 0;
  for (const line of lines) {
    const who = people.filter((p) => line.who.includes(p));
    if (!who.length) {
      unclaimed += line.cents;
      continue;
    }
    share(
      line.cents,
      who.map(() => 1)
    ).forEach((c, i) => (sub[who[i]] += c));
  }
  const tax = share(taxCents, [...people.map((p) => sub[p]), unclaimed]);
  const owed = Object.fromEntries(people.map((p, i) => [p, sub[p] + tax[i]]));
  return { owed, unclaimed: unclaimed + tax[people.length] };
}
