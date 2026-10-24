"use client";

import { useState, type FormEvent } from "react";

import { Button, fieldClass } from "@/components/ui";
import { setMemberPhone, type SplitSummaryMember } from "@/lib/api";
import { inviteMessage, inviteUrl, smsHref } from "@/lib/invite";
import { formatUsPhone, looksComplete, prettyPhone } from "@/lib/phone";

/** One line under someone's name: where they stand with Cotab. */
export function memberStatusLabel(member: SplitSummaryMember, isOwner: boolean): string {
  const number = isOwner && member.phone ? `${prettyPhone(member.phone)}. ` : "";
  switch (member.status) {
    case "joined":
      return "On Cotab";
    default:
      return member.joined ? "On Cotab" : `${number}Not on Cotab yet`;
  }
}

const chip =
  "press inline-flex min-h-10 items-center rounded-full px-4 text-[13px] font-bold disabled:opacity-50";

/**
 * What the tab's owner can do for someone who hasn't joined: text them an
 * invite from their own phone, share the link another way, or add their
 * number so Cotab can match them to an account.
 */
export function MemberInvite({
  member,
  groupId,
  shareCode,
  tab,
  from,
  onSaved,
}: {
  member: SplitSummaryMember;
  groupId: string;
  shareCode: string;
  tab: { name: string; kind?: string };
  from: string;
  onSaved: () => unknown;
}) {
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (member.joined) return null;
  const link = inviteUrl(window.location.origin, shareCode, member.id);
  const message = inviteMessage(from, tab, link);

  async function share() {
    setNote("");
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
        return;
      }
      await navigator.clipboard.writeText(message);
      setNote("Invite copied. Paste it anywhere.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Couldn't share just now.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    try {
      await setMemberPhone(groupId, member.id, phone);
      setAdding(false);
      setPhone("");
      await onSaved();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <form onSubmit={save} className="mt-3 flex items-center gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(formatUsPhone(e.target.value))}
          type="tel"
          inputMode="tel"
          placeholder="(415) 555-0123"
          aria-label={`${member.name}'s mobile number`}
          className={`${fieldClass} flex-1`}
          autoFocus
        />
        <Button type="submit" disabled={busy || !looksComplete(phone)}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="min-h-10 px-2 text-sm font-bold text-muted"
        >
          Cancel
        </button>
        {note && (
          <p role="alert" className="basis-full text-sm font-semibold text-rose">
            {note}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 pl-[56px]">
      {member.phone && (
        <a
          href={smsHref(member.phone, message, navigator.userAgent)}
          className={`${chip} bg-forest text-gold`}
        >
          Text invite
        </a>
      )}
      {!member.phone && member.email && (
        <a
          href={`mailto:${member.email}?subject=${encodeURIComponent(
            `${from} added you on Cotab`
          )}&body=${encodeURIComponent(message)}`}
          className={`${chip} bg-forest text-gold`}
        >
          Email invite
        </a>
      )}
      <button type="button" onClick={share} className={`${chip} bg-paper`}>
        Share invite
      </button>
      {!member.phone && (
        <button type="button" onClick={() => setAdding(true)} className={`${chip} bg-paper`}>
          Add number
        </button>
      )}
      {note && (
        <p role="status" className="basis-full text-sm font-semibold text-muted">
          {note}
        </p>
      )}
    </div>
  );
}
