"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import {
  AuthCard,
  ErrorNote,
  Field,
  PasswordRules,
  PrimaryButton,
  TextLink,
  strongPassword,
} from "@/components/AuthCard";
import { forgotPassword, resetPassword } from "@/lib/api";
import { routes } from "@/lib/routes";
import { goAfterSignIn } from "@/lib/session";

/**
 * Forgot password: your email, then the 6-digit code Tabby emails you and a
 * new password. Then you're signed in.
 */
function ForgotForm() {
  const router = useRouter();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.includes("@")) {
      setError("Type the email you signed up with.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
      setNote(e ? null : "A new code is on its way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!strongPassword(password)) {
      setError("Your new password needs every item on the list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await goAfterSignIn(router, await resetPassword(email.trim(), code, password), null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={sent ? "Check your email" : "Forgot your password?"}
      subtitle={
        sent
          ? `If ${email} has a Cotab account, Tabby just sent it a 6-digit code.`
          : "Type your email and Tabby will send you a code to choose a new one."
      }
      footer={
        <>
          Remembered it? <TextLink href={routes.login}>Log in</TextLink>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {note && (
        <p role="status" className="mb-4 text-sm font-semibold text-good">
          {note}
        </p>
      )}
      {!sent ? (
        <form onSubmit={send} noValidate>
          <Field
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <div className="mt-6">
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send me a code"}
            </PrimaryButton>
          </div>
        </form>
      ) : (
        <form onSubmit={reset} noValidate>
          <Field
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
          <Field
            label="New password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            placeholder="Make it strong"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <PasswordRules value={password} />
          <div className="mt-6">
            <PrimaryButton type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Saving…" : "Save and log in"}
            </PrimaryButton>
          </div>
          <p className="mt-4 text-center text-sm text-muted">
            No email?{" "}
            <button
              type="button"
              onClick={() => send()}
              disabled={busy}
              className="font-bold text-forest underline underline-offset-4"
            >
              Send a new code
            </button>{" "}
            or check spam.
          </p>
        </form>
      )}
    </AuthCard>
  );
}

export default function ForgotPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-paper">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      }
    >
      <ForgotForm />
    </Suspense>
  );
}
