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
import { TabbyGreeter } from "@/components/TabbyGreeter";
import { buttonClass, fieldClass } from "@/components/ui";
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
    <main className="auth-night min-h-screen bg-paper md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-forest px-12 py-12 text-[#F3F6F1] md:flex lg:px-20">
        <span
          aria-hidden="true"
          className="absolute -right-24 -top-40 h-[520px] w-[340px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
        />
        <Link
          href="/"
          aria-label="Cotab home"
          className="relative w-fit rounded-full bg-card py-1.5 pl-1.5 pr-4"
        >
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <p className="text-5xl font-extrabold leading-[1.02] tracking-[-0.045em] lg:text-6xl">
            Keep tabs on everything you buy.
          </p>
          <p className="mt-5 text-lg leading-relaxed text-[#F3F6F1]/75">
            Snap a receipt and Tabby reads every line. Splits with friends settle in a tap.
          </p>
          <div className="relative mt-10 h-[260px]">
            <div className="tabby-bubble absolute left-0 top-6 max-w-[230px] rounded-[20px] rounded-br-md bg-card px-4 py-3 text-[15px] font-semibold text-ink shadow-[0_14px_28px_-16px_rgb(0_0_0/0.5)]">
              Hi, I&apos;m Tabby! I&apos;ll keep an eye on your money.
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/cat-v3-stock/png/hi.png"
              alt="Tabby waving"
              className="tabby-hop absolute bottom-0 right-6 h-[240px] w-auto"
            />
          </div>
        </div>
        <p className="relative text-sm text-[#F3F6F1]/60">
          Private by default. Your receipts are only yours.
        </p>
      </aside>

      <div className="flex min-h-screen flex-col px-5 pb-8 pt-5 md:justify-center md:px-12 md:py-8">
        <div className="relative md:hidden">
          <Link href="/" aria-label="Cotab home" className="absolute left-0 top-0 z-10 w-fit">
            <Logo />
          </Link>
          <TabbyGreeter compact={!!step} />
        </div>
        <div
          className={`rise relative z-[1] -mt-4 w-full rounded-[28px] bg-card p-6 md:mt-0 md:bg-transparent md:p-0 ${wide ? "max-w-xl" : "max-w-[420px]"} md:mx-auto`}
        >
          {step && <p className="mb-3 text-[13px] font-bold text-faint">{step}</p>}
          <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.04em] md:text-4xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <p className="mt-7 text-sm text-muted">{footer}</p>}
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
      <span className="mb-1.5 block text-[13px] font-bold text-muted">{label}</span>
      <input {...props} className={fieldClass} />
    </label>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${buttonClass.primary} w-full`}>
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-4 rounded-tile bg-blush px-4 py-3 text-sm font-semibold text-rose"
    >
      {children}
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-bold text-forest underline underline-offset-4">
      {children}
    </Link>
  );
}
