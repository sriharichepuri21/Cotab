"use client";

/**
 * Cotab notifications on this device (Web Push). A friend's reminder arrives
 * as a notification; tapping it opens that tab.
 *
 * iPhone and iPad only allow them for apps on the Home Screen, so there the
 * first step is "Add to Home Screen".
 */

import { apiFetch, apiJson } from "@/lib/api";

export type PushState =
  | "unsupported" // this browser can't do notifications at all
  | "needs-install" // iPhone/iPad in Safari: add to Home Screen first
  | "blocked" // the person said no; only the browser's settings can undo it
  | "off"
  | "on";

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const isInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Register the worker that shows notifications (safe to call on every load). */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const capable =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIOS() && !isInstalled() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await registerWorker();
  const existing = await registration?.pushManager.getSubscription();
  return existing && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** Ask permission (must follow a tap) and sign this device up. */
export async function turnOn(): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "needs-install" || state === "blocked") return state;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const registration = await registerWorker();
  if (!registration) return "unsupported";
  await navigator.serviceWorker.ready;
  const { public_key } = await apiFetch<{ public_key: string }>("/api/v1/push/key");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(public_key) as BufferSource,
    }));
  const json = subscription.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await apiJson("/api/v1/push/subscribe", "POST", { endpoint: json.endpoint, keys: json.keys });
  return "on";
}

export async function turnOff(): Promise<PushState> {
  const registration = await registerWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await apiJson("/api/v1/push/unsubscribe", "POST", { endpoint: subscription.endpoint }).catch(
      () => undefined
    );
    await subscription.unsubscribe();
  }
  return "off";
}
