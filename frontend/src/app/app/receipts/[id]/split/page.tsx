"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, ErrorNote, Field, fieldClass, PageHeader, Section } from "@/components/ui";
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
import { amount, money } from "@/lib/format";
import { routes } from "@/lib/routes";

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
        setGroupName("");
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
        target = await createSplitGroup({
          name: groupName.trim() || `${receipt.merchant || "Receipt"} split`,
          my_name: myName,
          members: validPeople,
        });
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

  if (!receipt) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-muted">Loading…</p>}
      </main>
    );
  }

  const lines = receipt.line_items || [];
  const choice = (active: boolean) =>
    `flex min-h-16 flex-col justify-center rounded-card border px-4 py-3 text-left transition ${
      active ? "border-ink bg-gold" : "border-line bg-card hover:border-ink/60"
    }`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title={`Split ${receipt.merchant || "this"}`}
        sub={`${money(receipt.total, receipt.currency)}. Every cent is accounted for.`}
        back={{ href: routes.receipt(id), label: "Receipt" }}
      />

      {suggestions && suggestions.merchant_history_count > 0 && (
        <p className="mb-6 rounded-card bg-mint px-4 py-3">
          You&apos;ve split at {receipt.merchant} {suggestions.merchant_history_count} time
          {suggestions.merchant_history_count === 1 ? "" : "s"} before
          {suggestions.auto_apply
            ? ", so we filled in the same people."
            : ". Pick the people again below."}
        </p>
      )}

      <Section title="With who">
        <Field label="Group">
          <select
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              const group = groups.find((g) => g.id === e.target.value);
              if (group) setPaidBy(group.members[0]?.name || "");
              else setPaidBy(myName);
            }}
            className={fieldClass}
            aria-label="Split group"
          >
            <option value="new">New group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.members.map((m) => m.name).join(", ")})
              </option>
            ))}
          </select>
        </Field>
        {groupId === "new" && (
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Group name">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className={fieldClass}
                placeholder="Apartment 4B"
                aria-label="Group name"
              />
            </Field>
            <p className="text-sm font-semibold">People</p>
            {people.map((person, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={person.name}
                  onChange={(e) =>
                    setPeople(
                      people.map((p, i) => (i === index ? { ...p, name: e.target.value } : p))
                    )
                  }
                  className={`${fieldClass} sm:flex-1`}
                  placeholder="Name"
                  aria-label={`Person ${index + 1} name`}
                  list="prior-contacts"
                />
                <input
                  type="email"
                  value={person.email || ""}
                  onChange={(e) =>
                    setPeople(
                      people.map((p, i) => (i === index ? { ...p, email: e.target.value } : p))
                    )
                  }
                  className={`${fieldClass} sm:flex-1`}
                  placeholder="Email (optional)"
                  aria-label={`Person ${index + 1} email`}
                />
              </div>
            ))}
            <datalist id="prior-contacts">
              {suggestions?.contacts.map((p) => (
                <option key={`${p.name}-${p.email}`} value={p.name}>
                  {p.email || `${p.split_count} past splits`}
                </option>
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => setPeople([...people, { name: "", email: "" }])}
              className="min-h-11 w-fit text-sm font-semibold underline underline-offset-4"
            >
              + Add someone
            </button>
          </div>
        )}
      </Section>

      <Section title="How">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setMode("even")} className={choice(mode === "even")}>
            <strong>Evenly</strong>
            <span className="text-sm">About {money(estimated, receipt.currency)} each</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("itemized")}
            className={choice(mode === "itemized")}
          >
            <strong>By item</strong>
            <span className="text-sm">Each item goes to one or more people</span>
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Paid by">
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className={fieldClass}
            >
              {memberNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Field>
          <Field label="Tax and tip">
            <select
              value={taxMode}
              onChange={(e) => setTaxMode(e.target.value as typeof taxMode)}
              className={fieldClass}
            >
              <option value="pro_rata">In proportion to items</option>
              <option value="even">Split evenly</option>
              <option value="payer">Payer covers it</option>
            </select>
          </Field>
        </div>
      </Section>

      {mode === "itemized" && (
        <Section title="Who had what">
          <div className="mb-3 flex flex-wrap gap-2">
            {memberNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => assignAll(name)}
                className="min-h-9 rounded-full border border-ink px-3 text-sm font-medium hover:bg-ink/5"
              >
                All to {name}
              </button>
            ))}
          </div>
          {lines.length ? (
            <ul className="border-t border-ink">
              {lines.map((item) => (
                <li key={item.id} className="border-b border-line/70 py-3">
                  <div className="flex justify-between gap-3 font-mono text-sm">
                    <span className="truncate">{item.description || "Item"}</span>
                    <span>{amount(item.total_price)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {memberNames.map((name) => {
                      const on = (assignments[item.id] || []).includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${item.description} for ${name}`}
                          onClick={() => toggle(item.id, name)}
                          className={`min-h-9 rounded-full px-3 text-sm font-medium ${
                            on ? "bg-ink text-paper" : "bg-ink/[0.06] text-ink"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-card border border-dashed border-line px-4 py-6 text-sm">
              This receipt has no item lines. Add them with Edit on the receipt, or split it evenly.
            </p>
          )}
        </Section>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      <Button onClick={submit} disabled={busy} arrow className="w-full">
        {busy ? "Splitting…" : "Split it"}
      </Button>
    </main>
  );
}
