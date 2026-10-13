"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getNetBalances, listSplitGroups, type NetBalance, type SplitGroup } from "@/lib/api";

export default function GroupsPage() {
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [nets, setNets] = useState<NetBalance[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([listSplitGroups(), getNetBalances()])
      .then(([g, n]) => {
        setGroups(g);
        setNets(n);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Splits</h1>
            <p className="text-sm text-gray-500">Running balances across every group</p>
          </div>
          <Link href="/" className="text-sm text-blue-600">
            ← Dashboard
          </Link>
        </div>
        {error && <p className="mt-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}
        <section className="mt-6 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Net balances</h2>
          {nets.length ? (
            <ul className="mt-3 divide-y">
              {nets.map((net) => (
                <li key={`${net.person}-${net.email}`} className="flex justify-between py-3">
                  <span>
                    {net.person}
                    <span className="block text-xs text-gray-400">{net.email}</span>
                  </span>
                  <strong
                    className={net.direction === "you_owe" ? "text-red-600" : "text-green-700"}
                  >
                    {net.direction === "owes_you"
                      ? `${net.person} owes you`
                      : net.direction === "you_owe"
                        ? `You owe ${net.person}`
                        : "Settled"}{" "}
                    ${net.amount.toFixed(2)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-400">No open balances yet.</p>
          )}
        </section>
        <section className="mt-6">
          <h2 className="font-semibold">Groups</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/groups/${group.id}`}
                className="rounded-xl border bg-white p-4 shadow-sm hover:border-blue-300"
              >
                <h3 className="font-semibold">{group.name}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {group.members.map((m) => m.name).join(", ")}
                </p>
              </Link>
            ))}
          </div>
          {!groups.length && (
            <p className="rounded-xl border bg-white p-8 text-center text-sm text-gray-400">
              Open a receipt and choose “Split this receipt” to begin.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
