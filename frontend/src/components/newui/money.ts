/** Money typed into a field, worked in whole cents so totals reconcile
 *  exactly ($0.10 + $0.20 is $0.30, not 0.30000000000000004). */

/** "12.5", "$12.50", "-3" → cents; "" → 0; anything else (or a third
 *  decimal) → null, so the field can say it isn't an amount. */
export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!clean) return 0;
  if (!/^-?\d*\.?\d{0,2}$/.test(clean) || clean === "." || clean === "-") return null;
  return Math.round(Number(clean) * 100);
}

/** Cents back to a field's text: 1250 → "12.50". */
export const centsText = (cents: number) => (cents / 100).toFixed(2);

/** A line's unit price from its total, to the cent (the backend stores both). */
export const unitCents = (totalCents: number, quantity: number) =>
  quantity > 0 ? Math.round(totalCents / quantity) : totalCents;

export type Reconcile = { ok: boolean; message: string };

/** Do the items, charges and total agree? Subtotal is the items; total is
 *  subtotal plus tax, tip and fees (or less discounts). */
export function reconcile(
  itemsCents: number,
  subtotalCents: number,
  taxCents: number,
  totalCents: number,
  money: (cents: number) => string
): Reconcile {
  if (itemsCents !== subtotalCents)
    return {
      ok: false,
      message: `Items add up to ${money(itemsCents)}, but the subtotal says ${money(subtotalCents)}.`,
    };
  if (subtotalCents + taxCents !== totalCents)
    return {
      ok: false,
      message: `Subtotal plus tax and tip is ${money(subtotalCents + taxCents)}, but the total says ${money(totalCents)}.`,
    };
  return { ok: true, message: "Items, charges and total add up." };
}
