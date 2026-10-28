"use client";

import { useEffect, useState } from "react";
import { tabbyArt } from "@/lib/tabby";

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
  const [delivery, setDelivery] = useState<"push" | "message">(friend.notify ? "push" : "message");

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
      setDelivery("message");
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
      className="remind-scrim fixed inset-0 z-[80] flex items-end justify-center scrim-in bg-ink/40 backdrop-blur-[5px] md:items-center md:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remind ${friend.name}`}
        className="remind-sheet sheet flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[30px] md:max-w-lg md:rounded-[30px]"
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-6">
          <div>
            <p className="remind-kicker text-[12px] font-semibold">Friendly reminder</p>
            <h2 className="mt-0.5 text-[26px] font-semibold tracking-[-0.045em]">
              Remind {friend.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="remind-close grid h-11 w-11 place-items-center rounded-full"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-[max(22px,env(safe-area-inset-bottom))]">
          <section className="remind-amount mt-4 grid grid-cols-[1fr_116px] items-end overflow-hidden rounded-[24px] px-5 pt-5">
            <div className="pb-5">
              <p className="text-[13px] font-medium opacity-65">Amount due</p>
              <p className="mt-1 text-[36px] font-semibold leading-none tracking-[-0.055em]">
                {money(amount, currency)}
              </p>
              <p className="mt-2 text-[13px] opacity-65">from {friend.name}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- local transparent mascot asset */}
            <img
              src={tabbyArt("remember")}
              alt=""
              className="remind-tabby h-[118px] w-full object-contain object-bottom"
            />
          </section>

          <p className="mb-2 mt-5 text-[13px] font-semibold">How should Cotab remind them?</p>
          <div className="remind-options overflow-hidden rounded-[20px]">
            <button
              type="button"
              disabled={!friend.notify}
              onClick={() => setDelivery("push")}
              className={`remind-option flex min-h-[72px] w-full items-center gap-3 px-4 text-left ${
                delivery === "push" ? "is-selected" : ""
              }`}
            >
              <span className="remind-option-icon grid size-10 shrink-0 place-items-center rounded-full">
                <Icon name="notifications_active" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-[15px] font-semibold">Notify in Cotab</strong>
                <span className="remind-secondary block text-[12px] leading-snug">
                  {friend.notify
                    ? `Arrives on ${friend.name}'s phone and opens this tab`
                    : `${friend.name} hasn't enabled Cotab notifications`}
                </span>
              </span>
              {friend.notify ? (
                <Icon name={delivery === "push" ? "check_circle" : "circle"} size={22} />
              ) : (
                <Icon name="lock" size={18} />
              )}
            </button>
            <div className="remind-divider mx-4" />
            <button
              type="button"
              onClick={() => setDelivery("message")}
              className={`remind-option flex min-h-[72px] w-full items-center gap-3 px-4 text-left ${
                delivery === "message" ? "is-selected" : ""
              }`}
            >
              <span className="remind-option-icon grid size-10 shrink-0 place-items-center rounded-full">
                <Icon name="ios_share" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-[15px] font-semibold">Share a reminder</strong>
                <span className="remind-secondary block text-[12px] leading-snug">
                  Messages, WhatsApp, email, or copy
                </span>
              </span>
              <Icon name={delivery === "message" ? "check_circle" : "circle"} size={22} />
            </button>
          </div>

          {error && (
            <p
              role="alert"
              className="remind-error mt-3 rounded-[16px] px-4 py-3 text-[13px] font-semibold"
            >
              {error}
            </p>
          )}

          {delivery === "message" && (
            <details className="remind-preview mt-3 rounded-[16px] px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-semibold">
                Preview message
              </summary>
              <p className="remind-secondary mt-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {text}
              </p>
            </details>
          )}

          <button
            type="button"
            onClick={delivery === "push" ? notify : message}
            disabled={busy}
            className="remind-primary press mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:opacity-50"
          >
            <Icon name={delivery === "push" ? "notifications_active" : "ios_share"} size={20} />
            {busy ? "Sending…" : delivery === "push" ? `Notify ${friend.name}` : "Share reminder"}
          </button>
          <p className="remind-secondary mt-2 text-center text-[12px]">
            {delivery === "push"
              ? "Cotab sends one reminder per person per day."
              : "Cotab records it only after the share sheet opens."}
          </p>
        </div>
      </div>
    </div>
  );
}
