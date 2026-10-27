"use client";

import { useEffect, useState } from "react";

import { TabbyPortrait } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { pushState, turnOff, turnOn, type PushState } from "@/lib/push";

const SUB: Record<PushState, string> = {
  on: "Friends' reminders and Tabby's notes show up on this device.",
  off: "Get a notification when a friend reminds you, and tap it to open the tab.",
  blocked:
    "Notifications are blocked for Cotab. Turn them on in your browser's or phone's settings.",
  "needs-install":
    "On iPhone, add Cotab to your Home Screen first: tap Share, then Add to Home Screen. Open Cotab from there and turn this on.",
  unsupported: "This browser can't show notifications. Try Chrome, Edge or Safari.",
};

/**
 * Turn Cotab notifications on or off for this device. `compact` is the
 * prompt shown on a tab; the full version lives in Settings.
 */
export function NotificationsCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  if (state === null || (compact && (state === "on" || state === "unsupported"))) return null;

  async function toggle() {
    setBusy(true);
    setProblem("");
    try {
      setState(state === "on" ? await turnOff() : await turnOn());
    } catch {
      setProblem("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const canToggle = state === "on" || state === "off";
  return (
    <div
      className={`flex items-center gap-3 rounded-card p-4 ${
        compact ? "bg-[#FFF4D6]" : "bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.04)]"
      }`}
    >
      <TabbyPortrait mood={state === "on" ? "done" : "hi"} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">
          {compact ? "Get reminders as notifications" : "Notifications"}
        </span>
        <span className="mt-0.5 block text-[13px] text-faint">{problem || SUB[state]}</span>
      </span>
      {canToggle &&
        (compact ? (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="press inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-forest px-4 text-sm font-bold text-paper disabled:opacity-50"
          >
            <Icon name="notifications" size={18} />
            Turn on
          </button>
        ) : (
          <label className="flex cursor-pointer items-center">
            <span className="sr-only">Notifications on this device</span>
            <input
              type="checkbox"
              role="switch"
              checked={state === "on"}
              disabled={busy}
              onChange={toggle}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-gold ${
                state === "on" ? "bg-forest" : "bg-ink/15"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  state === "on" ? "left-6" : "left-1"
                }`}
              />
            </span>
          </label>
        ))}
    </div>
  );
}
