"use client";

/**
 * Shared frame for sign-in, sign-up and onboarding, taken from the prototype's
 * first screens: the Cotab promise and a printed slip on one side, a single
 * form on the other. On phones the promise shrinks to the logo so the form is
 * above the fold.
 */

import Link from "next/link";
import { useEffect } from "react";

import { Logo } from "@/components/Logo";
import { Slip, SlipLine, buttonClass, fieldClass } from "@/components/ui";
import { wakeServer } from "@/lib/api";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  wide = false,
  step,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  step?: string;
}) {
  // Sign-in, sign-up and onboarding all start the server warming up.
  useEffect(wakeServer, []);
  return (
    <main className="min-h-screen bg-paper md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-mint px-12 py-12 md:flex lg:px-20">
        <Link href="/" aria-label="Cotab home" className="w-fit">
          <Logo />
        </Link>
        <div className="max-w-md">
          <p className="font-display text-5xl leading-[1.02] lg:text-6xl">
            Keep tabs on <span className="hl">everything</span> you buy.
          </p>
          <p className="mt-5 text-lg leading-relaxed">
            Purchases land on your tab by themselves, item by item. Your household settles up in a
            tap.
          </p>
          <Slip className="mt-8 max-w-sm">
            <SlipLine name="Tap at Starbucks" amount="5.75" />
            <SlipLine name="Email from Amazon" amount="23.48" />
            <SlipLine name="Photo at Safeway" amount="41.20" />
          </Slip>
        </div>
        <p className="text-sm">Private by default. Your receipts are only yours.</p>
      </aside>

      <div className="flex min-h-screen flex-col px-5 py-8 md:justify-center md:px-12">
        <Link href="/" aria-label="Cotab home" className="mb-10 w-fit md:hidden">
          <Logo />
        </Link>
        <div className={`rise w-full ${wide ? "max-w-xl" : "max-w-[420px]"} md:mx-auto`}>
          {step && <p className="mb-3 font-mono text-xs text-muted">{step}</p>}
          <h1 className="font-display text-3xl leading-tight md:text-4xl">{title}</h1>
          {subtitle && <p className="mt-3 text-base text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <p className="mt-8 text-sm text-muted">{footer}</p>}
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      <input {...props} className={`${fieldClass} disabled:opacity-60`} />
    </label>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${buttonClass.primary} w-full`}>
      <span aria-hidden="true">→</span>
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-4 rounded-card border border-rose/40 bg-blush/60 px-4 py-3 text-sm text-ink"
    >
      {children}
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-ink underline underline-offset-4">
      {children}
    </Link>
  );
}
