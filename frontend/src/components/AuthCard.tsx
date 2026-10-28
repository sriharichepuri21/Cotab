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
    <main className="min-h-screen bg-[#fffefa] md:grid md:grid-cols-[minmax(0,1.08fr)_minmax(440px,.92fr)]">
      <aside className="relative hidden min-h-screen flex-col overflow-hidden bg-[#e7ff54] p-10 text-[#151716] md:flex lg:p-14">
        <Link href="/" aria-label="Cotab home" className="relative z-10 block w-fit">
          <Logo height={42} tone="flat" />
        </Link>
        <div className="relative z-10 mt-auto max-w-[650px] pb-8">
          <p className="text-[clamp(64px,7vw,118px)] font-extrabold leading-[.82] tracking-[-.08em]">
            Your tab.
            <br />
            Still yours.
          </p>
          <p className="mt-8 max-w-md text-[18px] font-medium leading-relaxed">
            Ask Tabby, review activity, manage rules and edit memories. Changes always wait for your
            approval.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cat-v3-stock/png/working.png"
          alt="Tabby working"
          className="absolute -bottom-10 -right-20 h-[52vh] max-h-[620px] w-auto object-contain"
        />
        <p className="relative z-10 text-[12px] font-bold uppercase tracking-[.12em]">
          Private by default · Undoable by design
        </p>
      </aside>

      <div className="flex min-h-screen flex-col px-5 py-8 md:justify-center md:px-12 lg:px-20">
        <div className="flex items-end justify-between md:hidden">
          <Link href="/" aria-label="Cotab home" className="block w-fit">
            <Logo height={32} />
          </Link>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cat-v3-stock/png/working.png"
            alt=""
            className="relative z-10 -mb-5 mr-2 h-[112px] w-auto"
          />
        </div>
        <div
          className={`rise w-full bg-[#fffefa] p-6 md:p-0 ${wide ? "max-w-xl" : "max-w-[440px]"} md:mx-auto`}
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
