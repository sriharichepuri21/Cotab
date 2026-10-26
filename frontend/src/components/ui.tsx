import type { ButtonHTMLAttributes, ReactNode } from "react";

import { LargeTitle } from "@/components/LargeTitle";

/** Shared building blocks so every screen reads as one Cotab system. */

const base =
  "press inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-6 text-[17px] font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${base} bg-forest text-white hover:bg-forest/90`,
  ghost: `${base} bg-ink/[0.06] text-ink hover:bg-ink/[0.09]`,
  quiet: `${base} px-2 text-forest underline underline-offset-4 hover:text-forest/70`,
  danger: `${base} bg-blush text-rose hover:bg-blush/70`,
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
      {children}
      {arrow && (
        <span className="ms text-[20px]" aria-hidden="true">
          arrow_forward
        </span>
      )}
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
    <header className="mb-6 flex flex-col gap-1">
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <LargeTitle title={title} back={back} />
          {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A receipt slip: a white card with a torn bottom edge. */
export function Slip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`torn-b rounded-t-card bg-card px-5 pb-7 pt-5 font-mono text-sm ${className}`}>
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
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-card p-5 ${className}`}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-6 rounded-tile bg-blush px-4 py-3 text-sm font-semibold text-rose"
    >
      {children}
    </p>
  );
}

/** Progress bar coloured by state: green under 80%, amber to 100%, rose beyond. */
export function Meter({ percent }: { percent: number }) {
  const fill = percent > 100 ? "bg-rose" : percent >= 80 ? "bg-[#E8A33B]" : "bg-forest";
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-ink/[0.07]">
      <div
        className={`bar-fill h-full rounded-full ${fill}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** Text inputs and selects: soft white wells, same height as buttons. */
export const fieldClass =
  "min-h-12 w-full rounded-tile border border-transparent bg-ink/[0.05] px-4 text-[17px] text-ink outline-none transition-colors placeholder:text-faint focus:border-forest/40 focus:bg-card focus:ring-4 focus:ring-forest/10 disabled:opacity-60";

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-bold text-muted">{label}</span>
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

/** Material Symbols Rounded icon. */
export function Icon({
  name,
  size = 22,
  fill = false,
  className = "",
}: {
  name: string;
  size?: number;
  fill?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`ms ${fill ? "ms-fill" : ""} ${className}`}
      style={{ fontSize: size }}
    >
      {name}
    </span>
  );
}
