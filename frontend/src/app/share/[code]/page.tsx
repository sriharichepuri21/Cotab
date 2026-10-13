"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Slip, SlipLine } from "@/components/ui";
import { getPublicSplit, type SplitSummary } from "@/lib/api";
import { amount, money } from "@/lib/format";

export default function PublicSplitPage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<SplitSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getPublicSplit(code)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [code]);
  if (!data)
    return (
      <main className="mx-auto max-w-xl px-5 py-10">
        <Logo />
        <p className="mt-10 text-muted">{error || "Loading split…"}</p>
      </main>
    );
  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <Logo />
      <h1 className="mt-10 font-display text-3xl">{data.group_name}</h1>
      <p className="mt-2 text-muted">
        {data.members.map((m) => m.name).join(", ")}. {money(data.total_spend)} shared.
      </p>

      <h2 className="mb-3 mt-8 text-lg font-bold">To settle up</h2>
      {data.suggested_settlements.length ? (
        <ul className="flex flex-col gap-2">
          {data.suggested_settlements.map((row, i) => (
            <li
              key={i}
              className="flex min-h-14 items-center justify-between gap-3 rounded-card bg-gold/60 px-4 py-3"
            >
              <span>
                <strong>{row.from}</strong> pays <strong>{row.to}</strong>
              </span>
              <strong className="font-mono">{amount(row.amount)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-gold px-4 py-4 font-semibold">Everyone is even.</p>
      )}

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
