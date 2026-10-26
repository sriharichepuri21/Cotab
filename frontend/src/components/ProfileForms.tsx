"use client";

/* Profile pieces shared by Settings and the app's Profile screen: your name,
   mobile number and Tabby. */

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { CatAvatar } from "@/components/Tabby";
import { Button, buttonClass, Field, fieldClass, Icon } from "@/components/ui";
import {
  ApiError,
  deleteAccount,
  requestExport,
  sendDeleteCode,
  setPhone,
  updateProfile,
  type ExportResult,
  type ProfileUpdate,
  type User,
} from "@/lib/api";
import { mutate, peek } from "@/lib/cache";
import { keys, useMe } from "@/lib/data";
import { formatUsPhone, looksComplete, prettyPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { LOOKS, MOODS, userTabby } from "@/lib/tabby";

export function Group({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-6">
      <h2 className="mb-2.5 px-1 text-[15px] font-extrabold text-muted">{title}</h2>
      <div className="rounded-card bg-card p-5">{children}</div>
    </section>
  );
}

/** Save one profile change: shown at once, put back if the server says no. */
export async function saveProfile(change: ProfileUpdate) {
  const before = peek<User>(keys.me);
  if (before) mutate<User>(keys.me, { ...before, ...change });
  try {
    mutate<User>(keys.me, await updateProfile(change));
  } catch (e) {
    if (before) mutate<User>(keys.me, before);
    throw e;
  }
}

export function TabbyPicker() {
  const { data: user } = useMe();
  const choice = userTabby(user);
  const reacts = user?.tabby_reacts ?? true;
  const [error, setError] = useState("");
  const save = (change: ProfileUpdate) => {
    setError("");
    saveProfile(change).catch((e) => setError((e as Error).message));
  };

  return (
    <Group title="Your Tabby">
      <p className="text-sm text-muted">
        Pick the Tabby that shows up as you: on Home, on shared tabs and next to your splits.
      </p>

      <div
        role="radiogroup"
        aria-label="Outfit"
        className="mt-4 grid grid-cols-3 gap-1 rounded-full bg-paper p-1"
      >
        {LOOKS.map((look) => (
          <button
            key={look.id}
            type="button"
            role="radio"
            aria-checked={choice.look === look.id}
            onClick={() => save({ avatar_look: look.id, avatar_mood: choice.mood })}
            className={`h-10 rounded-full text-sm font-bold ${
              choice.look === look.id
                ? "bg-card text-ink shadow-[0_2px_8px_-2px_rgb(12_17_14/0.15)]"
                : "text-faint"
            }`}
          >
            {look.label}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Profile picture" className="mt-4 grid grid-cols-5 gap-2.5">
        {MOODS.map((mood) => {
          const on = choice.mood === mood.id;
          return (
            <button
              key={mood.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={mood.label}
              title={mood.label}
              onClick={() => save({ avatar_mood: mood.id, avatar_look: choice.look })}
              className={`press relative rounded-full p-[3px] ${on ? "bg-forest" : ""}`}
            >
              <CatAvatar
                choice={{ look: choice.look, mood: mood.id, bg: choice.bg }}
                size={56}
                className="!h-auto !w-full aspect-square"
              />
              {on && (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-card bg-gold text-forest">
                  <Icon name="check" size={13} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-[15px] font-bold">Background</span>
        <div
          role="radiogroup"
          aria-label="Background"
          className="flex gap-1 rounded-full bg-paper p-1"
        >
          {(
            [
              ["mood", "Mood colour"],
              ["sage", "Cotab sage"],
            ] as const
          ).map(([bg, label]) => (
            <button
              key={bg}
              type="button"
              role="radio"
              aria-checked={choice.bg === bg}
              onClick={() =>
                save({ avatar_bg: bg, avatar_mood: choice.mood, avatar_look: choice.look })
              }
              className={`h-9 rounded-full px-3 text-[13px] font-bold ${
                choice.bg === bg
                  ? "bg-card shadow-[0_2px_8px_-2px_rgb(12_17_14/0.15)]"
                  : "text-faint"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 border-t border-line pt-4">
        <span>
          <span className="block text-[15px] font-bold">Let Tabby react</span>
          <span className="block text-[13px] text-faint">
            Tabby&apos;s face on Home follows your budget. Off keeps your picture.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={reacts}
          onChange={(e) => save({ tabby_reacts: e.target.checked })}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-gold ${
            reacts ? "bg-forest" : "bg-ink/15"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
              reacts ? "left-6" : "left-1"
            }`}
          />
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-rose">
          {error}
        </p>
      )}
    </Group>
  );
}

export function NameForm({ first, last }: { first: string; last: string }) {
  const [values, setValues] = useState({ first, last });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setValues({ first, last }), [first, last]);
  const changed = values.first.trim() !== first || values.last.trim() !== last;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    try {
      await saveProfile({ full_name: `${values.first.trim()} ${values.last.trim()}`.trim() });
      setNote("Saved");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-2 flex flex-col gap-3 border-b border-line pb-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <input
            value={values.first}
            onChange={(e) => setValues({ ...values, first: e.target.value })}
            className={fieldClass}
            autoComplete="given-name"
            required
          />
        </Field>
        <Field label="Last name (optional)">
          <input
            value={values.last}
            onChange={(e) => setValues({ ...values, last: e.target.value })}
            className={fieldClass}
            autoComplete="family-name"
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !changed || !values.first.trim()}>
          {busy ? "Saving…" : "Save name"}
        </Button>
        {note && (
          <span role="status" className="text-sm font-semibold text-muted">
            {note}
          </span>
        )}
      </div>
    </form>
  );
}

export function PhoneForm({ phone }: { phone: string | null }) {
  const saved = prettyPhone(phone);
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setValue(saved), [saved]);
  const changed = value !== saved;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    try {
      mutate<User>(keys.me, await setPhone(value));
      setNote("Saved");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-2 flex flex-col gap-3 border-b border-line pb-5">
      <Field label="Mobile number">
        <input
          value={value}
          onChange={(e) => {
            setValue(formatUsPhone(e.target.value));
            setNote("");
          }}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(415) 555-0123"
          className={fieldClass}
        />
      </Field>
      <p className="-mt-1 text-[13px] text-faint">
        Friends add you to splits by this number. It&apos;s never shown on share links.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !changed || !looksComplete(value)}>
          {busy ? "Saving…" : "Save number"}
        </Button>
        {note && (
          <span role="status" className="text-sm font-semibold text-muted">
            {note}
          </span>
        )}
      </div>
    </form>
  );
}

/** Download a copy of everything, as a file with a 7-day link. */
export function ExportData() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);

  async function onExport() {
    setExporting(true);
    setExported(null);
    try {
      setExported(await requestExport());
    } catch (e) {
      setExported({ id: "", status: "failed" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Download a copy of every purchase on your tab as a JSON file. Links last 7 days.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onExport} disabled={exporting}>
          <Icon name="download" size={20} />
          {exporting ? "Preparing your copy…" : "Download my data"}
        </Button>
        {exported?.status === "ready" && exported.download_url && (
          <a
            href={exported.download_url}
            className={buttonClass.primary}
            target="_blank"
            rel="noreferrer"
          >
            Save the file
          </a>
        )}
      </div>
      {exported && exported.status !== "ready" && (
        <p role="status" className="mt-3 text-sm text-rose">
          We couldn&apos;t build the file just now. Try again in a minute.
        </p>
      )}
    </>
  );
}

/** Delete the account for good: a password, or for Google and Apple sign-ins
 *  an emailed code. Nothing is deleted on a wrong answer. */
export function DeleteAccount() {
  const router = useRouter();
  const { data: user } = useMe();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Google and Apple accounts have no password to type, so they get a code.
  const usesCode = user?.has_password === false;
  const [codeSentTo, setCodeSentTo] = useState("");
  async function onSendDeleteCode() {
    setDeleteError(null);
    try {
      setCodeSentTo((await sendDeleteCode()).email);
    } catch (err) {
      setDeleteError((err as Error).message);
    }
  }

  async function onDelete(e: FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(usesCode ? { code: password } : { password });
      router.replace(routes.login);
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.status === 403
          ? "That password doesn't match. Nothing was deleted."
          : (err as Error).message
      );
      setDeleting(false);
    }
  }

  return (
    <>
      {!confirming ? (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      ) : (
        <form onSubmit={onDelete} className="rise rounded-[20px] bg-blush p-5">
          <div className="flex items-center gap-3">
            <CatAvatar choice={{ look: "hoodie", mood: "hmm", bg: "mood" }} size={44} />
            <p className="font-extrabold">Delete your account for good?</p>
          </div>
          <p className="mt-2 text-sm">
            Every receipt, budget and split goes with it. This can&apos;t be undone.
          </p>
          {usesCode ? (
            <>
              <p className="mt-4 text-[13px] font-bold">
                {codeSentTo
                  ? `Type the code Tabby sent to ${codeSentTo}`
                  : "You signed up with Google or Apple, so Tabby will email you a code to confirm."}
              </p>
              {codeSentTo ? (
                <input
                  id="delete-password"
                  aria-label="Code from the email"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))}
                  className={`${fieldClass} mt-1.5 tracking-[0.4em]`}
                  required
                />
              ) : (
                <Button variant="ghost" className="mt-2" onClick={onSendDeleteCode}>
                  <Icon name="mail" size={20} />
                  Email me a code
                </Button>
              )}
            </>
          ) : (
            <>
              <label className="mt-4 block text-[13px] font-bold" htmlFor="delete-password">
                Type your password to confirm
              </label>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} mt-1.5`}
                required
              />
            </>
          )}
          {deleteError && (
            <p role="alert" className="mt-2 text-sm font-semibold text-rose">
              {deleteError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={deleting || !password}
              className={`${buttonClass.primary} !bg-rose`}
            >
              {deleting ? "Deleting…" : "Delete everything"}
            </button>
            <Button
              variant="quiet"
              onClick={() => {
                setConfirming(false);
                setPassword("");
                setDeleteError(null);
              }}
            >
              Keep my account
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
