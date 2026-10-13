"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { TicketRail, type Ticket } from "@/components/TicketRail";
import { Button, ErrorNote, PageHeader, PageSkeleton, Section } from "@/components/ui";
import { type SplitSummary } from "@/lib/api";
import { useGroup } from "@/lib/data";
import { amount, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

/** Where each member stands once the suggested settlements are paid. */
function memberTickets(summary: SplitSummary): Ticket[] {
  const net = new Map<string, number>(summary.members.map((m) => [m.name, 0]));
  for (const s of summary.suggested_settlements) {
    net.set(s.from, (net.get(s.from) ?? 0) - s.amount);
    net.set(s.to, (net.get(s.to) ?? 0) + s.amount);
  }
  return Array.from(net.entries()).map(([name, n]) => {
    if (Math.abs(n) < 0.005)
      return { key: name, name, label: "even", amount: "0.00", tone: "mint" };
    return n < 0
      ? { key: name, name, label: "owes", amount: amount(-n), tone: "blush" }
      : { key: name, name, label: "is owed", amount: amount(n) };
  });
}

const modeLabel: Record<string, string> = { even: "split evenly", itemized: "split by item" };

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const groupQ = useGroup(id);
  const summary = groupQ.data;
  const error = groupQ.error?.message ?? "";
  const [copied, setCopied] = useState(false);

  if (!summary) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        {error ? (
          <>
            <PageHeader title="Group" back={{ href: routes.groups, label: "House" }} />
            <ErrorNote>{error}</ErrorNote>
          </>
        ) : (
          <PageSkeleton rows={4} />
        )}
      </main>
    );
  }

  const shareUrl = `${window.location.origin}${routes.share(summary.share_code)}`;
  const names = summary.members.map((m) => m.name);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title={summary.group_name}
        sub={`${names.join(", ")}. ${money(summary.total_spend)} shared so far.`}
        back={{ href: routes.groups, label: "House" }}
      />

      <div className="mb-8">
        <TicketRail tickets={memberTickets(summary)} />
      </div>

      <Section title="To settle up">
        {summary.suggested_settlements.length ? (
          <ul className="flex flex-col gap-2">
            {summary.suggested_settlements.map((row, i) => (
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
        <div className="mt-4">
          <Button
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
            }}
          >
            {copied ? "Link copied" : "Copy a link to share"}
          </Button>
        </div>
      </Section>

      <Section title="Shared purchases">
        <ul className="border-t border-ink">
          {summary.splits.map((split) => (
            <li key={split.split_id} className="border-b border-line/70 py-3">
              <Link
                href={routes.receipt(split.receipt_id)}
                className="flex items-start justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{split.merchant}</span>
                  <span className="block text-sm text-muted">
                    {dayLabel(split.purchased_at)}, {split.paid_by} paid,{" "}
                    {modeLabel[split.mode] ?? split.mode}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{amount(split.total)}</span>
              </Link>
              <div className="mt-2 flex flex-wrap gap-2">
                {split.shares.map((share) => (
                  <span
                    key={share.member}
                    className={`rounded-full px-3 py-1 font-mono text-xs ${
                      share.settled ? "bg-mint" : "bg-ink/[0.06]"
                    }`}
                  >
                    {share.member} {amount(share.amount)}
                    {share.settled ? ", paid" : ""}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {summary.splits.length === 0 && (
          <p className="mt-3 text-sm text-muted">Nothing split in this group yet.</p>
        )}
      </Section>
    </main>
  );
}
