"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import { AuthCard, ErrorNote } from "@/components/AuthCard";
import { Button, Field, fieldClass } from "@/components/ui";
import { isAuthed, me, setPhone } from "@/lib/api";
import { mutate } from "@/lib/cache";
import { keys } from "@/lib/data";
import { formatUsPhone, looksComplete } from "@/lib/phone";
import { routes, safeNext, withNext } from "@/lib/routes";
import { afterConfirmed } from "@/lib/session";

/** Every account adds a mobile number once, right after confirming its email. */
function PhoneForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [phone, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    me()
      .then((user) => {
        if (user.email_verified === false) {
          router.replace(next ? withNext(routes.verify, next) : routes.verify);
        } else if (user.phone) router.replace(afterConfirmed(user, next));
        else setReady(true);
      })
      .catch(() => router.replace(routes.login));
  }, [next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await setPhone(phone);
      mutate(keys.me, user);
      router.replace(afterConfirmed(user, next));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Add your mobile number"
      subtitle="Friends add you to splits by your number, and you can add them by theirs. It's never shown on share links."
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Mobile number">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-muted" aria-hidden="true">
              +1
            </span>
            <input
              value={phone}
              onChange={(e) => {
                setValue(formatUsPhone(e.target.value));
                setError(null);
              }}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(415) 555-0123"
              autoFocus
              disabled={!ready || busy}
              className={fieldClass}
            />
          </div>
        </Field>
        <Button type="submit" className="w-full" disabled={!ready || busy || !looksComplete(phone)}>
          {busy ? "Saving…" : "Continue"}
        </Button>
        <p className="text-center text-xs text-faint">US numbers only for now.</p>
      </form>
    </AuthCard>
  );
}

export default function PhonePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-paper">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      }
    >
      <PhoneForm />
    </Suspense>
  );
}
