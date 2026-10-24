"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { NameClashDialog } from "@/components/NameClashDialog";
import { CatAvatar } from "@/components/Tabby";
import { Icon, fieldClass } from "@/components/ui";
import { checkNumber, type NumberCheck, type Person } from "@/lib/api";
import { usePeople } from "@/lib/data";
import { formatUsPhone, looksComplete, prettyPhone } from "@/lib/phone";
import { friendTabby } from "@/lib/tabby";

/** Someone already in the split being built or viewed. */
export interface InSplit {
  name: string;
  phone?: string | null;
  email?: string | null;
  ref?: string | null;
  /** Their Cotab account, when known. */
  account?: string | null;
}

export interface Picked {
  name: string;
  phone?: string;
  email?: string;
  from_member?: string;
}

const digits = (phone?: string | null) => (phone ?? "").replace(/\D/g, "").slice(-10);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What's being typed: a mobile number, an email, or a name to search for. */
export function kindOf(text: string): "phone" | "email" | "name" {
  const t = text.trim();
  if (t.includes("@")) return "email";
  if (/^[\d\s()+.-]+$/.test(t) && t.replace(/\D/g, "").length >= 3) return "phone";
  return "name";
}

/** The one line that tells two people with the same name apart. */
export function personDetail(person: Person): string {
  if (person.phone) return prettyPhone(person.phone);
  if (person.hint) return `Number ending ${person.hint.replace(/\D/g, "")}`;
  return "On Cotab";
}

function Badge() {
  return (
    <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-bold text-good">
      On Cotab
    </span>
  );
}

/**
 * Who in the split this person already is, if anyone. A number (or email) is
 * one identity: the same account, pick, number or email is the same person,
 * whatever the name. A name alone only clashes when there's nothing else.
 */
export function alreadyIn(
  existing: InSplit[],
  person: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    ref?: string | null;
    account?: string | null;
  }
): InSplit | undefined {
  const number = digits(person.phone).length === 10 ? digits(person.phone) : "";
  const email = (person.email ?? "").trim().toLowerCase();
  const identified = Boolean(person.account || person.ref || number || email);
  return existing.find(
    (e) =>
      (person.account && e.account === person.account) ||
      (person.ref && e.ref === person.ref) ||
      (number && digits(e.phone) === number) ||
      (email && (e.email ?? "").trim().toLowerCase() === email) ||
      (!identified && person.name && same(e.name, person.name))
  );
}

/** The last four digits that tell this person apart (in the list, never in
 *  their name). */
export function last4(person: { phone?: string | null; hint?: string | null }): string {
  return digits(person.phone || person.hint).slice(-4);
}

/**
 * "Add someone": type their mobile number or email and Cotab finds who signed
 * up with it, under the name they gave. Nobody there yet: name them, add them,
 * and send them the invite link. Typing a name searches the people on Cotab
 * you've split with. Someone already in the split can't be added twice.
 */
