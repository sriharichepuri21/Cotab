"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthCard, ErrorNote } from "@/components/AuthCard";
import { isAuthed, setIntent, type Intent } from "@/lib/api";

const CHOICES: { intent: Intent; emoji: string; title: string; blurb: string }[] = [
  {
    intent: "personal",
    emoji: "🧾",
    title: "Track my personal expenses",
    blurb: "See where your money goes, month to month.",
  },
  {
    intent: "splits",
    emoji: "👥",
    title: "Split bills with friends",
    blurb: "Work out who owes what — no accounts needed for them.",
  },
  {
    intent: "business",
    emoji: "💼",
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
    if (!isAuthed()) router.replace("/login");
  }, [router]);

  async function choose(intent: Intent) {
    setBusy(intent);
    setError(null);
    try {
      await setIntent(intent);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that — try again.");
      setBusy(null);
    }
  }

  return (
    <AuthCard
      title="What brings you here?"
      subtitle="One quick thing, so we can set things up the way you need."
      wide
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="space-y-3">
        {CHOICES.map((c) => (
          <button
            key={c.intent}
            type="button"
            onClick={() => choose(c.intent)}
            disabled={busy !== null}
            className="group flex w-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-500 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden className="text-2xl leading-none">
              {c.emoji}
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-gray-900">{c.title}</span>
              <span className="mt-0.5 block text-sm text-gray-500">
                {busy === c.intent ? "Setting things up…" : c.blurb}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-gray-400">You can change this later.</p>
    </AuthCard>
  );
}
