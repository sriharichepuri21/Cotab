import type { Metadata } from "next";
import Link from "next/link";

import { LandingMotion } from "@/components/LandingMotion";
import { LandingNav } from "@/components/LandingNav";
import { Showcase } from "@/components/landing/Showcase";
import { SplitDemo } from "@/components/landing/SplitDemo";
import { Switches } from "@/components/landing/Switches";
import { routes } from "@/lib/routes";
import { tabbyArt } from "@/lib/tabby";
import "@fontsource-variable/bricolage-grotesque";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Cotab: receipts, read for you",
  description:
    "Snap or forward any receipt. Tabby reads every line, keeps your budgets honest and splits the bill with friends.",
};

/** Tabby's clips are muted loops; landing-motion.js plays each one while it is on screen. */
function Clip({ name, label, eager = false }: { name: string; label: string; eager?: boolean }) {
  return (
    <video
      className="clip"
      data-clip
      muted
      loop
      playsInline
      preload={eager ? "auto" : "none"}
      poster={`/landing/tabby-${name}.jpg`}
      aria-label={label}
      width={720}
      height={720}
    >
      <source src={`/landing/tabby-${name}.mp4`} type="video/mp4" />
    </video>
  );
}

/** A handwritten aside with an arrow that draws itself in. */
function Note({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`note ${className}`} aria-hidden="true">
      {children}
      <svg viewBox="0 0 80 50" width="64" height="40" fill="none">
        <path d="M4 8c22-6 50 0 64 30" />
        <path d="M56 33l12 7 3-14" />
      </svg>
    </span>
  );
}

const HERO_LINES: Array<[string, string, string?]> = [
  ["OAT MILK 64OZ", "4.29", "Groceries"],
  ["BANANAS X6", "1.74"],
  ["SOURDOUGH LOAF", "4.99"],
  ["DARK CHOCOLATE", "2.49", "Treats"],
  ["COFFEE BEANS 12OZ", "8.99", "Coffee"],
];

const LEAKS: Array<[string, string]> = [
  ["Oat milk, ninth carton this month", "38.61"],
  ["The streaming plan you forgot", "15.49"],
  ["Gym, last visit in March", "49.00"],
  ["Dinner. Who paid?", "86.40"],
  ["Coffee, “just one” ×14", "64.75"],
  ["A price that quietly went up", "3.00"],
  ["Delivery fees", "27.96"],
];

const BUDGETS = [
  { name: "October plan", spent: 1904.13, of: 2400 },
  { name: "Dining out", spent: 212.4, of: 250 },
  { name: "Trader Joe’s", spent: 96.12, of: 150 },
  { name: "Oat milk", spent: 38.61, of: 24 },
];

