/**
 * The snap, shown as it happens: the camera's corners close on a receipt, the shutter
 * flashes, and each line is picked out and tagged in turn. One CSS loop, no script.
 */
const LINES: Array<[string, string, string]> = [
  ["Oat milk 64oz", "Groceries", "4.29"],
  ["Bananas ×6", "Groceries", "1.74"],
  ["Sourdough loaf", "Bakery", "4.99"],
  ["Dark chocolate", "Treats", "2.49"],
  ["Coffee beans 12oz", "Coffee", "8.99"],
];

export function SnapViewfinder() {
  return (
    <div
      className="snap"
      role="img"
      aria-label="Cotab's camera framing a receipt and reading its five lines"
    >
      <div className="snap-table">
        <div className="snap-receipt">
          <p className="snap-store">
            Trader Joe&apos;s
            <small>#552 · Oct 28 · 6:42 PM</small>
          </p>
          {LINES.map(([item, tag, price], i) => (
            <p key={item} className="snap-line" style={{ ["--i" as string]: i }}>
              <span>{item}</span>
              <b>{price}</b>
              <em>{tag}</em>
            </p>
          ))}
          <p className="snap-total">
            <span>Total</span>
            <b>$22.50</b>
          </p>
        </div>
      </div>
      <i className="snap-corner tl" />
      <i className="snap-corner tr" />
      <i className="snap-corner bl" />
      <i className="snap-corner br" />
      <i className="snap-flash" />
      <p className="snap-done">5 lines read · matches the total</p>
      <span className="snap-shutter" />
    </div>
  );
}
