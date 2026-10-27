"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { isAuthed, wakeServer } from "@/lib/api";
import { routes } from "@/lib/routes";

/** Sticky header for the landing page. Signed-in visitors get a way back in. */
export function LandingNav() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(isAuthed());
    wakeServer();
  }, []);

  return (
    <header className="nav">
      <div className="wrap">
        <a className="logo" href="#top" aria-label="Cotab home">
          <span className="mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cat-v3-stock/png/hi.png" alt="" />
          </span>
          cotab
        </a>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#cat">Meet Tabby</a>
          <a href="#splits">Splits</a>
        </nav>
        {authed ? (
          <Link className="btn btn-citron" href={routes.home}>
            Open your tab
          </Link>
        ) : (
          <span className="navcta">
            <Link className="signin" href={routes.login}>
              Sign in
            </Link>
            <Link className="btn btn-citron" href={routes.register}>
              Get started
            </Link>
          </span>
        )}
      </div>
    </header>
  );
}