const FAQ = [
  [
    "What can Tabby read?",
    "Photos of paper receipts, PDFs and the receipts you forward from email. Every line is read with its price, so later you can search for one item, not just the shop.",
  ],
  [
    "Do my friends need Cotab?",
    "No. They get a link that shows what they owe and what for, and pay you with Venmo, PayPal, Cash App or Zelle.",
  ],
  [
    "Will Tabby change things without asking?",
    "Never. Answers come straight away. A change to a category, a split or a budget waits for your yes, and can be undone.",
  ],
  [
    "How is tax shared in a split?",
    "In proportion to what each person had, rounded so every cent of the total belongs to someone.",
  ],
  [
    "Who can see my receipts?",
    "Only you. A split you share shows that one receipt to the people on it, read-only.",
  ],
  [
    "Can I take my data with me?",
    "Yes. Export everything at any time. Delete your account and you have 30 days to change your mind.",
  ],
  [
    "Does it work on my phone?",
    "Yes. Add Cotab to your Home Screen; on iPhone, that is also what turns on notifications.",
  ],
];

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Landing() {
  const leakTotal = LEAKS.reduce((a, [, v]) => a + Number(v), 0);
  return (
    <div className="lp" id="top">
      <LandingNav />
      <main>
        {/* 1. The receipt prints; Tabby waves from the top of it. */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              Receipts,
              <br />
              <em>read</em> for you.
            </h1>
            <p className="hero-deck">
              Snap a receipt or forward the email. Tabby reads every line, keeps your budgets honest
              and splits the bill with friends.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-lime" href={routes.register}>
                Get started free
              </Link>
              <a className="text-link" href="#how">
                See how it works
              </a>
            </div>
            <Note className="note-hero">psst, he reads every line</Note>
          </div>
          <div
            className="hero-slip slip shutter"
            data-ui
            style={{ ["--paper" as string]: "#fdf1dc" }}
          >
            <Clip name="wave" label="Tabby waves hello from the top of a receipt" eager />
            <div className="rc">
              <p className="rc-head">
                TRADER JOE&apos;S #552
                <span>OCT 28 · 6:42 PM</span>
              </p>
              <ul>
                {HERO_LINES.map(([item, price, tag], i) => (
                  <li key={item} className="rc-row print" style={{ ["--i" as string]: i }}>
                    <span>
                      {item}
                      {tag && <em className="tag">{tag}</em>}
                    </span>
                    <span>{price}</span>
                  </li>
                ))}
              </ul>
              <p className="rc-row rc-total print" style={{ ["--i" as string]: HERO_LINES.length }}>
                <span>TOTAL</span>
                <span>$22.50</span>
              </p>
              <p className="stamp print" style={{ ["--i" as string]: HERO_LINES.length + 1.5 }}>
                Read · 5 lines · filed
              </p>
            </div>
          </div>
        </section>

        {/* 2. The problem, printed as the receipt nobody keeps. */}
        <section className="leaks" aria-labelledby="leaks-title">
          <div className="leaks-film slip" style={{ ["--paper" as string]: "#fdf1dc" }}>
            <Clip name="tangle" label="Tabby gets tangled up in a long receipt" />
          </div>
          <div className="leaks-copy">
            <h2 id="leaks-title" data-reveal>
              Where did <em>October</em> go?
            </h2>
            <p data-reveal>
              Receipts pile up in pockets, inboxes and group chats. The small stuff adds up long
              before anyone notices.
            </p>
            <div className="ribbon-wrap">
              <div className="ribbon" data-ui>
                <p className="rc-head">
                  THE RECEIPT NOBODY KEEPS
                  <span>OCTOBER 1 TO 28</span>
                </p>
                <ul>
                  {LEAKS.map(([what, amt]) => (
                    <li key={what} className="rc-row">
                      <span>{what}</span>
                      <span>{amt}</span>
                    </li>
                  ))}
                </ul>
                <p className="rc-row rc-total">
                  <span>Gone, quietly</span>
                  <span>{usd(leakTotal)}</span>
                </p>
                <p className="ribbon-foot">Tabby untangles it.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Three steps, three tiles: catch, chop, filed. */}
        <section className="how" id="how" aria-labelledby="how-title">
          <div className="how-head">
            <h2 id="how-title" data-reveal>
              Snap it. Tabby does <em>the rest.</em>
            </h2>
            <p data-reveal>
              No typing, no sorting. Snap the paper ones on your way out of the shop, and forward
              the rest from any inbox.
            </p>
          </div>
          <ol className="how-tiles">
            <li className="tile tile-catch" data-reveal>
              <Clip name="catch" label="Tabby leaps and catches a falling receipt" />
              <p>
                <strong>Snap it or forward it.</strong> A photo, a PDF, or the email receipt from
                any shop.
              </p>
            </li>
            <li className="tile tile-chop" data-reveal>
              <Clip name="karate" label="Tabby karate-chops a long receipt into a neat stack" />
              <p>
                <strong>Tabby reads every line.</strong> Item, price, category and shop, checked
                against the total.
              </p>
            </li>
            <li className="tile tile-done" data-reveal>
              <div className="done-stage">
                <div className="card done-card" data-ui>
                  <p className="card-top">
                    <span>Trader Joe&apos;s</span>
                    <span>$22.50</span>
                  </p>
                  <p className="card-meta">Oct 28 · 5 items · Groceries</p>
                  <p className="card-row">
                    <span>Oat milk budget</span>
                    <span className="neg">$38.61 of $24</span>
                  </p>
                  <p className="card-row">
                    <span>Split with Maya</span>
                    <span>$11.25 each</span>
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element -- Tabby's stock art, already small WebP */}
                <img
                  className="done-cat"
                  src={tabbyArt("done", 640)}
                  alt="Tabby holding up a tick"
                  width={640}
                  height={640}
                  loading="lazy"
                />
                <p className="chip done-chip" data-ui>
                  <span className="ms" aria-hidden="true">
                    check_circle
                  </span>
                  Maya paid you $11.25
                </p>
                <Note className="note-done">all filed!</Note>
              </div>
              <p>
                <strong>Filed, budgeted, split.</strong> Your plan updates and anyone who shared it
                knows their part.
              </p>
            </li>
          </ol>
        </section>

        {/* 4. The live thing: split a real dinner. */}
        <section className="splits" id="splits" aria-labelledby="splits-title">
          <div className="splits-copy" data-reveal>
            <h2 id="splits-title">
              Who had the <em>fries?</em>
            </h2>
            <p>
              Tap a line, pick who had it. Tax is shared in proportion, and every cent lands on
              somebody.
            </p>
            <Note className="note-split">go on, tap a name</Note>
          </div>
          <SplitDemo />
        </section>

        {/* 5. Budgets down to one item. */}
        <section className="budgets" id="budgets" aria-labelledby="budgets-title">
          <div className="slip budgets-slip" style={{ ["--paper" as string]: "#fef2db" }}>
            <Clip name="coins" label="Tabby hugs a gold coin beside a stack of savings" />
          </div>
          <div className="budgets-copy">
            <h2 id="budgets-title" data-reveal>
              Budgets down to the <em>oat milk.</em>
            </h2>
            <p data-reveal>
              Set a plan for the month, a shop, a category or one item. Tabby counts every line
              against it.
            </p>
            <ul className="meters" data-ui data-reveal>
              {BUDGETS.map((b) => {
                const pct = Math.round((b.spent / b.of) * 100);
                const tone = pct > 100 ? "neg" : pct >= 80 ? "warn" : "pos";
                return (
                  <li key={b.name} className={`meter meter-${tone}`}>
                    <span className="meter-name">{b.name}</span>
                    <span className="meter-amt">
                      {usd(b.spent)} of {usd(b.of)}
                    </span>
                    <span className="meter-track">
                      <span style={{ width: `${Math.min(pct, 100)}%` }} />
                    </span>
                    <span className="meter-note">
                      {pct > 100 ? `Over by ${usd(b.spent - b.of)}` : `${pct}% used`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Note className="note-budget">too much oat milk, Tabby noticed</Note>
          </div>
        </section>

        {/* 6. What Tabby will speak up about. */}
        <section className="speak" aria-labelledby="speak-title">
          <div className="speak-head">
            <div data-reveal>
              <h2 id="speak-title">
                Tabby <em>speaks up.</em>
              </h2>
              <p>Pick what is worth a nudge. Everything else stays quiet.</p>
            </div>
            <div className="slip speak-slip" style={{ ["--paper" as string]: "#f9f4e8" }}>
              <Clip name="megaphone" label="Tabby announces something through a megaphone" />
            </div>
          </div>
          <Switches />
        </section>

        {/* 7. The real app. */}
        <section className="app" id="ask" aria-labelledby="app-title">
          <Showcase />
        </section>

        {/* 8. Questions. */}
        <section className="faq" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">
            Fair <em>questions</em>
          </h2>
          <div className="faq-list">
            {FAQ.map(([q, a], i) => (
              <details key={q} name="faq" open={i === 0}>
                <summary>
                  {q}
                  <span className="plus" aria-hidden="true" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 9. The first step, already open. */}
        <section className="start" id="start" aria-labelledby="start-title">
          <div className="start-copy">
            <h2 id="start-title">
              Start your <em>tab.</em>
            </h2>
            <p>Make an account, snap one receipt and watch Tabby read it. It takes a minute.</p>
          </div>
          <div className="sheet" data-ui>
            <p className="sheet-title">Add your first receipt</p>
            <ul>
              <li>
                <span className="sheet-ico" aria-hidden="true">
                  Photo
                </span>
                Take a photo
              </li>
              <li>
                <span className="sheet-ico" aria-hidden="true">
                  PDF
                </span>
                Upload a PDF
              </li>
              <li>
                <span className="sheet-ico" aria-hidden="true">
                  Email
                </span>
                Forward an email receipt
              </li>
            </ul>
            <Link className="btn btn-lime" href={routes.register}>
              Get started free
            </Link>
          </div>
        </section>
      </main>

      <footer className="foot">
        <a className="foot-mark" href="#top" aria-label="Cotab, back to top">
          {/* eslint-disable-next-line @next/next/no-img-element -- the official wordmark */}
          <img src="/brand/cotab-horizontal-flat-ink.svg" alt="Cotab" width={1400} height={319} />
        </a>
        <div className="foot-row">
          <nav aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#splits">Splits</a>
            <a href="#ask">The app</a>
            <a href="#faq">Questions</a>
          </nav>
          <nav aria-label="Account">
            <Link href={routes.login}>Sign in</Link>
            <Link href={routes.register}>Create an account</Link>
          </nav>
          <p>© 2026 Cotab. Receipts read, budgets honest, friends still friends.</p>
        </div>
      </footer>
      <LandingMotion />
    </div>
  );
}
