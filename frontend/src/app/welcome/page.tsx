"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthCard, ErrorNote } from "@/components/AuthCard";
import { isAuthed, setIntent, type Intent } from "@/lib/api";
import { routes } from "@/lib/routes";

const CHOICES: { intent: Intent; tone: string; title: string; blurb: string }[] = [
  {
    intent: "personal",
    tone: "bg-mint",
    title: "Track my personal expenses",
    blurb: "See where your money goes, month to month.",
  },
  {
    intent: "splits",
    tone: "bg-gold/70",
    title: "Split bills with the people I live with",
    blurb: "Shared groceries and bills, settled up without the spreadsheet.",
  },
  {
    intent: "business",
    tone: "bg-blush",
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
    if (!isAuthed()) router.replace(routes.login);
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
            className={`flex min-h-20 w-full items-center gap-4 rounded-card px-5 py-4 text-left ring-ink transition hover:ring-1 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${c.tone}`}
          >
            <span className="flex-1">
              <span className="block text-[17px] font-bold">{c.title}</span>
              <span className="mt-1 block text-sm leading-snug">
                {busy === c.intent ? "Setting things up…" : c.blurb}
              </span>
            </span>
            <span aria-hidden="true" className="text-xl">
              ›
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">You can change this later in Settings.</p>
    </AuthCard>
  );
}
