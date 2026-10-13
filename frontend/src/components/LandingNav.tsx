"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { isAuthed, wakeServer } from "@/lib/api";
import { routes } from "@/lib/routes";

/** Sticky pill header. Signed-in visitors get a way back into the app. */
export function LandingNav() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(isAuthed());
    wakeServer();
  }, []);

  return (
    <header className="sticky top-3 z-30 mx-3 mt-3 flex items-center justify-between rounded-2xl border border-line bg-paper py-2.5 pl-3 pr-2.5 shadow-[0_6px_24px_rgb(var(--c-gold)/0.5)] md:mx-auto md:max-w-5xl">
      <Link href={routes.landing} aria-label="Cotab home" id="nav-logo">
        <Logo />
      </Link>
      <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
        {authed ? (
          <Link
            href={routes.home}
            className="min-h-10 rounded-button bg-ink px-4 py-2.5 text-sm font-semibold text-paper"
          >
            Open your tab
          </Link>
        ) : (
          <>
            <Link href={routes.login} className="min-h-10 px-3 py-2.5 text-sm font-semibold">
              Sign in
            </Link>
            <Link
              href={routes.register}
              className="min-h-10 rounded-button border border-ink px-4 py-2.5 text-sm font-semibold"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
