"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { PayLinks } from "@/components/PayLinks";
import { Slip, SlipLine } from "@/components/ui";
import { getPublicSplit, getToken, joinTab, type SplitSummary } from "@/lib/api";
import { invalidateSplits } from "@/lib/data";
import { amount, money } from "@/lib/format";
import { routes, withNext } from "@/lib/routes";

export default function PublicSplitPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [data, setData] = useState<SplitSummary | null>(null);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [joining, setJoining] = useState("");
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
    getPublicSplit(code)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [code]);

  async function join(memberId?: string) {
    setJoining(memberId ?? "new");
    setJoinError("");
    try {
      const result = await joinTab(code, memberId);
      invalidateSplits();
      router.push(routes.group(result.group_id));
    } catch (e) {
      setJoinError((e as Error).message);
      setJoining("");
    }
  }

  if (!data)
    return (
      <main className="mx-auto max-w-xl px-5 py-10">
        <Logo />
        <p className="mt-10 text-muted">{error || "Loading split…"}</p>
      </main>
    );

  const here = routes.share(code);
  const open = data.members.filter((m) => !m.joined);

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <Logo />
      <h1 className="mt-10 font-display text-3xl">{data.group_name}</h1>
      <p className="mt-2 text-muted">
        {data.members.map((m) => m.name).join(", ")}. {money(data.total_spend, data.currency)}{" "}
        shared.
      </p>

      <h2 className="mb-3 mt-8 text-lg font-bold">To settle up</h2>
      {data.suggested_settlements.length ? (
        <ul className="flex flex-col gap-3">
          {data.suggested_settlements.map((row, i) => (
            <li key={i} className="rounded-card bg-gold/60 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <strong>{row.from}</strong> pays <strong>{row.to}</strong>
                </span>
                <strong className="font-mono">{amount(row.amount)}</strong>
              </div>
              {(row.pay_links?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-sm">
                    {row.from}, pay {row.to} in one tap:
                  </p>
                  <PayLinks links={row.pay_links!} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-gold px-4 py-4 font-semibold">Everyone is even.</p>
      )}

      <section className="mt-8 rounded-card border border-ink bg-card p-5">
        <h2 className="text-lg font-bold">Join this tab</h2>
        <p className="mt-1 text-sm text-muted">
          Add your own receipts, mark payments and see the balance update for everyone.
        </p>
        {signedIn ? (
          <div className="mt-4 flex flex-col gap-2">
            {open.length > 0 && <p className="text-sm font-semibold">Which one is you?</p>}
            <div className="flex flex-wrap gap-2">
              {open.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  disabled={Boolean(joining)}
                  onClick={() => join(member.id)}
                  className="min-h-11 rounded-full border border-ink px-4 font-semibold hover:bg-ink/5 disabled:opacity-50"
                >
                  {joining === member.id ? "Joining…" : `I'm ${member.name}`}
                </button>
              ))}
              <button
                type="button"
                disabled={Boolean(joining)}
                onClick={() => join()}
                className="min-h-11 rounded-full bg-ink px-4 font-semibold text-paper disabled:opacity-50"
              >
                {joining === "new" ? "Joining…" : open.length ? "I'm someone new" : "Join"}
              </button>
            </div>
            {joinError && (
              <p role="alert" className="text-sm text-rose">
                {joinError}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={withNext(routes.register, here)}
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-semibold text-paper"
            >
              Create a free account
            </Link>
            <Link
              href={withNext(routes.login, here)}
              className="inline-flex min-h-11 items-center rounded-full border border-ink px-5 font-semibold"
            >
              Log in
            </Link>
          </div>
        )}
      </section>

      <h2 className="mb-3 mt-8 text-lg font-bold">Shared purchases</h2>
      <div className="flex flex-col gap-6">
        {data.splits.map((split) => (
          <Slip key={split.split_id}>
            <div className="mb-2 flex justify-between gap-3 font-sans text-base">
              <strong>{split.merchant}</strong>
              <span>{amount(split.total)}</span>
            </div>
            <p className="mb-2 font-sans text-sm text-muted">Paid by {split.paid_by}</p>
            {split.shares.map((share) => (
              <SlipLine key={share.member} name={share.member} amount={amount(share.amount)} />
            ))}
          </Slip>
        ))}
      </div>
      <p className="mt-10 text-sm text-muted">
        Anyone with this link can see this summary. Made with Cotab.
      </p>
    </main>
  );
}
