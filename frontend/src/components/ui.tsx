import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Shared building blocks so every screen reads as one Cotab system. */

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${base} bg-ink text-paper hover:bg-ink/90`,
  ghost: `${base} border border-ink bg-transparent text-ink hover:bg-ink/5`,
  quiet: `${base} text-ink underline underline-offset-4 hover:text-ink/70`,
  danger: `${base} border border-rose text-rose hover:bg-blush/40`,
};

export function Button({
  variant = "primary",
  arrow = false,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonClass;
  arrow?: boolean;
}) {
  return (
    <button type="button" className={`${buttonClass[variant]} ${className}`} {...rest}>
      {arrow && <span aria-hidden="true">→</span>}
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  sub,
  back,
  action,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-2">
      {back && (
        <Link href={back.href} className="-ml-1 w-fit py-2 text-sm font-semibold text-ink">
          ‹ {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
          {sub && <p className="mt-2 text-base text-muted">{sub}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A receipt slip: white paper, ink outline, torn bottom edge. */
export function Slip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`torn-b border border-b-0 border-ink bg-card px-4 pb-6 pt-4 font-mono text-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** One printed line on a slip: name, dotted leader, amount. */
export function SlipLine({
  name,
  amount,
  tone = "ink",
  strong = false,
}: {
  name: ReactNode;
  amount: ReactNode;
  tone?: "ink" | "muted" | "rose";
  strong?: boolean;
}) {
  const color = tone === "rose" ? "text-rose" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className={`flex items-end py-0.5 ${color} ${strong ? "text-[15px] font-medium" : ""}`}>
      <span className="truncate">{name}</span>
      <span className="leader" aria-hidden="true" />
      <span className="shrink-0">{amount}</span>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-card p-5 ${className}`}>{children}</div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-6 rounded-card border border-rose/40 bg-blush/50 px-4 py-3 text-sm text-ink"
    >
      {children}
    </p>
  );
}

/** Progress bar coloured by state: green under 80%, gold to 100%, rose beyond. */
export function Meter({ percent }: { percent: number }) {
  const fill = percent > 100 ? "bg-rose" : percent >= 80 ? "bg-gold" : "bg-ink";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-ink/10">
      <div
        className={`h-full ${fill}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** Text inputs and selects: ink outline on white paper, same height as buttons. */
export const fieldClass =
  "min-h-12 w-full rounded-button border border-ink/40 bg-card px-3 text-base text-ink outline-none placeholder:text-muted focus:border-ink focus:ring-2 focus:ring-gold";

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

/** Grey stand-in for content that is on its way, shaped like what will arrive. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`block animate-pulse rounded bg-ink/[0.08] ${className}`} />
  );
}

/** A page-shaped placeholder: heading, a big card and a few rows. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-32 w-full rounded-card" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2">
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </span>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}
