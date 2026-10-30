/**
 * October by category, as glass tubes in the logo's gradient, each drawn as a share of
 * its own budget so they all meet one budget line. A tube that rises past it turns rose.
 */
const DATA: Array<[string, number, number]> = [
  ["Groceries", 412.2, 500],
  ["Dining", 212.4, 250],
  ["Coffee", 64.75, 60],
  ["Transport", 96.12, 150],
  ["Oat milk", 38.61, 24],
];
const TITLE = `October spending by category against budget: ${DATA.map(
  ([n, s, b]) => `${n} $${s.toFixed(2)} of $${b}`
).join(", ")}`;
const TOP = 1.5; // the chart's ceiling, as a share of budget
const H = 300;
const W = 92;
const GAP = 34;
const LINE = H - H / TOP;

export function SpendChart() {
  const width = DATA.length * W + (DATA.length - 1) * GAP;
  return (
    <figure className="chart" data-reveal>
      <svg viewBox={`-96 -44 ${width + 106} ${H + 108}`} role="img" aria-labelledby="chart-title">
        <title id="chart-title">{TITLE}</title>
        <defs>
          <linearGradient id="bar-ok" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4f7f5a" />
            <stop offset=".35" stopColor="#e6f5e0" />
            <stop offset=".6" stopColor="#a8cba6" />
            <stop offset="1" stopColor="#2f6a45" />
          </linearGradient>
          <linearGradient id="bar-over" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#9a4b3e" />
            <stop offset=".35" stopColor="#fbe1d8" />
            <stop offset=".6" stopColor="#f0a493" />
            <stop offset="1" stopColor="#8a3f33" />
          </linearGradient>
        </defs>
        {DATA.map(([name, spent, budget], i) => {
          const x = i * (W + GAP);
          const share = Math.min(spent / budget, TOP);
          const h = (share / TOP) * H;
          const over = spent > budget;
          return (
            <g key={name} className="bar" style={{ ["--i" as string]: i }}>
              <rect className="bar-well" x={x} y={0} width={W} height={H} rx={W / 2} />
              <rect
                className="bar-fill"
                x={x}
                y={H - h}
                width={W}
                height={h}
                rx={W / 2}
                fill={`url(#bar-${over ? "over" : "ok"})`}
              />
              <text className="bar-value" x={x + W / 2} y={Math.min(H - h - 16, LINE - 14)}>
                {Math.round((spent / budget) * 100)}%
              </text>
              <text className="bar-name" x={x + W / 2} y={H + 34}>
                {name}
              </text>
              <text className={`bar-of${over ? " is-over" : ""}`} x={x + W / 2} y={H + 58}>
                ${spent.toFixed(0)} of ${budget}
              </text>
            </g>
          );
        })}
        <line className="bar-budget" x1={-18} x2={width + 10} y1={LINE} y2={LINE} />
        <text className="bar-line" x={-96} y={LINE + 5}>
          Budget
        </text>
      </svg>
    </figure>
  );
}
