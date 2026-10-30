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
import { SocialSignIn } from "@/components/SocialSignIn";
import { register } from "@/lib/api";
import { routes, safeNext, withNext } from "@/lib/routes";
import { goAfterSignIn } from "@/lib/session";

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
    if (!strongPassword(password)) {
      setError("Your password needs every item on the list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A new account gets a code by email; the code screen comes next.
      await goAfterSignIn(router, await register(email, password, fullName), next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Let's get you set up"
      subtitle="Make an account and Tabby will read every receipt for you."
      footer={
        <>
          Already have an account?{" "}
          <TextLink href={next ? withNext(routes.login, next) : routes.login}>Log in</TextLink>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <SocialSignIn
        mode="signup"
        disabled={busy}
        onSignedIn={(result) => goAfterSignIn(router, result, next)}
        onError={setError}
      />
      <form onSubmit={onSubmit} noValidate>
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
          placeholder="Make it strong"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <PasswordRules value={password} />
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