export function PersonPicker({
  existing,
  onAdd,
  busy = false,
  label = "Add someone",
  onRename,
}: {
  existing: InSplit[];
  onAdd: (person: Picked) => unknown;
  busy?: boolean;
  label?: string;
  /** Rename someone already in the split, when a second person with their
   *  name is added. Without it, only the newcomer can be renamed. */
  onRename?: (who: InSplit, name: string) => unknown;
}) {
  const { data: people } = usePeople();
  const [text, setText] = useState("");
  // What to call someone who isn't on Cotab yet.
  const [newName, setNewName] = useState("");
  const [picked, setPicked] = useState<Person | null>(null);
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<NumberCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState("");
  // A different person whose name is already in the split: ask for names.
  const [naming, setNaming] = useState<InSplit | null>(null);
  const listId = useId();

  const kind = kindOf(text);
  const complete =
    kind === "phone" ? looksComplete(text) : kind === "email" ? EMAIL.test(text.trim()) : false;
  const query = kind === "name" ? text.trim().toLowerCase() : "";
  const matches = useMemo(
    () =>
      query && !picked
        ? (people ?? []).filter((p) => p.name.toLowerCase().includes(query)).slice(0, 6)
        : [],
    [people, query, picked]
  );

  // Who is this number or email on Cotab? Asked once it's complete.
  useEffect(() => {
    setCheck(null);
    setChecking(false);
    if (picked || !complete) return;
    let stale = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      checkNumber(text.trim())
        .then((result) => !stale && setCheck(result))
        .catch((e) => !stale && setFailed((e as Error).message))
        .finally(() => !stale && setChecking(false));
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [text, complete, picked]);

  const contact: { phone?: string; email?: string } =
    kind === "phone" && complete
      ? { phone: text.trim() }
      : kind === "email" && complete
        ? { email: text.trim() }
        : {};
  const found = check?.on_cotab && !check.you ? check : null;
  // The name they'll have: theirs on Cotab, the one you give a newcomer, or
  // the one from your list.
  const name = picked ? picked.name : found ? found.name || "" : newName.trim();
  const clash = picked
    ? alreadyIn(existing, picked)
    : check
      ? alreadyIn(existing, { ...contact, account: check.account })
      : undefined;
  const warning = clash
    ? `${clash.name} is already in this split.`
    : check?.you
      ? `That's your own ${kind === "email" ? "email" : "number"}.`
      : failed;
  const ready = !warning && !busy && (picked ? true : Boolean(check && !check.you && name));
  // Same name, but a different person: they'll need different names.
  const namesake = clash || !name ? undefined : existing.find((e) => same(e.name, name));

  function choose(person: Person) {
    setFailed("");
    setPicked(person);
    setText(person.name);
    setOpen(false);
  }

  function reset() {
    setFailed("");
    setPicked(null);
    setText("");
    setNewName("");
    setCheck(null);
  }

  const person = (as: string): Picked =>
    picked ? { name: as, from_member: picked.ref } : { name: as, ...contact };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    if (namesake) {
      setNaming(namesake);
      return;
    }
    try {
      await onAdd(person(name));
      reset();
    } catch (e) {
      // e.g. "Ben is already in this split." from the server; keep what was typed.
      setFailed((e as Error).message);
    }
  }

  /** Both names chosen in the dialog: rename the one already here, then add. */
  async function confirmNames(chosen: string, existingName: string) {
    if (naming && onRename && existingName !== naming.name) await onRename(naming, existingName);
    await onAdd(person(chosen));
    setNaming(null);
    reset();
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <span className="text-[13px] font-bold text-muted">{label}</span>
        {picked ? (
          <div className="flex min-h-12 items-center gap-3 rounded-tile border border-ink/10 bg-card px-3">
            <CatAvatar choice={friendTabby(picked.name)} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">{picked.name}</span>
              <span className="block text-[12px] text-faint">{personDetail(picked)}. On Cotab</span>
            </span>
            <button
              type="button"
              onClick={reset}
              aria-label={`Not ${picked.name}`}
              className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-ink/10"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={text}
              onChange={(e) => {
                const value = e.target.value;
                setText(kindOf(value) === "phone" ? formatUsPhone(value) : value);
                setNewName("");
                setFailed("");
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              placeholder="Mobile number, email or name"
              aria-label="Their mobile number, email or name"
              role="combobox"
              aria-expanded={open && matches.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              autoComplete="off"
              inputMode={kind === "phone" ? "tel" : kind === "email" ? "email" : "text"}
              className={fieldClass}
            />
            {open && matches.length > 0 && (
              <ul
                id={listId}
                role="listbox"
                aria-label="People on Cotab you've split with"
                className="absolute inset-x-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-tile border border-ink/10 bg-card shadow-[0_18px_30px_-18px_rgb(12_17_14/0.45)]"
              >
                {matches.map((p) => {
                  const inSplit = alreadyIn(existing, p);
                  return (
                    <li
                      key={p.ref}
                      role="option"
                      aria-selected={false}
                      aria-disabled={Boolean(inSplit)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => !inSplit && choose(p)}
                      className={`flex min-h-12 items-center gap-3 px-3 py-2 ${
                        inSplit ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-paper"
                      }`}
                    >
                      <CatAvatar choice={friendTabby(p.name)} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold">{p.name}</span>
                        <span className="block text-[12px] text-faint">
                          {inSplit ? "Already in this split" : personDetail(p)}
                        </span>
                      </span>
                      {!inSplit && <Badge />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {!picked && kind === "name" && query && matches.length === 0 && (
          <p className="text-[13px] text-muted">
            No one called {text.trim()} among your people on Cotab. Type their mobile number or
            email to find them.
          </p>
        )}
        {!picked && kind !== "name" && !complete && text.trim() && (
          <p className="text-[13px] text-faint">
            {kind === "phone" ? "Keep typing their number…" : "Keep typing their email…"}
          </p>
        )}
        {checking && <p className="text-[13px] text-faint">Looking them up…</p>}

        {found && !clash && (
          <div className="flex min-h-12 items-center gap-3 rounded-tile bg-mint/60 px-3 py-2">
            <CatAvatar choice={friendTabby(found.name || "?")} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">
                {found.name || "Someone"}
              </span>
              <span className="block text-[12px] text-good">
                On Cotab. They&apos;ll be added right away.
              </span>
            </span>
          </div>
        )}
        {check && !check.on_cotab && !clash && (
          <>
            <p role="status" className="text-[13px] font-semibold text-muted">
              No one on Cotab with this {kind === "email" ? "email" : "number"} yet. Add them, then
              send them the invite link to sign up.
            </p>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setFailed("");
              }}
              placeholder="What should we call them?"
              aria-label="What to call them"
              className={fieldClass}
              autoFocus
            />
          </>
        )}

        {warning && (
          <p role="alert" className="text-[13px] font-semibold text-rose">
            {warning}
          </p>
        )}
        <button
          type="submit"
          disabled={!ready}
          className="press min-h-11 self-start rounded-full bg-forest px-5 text-sm font-bold text-gold disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
      {naming && (
        <NameClashDialog
          name={name}
          existing={{
            name: naming.name,
            detail: naming.phone
              ? prettyPhone(naming.phone)
              : naming.email
                ? naming.email
                : naming.account
                  ? "on Cotab"
                  : undefined,
          }}
          taken={existing.map((e) => e.name)}
          suggestion={null}
          canRenameExisting={Boolean(onRename)}
          onConfirm={confirmNames}
          onCancel={() => setNaming(null)}
        />
      )}
    </>
  );
}
