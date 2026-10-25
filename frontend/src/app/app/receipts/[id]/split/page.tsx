"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { NameClashDialog } from "@/components/NameClashDialog";
import { PersonPicker, last4, type InSplit } from "@/components/PersonPicker";
import { CatAvatar } from "@/components/Tabby";
import { Button, ErrorNote, Icon, PageHeader, PageSkeleton, fieldClass } from "@/components/ui";
import {
  addReceiptSplit,
  createDirectSplit,
  createSplitGroup,
  getReceipt,
  getSplitSummary,
  getSplitSuggestions,
  listSplitGroups,
  me,
  previewSplit,
  type Receipt,
  type SplitGroup,
  type SplitMemberInput,
  type SplitMode,
  type SplitPreview,
  type SplitSuggestions,
  type User,
} from "@/lib/api";
import { invalidateSplits, usePeople } from "@/lib/data";
import { myNameOn } from "@/lib/people";
import { categoryStyle, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";
import { checkParts, isPartsMode, shown, typedFrom, type PartsMode } from "@/lib/splitParts";
import { friendTabby, userTabby } from "@/lib/tabby";

type With = "friend" | "group";
type TaxMode = "pro_rata" | "even" | "payer";

const partsUnit: Record<PartsMode, { title: string; label: string; mark: string }> = {
  exact: { title: "Who owes how much", label: "exact amounts", mark: "$" },
  percent: { title: "Who pays what share", label: "percentages", mark: "%" },
  shares: { title: "How many shares each", label: "shares", mark: "×" },
};

const card = "rounded-card bg-card p-5";
const h2 = "text-lg font-extrabold tracking-[-0.02em]";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<[T, string, string?]>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-paper p-1">
      {options.map(([key, text, icon]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-bold transition ${
            value === key
              ? "bg-card text-ink shadow-[0_2px_8px_-2px_rgb(12_17_14/0.15)]"
              : "text-faint"
          }`}
        >
          {icon && <Icon name={icon} size={18} fill={value === key} />}
          {text}
        </button>
      ))}
    </div>
  );
}

export default function SplitReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [suggestions, setSuggestions] = useState<SplitSuggestions | null>(null);
  const [withWhom, setWithWhom] = useState<With>("friend");
  const [friends, setFriends] = useState<SplitMemberInput[]>([]);
  const [groupId, setGroupId] = useState<string>("new");
  const [groupName, setGroupName] = useState("");
  const [groupPeople, setGroupPeople] = useState<SplitMemberInput[]>([]);
  const [myName, setMyName] = useState("Me");
  const [mode, setMode] = useState<SplitMode>("even");
  // What's typed for exact / percent / shares, per mode, by person.
  const [typed, setTyped] = useState<Record<PartsMode, Record<string, string>>>({
    exact: {},
    percent: {},
    shares: {},
  });
  const [taxMode, setTaxMode] = useState<TaxMode>("pro_rata");
  const [paidBy, setPaidBy] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  // Editing this receipt's split on that tab (?tab=), from the tab's page.
  const [redo, setRedo] = useState<string | null>(null);
  // Picked from the row, but someone with that name is already in.
  const [clash, setClash] = useState<{
    person: SplitMemberInput;
    with: SplitMemberInput;
  } | null>(null);
  const { data: people } = usePeople();

  useEffect(() => {
    Promise.all([getReceipt(id), listSplitGroups(), getSplitSuggestions(id), me()])
      .then(([r, g, s, u]) => {
        setReceipt(r);
        setGroups(g);
        setSuggestions(s);
        setUser(u);
        const mine = u.full_name || u.email.split("@")[0];
        setMyName(mine);
        setPaidBy(mine);
        if (s.auto_apply && s.suggested_people.length) {
          setFriends(s.suggested_people.map((p) => ({ name: p.name, email: p.email || "" })));
          setAssignments(s.assignments);
        }
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (!tab || !g.some((x) => x.id === tab)) return;
        setRedo(tab);
        setWithWhom("group");
        setGroupId(tab);
        // Start from how it was split, item picks included.
        return getSplitSummary(tab).then((sum) => {
          const old = sum.splits.find((x) => x.receipt_id === r.id);
          if (!old) return;
          setPaidBy(old.paid_by);
          const oldMode = old.mode as SplitMode;
          setMode(oldMode);
          if (isPartsMode(oldMode)) setTyped((t) => ({ ...t, [oldMode]: typedFrom(old.parts) }));
          setTaxMode(old.tax_mode as TaxMode);
          const byItem: Record<string, string[]> = {};
          for (const [person, itemIds] of Object.entries(old.items ?? {}))
            for (const itemId of itemIds) (byItem[itemId] ??= []).push(person);
          setAssignments(byItem);
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const namedGroups = groups.filter((g) => g.kind !== "direct" || g.id === redo);
  const selectedGroup = withWhom === "group" ? groups.find((g) => g.id === groupId) : undefined;
  const picked = withWhom === "friend" ? friends : selectedGroup ? [] : groupPeople;
  // You on this tab, found by account: the tab may call you something else.
  const meOnTab = myNameOn(selectedGroup?.members, user?.id, myName);
  const memberNames = selectedGroup
    ? selectedGroup.members.map((m) => m.name)
    : [myName, ...picked.map((p) => p.name).filter(Boolean)];
  const others = memberNames.filter((n) => n !== meOnTab);

  // People you split with who are on Cotab, as one-tap chips: each adds
  // that exact person (`from_member`), linked to their account.
  const recent = useMemo(() => (people ?? []).slice(0, 12), [people]);
  // Two Bens in the row each show the end of their number.
  const twice = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of recent)
      count.set(p.name.toLowerCase(), (count.get(p.name.toLowerCase()) ?? 0) + 1);
    return (name: string) => (count.get(name.toLowerCase()) ?? 0) > 1;
  }, [recent]);

  // Who paid: your pick while they're on the split, else you, else the first.
  const payer = memberNames.includes(paidBy)
    ? paidBy
    : memberNames.includes(meOnTab)
      ? meOnTab
      : (memberNames[0] ?? "");

  // Do the typed amounts, percentages or shares add up?
  const partsCheck = isPartsMode(mode)
    ? checkParts(
        mode,
        Math.round((receipt?.total ?? 0) * 100),
        memberNames,
        typed[mode],
        receipt?.currency
      )
    : null;

  // Each person's exact share from the server as the choices change.
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
    if (!receipt || memberNames.length < 2 || !payer || unreadable) {
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
        receipt_id: receipt.id,
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
  }, [receipt, previewKey]);

  const avatar = (name: string) => (name === meOnTab && user ? userTabby(user) : friendTabby(name));

  // One number is one person: someone picked from your people is matched by
  // who they are (`from_member`), not by name, so two Bens can both be in.
  const personKey = (p: SplitMemberInput) => p.from_member || p.name.toLowerCase();

  function togglePerson(person: SplitMemberInput) {
    const list = withWhom === "friend" ? friends : groupPeople;
    const set = withWhom === "friend" ? setFriends : setGroupPeople;
    const key = personKey(person);
    if (list.some((p) => personKey(p) === key)) {
      set(list.filter((p) => personKey(p) !== key));
      return;
    }
    // A different person with a name already here: ask for two names first.
    const namesake = [{ name: myName }, ...list].find(
      (p) => p.name.trim().toLowerCase() === person.name.trim().toLowerCase()
    );
    if (namesake) {
      setClash({ person, with: namesake });
      return;
    }
    set([...list, person]);
  }

  /** Items already given to someone follow them when they're renamed. */
  function carryAssignments(from: string, to: string) {
    if (from === to) return;
    setAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([item, names]) => [
          item,
          names.map((n) => (n === from ? to : n)),
        ])
      )
    );
  }

  /** Rename someone in the split being built (never yourself: that's Settings). */
  function renamePerson(who: InSplit, name: string) {
    if (who.name === meOnTab) throw new Error("Change your own name in Settings.");
    carryAssignments(who.name, name);
    setTyped((t) => {
      const carry = (typedBy: Record<string, string>) =>
        Object.fromEntries(Object.entries(typedBy).map(([n, v]) => [n === who.name ? name : n, v]));
      return { exact: carry(t.exact), percent: carry(t.percent), shares: carry(t.shares) };
    });
    const set = withWhom === "friend" ? setFriends : setGroupPeople;
    set((list) =>
      list.map((p) =>
        (who.ref ? p.from_member === who.ref : p.name === who.name) ? { ...p, name } : p
      )
    );
  }

  function toggleItem(itemId: string, person: string) {
    setAssignments((current) => {
      const names = new Set(current[itemId] || []);
      if (names.has(person)) names.delete(person);
      else names.add(person);
      return { ...current, [itemId]: Array.from(names) };
    });
  }

  async function submit() {
    if (!receipt) return;
    setBusy(true);
    setError("");
    try {
      let target = selectedGroup;
      if (!target) {
        const people = picked.filter((p) => p.name.trim());
        if (!people.length) throw new Error("Add who you're splitting with.");
        target =
          withWhom === "friend"
            ? await createDirectSplit({ my_name: myName, members: people })
            : await createSplitGroup({
                name: groupName.trim() || `${receipt.merchant || "Receipt"} split`,
                my_name: myName,
                members: people,
              });
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
          ? checkParts(mode, Math.round(receipt.total * 100), names, typed[mode], receipt.currency)
              .parts
          : undefined,
        replace: target.id === redo,
      });
      invalidateSplits();
      router.push(routes.group(target.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!receipt) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        {error ? <ErrorNote>{error}</ErrorNote> : <PageSkeleton rows={4} />}
      </main>
    );
  }

  const lines = receipt.line_items || [];
  const style = categoryStyle(receipt.category);
  const each = memberNames.length > 1 ? receipt.total / memberNames.length : 0;
  const unassigned =
    mode === "itemized" ? lines.filter((item) => !(assignments[item.id] || []).length).length : 0;
  const ready = memberNames.length > 1;
  const peopleList = withWhom === "friend" ? friends : groupPeople;
  // People typed in by hand get a chip; ones picked from the row are ticked there.
  const extraPeople = peopleList.filter(
    (p) => !p.from_member || !recent.some((r) => r.ref === p.from_member)
  );
  const cta = !ready
    ? "Add someone to split with"
    : others.length === 1
      ? `Split ${money(receipt.total, receipt.currency)} with ${others[0]}`
      : `Split ${money(receipt.total, receipt.currency)} ${others.length + 1} ways`;

  const personPicker = (
    <>
      {recent.length > 0 && (
        <>
          <p className="mt-4 text-[13px] font-bold text-muted">People you split with</p>
          <div className="-mx-5 mt-2 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {recent.map((person) => {
              const on = peopleList.some((p) => p.from_member === person.ref);
              return (
                <button
                  key={person.ref}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePerson({ name: person.name, from_member: person.ref })}
                  className="w-[62px] flex-none text-center"
                >
                  <span className={`relative block rounded-full p-[3px] ${on ? "bg-forest" : ""}`}>
                    <CatAvatar choice={avatar(person.name)} size={52} soft />
                    {on && (
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-card bg-gold text-forest">
                        <Icon name="check" size={13} />
                      </span>
                    )}
                  </span>
                  <span
                    className={`mt-1.5 block truncate text-[12px] ${on ? "font-extrabold" : "font-semibold text-muted"}`}
                  >
                    {person.name}
                  </span>
                  {twice(person.name) && (
                    <span className="block text-[11px] font-semibold text-faint">
                      {last4(person)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="mt-4">
        <PersonPicker
          label={recent.length ? "Someone else" : "Who are you splitting with?"}
          existing={[
            { name: myName },
            ...peopleList.map((p) => ({
              name: p.name,
              phone: p.phone,
              email: p.email,
              ref: p.from_member,
            })),
          ]}
          onAdd={(person) => {
            if (person.name.trim().toLowerCase() === myName.toLowerCase())
              throw new Error("That's you. Add who you're splitting with.");
            togglePerson(person);
            setError("");
          }}
          onRename={renamePerson}
        />
      </div>
      {clash && (
        <NameClashDialog
          name={clash.person.name}
          existing={{ name: clash.with.name }}
          taken={[myName, ...peopleList.map((p) => p.name)]}
          canRenameExisting={clash.with.name !== myName}
          onCancel={() => setClash(null)}
          onConfirm={(newName, existingName) => {
            carryAssignments(clash.with.name, existingName);
            const set = withWhom === "friend" ? setFriends : setGroupPeople;
            set((list) => [
              ...list.map((p) =>
                personKey(p) === personKey(clash.with) ? { ...p, name: existingName } : p
              ),
              { ...clash.person, name: newName },
            ]);
            setClash(null);
          }}
        />
      )}
      {extraPeople.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {extraPeople.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1.5 rounded-full bg-paper py-1 pl-1 pr-1.5 text-sm font-bold"
            >
              <CatAvatar choice={avatar(p.name)} size={26} />
              {p.name}
              <button
                type="button"
                onClick={() => togglePerson(p)}
                aria-label={`Remove ${p.name}`}
                className="grid h-6 w-6 place-items-center rounded-full text-faint hover:bg-ink/10"
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );

  return (
    <main className="mx-auto max-w-2xl px-5 pb-36 pt-6 md:px-8 md:pb-12 md:pt-10">
      <PageHeader
        title={`Split ${receipt.merchant || "this"}`}
        back={{ href: routes.receipt(id), label: "Receipt" }}
      />

      <section className="relative -mt-2 overflow-hidden rounded-[28px] bg-forest px-5 py-5 text-[#F3F6F1]">
        <span
          aria-hidden="true"
          className="absolute -right-[60px] -top-[90px] h-[300px] w-[220px] rotate-[32deg] bg-gradient-to-b from-white/[0.07] to-white/0"
        />
        <div className="relative flex items-center gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px]"
            style={{ background: style.tile, color: style.ink }}
          >
            <Icon name={style.icon} fill size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{receipt.merchant || "Receipt"}</p>
            <p className="text-[13px] text-[#F3F6F1]/60">
              {dayLabel(receipt.purchased_at)} · {lines.length} item{lines.length === 1 ? "" : "s"}
            </p>
          </div>
          <p className="text-[28px] font-extrabold tracking-[-0.04em]">
            {money(receipt.total, receipt.currency)}
          </p>
        </div>
        <div className="relative mt-4 flex items-center gap-2">
          <span className="flex -space-x-2">
            {memberNames.slice(0, 5).map((name) => (
              <CatAvatar key={name} choice={avatar(name)} size={30} ring="#0F3D31" />
            ))}
          </span>
          <p className="text-[13px] font-semibold text-[#F3F6F1]/75">
            {ready
              ? mode === "even"
                ? `${money(each, receipt.currency)} each, every cent accounted for`
                : mode === "itemized"
                  ? "Split by what each person had"
                  : `Split by ${partsUnit[mode].label}`
              : "Who are you splitting with?"}
          </p>
        </div>
      </section>

      {suggestions && suggestions.merchant_history_count > 0 && suggestions.auto_apply && (
        <p className="mt-4 flex items-center gap-2 rounded-tile bg-mint px-4 py-3 text-sm font-semibold text-good">
          <Icon name="history" size={18} />
          Same people as your last {receipt.merchant} split. Change them below.
        </p>
      )}

      <section className={`${card} mt-4`}>
        <h2 className={h2}>Split with</h2>
        <div className="mt-3">
          <Segmented
            label="Split with"
            value={withWhom}
            onChange={setWithWhom}
            options={[
              ["friend", "Friends", "person"],
              ["group", "A group", "group"],
            ]}
          />
        </div>
        {withWhom === "friend" ? (
          <>
            <p className="mt-3 text-[13px] text-faint">
              No group needed. Splitting with the same people again keeps one running total.
            </p>
            {personPicker}
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {namedGroups.map((group) => {
                const on = groupId === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setGroupId(group.id)}
                    className={`flex items-center gap-3 rounded-[18px] border-2 p-3 text-left transition ${
                      on ? "border-forest bg-mint/50" : "border-transparent bg-paper"
                    }`}
                  >
                    <span className="flex -space-x-2.5">
                      {group.members.slice(0, 3).map((m) => (
                        <CatAvatar key={m.id} choice={avatar(m.name)} size={30} ring="#FFFFFF" />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{group.name}</span>
                      <span className="block truncate text-[12px] text-faint">
                        {group.members.map((m) => m.name).join(", ")}
                      </span>
                    </span>
                    {on && <Icon name="check_circle" fill size={22} className="text-forest" />}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={groupId === "new"}
                onClick={() => setGroupId("new")}
                className={`flex items-center gap-3 rounded-[18px] border-2 p-3 text-left ${
                  groupId === "new" ? "border-forest bg-mint/50" : "border-dashed border-[#B9C0BB]"
                }`}
              >
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-forest text-gold">
                  <Icon name="add" size={20} />
                </span>
                <span className="text-[15px] font-bold">New group</span>
              </button>
            </div>
            {groupId === "new" && (
              <>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name, e.g. Apartment 4B"
                  aria-label="Group name"
                  className={`${fieldClass} mt-4`}
                />
                {personPicker}
              </>
            )}
          </>
        )}
      </section>

      {ready && (
        <section className={`${card} mt-4`}>
          <h2 className={h2}>Who paid?</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Paid by">
            {memberNames.map((name) => {
              const on = payer === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPaidBy(name)}
                  className={`inline-flex items-center gap-2 rounded-full border-2 py-1 pl-1 pr-3.5 text-sm font-bold transition ${
                    on ? "border-forest bg-forest text-paper" : "border-transparent bg-paper"
                  }`}
                >
                  <CatAvatar choice={avatar(name)} size={30} />
                  {name === meOnTab ? "You" : name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {ready && (
        <section className={`${card} mt-4`}>
          <h2 className={h2}>How</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ["even", "Evenly", "drag_handle", `${money(each, receipt.currency)} each`],
                ["itemized", "By item", "checklist", "Pick who had what"],
                ["exact", "Exact amounts", "payments", "Type what each owes"],
                ["percent", "Percentages", "percent", "Share it by percent"],
                ["shares", "Shares", "pie_chart", "Like 2 : 1 : 1"],
              ] as const
            ).map(([key, title, icon, sub]) => {
              const on = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMode(key)}
                  className={`flex flex-col items-start gap-2 rounded-[18px] border-2 p-3.5 text-left transition ${
                    on ? "border-forest bg-gold/40" : "border-transparent bg-paper"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-[12px] ${on ? "bg-forest text-gold" : "bg-card text-ink"}`}
                  >
                    <Icon name={icon} size={20} />
                  </span>
                  <span>
                    <span className="block text-[15px] font-extrabold">{title}</span>
                    <span className="block text-[12px] font-semibold text-muted">{sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!partsCheck && (
            <>
              <p className="mt-4 text-[13px] font-bold text-muted">Tax and tip</p>
              <div className="mt-2">
                <Segmented
                  label="Tax and tip"
                  value={taxMode}
                  onChange={setTaxMode}
                  options={[
                    ["pro_rata", "By items"],
                    ["even", "Evenly"],
                    ["payer", "Payer covers"],
                  ]}
                />
              </div>
            </>
          )}
        </section>
      )}

      {ready && mode === "itemized" && (
        <section className={`${card} mt-4`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={h2}>Who had what</h2>
            {unassigned > 0 && (
              <span className="text-[12px] font-bold text-[#8A5A00]">
                {unassigned} left to pick
              </span>
            )}
          </div>
          <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {memberNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  const next: Record<string, string[]> = {};
                  for (const item of lines) next[item.id] = [name];
                  setAssignments(next);
                }}
                className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-[12px] font-bold"
              >
                All to {name === meOnTab ? "you" : name}
              </button>
            ))}
          </div>
          {lines.length ? (
            <ul className="mt-2">
              {lines.map((item, i) => (
                <li key={item.id} className={`py-3 ${i ? "border-t border-line" : ""}`}>
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-[15px] font-semibold">
                      {item.item_name || item.description || "Item"}
                    </span>
                    <span className="text-[15px] font-bold">
                      {money(item.total_price, receipt.currency)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {memberNames.map((name) => {
                      const on = (assignments[item.id] || []).includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${item.description} for ${name}`}
                          onClick={() => toggleItem(item.id, name)}
                          className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[12px] font-bold transition ${
                            on ? "bg-forest text-paper" : "bg-paper text-muted"
                          }`}
                        >
                          <CatAvatar choice={avatar(name)} size={22} />
                          {name === meOnTab ? "You" : name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-tile bg-paper px-4 py-4 text-sm text-muted">
              This receipt has no item lines. Add them with Edit on the receipt, or split it evenly.
            </p>
          )}
        </section>
      )}

      {ready && isPartsMode(mode) && partsCheck && (
        <section className={`${card} mt-4`}>
          <h2 className={h2}>{partsUnit[mode].title}</h2>
          <ul className="mt-2">
            {memberNames.map((name, i) => (
              <li
                key={name}
                className={`flex items-center gap-3 py-2.5 ${i ? "border-t border-line" : ""}`}
              >
                <CatAvatar choice={avatar(name)} size={36} soft />
                <label
                  htmlFor={`part-${name}`}
                  className="min-w-0 flex-1 truncate text-[15px] font-bold"
                >
                  {name === meOnTab ? "You" : name}
                </label>
                <span className="flex w-32 items-center gap-2">
                  {mode === "exact" && (
                    <span className="font-bold text-muted">{partsUnit[mode].mark}</span>
                  )}
                  <input
                    id={`part-${name}`}
                    inputMode={mode === "shares" ? "numeric" : "decimal"}
                    autoComplete="off"
                    placeholder="0"
                    value={shown(mode, typed[mode], name)}
                    onChange={(e) =>
                      setTyped((t) => ({ ...t, [mode]: { ...t[mode], [name]: e.target.value } }))
                    }
                    className={`${fieldClass} text-right`}
                  />
                  {mode !== "exact" && (
                    <span className="font-bold text-muted">{partsUnit[mode].mark}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p
            aria-live="polite"
            className={`mt-2 text-[13px] font-bold ${partsCheck.ok ? "text-good" : "text-[#8A5A00]"}`}
          >
            {partsCheck.note}
          </p>
        </section>
      )}

      {preview && !preview.shares && preview.message && !partsCheck?.note.startsWith("Use ") && (
        <p className="mt-4 rounded-tile bg-paper px-4 py-3 text-sm font-semibold text-muted">
          {preview.message}
        </p>
      )}

      {preview?.shares && (
        <section className={`${card} mt-4`} aria-live="polite">
          <h2 className={h2}>Who pays what</h2>
          <ul className="mt-2">
            {memberNames.map((name, i) => {
              const share = preview.shares?.[name] ?? 0;
              return (
                <li key={name} className={`py-2.5 ${i ? "border-t border-line" : ""}`}>
                  <div className="flex items-center gap-3">
                    <CatAvatar choice={avatar(name)} size={36} soft />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">
                        {name === meOnTab ? "You" : name}
                      </span>
                      {name === payer && (
                        <span className="block text-[12px] font-semibold text-faint">
                          Paid the bill
                        </span>
                      )}
                    </span>
                    <span className="text-[16px] font-extrabold">
                      {money(share, preview.currency)}
                    </span>
                  </div>
                  <div className="ml-12 mt-1.5 h-1.5 rounded-full bg-ink/[0.06]">
                    <span
                      className="bar-fill block h-full rounded-full bg-forest"
                      style={{
                        width: `${receipt.total ? Math.min(100, (share / receipt.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[12px] font-semibold text-faint">
            {!partsCheck && Math.abs(preview.extra) >= 0.01
              ? `Includes ${money(Math.abs(preview.extra), preview.currency)} of ${
                  preview.extra > 0 ? "tax, tip and fees" : "discounts"
                }, ${
                  taxMode === "pro_rata"
                    ? "shared by what each person had"
                    : taxMode === "even"
                      ? "split evenly"
                      : `covered by ${payer === meOnTab ? "you" : payer}`
                }.`
              : "Adds up to the receipt total."}
            {unassigned > 0 &&
              ` ${unassigned} item${unassigned === 1 ? "" : "s"} not picked yet go${
                unassigned === 1 ? "es" : ""
              } to ${payer === meOnTab ? "you" : payer}.`}
          </p>
        </section>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[96px] z-20 px-5 md:static md:mt-6 md:px-0">
        <div className="mx-auto max-w-2xl">
          <Button
            onClick={submit}
            disabled={busy || !ready || (partsCheck !== null && !partsCheck.ok)}
            className="w-full shadow-[0_18px_30px_-12px_rgb(15_61_49/0.7)]"
          >
            <Icon name="call_split" size={20} />
            {busy ? "Splitting…" : cta}
          </Button>
        </div>
      </div>
    </main>
  );
}
