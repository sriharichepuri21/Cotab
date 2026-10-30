"use client";

/**
 * Shared frame for sign-in, sign-up and the steps after them, in the onboarding tour's
 * system: the sage studio, the logo's glass rings floating above one form, a white glass
 * field for each answer and one dark action, in a phone-width column.
 */

import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { GlassRings } from "@/components/landing/GlassRings";
import { buttonClass, fieldClass } from "@/components/ui";
import { wakeServer } from "@/lib/api";
import "@/styles/onboarding.css";
import "@/styles/auth.css";

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
    <main className="ob auth">
      <div className="ob-light" aria-hidden="true" />
      <header className="auth-top">
        <Link href="/" className="ob-round" aria-label="Back to Cotab">
          <ArrowLeft />
        </Link>
      </header>
      <div className={`auth-col ${wide ? "is-wide" : ""}`}>
        <div className="auth-head">
          <div className="ob-mark auth-mark">
            <GlassRings uid="auth" />
          </div>
          {step && <p className="auth-step">{step}</p>}
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
        </div>
        <div className="auth-form">{children}</div>
        {footer && <p className="auth-foot">{footer}</p>}
      </div>
    </main>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  const autoId = useId();
  if (props.type !== "password") {
    return (
      <label className="mb-4 block">
        <span className="mb-1.5 block text-[13px] font-bold text-muted">{label}</span>
        <input {...props} className={fieldClass} />
      </label>
    );
  }
  // The eye wraps only the input, so it centres on it, and sits outside the label.
  const id = props.id ?? autoId;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold text-muted">
        {label}
      </label>
      <div className="auth-secret">
        <input {...props} id={id} type={shown ? "text" : "password"} className={fieldClass} />
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** What a new password needs; the API checks the same four kinds and length. */
const PASSWORD_RULES: Array<[string, (pw: string) => boolean]> = [
  ["8 or more characters", (pw) => pw.length >= 8],
  ["An uppercase letter", (pw) => /[A-Z]/.test(pw)],
  ["A lowercase letter", (pw) => /[a-z]/.test(pw)],
  ["A number", (pw) => /\d/.test(pw)],
  ["A symbol, like ! or #", (pw) => /[^A-Za-z0-9]/.test(pw)],
];

export const strongPassword = (pw: string) => PASSWORD_RULES.every(([, ok]) => ok(pw));

export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="auth-rules" aria-label="Requirements">
      {PASSWORD_RULES.map(([text, ok]) => (
        <li key={text} className={ok(value) ? "is-met" : ""}>
          <Check aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
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
