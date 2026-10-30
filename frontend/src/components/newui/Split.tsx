"use client";

import { useEffect, useMemo, useState } from "react";

import { NameClashDialog } from "@/components/NameClashDialog";
import { PersonPicker, alreadyIn, last4, type InSplit } from "@/components/PersonPicker";
import { Icon } from "@/components/ui";
import {
  ApiError,
  addReceiptSplit,
  createDirectSplit,
  getSplitSummary,
  listSplitGroups,
  previewSplit,
  type SplitGroup,
  type SplitMemberInput,
  type SplitMode,
  type SplitPreview,
} from "@/lib/api";
import { invalidateSpending, invalidateSplits, useMe, usePeople } from "@/lib/data";
import { myNameOn } from "@/lib/people";
import { checkParts, isPartsMode, shown, typedFrom, type PartsMode } from "@/lib/splitParts";
import { Person, scanMoney, type Receipt } from "./parts";

type TaxMode = "pro_rata" | "even" | "payer";

const MODES: Array<[SplitMode, string, string, string]> = [
  ["even", "Evenly", "drag_handle", "Same amount"],
  ["itemized", "By item", "checklist", "Pick who had what"],
  ["exact", "Exact amounts", "payments", "Type each amount"],
  ["percent", "Percentages", "percent", "Must total 100%"],
  ["shares", "Shares", "pie_chart", "Like 2 : 1"],
];
const MARK: Record<PartsMode, string> = { exact: "$", percent: "%", shares: "×" };

/** The same Tabby for the same name, every time. */
/** One number is one person: someone picked from your people is matched by
 *  who they are (`from_member`), not by name, so two Bens can both be in. */
const personKey = (p: SplitMemberInput) => p.from_member || p.name.toLowerCase();

/**
 * Split a saved receipt: with people (a friend tab, kept per set of people)
 * or on one of your tabs; who paid; evenly, by item, by exact amounts,
 * percentages or shares. Every share comes from the server's preview, and
 * saving is the same two calls the rest of the app makes.
 */
