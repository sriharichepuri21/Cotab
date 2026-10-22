"use client";

import Link from "next/link";

import { TicketRail, type Ticket } from "@/components/TicketRail";
import { ErrorNote, PageHeader, PageSkeleton, Section } from "@/components/ui";
import { type NetBalance } from "@/lib/api";
import { useGroups, useNetBalances } from "@/lib/data";
import { amount, money } from "@/lib/format";
import { routes } from "@/lib/routes";

function toTicket(n: NetBalance): Ticket {
  if (n.direction === "owes_you")
    return { key: n.person, name: n.person, label: "owes you", amount: amount(n.amount) };
  if (n.direction === "you_owe")
    return {
      key: n.person,
      name: n.person,
      label: "you owe",
      amount: amount(n.amount),
      tone: "blush",
    };
  return { key: n.person, name: n.person, label: "even", amount: "0.00", tone: "mint" };
}

export default function HousePage() {
  const groupsQ = useGroups();
  const netsQ = useNetBalances();
  const groups = groupsQ.data ?? [];
  const nets = netsQ.data ?? [];
  const loaded = !groupsQ.loading && !netsQ.loading;
  const error = groupsQ.error?.message ?? netsQ.error?.message ?? "";

  const owedToYou = nets
    .filter((n) => n.direction === "owes_you")
    .reduce((s, n) => s + n.amount, 0);
  const youOwe = nets.filter((n) => n.direction === "you_owe").reduce((s, n) => s + n.amount, 0);
  const open = nets.filter((n) => n.direction !== "settled");

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title="House"
        sub={
          open.length
            ? `${money(owedToYou)} owed to you, ${money(youOwe)} you owe`
            : "Everyone you split with, and where you stand"
        }
      />

      {error && <ErrorNote>Couldn&apos;t load your house: {error}</ErrorNote>}
      {!loaded && <PageSkeleton rows={3} />}

      {open.length > 0 && (
        <div className="mb-8">
          <TicketRail tickets={open.map(toTicket)} />
        </div>
      )}

      {loaded && !error && open.length === 0 && groups.length > 0 && (
        <p className="mb-8 rounded-card bg-gold px-4 py-4 font-semibold">
          You&apos;re even with everyone.
        </p>
      )}

      <Section title="Your groups">
        {groups.length > 0 ? (
          <ul className="border-t border-ink">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  href={routes.group(group.id)}
                  className="flex min-h-16 items-center gap-3 border-b border-line/70 py-3 hover:bg-ink/[0.03]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {group.name}
                      {group.is_owner === false && (
                        <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-xs font-semibold">
                          Shared with you
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {group.members.map((m) => m.name).join(", ")}
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          loaded && (
            <div className="rounded-card border border-dashed border-line px-5 py-8 text-center">
              <p className="font-semibold">No one to split with yet.</p>
              <p className="mt-1 text-sm text-muted">
                Open any receipt on your tab and tap Split this. The people you add become your
                house.
              </p>
              <Link
                href={routes.tab}
                className="mt-4 inline-block min-h-11 py-2 font-semibold underline underline-offset-4"
              >
                Go to your tab
              </Link>
            </div>
          )
        )}
      </Section>
    </main>
  );
}
