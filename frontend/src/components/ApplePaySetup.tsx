"use client";

import { useState } from "react";

import { CopyField } from "@/components/CopyField";
import { Button, ErrorNote } from "@/components/ui";
import { createCaptureKey, revokeCaptureKey, TAP_URL, type CaptureStatus } from "@/lib/api";
import { invalidate, mutate } from "@/lib/cache";
import { keys, useCaptureStatus } from "@/lib/data";
import { dayLabel } from "@/lib/format";

function when(iso: string) {
  const time = new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayLabel(iso)}, ${time}`;
}

/** The one-time walkthrough shown right after a key is made. */
function Steps({ secret }: { secret: string }) {
  return (
    <div className="rise mt-4 rounded-card border border-ink/15 bg-paper p-4">
      <p className="font-semibold">
        Your key is ready. Copy it now: Cotab won&apos;t show it again.
      </p>
      <ol className="mt-4 flex list-decimal flex-col gap-4 pl-5 marker:font-semibold">
        <li>
          On your iPhone, open <strong>Shortcuts</strong>, go to <strong>Automation</strong> and tap{" "}
          <strong>+</strong>.
        </li>
        <li>
          Choose <strong>Transaction</strong>. Pick the cards you pay with, choose{" "}
          <strong>Run Immediately</strong>, then tap <strong>Next</strong>.
        </li>
        <li>
          Tap <strong>New Blank Automation</strong> and add the action{" "}
          <strong>Get Contents of URL</strong>. Set it to this address:
          <CopyField label="Address" value={TAP_URL} />
        </li>
        <li>
          Open the action&apos;s options. Set <strong>Method</strong> to <strong>POST</strong>, and
          add a header named <strong>Authorization</strong> with this value:
          <CopyField label="Authorization" value={`Bearer ${secret}`} />
        </li>
        <li>
          Under <strong>Request Body</strong> choose <strong>JSON</strong> and add two text fields:{" "}
          <code className="font-mono">merchant</code>, set to{" "}
          <strong>Shortcut Input › Merchant</strong>, and <code className="font-mono">amount</code>,
          set to <strong>Shortcut Input › Amount</strong>.
        </li>
        <li>
          Tap <strong>Done</strong>. Next time you pay with Apple Pay, the purchase shows up on your
          tab.
        </li>
      </ol>
      <p className="mt-4 text-sm text-muted">
        Want a confirmation? Add a <strong>Show Notification</strong> action after it, showing the{" "}
        <strong>message</strong> from the result.
      </p>
    </div>
  );
}

/**
 * Settings section for Apple Pay taps: make a key for the iPhone shortcut,
 * see whether taps are arriving, and remove keys for phones you no longer use.
 */
export function ApplePaySetup() {
  const status = useCaptureStatus();
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keysList = status.data?.keys ?? [];
  const last = status.data?.last_tap_at;
  const tapCount = status.data?.taps_this_month ?? 0;

  async function makeKey() {
    setBusy(true);
    setError(null);
    try {
      const made = await createCaptureKey(
        keysList.length ? `iPhone ${keysList.length + 1}` : "iPhone"
      );
      setSecret(made.key);
      mutate<CaptureStatus>(keys.capture, (s) => ({
        keys: [made, ...(s?.keys ?? [])],
        last_tap_at: s?.last_tap_at ?? null,
        taps_this_month: s?.taps_this_month ?? 0,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const before = status.data;
    mutate<CaptureStatus>(keys.capture, (s) => ({
      keys: (s?.keys ?? []).filter((k) => k.id !== id),
      last_tap_at: s?.last_tap_at ?? null,
      taps_this_month: s?.taps_this_month ?? 0,
    }));
    try {
      await revokeCaptureKey(id);
    } catch (e) {
      if (before) mutate(keys.capture, before);
      setError((e as Error).message);
    }
    invalidate(keys.capture);
  }

  return (
    <div>
      <p className="mb-4 text-muted">
        Every time you pay with Apple Pay on your iPhone, the store and amount land on your tab. No
        photo needed. Scan the receipt later and its items join the same purchase.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      {keysList.length > 0 && (
        <p className="mb-4 rounded-card bg-mint/70 px-4 py-3" aria-live="polite">
          {last ? (
            <>
              <strong>Connected.</strong> Last tap {when(last)}.{" "}
              {tapCount === 1 ? "1 tap" : `${tapCount} taps`} this month.
            </>
          ) : (
            <>
              <strong>Waiting for your first tap.</strong> Pay with Apple Pay once the shortcut is
              set up and it will show here.
            </>
          )}
        </p>
      )}

      {keysList.length > 0 && (
        <ul className="mb-4 border-t border-ink/15">
          {keysList.map((k) => (
            <li
              key={k.id}
              className="flex min-h-14 items-center justify-between gap-3 border-b border-line/70 py-2"
            >
              <span className="min-w-0">
                <span className="block font-semibold">{k.name}</span>
                <span className="block text-sm text-muted">
                  <code className="font-mono">{k.prefix}…</code>,{" "}
                  {k.last_used_at ? `last used ${when(k.last_used_at)}` : "not used yet"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(k.id)}
                className="min-h-11 shrink-0 text-sm font-semibold text-rose underline underline-offset-4"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button variant={keysList.length ? "ghost" : "primary"} onClick={makeKey} disabled={busy}>
        {busy
          ? "Making a key…"
          : keysList.length
            ? "Set up another iPhone"
            : "Set up Apple Pay taps"}
      </Button>
      <p className="mt-2 text-sm text-muted">iPhone with iOS 17 or later.</p>

      {secret && <Steps secret={secret} />}
    </div>
  );
}
