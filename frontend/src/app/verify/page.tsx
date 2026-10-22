"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AuthCard, ErrorNote } from "@/components/AuthCard";
import { Button } from "@/components/ui";
import { ApiError, isAuthed, logout, me, resendCode, verifyEmail } from "@/lib/api";
import { mutate } from "@/lib/cache";
import { keys } from "@/lib/data";
import { routes, safeNext } from "@/lib/routes";

const LENGTH = 6;

function VerifyForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [wait, setWait] = useState(30);
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const goOn = useCallback(
    (intent: string | null) => router.replace(next ?? (intent ? routes.home : routes.welcome)),
    [next, router]
  );

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    me()
      .then((user) => {
        if (user.email_verified !== false) goOn(user.intent);
        else setEmail(user.email);
      })
      .catch(() => router.replace(routes.login));
  }, [goOn, router]);

  // Count down to when a new code may be sent.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit(value: string) {
    if (value.length !== LENGTH || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const user = await verifyEmail(value);
      mutate(keys.me, user);
      setDone(true);
      setTimeout(() => goOn(user.intent), 1100);
    } catch (e) {
      setError((e as Error).message);
      setCode("");
      setBusy(false);
      field.current?.focus();
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      const out = await resendCode();
      if (out.email_verified) return goOn(null);
      setNotice(`New code sent to ${out.email ?? email}.`);
      setWait(out.retry_after || 60);
      setCode("");
      field.current?.focus();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      const seconds = /(\d+) seconds/.exec(err.message);
      if (seconds) setWait(Number(seconds[1]));
    }
  }

  async function startOver() {
    try {
      await logout();
    } finally {
      router.replace(routes.register);
    }
  }

  if (done) {
    return (
      <AuthCard title="You're in!" subtitle="Email confirmed. Tabby's ready when you are.">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cat/love.webp" alt="Tabby, happy" className="tabby-hop h-40 w-auto" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Check your email"
      subtitle={
        email
          ? `Tabby sent a 6-digit code to ${email}. Type it below to confirm it's you.`
          : "Tabby sent you a 6-digit code. Type it below to confirm it's you."
      }
      footer={
        <>
          Wrong email?{" "}
          <button
            type="button"
            onClick={startOver}
            className="font-bold text-forest underline underline-offset-4"
          >
            Start over
          </button>
          . Can&apos;t find it? Check your spam folder.
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-tile bg-mint px-4 py-3 text-sm font-semibold text-good"
        >
          {notice}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
      >
        <label className="relative block" onClick={() => field.current?.focus()}>
          <span className="sr-only">6-digit code</span>
          <input
            ref={field}
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, LENGTH);
              setCode(digits);
              setError(null);
              if (digits.length === LENGTH) submit(digits);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={LENGTH}
            disabled={busy}
            aria-label="6-digit code"
            className="absolute inset-0 h-full w-full cursor-text opacity-0"
          />
          <span aria-hidden="true" className="grid grid-cols-6 gap-2">
            {Array.from({ length: LENGTH }, (_, i) => {
              const active = focused && i === Math.min(code.length, LENGTH - 1);
              return (
                <span
                  key={i}
                  className={`grid h-14 place-items-center rounded-[16px] border-2 bg-card text-[26px] font-extrabold transition ${
                    error
                      ? "border-rose/60"
                      : active
                        ? "border-forest ring-4 ring-gold/60"
                        : code[i]
                          ? "border-ink/20"
                          : "border-ink/10"
                  }`}
                >
                  {code[i] ?? ""}
                </span>
              );
            })}
          </span>
        </label>
        <Button type="submit" className="mt-6 w-full" disabled={busy || code.length !== LENGTH}>
          {busy ? "Checking…" : "Confirm email"}
        </Button>
      </form>
      <div className="mt-4 text-center">
        {wait > 0 ? (
          <p className="text-sm font-semibold text-faint">Send a new code in {wait}s</p>
        ) : (
          <button
            type="button"
            onClick={resend}
            className="text-sm font-bold text-forest underline underline-offset-4"
          >
            Send a new code
          </button>
        )}
      </div>
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-paper">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      }
    >
      <VerifyForm />
    </Suspense>
  );
}
