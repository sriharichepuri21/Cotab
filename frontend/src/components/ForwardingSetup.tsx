"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { CopyField } from "@/components/CopyField";
import { ErrorNote, fieldClass, Section } from "@/components/ui";
import {
  addInboxSender,
  newInboxAddress,
  removeInboxSender,
  type Inbox,
  type InboxEmail,
} from "@/lib/api";
import { mutate } from "@/lib/cache";
import { keys, useInbox } from "@/lib/data";
import { dayLabel } from "@/lib/format";
import { routes } from "@/lib/routes";

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Reading…", tone: "bg-ink/[0.06]" },
  reading: { label: "Reading…", tone: "bg-ink/[0.06]" },
  added: { label: "Added", tone: "bg-mint" },
  matched: { label: "Joined a tap", tone: "bg-mint" },
  skipped: { label: "Skipped", tone: "bg-gold/50" },
  ignored: { label: "Ignored", tone: "bg-gold/50" },
  failed: { label: "Didn't work", tone: "bg-blush" },
};

function Recent({ email }: { email: InboxEmail }) {
  const s = STATUS[email.status] ?? STATUS.failed;
  return (
    <li className="flex items-start gap-3 border-b border-line/70 py-3">
      <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.tone}`}>
        {s.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{email.subject || "(no subject)"}</span>
        <span className="block text-sm text-muted">
          {dayLabel(email.created_at)}, from {email.from_address || "unknown sender"}
        </span>
        {email.reason && <span className="mt-1 block text-sm">{email.reason}</span>}
      </span>
      {email.receipt_id && (
        <Link
          href={routes.receipt(email.receipt_id)}
          className="min-h-10 shrink-0 py-2 text-sm font-semibold underline underline-offset-4"
        >
          Open
        </Link>
      )}
    </li>
  );
}

/**
 * Settings section for forwarding receipts by email: the person's private
 * address, which of their addresses may forward to it, and what happened to
 * recent emails. Renders nothing until the server has email switched on.
 */
export function ForwardingSetup() {
  const inbox = useInbox();
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  const data = inbox.data;
  if (!data?.enabled || !data.address) return null;

  const apply = (next: Inbox) => mutate(keys.inbox, next);

  async function run(work: () => Promise<Inbox>) {
    setBusy(true);
    setError(null);
    try {
      apply(await work());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    if (await run(() => addInboxSender(adding.trim()))) setAdding("");
  }

  return (
    <Section title="Forward receipts by email">
      <p className="mb-4 text-muted">
        Forward order emails and e-receipts to your Cotab address and they land on your tab with
        their items. Receipts for Apple Pay taps join the same purchase.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <CopyField label="Your Cotab address" value={data.address} />

      <h3 className="mb-2 mt-6 font-semibold">Forwarding from</h3>
      <p className="mb-2 text-sm text-muted">
        Only mail forwarded from these addresses is read, so nobody else can add to your tab.
      </p>
      <ul className="border-t border-ink/15">
        <li className="flex min-h-12 items-center justify-between gap-3 border-b border-line/70 py-2">
          <span className="truncate">{data.account_email}</span>
          <span className="shrink-0 text-sm text-muted">your sign-in email</span>
        </li>
        {data.senders.map((s) => (
          <li
            key={s.id}
            className="flex min-h-12 items-center justify-between gap-3 border-b border-line/70 py-2"
          >
            <span className="truncate">{s.email}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => removeInboxSender(s.id))}
              className="min-h-11 shrink-0 text-sm font-semibold text-rose underline underline-offset-4"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={onAdd} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="forward-from">
          Another address you forward from
        </label>
        <input
          id="forward-from"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="work@company.com"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          className={`${fieldClass} flex-1`}
        />
        <button
          type="submit"
          disabled={busy || !adding.trim()}
          className="min-h-12 shrink-0 rounded-button border border-ink/15 px-4 font-semibold disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <p className="mt-4 text-sm text-muted">
        To forward automatically, add a filter in Gmail or Outlook that forwards order and receipt
        emails to your Cotab address. If Gmail asks for a confirmation code, it shows up under
        Recent emails below.
      </p>

      {data.recent.length > 0 && (
        <>
          <h3 className="mb-1 mt-6 font-semibold">Recent emails</h3>
          <ul className="border-t border-ink/15">
            {data.recent.map((e) => (
              <Recent key={e.id} email={e} />
            ))}
          </ul>
        </>
      )}

      <div className="mt-4">
        {confirmNew ? (
          <p className="rounded-card bg-gold/40 p-3 text-sm">
            Your current address will stop working.{" "}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await run(newInboxAddress)) setConfirmNew(false);
              }}
              className="font-semibold underline underline-offset-4"
            >
              Get a new address
            </button>{" "}
            or{" "}
            <button
              type="button"
              onClick={() => setConfirmNew(false)}
              className="font-semibold underline underline-offset-4"
            >
              keep this one
            </button>
            .
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmNew(true)}
            className="min-h-11 text-sm font-semibold underline underline-offset-4"
          >
            Getting spam? Get a new address
          </button>
        )}
      </div>
    </Section>
  );
}
