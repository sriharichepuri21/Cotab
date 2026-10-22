"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthCard, ErrorNote } from "@/components/AuthCard";
import { CatAvatar } from "@/components/Tabby";
import { isAuthed, me, setIntent, type Intent, type TabbyMood } from "@/lib/api";
import { routes } from "@/lib/routes";

const CHOICES: {
  intent: Intent;
  tone: string;
  mood: TabbyMood;
  title: string;
  blurb: string;
}[] = [
  {
    intent: "personal",
    tone: "bg-card",
    mood: "cool",
    title: "Track my personal expenses",
    blurb: "See where your money goes, month to month.",
  },
  {
    intent: "splits",
    tone: "bg-card",
    mood: "love",
    title: "Split bills with the people I live with",
    blurb: "Shared groceries and bills, settled up without the spreadsheet.",
  },
  {
    intent: "business",
    tone: "bg-card",
    mood: "payday",
    title: "Track a small business",
    blurb: "Keep receipts organised and ready for tax time.",
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Intent | null>(null);

  // Registration/login land here with a token set; a fresh tab without one can't
  // set an intent (no session) so go straight to login.
  useEffect(() => {
    if (!isAuthed()) {
      router.replace(routes.login);
      return;
    }
    // The email has to be confirmed before onboarding.
    me()
      .then((user) => {
        if (user.email_verified === false) router.replace(routes.verify);
      })
      .catch(() => undefined);
  }, [router]);

  async function choose(intent: Intent) {
    setBusy(intent);
    setError(null);
    try {
      await setIntent(intent);
      router.push(routes.home);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
      setBusy(null);
    }
  }

  return (
    <AuthCard
      title="What brings you here?"
      subtitle="One quick thing, so we can set things up the way you need."
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-col gap-3">
        {CHOICES.map((c) => (
          <button
            key={c.intent}
            type="button"
            onClick={() => choose(c.intent)}
            disabled={busy !== null}
            className={`press flex min-h-20 w-full items-center gap-4 rounded-card px-4 py-4 text-left shadow-[0_0_0_1px_rgb(12_17_14/0.06)] transition disabled:cursor-not-allowed disabled:opacity-60 ${c.tone}`}
          >
            <CatAvatar choice={{ look: "hoodie", mood: c.mood, bg: "mood" }} size={52} />
            <span className="flex-1">
              <span className="block text-[16px] font-extrabold">{c.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                {busy === c.intent ? "Setting things up…" : c.blurb}
              </span>
            </span>
            <span aria-hidden="true" className="ms text-[22px] text-faint">
              chevron_right
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">You can change this later in your profile.</p>
    </AuthCard>
  );
}
