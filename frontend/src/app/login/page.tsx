"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AuthCard,
  ErrorNote,
  Field,
  PrimaryButton,
  TextLink,
} from "@/components/AuthCard";
import { login, me } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
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
      setError(
        err instanceof Error ? err.message : "Something went wrong — try again."
      );
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
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
