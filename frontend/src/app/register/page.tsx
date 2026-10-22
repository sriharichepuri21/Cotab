"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard, ErrorNote, Field, PrimaryButton, TextLink } from "@/components/AuthCard";
import { register } from "@/lib/api";
import { routes, safeNext, withNext } from "@/lib/routes";

function RegisterForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password needs to be at least 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(email, password, fullName);
      // Register logs you straight in. Someone invited to a tab goes back to
      // it; everyone else picks what they're using Cotab for.
      router.push(next ?? routes.welcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Let's get you set up"
      subtitle="Scan a receipt, and we'll pull out the details for you."
      footer={
        <>
          Already have an account?{" "}
          <TextLink href={next ? withNext(routes.login, next) : routes.login}>Log in</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={busy}
        />
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
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <div className="mt-6">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Creating your account…" : "Create account"}
          </PrimaryButton>
        </div>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  // useSearchParams needs a Suspense boundary or `next build` fails the page.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-paper">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
