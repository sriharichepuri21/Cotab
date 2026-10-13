"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSplitSummary, type SplitSummary } from "@/lib/api";

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<SplitSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    getSplitSummary(id)
      .then(setSummary)
      .catch((e) => setError(e.message));
  }, [id]);
  if (!summary)
    return (
      <main className="flex min-h-screen items-center justify-center">{error || "Loading…"}</main>
    );
  const shareUrl = `${window.location.origin}/share/${summary.share_code}`;
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/groups" className="text-sm text-gray-500">
              ← All groups
            </Link>
            <h1 className="mt-2 text-2xl font-bold">{summary.group_name}</h1>
            <p className="text-gray-500">
              {summary.member_count} people · {summary.total_spend.toFixed(2)} total
            </p>
          </div>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {copied ? "Link copied" : "Copy public link"}
          </button>
        </div>
        <section className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Who owes whom</h2>
          {summary.suggested_settlements.length ? (
            <ul className="mt-3 space-y-2">
              {summary.suggested_settlements.map((row, i) => (
                <li key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                  <strong>{row.from}</strong> pays <strong>{row.to}</strong> {row.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-green-700">Everyone is settled.</p>
          )}
        </section>
        <section className="mt-6 space-y-3">
          <h2 className="font-semibold">Receipt history</h2>
          {summary.splits.map((split) => (
            <article key={split.split_id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex justify-between">
                <div>
                  <Link
                    href={`/receipts/${split.receipt_id}`}
                    className="font-semibold hover:text-blue-600"
                  >
                    {split.merchant}
                  </Link>
                  <p className="text-xs text-gray-400">
                    Paid by {split.paid_by} · {split.mode.replace("_", " ")} · tax{" "}
                    {split.tax_mode.replace("_", " ")}
                  </p>
                </div>
                <strong>
                  {split.currency} {split.total.toFixed(2)}
                </strong>
              </div>
              <ul className="mt-3 text-sm">
                {split.shares.map((share) => (
                  <li key={share.member} className="flex justify-between border-t py-2">
                    <span>{share.member}</span>
                    <span>
                      {split.currency} {share.amount.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