export function SplitSheet({
  receipt,
  close,
  onSaved,
}: {
  receipt: Receipt;
  close: () => void;
  /** Saved: what to tell the person. */
  onSaved: (message: string) => void;
}) {
  const { data: user } = useMe();
  const { data: people } = usePeople();
  const myName = user?.full_name || user?.email?.split("@")[0] || "Me";
  const total = receipt.total ?? 0;
  const currency = receipt.currency || "USD";
  const [groups, setGroups] = useState<SplitGroup[] | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [choosingTab, setChoosingTab] = useState(false);
  const [adding, setAdding] = useState(false);
  const [friends, setFriends] = useState<SplitMemberInput[]>([]);
  const [clash, setClash] = useState<{ person: SplitMemberInput; with: { name: string } } | null>(
    null
  );
  const [paidBy, setPaidBy] = useState("");
  const [mode, setMode] = useState<SplitMode>("even");
  const [typed, setTyped] = useState<Record<PartsMode, Record<string, string>>>({
    exact: {},
    percent: {},
    shares: {},
  });
  const [taxMode, setTaxMode] = useState<TaxMode>("pro_rata");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The receipt is already split on that tab: offer to redo it there.
  const [conflict, setConflict] = useState(false);

  // Already split: start from how it was split there, item picks included.
  const editing = Boolean(receipt.splitTab && tabId === receipt.splitTab);
  useEffect(() => {
    let live = true;
    listSplitGroups()
      .then((list) => {
        if (!live) return;
        setGroups(list);
        const on = receipt.splitTab;
        if (!on || !list.some((g) => g.id === on)) return;
        setTabId(on);
        return getSplitSummary(on).then((summary) => {
          const old = live && summary.splits.find((s) => s.receipt_id === receipt.id);
          if (!old) return;
          const oldMode = old.mode as SplitMode;
          setPaidBy(old.paid_by);
          setMode(oldMode);
          setTaxMode(old.tax_mode as TaxMode);
          if (isPartsMode(oldMode)) setTyped((t) => ({ ...t, [oldMode]: typedFrom(old.parts) }));
          const byItem: Record<string, string[]> = {};
          for (const [person, itemIds] of Object.entries(old.items ?? {}))
            for (const itemId of itemIds) (byItem[itemId] ??= []).push(person);
          setAssignments(byItem);
        });
      })
      .catch(() => live && setGroups([]));
    return () => {
      live = false;
    };
  }, [receipt.id, receipt.splitTab]);

  const tab = groups?.find((g) => g.id === tabId);
  // You on this tab, found by account: the tab may call you something else.
  const meOnTab = myNameOn(tab?.members, user?.id, myName);
  const memberNames = tab
    ? tab.members.map((m) => m.name)
    : [myName, ...friends.map((p) => p.name).filter(Boolean)];
  const others = memberNames.filter((n) => n !== meOnTab);
  const ready = memberNames.length > 1;
  // Who paid: your pick while they're on the split, else you, else the first.
  const payer = memberNames.includes(paidBy)
    ? paidBy
    : memberNames.includes(meOnTab)
      ? meOnTab
      : (memberNames[0] ?? "");
  const lines = (receipt.lineItems ?? []).filter((line) => !line.charge);
  const partsCheck = isPartsMode(mode)
    ? checkParts(mode, Math.round(total * 100), memberNames, typed[mode], currency)
    : null;
  const unassigned =
    mode === "itemized" ? lines.filter((line) => !(assignments[line.id] || []).length).length : 0;
  const recent = useMemo(() => (people ?? []).slice(0, 12), [people]);
  const shownName = (name: string) => (name === meOnTab ? "You" : name);

  const previewKey = JSON.stringify([
    memberNames,
    payer,
    mode,
    taxMode,
    assignments,
    partsCheck?.parts,
  ]);
  useEffect(() => {
    // Typed numbers that aren't numbers yet: the line under the boxes says why.
    const unreadable = partsCheck && partsCheck.note.startsWith("Use ");
    if (!receipt.id || !ready || !payer || unreadable) {
      setPreview(null);
      return;
    }
    const byPerson: Record<string, string[]> = {};
    for (const name of memberNames) byPerson[name] = [];
    for (const [itemId, owners] of Object.entries(assignments))
      for (const owner of owners) byPerson[owner]?.push(itemId);
    let stale = false;
    const timer = window.setTimeout(() => {
      previewSplit({
        receipt_id: receipt.id as string,
        members: memberNames,
        paid_by: payer,
        mode,
        tax_mode: taxMode,
        assignments: mode === "itemized" ? byPerson : undefined,
        parts: partsCheck?.parts,
      })
        .then((result) => !stale && setPreview(result))
        .catch(() => !stale && setPreview(null));
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.id, previewKey]);

  function addPerson(person: SplitMemberInput) {
    if (person.name.trim().toLowerCase() === myName.toLowerCase())
      throw new Error("That's you. Add who you're splitting with.");
    if (friends.some((p) => personKey(p) === personKey(person))) return;
    // A different person with a name already here: ask for two names first.
    const namesake = [{ name: myName }, ...friends].find(
      (p) => p.name.trim().toLowerCase() === person.name.trim().toLowerCase()
    );
    if (namesake) {
      setClash({ person, with: namesake });
      return;
    }
    setFriends((list) => [...list, person]);
    setAdding(false);
    setError("");
  }

  /** Items already given to someone follow them when they're renamed. */
  function carry(from: string, to: string) {
    if (from === to) return;
    setAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, names]) => [id, names.map((n) => (n === from ? to : n))])
      )
    );
    setTyped((t) => {
      const move = (by: Record<string, string>) =>
        Object.fromEntries(Object.entries(by).map(([n, v]) => [n === from ? to : n, v]));
      return { exact: move(t.exact), percent: move(t.percent), shares: move(t.shares) };
    });
  }

  function renamePerson(who: InSplit, name: string) {
    if (who.name === myName) throw new Error("Change your own name in your profile.");
    carry(who.name, name);
    setFriends((list) =>
      list.map((p) =>
        (who.ref ? p.from_member === who.ref : p.name === who.name) ? { ...p, name } : p
      )
    );
  }

  function toggleOwner(itemId: string, person: string) {
    setAssignments((current) => {
      const names = new Set(current[itemId] || []);
      if (names.has(person)) names.delete(person);
      else names.add(person);
      return { ...current, [itemId]: Array.from(names) };
    });
  }

  async function submit(replace = false) {
    if (!receipt.id) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      let target = tab;
      if (!target) {
        if (!friends.length) throw new Error("Add who you're splitting with.");
        target = await createDirectSplit({ my_name: myName, members: friends });
        setTabId(target.id);
        setGroups((current) =>
          current?.some((g) => g.id === target?.id) ? current : [...(current ?? []), target!]
        );
      }
      const names = target.members.map((m) => m.name);
      const paying = names.includes(payer) ? payer : names[0];
      const byPerson: Record<string, string[]> = {};
      for (const name of names) byPerson[name] = [];
      for (const [itemId, owners] of Object.entries(assignments))
        for (const owner of owners) if (byPerson[owner]) byPerson[owner].push(itemId);
      await addReceiptSplit(target.id, {
        receipt_id: receipt.id,
        paid_by: paying,
        mode,
        tax_mode: taxMode,
        assignments: mode === "itemized" ? byPerson : undefined,
        parts: isPartsMode(mode)
          ? checkParts(mode, Math.round(total * 100), names, typed[mode], currency).parts
          : undefined,
        // Changing it where it's split replaces the old split.
        replace: replace || target.id === receipt.splitTab,
      });
      invalidateSplits();
      invalidateSpending();
      onSaved(`Split on ${target.name}.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = (groups ?? []).filter((g) => g.members.length > 1);
  const canSave = ready && !busy && (!partsCheck || partsCheck.ok);
  const cta = !ready
    ? "Add someone to split with"
    : editing
      ? "Save changes to this split"
      : others.length === 1
        ? `Split ${scanMoney(total, currency)} with ${others[0]}`
        : `Split ${scanMoney(total, currency)} ${others.length + 1} ways`;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-32 pt-5">
        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-semibold">People</h3>
            {tabs.length > 0 && (
              <button
                onClick={() => (tab ? setTabId(null) : setChoosingTab(true))}
                className="min-h-9 text-[12px] font-bold text-glass-pos"
              >
                {tab ? "Pick people instead" : "Use an existing tab"}
              </button>
            )}
          </div>
          {tab && (
            <p className="mt-1 text-[11px] text-glass-soft">
              {editing ? "Split" : "On"} <b>{tab.name}</b>.{" "}
              {editing
                ? "Change it here; saving replaces the old split."
                : "Everyone on the tab shares it."}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {memberNames.map((name) => {
              const friend = friends.find((p) => p.name === name);
              const pick = friend?.from_member
                ? recent.find((r) => r.ref === friend.from_member)
                : undefined;
              return (
                <div
                  key={name}
                  className="split-person flex items-center gap-3 rounded-[15px] bg-black/[0.035] p-2.5"
                >
                  <Person name={name} me={name === meOnTab} size={40} />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px]">{shownName(name)}</b>
                    <span className="block truncate text-[10px] text-glass-soft">
                      {name === meOnTab
                        ? "Receipt owner"
                        : pick
                          ? `On Cotab${last4(pick) ? ` · ••• ${last4(pick)}` : ""}`
                          : friend?.phone || friend?.email
                            ? "Gets an invite to join"
                            : tab
                              ? "On this tab"
                              : "Not on Cotab · no contact"}
                    </span>
                  </span>
                  {friend && (
                    <button
                      onClick={() =>
                        setFriends((list) => list.filter((p) => personKey(p) !== personKey(friend)))
                      }
                      aria-label={`Remove ${name}`}
                      className="grid h-9 w-9 place-items-center rounded-full text-glass-soft"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!tab && (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-black/15 text-[12px] font-bold"
            >
              <Icon name="person_add" size={17} />
              {friends.length ? "Add another person" : "Add someone"}
            </button>
          )}
        </section>

        {ready && (
          <>
            <section className="mt-6">
              <h3 className="text-[16px] font-semibold">Who paid?</h3>
              <div role="radiogroup" aria-label="Who paid" className="mt-3 flex flex-wrap gap-2">
                {memberNames.map((name) => (
                  <button
                    key={name}
                    role="radio"
                    aria-checked={payer === name}
                    onClick={() => setPaidBy(name)}
                    className={`flex min-h-10 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-bold ${payer === name ? "glass-cta text-white" : "bg-black/[0.05]"}`}
                  >
                    <Person name={name} me={name === meOnTab} size={26} />
                    {shownName(name)}
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-[16px] font-semibold">How should it split?</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {MODES.map(([key, title, icon, sub]) => (
                  <button
                    key={key}
                    aria-pressed={mode === key}
                    onClick={() => setMode(key)}
                    className={`split-mode flex items-center gap-2 rounded-[16px] border p-3 text-left ${mode === key ? "is-on border-glass-ink" : "border-black/[0.08]"}`}
                  >
                    <Icon name={icon} size={19} />
                    <span>
                      <b className="block text-[12px]">{title}</b>
                      <span className="text-[10px] text-glass-soft">{sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {mode === "itemized" && (
              <section className="mt-6">
                <div className="flex justify-between">
                  <h3 className="text-[16px] font-semibold">Who had what</h3>
                  {unassigned > 0 && (
                    <span className="text-[11px] font-bold text-glass-warn">
                      {unassigned} left to pick
                    </span>
                  )}
                </div>
                {lines.length ? (
                  <div className="mt-3 space-y-3">
                    {lines.map((line) => (
                      <div
                        key={line.id}
                        className="split-line rounded-[16px] border border-black/[0.08] p-3"
                      >
                        <div className="flex justify-between gap-3 text-[13px]">
                          <b className="min-w-0">{line.item_name || line.description}</b>
                          <b>{scanMoney(line.total_price, currency)}</b>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {memberNames.map((name) => {
                            const on = (assignments[line.id] || []).includes(name);
                            return (
                              <button
                                key={name}
                                aria-pressed={on}
                                aria-label={`${line.item_name || line.description} for ${shownName(name)}`}
                                onClick={() => toggleOwner(line.id, name)}
                                className={`min-h-9 rounded-full px-3 text-[11px] font-bold ${on ? "glass-cta text-white" : "bg-black/[0.05]"}`}
                              >
                                {shownName(name)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-[14px] bg-black/[0.035] px-4 py-3 text-[12px] text-glass-soft">
                    This receipt has no item lines. Add them with Edit receipt, or split it another
                    way.
                  </p>
                )}
                {unassigned > 0 && (
                  <p className="mt-2 text-[11px] text-glass-soft">
                    Items nobody picked go to {payer === meOnTab ? "you" : payer}.
                  </p>
                )}
              </section>
            )}

            {partsCheck && isPartsMode(mode) && (
              <section className="mt-6">
                <h3 className="text-[16px] font-semibold">
                  {mode === "exact"
                    ? "Who owes how much"
                    : mode === "percent"
                      ? "Who pays what share"
                      : "How many shares each"}
                </h3>
                <div className="mt-3 space-y-2">
                  {memberNames.map((name) => (
                    <label
                      key={name}
                      className="split-part flex items-center gap-3 rounded-[15px] bg-black/[0.035] p-2.5"
                    >
                      <Person name={name} me={name === meOnTab} size={34} />
                      <span className="flex-1 text-[13px] font-semibold">{shownName(name)}</span>
                      {mode === "exact" && <span className="text-[12px] text-glass-soft">$</span>}
                      <input
                        aria-label={`${shownName(name)}'s ${mode === "exact" ? "amount" : mode === "percent" ? "percentage" : "shares"}`}
                        inputMode={mode === "shares" ? "numeric" : "decimal"}
                        autoComplete="off"
                        placeholder="0"
                        value={shown(mode, typed[mode], name)}
                        onChange={(event) =>
                          setTyped((t) => ({
                            ...t,
                            [mode]: { ...t[mode], [name]: event.target.value },
                          }))
                        }
                        className="h-10 w-20 rounded-[11px] border border-black/10 bg-transparent px-2 text-right text-[14px] font-bold outline-none"
                      />
                      {mode !== "exact" && (
                        <span className="text-[12px] text-glass-soft">{MARK[mode]}</span>
                      )}
                    </label>
                  ))}
                </div>
                <p
                  aria-live="polite"
                  className={`mt-2 text-[11px] font-semibold ${partsCheck.ok ? "text-glass-pos" : "text-glass-warn"}`}
                >
                  {partsCheck.note}
                </p>
              </section>
            )}

            {(mode === "even" || mode === "itemized") && (
              <section className="mt-6">
                <h3 className="text-[16px] font-semibold">Tax, tip, fees and discounts</h3>
                <div
                  role="radiogroup"
                  aria-label="Tax, tip, fees and discounts"
                  className="split-tax mt-3 grid grid-cols-3 rounded-full bg-black/[0.06] p-1"
                >
                  {(
                    [
                      ["pro_rata", "By items"],
                      ["even", "Evenly"],
                      ["payer", "Payer covers"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      role="radio"
                      aria-checked={taxMode === key}
                      onClick={() => setTaxMode(key)}
                      className={`min-h-10 rounded-full text-[11px] font-bold ${taxMode === key ? "glass-surface text-glass-ink shadow-sm" : "text-glass-soft"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section
              aria-live="polite"
              className="split-preview mt-6 rounded-[18px] bg-black/[0.04] p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold">Who pays what</h3>
                {preview?.shares && (
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-glass-pos">
                    Adds to {scanMoney(total, currency)}
                  </span>
                )}
              </div>
              {preview?.shares ? (
                memberNames.map((name) => (
                  <div key={name} className="mt-3 flex items-center gap-3">
                    <Person name={name} me={name === meOnTab} size={34} />
                    <span className="flex-1 text-[13px] font-semibold">
                      {shownName(name)}
                      {name === payer && <small className="ml-2 text-glass-soft">Paid</small>}
                    </span>
                    <b>{scanMoney(preview.shares?.[name] ?? 0, preview.currency)}</b>
                  </div>
                ))
              ) : (
                <p className="mt-2 text-[12px] text-glass-soft">
                  {preview?.message || "Working out each share…"}
                </p>
              )}
            </section>
          </>
        )}

        {error && (
          <div
            role="alert"
            className="split-error mt-4 rounded-[14px] glass-tint-neg px-4 py-3 text-[12px] font-semibold text-glass-neg"
          >
            {error}
            {conflict && (
              <button
                onClick={() => submit(true)}
                className="mt-2 block min-h-10 font-bold underline underline-offset-4"
              >
                Replace the split on {tab?.name ?? "that tab"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sheet-footer fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[467px] px-5 pb-5 pt-4">
        <button
          onClick={() => submit()}
          disabled={!canSave}
          className="w-full rounded-full glass-cta py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Splitting…" : cta}
        </button>
      </div>

      {choosingTab && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Use an existing tab"
          className="app-overlay fixed inset-0 z-[60] mx-auto flex max-w-[467px] items-end bg-black/55"
        >
          <section className="ios-surface full-sheet max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-4">
            <div className="flex items-start justify-between">
              <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">Your tabs</h2>
              <button
                onClick={() => setChoosingTab(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
                aria-label="Close tabs"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="mt-4 divide-y divide-black/[0.07] rounded-[18px] border border-black/[0.08] px-3">
              {tabs.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setTabId(g.id);
                    setChoosingTab(false);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 py-3 text-left"
                >
                  <Icon name={g.kind === "direct" ? "person" : "group"} size={20} />
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px]">{g.name}</b>
                    <span className="block truncate text-[10px] text-glass-soft">
                      {g.members.map((m) => m.name).join(", ")}
                    </span>
                  </span>
                  <Icon name="chevron_right" size={18} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {adding && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add someone"
          className="app-overlay fixed inset-0 z-[60] mx-auto flex max-w-[467px] items-end bg-black/55"
        >
          <section className="ios-surface full-sheet split-add max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-4">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-black/15" />
            <div className="flex items-start justify-between">
              <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">Add someone</h2>
              <button
                onClick={() => setAdding(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
                aria-label="Close add person"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            {recent.length > 0 && (
              <>
                <p className="mt-5 text-[11px] font-bold uppercase tracking-[.14em] text-glass-soft">
                  People you split with
                </p>
                <div className="mt-2 divide-y divide-black/[0.07] rounded-[18px] border border-black/[0.08] px-3">
                  {recent.map((person) => {
                    const added = friends.some((p) => p.from_member === person.ref);
                    const twice =
                      recent.filter((r) => r.name.toLowerCase() === person.name.toLowerCase())
                        .length > 1;
                    return (
                      <button
                        key={person.ref}
                        disabled={added}
                        onClick={() => addPerson({ name: person.name, from_member: person.ref })}
                        className="flex min-h-14 w-full items-center gap-3 py-3 text-left disabled:opacity-45"
                      >
                        <Person name={person.name} size={38} />
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13px]">{person.name}</b>
                          <span className="block truncate text-[10px] text-glass-soft">
                            On Cotab{twice && last4(person) ? ` · ••• ${last4(person)}` : ""}
                          </span>
                        </span>
                        <span className="text-[11px] font-bold text-glass-pos">
                          {added ? "Added" : "Add"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="split-picker mt-6">
              <PersonPicker
                label={recent.length ? "Someone else" : "Who are you splitting with?"}
                existing={[
                  { name: myName, account: user?.id },
                  ...friends.map((p) => ({
                    name: p.name,
                    phone: p.phone,
                    email: p.email,
                    ref: p.from_member,
                  })),
                ]}
                onAdd={(person) => {
                  const known = alreadyIn(
                    friends.map((p) => ({ ...p, ref: p.from_member })),
                    { ...person, ref: person.from_member }
                  );
                  if (known) throw new Error(`${known.name} is already in this split.`);
                  addPerson(person);
                }}
                onRename={renamePerson}
              />
            </div>
          </section>
        </div>
      )}

      {clash && (
        <NameClashDialog
          name={clash.person.name}
          existing={{ name: clash.with.name }}
          taken={[myName, ...friends.map((p) => p.name)]}
          canRenameExisting={clash.with.name !== myName}
          onCancel={() => setClash(null)}
          onConfirm={(newName, existingName) => {
            carry(clash.with.name, existingName);
            setFriends((list) => [
              ...list.map((p) => (p.name === clash.with.name ? { ...p, name: existingName } : p)),
              { ...clash.person, name: newName },
            ]);
            setClash(null);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
