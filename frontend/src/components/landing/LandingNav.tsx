"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CotabLogo } from "@/components/CotabLogo";
import { isAuthed, wakeServer } from "@/lib/api";
import { routes } from "@/lib/routes";

/** Ink on the morning sky; once scrolled it becomes a dark bar. */
export function LandingNav() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(isAuthed());
    wakeServer();
  }, []);
  return (
    <header className="ln-nav">
      <a href="#top" aria-label="Cotab home">
        <CotabLogo height={26} />
      </a>
      <nav aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#split">Try it</a>
        <a href="#budgets">Budgets</a>
        <a href="#month">Your month</a>
        <a href="#faq">Questions</a>
      </nav>
      <div className="ln-nav-end">
        <Link href={authed ? routes.home : routes.login}>
          {authed ? "Open your tab" : "Log in"}
        </Link>
        <Link className="ln-btn ln-btn-sm" href={routes.start}>
          Get started
        </Link>
      </div>
    </header>
  );
}
