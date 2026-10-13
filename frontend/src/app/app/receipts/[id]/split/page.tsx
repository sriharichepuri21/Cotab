"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  addReceiptSplit,
  createSplitGroup,
  getReceipt,
  getSplitSuggestions,
  listSplitGroups,
  me,
  type Receipt,
  type SplitGroup,
  type SplitMemberInput,
  type SplitSuggestions,
} from "@/lib/api";
import { routes } from "@/lib/routes";

const FIELD =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500";

export default function SplitReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [suggestions, setSuggestions] = useState<SplitSuggestions | null>(null);
  const [groupId, setGroupId] = useState("new");
  const [groupName, setGroupName] = useState("");
  const [myName, setMyName] = useState("Me");
  const [people, setPeople] = useState<SplitMemberInput[]>([{ name: "", email: "" }]);
  const [mode, setMode] = useState<"even" | "itemized">("even");
  const [taxMode, setTaxMode] = useState<"pro_rata" | "even" | "payer">("pro_rata");
  const [paidBy, setPaidBy] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getReceipt(id), listSplitGroups(), getSplitSuggestions(id), me()])
      .then(([r, g, s, user]) => {
        setReceipt(r);
        setGroups(g);
        setSuggestions(s);
        const mine = user.full_name || user.email.split("@")[0];
        setMyName(mine);
        setPaidBy(mine);
        setGroupName(`${r.merchant || "Receipt"} split`);
        if (s.auto_apply && s.suggested_people.length) {
          setPeople(s.suggested_people.map((p) => ({ name: p.name, email: p.email || "" })));
          setAssignments(s.assignments);
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const selectedGroup = groups.find((group) => group.id === groupId);
  const memberNames = selectedGroup
    ? selectedGroup.members.map((member) => member.name)
    : [myName, ...people.map((person) => person.name).filter(Boolean)];

  const estimated = useMemo(() => {
    if (!receipt || memberNames.length === 0) return 0;
    return receipt.total / memberNames.length;
  }, [receipt, memberNames.length]);

  function toggle(itemId: string, person: string) {
    setAssignments((current) => {
      const names = new Set(current[itemId] || []);
      names.has(person) ? names.delete(person) : names.add(person);
      return { ...current, [itemId]: Array.from(names) };
    });
  }

  function assignAll(person: string) {
    const next: Record<string, string[]> = {};
    for (const item of receipt?.line_items || []) next[item.id] = [person];
    setAssignments(next);
    setMode("itemized");
  }

  async function submit() {
    if (!receipt) return;
    setBusy(true);
    setError("");
    try {
      let target = selectedGroup;
      if (!target) {
        const validPeople = people.filter((person) => person.name.trim());
        if (!validPeople.length) throw new Error("Add at least one person.");
        target = await createSplitGroup({ name: groupName, my_name: myName, members: validPeople });
      }
      const names = target.members.map((member) => member.name);
      const payer = names.includes(paidBy) ? paidBy : names[0];
      const byPerson: Record<string, string[]> = {};
      for (const name of names) byPerson[name] = [];
      for (const [itemId, owners] of Object.entries(assignments)) {
        for (const owner of owners) if (byPerson[owner]) byPerson[owner].push(itemId);
      }
      await addReceiptSplit(target.id, {
        receipt_id: receipt.id,
        paid_by: payer,
        mode,
        tax_mode: taxMode,
        assignments: mode === "itemized" ? byPerson : undefined,
      });
      router.push(routes.group(target.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!receipt)
    return (
      <main className="flex min-h-screen items-center justify-center">{error || "Loading…"}</main>
    );

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <Link href={routes.receipt(id)} className="text-sm text-gray-500">
          ← Receipt
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Split {receipt.merchant}</h1>
            <p className="text-gray-500">
              {receipt.currency} {receipt.total.toFixed(2)} · every cent will be reconciled
            </p>
          </div>
          <Link href={routes.groups} className="text-sm font-medium text-blue-600">
            Split history
          </Link>
        </div>

        {suggestions && suggestions.merchant_history_count > 0 && (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            You split at {receipt.merchant} {suggestions.merchant_history_count} time
            {suggestions.merchant_history_count === 1 ? "" : "s"} before. Suggestion confidence:{" "}
            {Math.round(suggestions.confidence * 100)}%.
            {!suggestions.auto_apply && <span> Review prior contacts below before applying.</span>}
          </div>
        )}

        <section className="mt-5 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">1. With whom?</h2>
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              const group = groups.find((g) => g.id === e.target.value);
              if (group) setPaidBy(group.members[0]?.name || "");
              else setPaidBy(myName);
            }}
            className={`${FIELD} mt-3 w-full`}
            aria-label="Split group"
          >
            <option value="new">Create a new group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · {group.members.map((m) => m.name).join(", ")}
              </option>
            ))}
          </select>
          {groupId === "new" && (
            <>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className={`${FIELD} mt-3 w-full`}
                placeholder="Group name"
                aria-label="Group name"
              />
              <div className="mt-3 space-y-2">
                {people.map((person, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={person.name}
                      onChange={(e) =>
                        setPeople(
                          people.map((p, i) => (i === index ? { ...p, name: e.target.value } : p))
                        )
                      }
                      className={`${FIELD} flex-1`}
                      placeholder="Name"
                      aria-label={`Person ${index + 1} name`}
                      list="prior-contacts"
                    />
                    <input
                      value={person.email || ""}
                      onChange={(e) =>
                        setPeople(
                          people.map((p, i) => (i === index ? { ...p, email: e.target.value } : p))
                        )
                      }
                      className={`${FIELD} flex-1`}
                      placeholder="Email (optional)"
                      aria-label={`Person ${index + 1} email`}
                    />
                  </div>
                ))}
                <datalist id="prior-contacts">
                  {suggestions?.contacts.map((p) => (
                    <option key={`${p.name}-${p.email}`} value={p.name}>
                      {p.email || `${p.split_count} prior splits`}
                    </option>
                  ))}
                </datalist>
                <button
                  onClick={() => setPeople([...people, { name: "", email: "" }])}
                  className="text-sm font-medium text-blue-600"
                >
                  + Add another person
                </button>
              </div>
            </>
          )}
        </section>

        <section className="mt-5 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">2. How should it split?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => setMode("even")}
              className={`rounded-lg border p-3 text-left ${mode === "even" ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
            >
              <strong>Evenly</strong>
              <span className="block text-sm text-gray-500">
                About {receipt.currency} {estimated.toFixed(2)} each
              </span>
            </button>
            <button
              onClick={() => setMode("itemized")}
              className={`rounded-lg border p-3 text-left ${mode === "itemized" ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
            >
              <strong>By item</strong>
              <span className="block text-sm text-gray-500">
                Items can belong to one or several people
              </span>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <label>
              Paid by{" "}
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className={FIELD}>
                {memberNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Tax/tip{" "}
              <select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as typeof taxMode)}
                className={FIELD}
              >
                <option value="pro_rata">Pro-rata by items</option>
                <option value="even">Evenly</option>
                <option value="payer">Payer covers it</option>
              </select>
            </label>
          </div>
        </section>

        {mode === "itemized" && (
          <section className="mt-5 overflow-x-auto rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">3. Assign items</h2>
              <div className="flex flex-wrap gap-2">
                {memberNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => assignAll(name)}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    All to {name}
                  </button>
                ))}
              </div>
            </div>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Item</th>
                  {memberNames.map((name) => (
                    <th key={name} className="p-2 text-center">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(receipt.line_items || []).map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-2">
                      {item.description}
                      <span className="block text-xs text-gray-400">
                        {receipt.currency} {item.total_price.toFixed(2)}
                      </span>
                    </td>
                    {memberNames.map((name) => (
                      <td key={name} className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={(assignments[item.id] || []).includes(name)}
                          onChange={() => toggle(item.id, name)}
                          aria-label={`${item.description} for ${name}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!(receipt.line_items || []).length && (
              <p className="py-6 text-center text-gray-400">
                Review the receipt and add line items before using itemized split.
              </p>
            )}
          </section>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Creating split…" : "Create split"}
        </button>
      </div>
    </main>
  );
}
