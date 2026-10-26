"use client";

import { useEffect, useState } from "react";

import { Duo } from "@/components/Tabby";
import { Icon } from "@/components/ui";
import { remindFriend, type PayLink, type SplitSummary } from "@/lib/api";
import { money } from "@/lib/format";

/** The words of the reminder message, as the friend will read them. */
export function reminderText({
  friend,
  me,
  amount,
  currency,
  links,
  shareUrl,
}: {
  friend: string;
  me: string;
  amount: number;
  currency: string;
  links: PayLink[];
  shareUrl: string;
}): string {
  const lines = [
    `Hi ${friend}! Friendly reminder from ${me}: you owe ${money(amount, currency)} on our Cotab tab.`,
  ];
  for (const link of links) {
    if (link.url) lines.push(`Pay with ${link.label}: ${link.url}`);
    else if (link.copy) lines.push(`${link.label}: ${link.copy}`);
  }
  lines.push(`Open the tab: ${shareUrl}`);
  return lines.join("\n");
}

/** "Reminded today", "Reminded 3 days ago", from when it was last sent. */
export function remindedLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Reminded today";
  if (days === 1) return "Reminded yesterday";
  return `Reminded ${days} days ago`;
}

/**
 * Remind a friend what they owe. If they use Cotab with notifications on,
 * Tabby sends a notification to their phone that opens this tab. Otherwise
 * you send the message yourself (Messages, WhatsApp…) with the tab's link,
 * which brings them into Cotab.
 */
export function RemindSheet({
  groupId,
  friend,
  me,
  amount,
  currency,
  text,
  onClose,
  onSent,
}: {
  groupId: string;
  friend: { id: string; name: string; notify?: boolean };
  me: string;
  amount: number;
  currency: string;
  text: string;
  onClose: () => void;
  onSent: (summary: SplitSummary | null, note: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMessage, setShowMessage] = useState(!friend.notify);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function notify() {
    setBusy(true);
    setError(null);
    try {
      onSent(
        await remindFriend(groupId, { member_id: friend.id, channel: "push" }),
        `Tabby nudged ${friend.name}.`
      );
    } catch (err) {
      setError((err as Error).message);
      setShowMessage(true);
      setBusy(false);
    }
  }

  async function message() {
    setError(null);
    let shared = false;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        shared = true;
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch (err) {
      // Closing the share sheet without sending isn't a reminder.
      if ((err as Error).name === "AbortError") return;
      setError("Couldn't open sharing on this device.");
      return;
    }
    const note = shared ? `Reminder sent to ${friend.name}.` : "Copied. Paste it in a message.";
    try {
      onSent(await remindFriend(groupId, { member_id: friend.id, channel: "message" }), note);
    } catch {
      onSent(null, note);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center scrim-in bg-ink/40 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remind ${friend.name}`}
        className="sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] bg-paper md:max-w-lg md:rounded-[28px]"
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-5">
          <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">Remind {friend.name}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-card"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
          <Duo scene="reminder" width={170} alt="" className="mx-auto" />
          <p className="text-center text-[15px] text-muted">
            {friend.name} owes you <strong className="text-ink">{money(amount, currency)}</strong>.
          </p>

          {friend.notify && (
            <>
              <div className="mt-4 rounded-tile bg-card p-3.5 shadow-[0_0_0_1px_rgb(12_17_14/0.05)]">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-faint">
                  <Icon name="notifications" size={15} />
                  Cotab · now
                </p>
                <p className="mt-1 text-[14px] font-extrabold">Reminder from {me}</p>
                <p className="text-[14px] leading-snug">
                  You owe {me} {money(amount, currency)}. Tap to see it and pay.
                </p>
              </div>
              <button
                type="button"
                onClick={notify}
                disabled={busy}
                className="press mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-forest font-bold text-paper disabled:opacity-50"
              >
                <Icon name="notifications_active" size={20} />
                {busy ? "Sending…" : "Send a notification"}
              </button>
              <p className="mt-2 text-center text-[12px] text-faint">
                It opens this tab on {friend.name}&apos;s phone. Once a day at most.
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose">
              {error}
            </p>
          )}

          {!friend.notify && (
            <p className="mt-3 rounded-tile bg-[#FFF4D6] px-3.5 py-3 text-[13px] leading-snug">
              {friend.name} isn&apos;t using Cotab notifications yet, so send this yourself. The
              link opens the tab, and once {friend.name} joins and turns notifications on, your next
              reminder arrives on their phone.
            </p>
          )}

          {showMessage ? (
            <>
              <p className="mt-4 whitespace-pre-wrap break-words rounded-tile bg-card p-3.5 text-[14px] leading-snug shadow-[0_0_0_1px_rgb(12_17_14/0.05)]">
                {text}
              </p>
              <button
                type="button"
                onClick={message}
                className={`press mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-full font-bold ${
                  friend.notify ? "bg-card ring-1 ring-ink/[0.1]" : "bg-forest text-paper"
                }`}
              >
                <Icon name="sms" size={20} />
                Send a message
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowMessage(true)}
              className="mx-auto mt-3 block text-sm font-bold text-forest underline underline-offset-4"
            >
              Send a message instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
