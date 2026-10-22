"use client";

import { useEffect, useRef, useState } from "react";

import {
  getProviders,
  signInWithApple,
  signInWithGoogle,
  type Providers,
  type SignedIn,
} from "@/lib/api";

/*
 * "Continue with Google" and "Continue with Apple". Each shows only when the
 * server has that provider set up. Both hand us a signed ID token in the
 * page; the server checks it and signs the person in (or makes the account
 * and emails a code). A fresh random nonce goes into each token so a token
 * captured elsewhere can't be replayed.
 */

type GoogleId = {
  accounts: {
    id: {
      initialize: (config: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};
type AppleId = {
  auth: {
    init: (config: Record<string, unknown>) => void;
    signIn: () => Promise<{
      authorization: { id_token: string };
      user?: { name?: { firstName?: string; lastName?: string } };
    }>;
  };
};
type WithProviders = Window & { google?: GoogleId; AppleID?: AppleId };

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
const APPLE_SCRIPT =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loading.has(src)) {
    loading.set(
      src,
      new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.async = true;
        tag.onload = () => resolve();
        tag.onerror = () => {
          loading.delete(src);
          reject(new Error("Couldn't reach the sign-in service. Check your connection."));
        };
        document.head.appendChild(tag);
      })
    );
  }
  return loading.get(src)!;
}

function nonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let providersOnce: Promise<Providers> | null = null;

export function SocialSignIn({
  mode,
  onSignedIn,
  onError,
  disabled = false,
}: {
  mode: "signin" | "signup";
  onSignedIn: (result: SignedIn) => void | Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [busy, setBusy] = useState<"" | "google" | "apple">("");
  const googleBox = useRef<HTMLDivElement>(null);
  const appleNonce = useRef("");
  const handlers = useRef({ onSignedIn, onError });
  handlers.current = { onSignedIn, onError };

  useEffect(() => {
    providersOnce ??= getProviders().catch(() => {
      providersOnce = null;
      return { google_client_id: null, apple_client_id: null };
    });
    providersOnce.then(setProviders);
  }, []);

  // Google draws its own button; we give it the box and the callback.
  const googleId = providers?.google_client_id;
  useEffect(() => {
    if (!googleId || !googleBox.current) return;
    let cancelled = false;
    const box = googleBox.current;
    const googleNonce = nonce();
    loadScript(GOOGLE_SCRIPT)
      .then(() => {
        const google = (window as WithProviders).google;
        if (cancelled || !google) return;
        google.accounts.id.initialize({
          client_id: googleId,
          nonce: googleNonce,
          ux_mode: "popup",
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return;
            setBusy("google");
            try {
              await handlers.current.onSignedIn(
                await signInWithGoogle(response.credential, googleNonce)
              );
            } catch (e) {
              handlers.current.onError((e as Error).message);
              setBusy("");
            }
          },
        });
        google.accounts.id.renderButton(box, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: mode === "signup" ? "signup_with" : "continue_with",
          logo_alignment: "center",
          width: Math.min(400, Math.max(240, box.offsetWidth)),
        });
      })
      .catch((e: Error) => handlers.current.onError(e.message));
    return () => {
      cancelled = true;
    };
  }, [googleId, mode]);

  const appleId = providers?.apple_client_id;
  useEffect(() => {
    if (!appleId) return;
    loadScript(APPLE_SCRIPT).catch(() => undefined);
  }, [appleId]);

  async function apple() {
    setBusy("apple");
    try {
      await loadScript(APPLE_SCRIPT);
      const AppleID = (window as WithProviders).AppleID;
      if (!AppleID) throw new Error("Sign in with Apple didn't load. Try again.");
      appleNonce.current = nonce();
      AppleID.auth.init({
        clientId: appleId,
        scope: "name email",
        redirectURI: `${window.location.origin}/login`,
        usePopup: true,
        nonce: appleNonce.current,
      });
      const result = await AppleID.auth.signIn();
      const name = [result.user?.name?.firstName, result.user?.name?.lastName]
        .filter(Boolean)
        .join(" ");
      await onSignedIn(
        await signInWithApple(result.authorization.id_token, appleNonce.current, name)
      );
    } catch (e) {
      const error = (e as { error?: string; message?: string }) ?? {};
      // Closing Apple's window isn't an error worth showing.
      if (error.error !== "popup_closed_by_user" && error.error !== "user_cancelled_authorize")
        onError(error.message || "Sign in with Apple didn't finish. Try again.");
      setBusy("");
    }
  }

  if (!providers || (!googleId && !appleId)) return null;

  return (
    <div className="mb-6">
      <div
        className={`flex flex-col gap-2.5 ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}
      >
        {googleId && (
          <div
            ref={googleBox}
            aria-label="Continue with Google"
            className="flex min-h-[44px] w-full justify-center"
          />
        )}
        {appleId && (
          <button
            type="button"
            onClick={apple}
            className="press flex h-[44px] w-full items-center justify-center gap-2 rounded-full bg-black text-[15px] font-semibold text-white"
          >
            <svg
              width="16"
              height="19"
              viewBox="0 0 814 1000"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
            </svg>
            {busy === "apple"
              ? "Signing in…"
              : mode === "signup"
                ? "Sign up with Apple"
                : "Continue with Apple"}
          </button>
        )}
        {busy === "google" && (
          <p role="status" className="text-center text-[13px] font-semibold text-muted">
            Signing in with Google…
          </p>
        )}
      </div>
      <div className="mt-6 flex items-center gap-3 text-[13px] font-semibold text-faint">
        <span className="h-px flex-1 bg-ink/10" />
        or with email
        <span className="h-px flex-1 bg-ink/10" />
      </div>
    </div>
  );
}
