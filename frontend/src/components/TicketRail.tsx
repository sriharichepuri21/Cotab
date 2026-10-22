/**
 * The House signature: one slip per person hung from a rail, like order
 * tickets in a kitchen. Each slip says where that person stands.
 */
export type Ticket = {
  key: string;
  name: string;
  label: string;
  amount: string;
  tone?: "paper" | "mint" | "blush";
};

const bg = { paper: "bg-card", mint: "bg-mint", blush: "bg-blush" } as const;
const tilt = ["-rotate-2", "rotate-[1.5deg]", "-rotate-1", "rotate-1", "-rotate-[1.5deg]"];

export function TicketRail({ tickets }: { tickets: Ticket[] }) {
  return (
    <div className="relative pt-2">
      <div aria-hidden="true" className="absolute inset-x-0 top-2 h-[5px] rounded-full bg-forest" />
      <ul className="relative flex gap-3 overflow-x-auto pb-2 pt-0.5">
        {tickets.map((t, i) => (
          <li
            key={t.key}
            className={`torn-b w-32 shrink-0 origin-top border border-b-0 px-3 pb-6 pt-4 sm:w-36 ${
              bg[t.tone ?? "paper"]
            } ${tilt[i % tilt.length]}`}
          >
            <span className="block truncate font-mono text-[11px] uppercase">{t.name}</span>
            <span className="mt-1.5 block text-xs">{t.label}</span>
            <span className={`block text-lg font-bold ${t.tone === "blush" ? "text-rose" : ""}`}>
              {t.amount}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
