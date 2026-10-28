"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { isAuthed, wakeServer } from "@/lib/api";
import { routes } from "@/lib/routes";
import { Logo } from "@/components/Logo";

/** Header for the landing page. Signed-in visitors get a way back in. */
export function LandingNav() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(isAuthed());
    wakeServer();
  }, []);

  return (
    <header className="nav">
      <a className="logo" href="#top" aria-label="Cotab home">
        <Logo height={34} tone="dark" />
      </a>
      <nav aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#splits">Splits</a>
        <a href="#ask">The app</a>
        <a href="#faq">Questions</a>
      </nav>
      {authed ? (
        <Link className="btn btn-lime" href={routes.home}>
          Open your tab
        </Link>
      ) : (
        <span className="navcta">
          <Link className="signin" href={routes.login}>
            Sign in
          </Link>
          <Link className="btn btn-lime" href={routes.register}>
            Get started free
          </Link>
        </span>
      )}
    </header>
  );
}
