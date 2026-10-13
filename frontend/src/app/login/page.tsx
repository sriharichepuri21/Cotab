"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthCard, ErrorNote, Field, PrimaryButton, TextLink } from "@/components/AuthCard";
import { login, me } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Arriving here from an expired session should say so — otherwise being
  // bounced to a login screen mid-task looks like the app lost your work.
  const expired = searchParams.get("expired") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // Someone who never finished onboarding still needs to pick an intent.
      const user = await me();
      router.push(user.intent ? "/" : "/welcome");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle={
        expired
          ? "Your session timed out. Sign in to pick up where you left off."
          : "Sign in to pick up where you left off."
      }
      footer={
        <>
          New here? <TextLink href="/register">Create an account</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && <ErrorNote>{error}</ErrorNote>}
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
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <div className="mt-6">
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Log in"}
          </PrimaryButton>
        </div>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary or `next build` fails the page.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
