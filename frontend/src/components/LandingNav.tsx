"use client";

import { ArrowUpRight } from "lucide-react";
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
        <Logo height={30} tone="flat" />
      </a>
      <nav aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#splits">Splits</a>
        <a href="#budgets">Budgets</a>
        <a href="#faq">Questions</a>
      </nav>
      <Link className="nav-cta" href={authed ? routes.home : routes.login}>
        {authed ? "Open your tab" : "Sign in"}
        <ArrowUpRight aria-hidden="true" />
      </Link>
    </header>
  );
}
