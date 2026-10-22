"use client";

import Link from "next/link";
import { useState } from "react";

import { CatAvatar, Duo, TabbyStand } from "@/components/Tabby";
import { ErrorNote, Icon, PageSkeleton } from "@/components/ui";
import type { TabbyMood } from "@/lib/api";
import { useGroups, useNetBalances } from "@/lib/data";
import { money } from "@/lib/format";
import { routes } from "@/lib/routes";
import { friendTabby } from "@/lib/tabby";

type Filter = "open" | "all";

export default function SplitsPage() {
  const groupsQ = useGroups();
  const netsQ = useNetBalances();
  const [filter, setFilter] = useState<Filter>("open");
  const groups = groupsQ.data ?? [];
  const nets = netsQ.data ?? [];
  const loaded = !groupsQ.loading && !netsQ.loading;
  const error = groupsQ.error?.message ?? netsQ.error?.message ?? "";

  const owedToYou = nets
    .filter((n) => n.direction === "owes_you")
    .reduce((s, n) => s + n.amount, 0);
  const youOweList = nets.filter((n) => n.direction === "you_owe");
  const youOwe = youOweList.reduce((s, n) => s + n.amount, 0);
  const open = nets.filter((n) => n.direction !== "settled");
  const rows = filter === "open" ? open : nets;
  const biggest = [...nets]
    .filter((n) => n.direction === "owes_you")
    .sort((a, b) => b.amount - a.amount)[0];

  const mood: TabbyMood = biggest ? "need-money" : youOwe > 0 ? "hmm" : "love";
  const bubble = biggest ? (
    <>
      {biggest.person} owes you <strong className="font-extrabold">{money(biggest.amount)}</strong>.
    </>
  ) : youOwe > 0 ? (
    <>
      You owe <strong className="font-extrabold">{money(youOwe)}</strong>. Settle up when you can.
    </>
  ) : groups.length ? (
    "Everyone's square. Nice."
  ) : (
    "Split a receipt and I'll keep score."
  );

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-8 md:px-8 md:pt-10">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-[30px]">Splits</h1>
        <Link
          href={routes.tab}
          aria-label="Split a receipt"
          className="press grid h-11 w-11 place-items-center rounded-full bg-forest text-gold"
        >
          <Icon name="add" size={24} />
        </Link>
      </header>

      {error && (
        <div className="mt-4">
          <ErrorNote>Couldn&apos;t load your splits: {error}</ErrorNote>
        </div>
      )}
      {!loaded && (
        <div className="mt-6">
          <PageSkeleton rows={3} />
        </div>
      )}

      {loaded && (
        <div className="mt-2">
          <TabbyStand mood={mood} bubble={bubble} alt={`Tabby, ${mood.replace("-", " ")}`} />
          <section className="card-in relative overflow-hidden rounded-[28px] bg-forest px-5 pb-5 pt-[22px] text-[#F3F6F1] shadow-[0_28px_40px_-24px_rgb(15_61_49/0.8)]">
            <span
              aria-hidden="true"
              className="absolute -right-[60px] -top-[90px] h-[300px] w-[220px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
            />
            <p className="relative text-sm font-semibold text-[#F3F6F1]/70">Owed to you</p>
            <p className="relative mt-2 text-[40px] font-extrabold leading-none tracking-[-0.05em]">
              {money(owedToYou)}
            </p>
            <p className="relative mt-2.5 text-sm font-medium text-[#F3F6F1]/70">
              {youOwe > 0 ? (
                <>
                  You owe <strong className="text-gold">{money(youOwe)}</strong>
                  {youOweList.length === 1 ? ` to ${youOweList[0].person}` : ""}
                </>
              ) : (
                "You don't owe anyone."
              )}
            </p>
            <div className="relative mt-5 flex gap-2.5">
              <Link
                href={routes.tab}
                className="press flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-gold text-sm font-extrabold text-forest"
              >
                <Icon name="call_split" size={20} />
                Split a receipt
              </Link>
              {groups[0] && (
                <Link
                  href={routes.group(groups[0].id)}
                  className="press flex h-[46px] flex-1 items-center justify-center gap-2 rounded-full border border-[#F3F6F1]/[0.14] bg-[#F3F6F1]/10 text-sm font-bold"
                >
                  <Icon name="send_money" size={20} />
                  Settle up
                </Link>
              )}
            </div>
          </section>
        </div>
      )}

      {loaded && nets.length > 0 && (
        <>
          <div
            role="tablist"
            aria-label="Filter"
            className="mt-7 inline-flex rounded-full bg-ink/[0.05] p-1"
          >
            {(
              [
                ["open", `Open · ${open.length}`],
                ["all", "Everyone"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`h-9 rounded-full px-4 text-sm font-bold ${
                  filter === key
                    ? "bg-card text-ink shadow-[0_2px_8px_-2px_rgb(12_17_14/0.15)]"
                    : "text-faint"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {rows.length ? (
            <ul className="mt-3 rounded-card bg-card px-4 py-1">
              {rows.map((n, i) => (
                <li
                  key={n.person}
                  className={`flex items-center gap-3 py-3 ${i ? "border-t border-line" : ""}`}
                >
                  <CatAvatar choice={friendTabby(n.person)} size={46} soft />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{n.person}</span>
                    <span className="mt-0.5 block text-[13px] text-faint">
                      {n.direction === "owes_you"
                        ? "Owes you"
                        : n.direction === "you_owe"
                          ? "You owe them"
                          : "All square"}
                    </span>
                  </span>
                  {n.direction === "settled" ? (
                    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-good">
                      <Icon name="check_circle" fill size={18} />
                      Paid
                    </span>
                  ) : (
                    <span
                      className={`text-[15px] font-extrabold ${n.direction === "owes_you" ? "text-good" : "text-rose"}`}
                    >
                      {n.direction === "owes_you" ? "+" : "-"}
                      {money(n.amount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 flex flex-col items-center rounded-card bg-card px-5 py-6 text-center">
              <Duo scene="debt-cleared" width={180} alt="Two cats celebrating" />
              <p className="mt-2 font-extrabold">Everyone&apos;s paid up</p>
              <p className="mt-0.5 text-sm text-faint">Split a receipt to add someone.</p>
            </div>
          )}
        </>
      )}

      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-extrabold tracking-[-0.02em]">Groups</h2>
      </div>
      {groups.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={routes.group(group.id)}
              className="press flex flex-col rounded-card bg-card p-4"
            >
              <span className="flex -space-x-2.5">
                {group.members.slice(0, 4).map((m) => (
                  <CatAvatar
                    key={m.id ?? m.name}
                    choice={friendTabby(m.name)}
                    size={34}
                    ring="#FFFFFF"
                  />
                ))}
              </span>
              <span className="mt-3 truncate text-[15px] font-extrabold">{group.name}</span>
              <span className="mt-0.5 truncate text-[13px] text-faint">
                {group.members.length} people
              </span>
              {group.is_owner === false && (
                <span className="mt-2 w-fit rounded-full bg-mint px-2 py-0.5 text-xs font-bold text-good">
                  Shared with you
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        loaded && (
          <Link
            href={routes.tab}
            className="press mt-3 flex items-center gap-3 rounded-card border-[1.5px] border-dashed border-[#B9C0BB] p-4"
          >
            <Duo scene="split-bill" width={96} />
            <span>
              <span className="block text-[15px] font-bold">No one to split with yet</span>
              <span className="block text-[13px] text-faint">
                Open a receipt and tap Split this. The people you add show up here.
              </span>
            </span>
          </Link>
        )
      )}
    </main>
  );
}
