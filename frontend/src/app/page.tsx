import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";

import { LandingMotion } from "@/components/LandingMotion";
import { LandingNav } from "@/components/LandingNav";
import { BigWord } from "@/components/landing/BigWord";
import { Clip } from "@/components/landing/Clip";
import { FloatingReceipts } from "@/components/landing/FloatingReceipts";
import { GlassRings } from "@/components/landing/GlassRings";
import { MorphWord } from "@/components/landing/MorphWord";
import { Showcase } from "@/components/landing/Showcase";
import { SnapViewfinder } from "@/components/landing/SnapViewfinder";
import { SpendChart } from "@/components/landing/SpendChart";
import { SplitDemo } from "@/components/landing/SplitDemo";
import { Switches } from "@/components/landing/Switches";
import { routes } from "@/lib/routes";
import { tabbyArt } from "@/lib/tabby";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Cotab: receipts, handled by Tabby",
  description:
    "Snap a photo or forward an email. Tabby reads every line, updates your budgets, and splits the bill with friends.",
};

const TRUST = [
  "Reads paper receipts, PDFs & emails",
  "Item-level accuracy",
  "Works with Venmo, PayPal, Cash App & Zelle",
  "Your data stays yours",
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

const STEPS = [
  [
    "Snap or forward",
    "A photo of a paper receipt, a PDF, or the email from any shop. That’s all it takes.",
  ],
  [
    "Tabby reads every line",
    "Item, price, category, and shop, checked against the total. Nothing is left as “miscellaneous.”",
  ],
  [
    "Filed, budgeted, split",
    "Your plan updates. Anyone who shared the bill knows exactly what they owe.",
  ],
];

const SPLIT_POINTS = [
  "Assign items to multiple people in one tap",
  "Tax and tip calculated fairly by share",
  "Friends pay via Venmo, PayPal, Cash App or Zelle — no app required",
];

const BUDGET_POINTS = [
  "Monthly, category, merchant, or item-level budgets",
  "Live progress that updates the moment a receipt is filed",
  "Clear overspend signals without the noise",
];

const BUDGETS = [
  { name: "October plan", spent: 1904.13, of: 2400, note: "79% used" },
  { name: "Dining out", spent: 212.4, of: 250, note: "85% used · 4 days left" },
  { name: "Oat milk", spent: 38.61, of: 24, note: "Over by $14.61" },
];

const NUDGES = [
  ["Budget alert", "Dining is at 85% — $212 of $250, with four days to go."],
  ["Price change", "Your usual oat milk went up $0.40 this week."],
  ["Friendly reminder", "Priya still owes $101.80 from last Friday’s dinner. Want to nudge?"],
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

/** A section's name, set small above its heading. */
function Mark({ children }: { children: React.ReactNode }) {
  return (
    <p className="mark" data-reveal>
      {children}
    </p>
  );
}

/** A short list of what a section's feature does, each line led by an arrow. */
function Points({ items }: { items: string[] }) {
  return (
    <ul className="points" data-reveal>
      {items.map((t) => (
        <li key={t}>
          <ArrowRight aria-hidden="true" />
          {t}
        </li>
      ))}
    </ul>
  );
}

export default function Landing() {
  const leakTotal = LEAKS.reduce((a, [, v]) => a + Number(v), 0);
  return (
    <div className="lp" id="top">
      <LandingNav />
      <main>
        {/* 1. A studio shot: Tabby in front of his own name, the promise above him. */}
        <section className="hero" aria-labelledby="hero-title">
          <BigWord word="TABBY" />
          <div className="hero-copy">
            <Mark>Meet Tabby, your AI agent</Mark>
            <h1 id="hero-title" className="hero-title">
              <span className="wide">Receipts,</span>
              <span className="serif">
                <MorphWord words={["handled", "read", "split", "sorted"]} /> by Tabby.
              </span>
            </h1>
            <p className="hero-deck" data-reveal>
              Snap it or forward it. Tabby reads every line, keeps the budget and splits the bill.
            </p>
          </div>
          <div className="hero-stage" data-tilt>
            <span className="hero-shadow" aria-hidden="true" />
            <Clip name="wave" label="Tabby, Cotab's AI agent, waves hello" className="hero-cat" />
          </div>
          <div className="hero-actions">
            <Link className="btn-dark" href={routes.start}>
              Get started free
              <ArrowUpRight aria-hidden="true" />
            </Link>
            <a className="btn-line" href="#how">
              See how it works
            </a>
          </div>
        </section>

        <div className="marquee" aria-label="What Cotab does">
          {/* The second run is the seamless join for the loop. */}
          {[false, true].map((copy) => (
            <ul key={String(copy)} aria-hidden={copy || undefined}>
              {[...TRUST, ...TRUST].map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ))}
        </div>

        {/* 2. The quiet problem: sage on the left, warming into the cream of Tabby's own film. */}
        <section className="leaks day" id="leaks" aria-labelledby="leaks-title">
          <div className="leaks-copy">
            <Mark>The quiet problem</Mark>
            <h2 id="leaks-title" data-reveal>
              <span className="wide">Where did</span>
              <span className="serif">the money go?</span>
            </h2>
            <p data-reveal>
              Receipts pile up in pockets, inboxes, and group chats. The small stuff adds up long
              before anyone notices — until Tabby untangles it.
            </p>
            <div className="ledger" data-ui data-reveal>
              <p className="ledger-head">
                The receipt nobody keeps
                <span>Oct 1 – 28</span>
              </p>
              <ul>
                {LEAKS.map(([what, amt]) => (
                  <li key={what}>
                    <span>{what}</span>
                    <span>{amt}</span>
                  </li>
                ))}
              </ul>
              <p className="ledger-total">
                <span>Gone, quietly</span>
                <span className="count" data-count={leakTotal.toFixed(2)}>
                  {usd(leakTotal)}
                </span>
              </p>
            </div>
          </div>
          <div className="leaks-art">
            <Clip
              name="tangle"
              label="Tabby gets tangled up in a long receipt"
              className="leaks-film"
              boxed
            />
            <p className="leaks-caption">Tabby untangles it.</p>
          </div>
        </section>

        {/* 3. Simple by design: the snap, happening, beside the three steps. */}
        <FloatingReceipts />

        <section className="how studio" id="how" aria-labelledby="how-title">
          <div className="how-visual">
            <SnapViewfinder />
            <div className="how-tabby">
              <span className="floor-shadow" aria-hidden="true" />
              {/* eslint-disable-next-line @next/next/no-img-element -- Tabby's stock art, already small WebP */}
              <img
                src={tabbyArt("working", 640)}
                alt="Tabby checking a receipt through a magnifying glass"
                width={640}
                height={640}
                loading="lazy"
              />
            </div>
          </div>
          <div className="how-copy">
            <Mark>Simple by design</Mark>
            <h2 id="how-title" data-reveal>
              <span className="wide">Snap it.</span>
              <span className="serif">Tabby does the rest.</span>
            </h2>
            <p className="lede" data-reveal>
              No typing. No sorting. Just hand Tabby the receipt and move on.
            </p>
            <ol className="steps">
              {STEPS.map(([title, text], i) => (
                <li key={title} data-reveal>
                  <b className="step-n">0{i + 1}</b>
                  <div>
                    <p className="step-title">{title}</p>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. Item-level intelligence: split a real dinner. */}
        <section className="splits day" id="splits" aria-labelledby="splits-title">
          <div className="sec-head">
            <div>
              <Mark>Item-level intelligence</Mark>
              <h2 id="splits-title" data-reveal>
                <span className="wide">Who had the</span>
                <span className="serif">fries?</span>
              </h2>
            </div>
            <div>
              <p className="lede" data-reveal>
                Tap any line and assign it. Tax is shared in proportion, and every cent lands on
                somebody. No more awkward “just send me half.”
              </p>
              <Points items={SPLIT_POINTS} />
            </div>
          </div>
          <SplitDemo />
        </section>

        {/* 5. Precision budgeting: the month as glass tubes, and the plans behind it. */}
        <section className="budgets" id="budgets" aria-labelledby="budgets-title">
          <div className="budgets-copy">
            <Mark>Precision budgeting</Mark>
            <h2 id="budgets-title" data-reveal>
              <span className="wide">Budgets down to the</span>
              <span className="serif">
                <MorphWord words={["oat milk.", "coffee.", "takeout.", "groceries."]} />
              </span>
            </h2>
            <p className="lede" data-reveal>
              Set a plan for the month, a category, a shop, or a single recurring item. Tabby counts
              every line against it — so you actually know where the money went.
            </p>
            <Points items={BUDGET_POINTS} />
          </div>
          <div className="budgets-data">
            <SpendChart />
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
                      <span style={{ ["--w" as string]: `${Math.min(pct, 100)}%` }} />
                    </span>
                    <span className="meter-note">{b.note}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 6. Not a scanner: an agent that speaks up, asks first, and stays quiet otherwise. */}
        <section className="agent day" aria-labelledby="agent-title">
          <div className="agent-copy">
            <Mark>Quiet intelligence</Mark>
            <h2 id="agent-title" data-reveal>
              <span className="wide">Not a scanner.</span>
              <span className="serif">An agent that speaks up, only when it matters.</span>
            </h2>
            <p className="lede" data-reveal>
              Tabby reads like a person and asks before it acts. Choose what deserves a nudge;
              everything else stays quiet.
            </p>
            <Switches />
          </div>
          <div className="agent-stage">
            <Clip
              name="megaphone"
              label="Tabby announcing a nudge through a megaphone"
              className="agent-film"
              boxed
            />
            <ul className="nudges" aria-label="What Tabby says">
              {NUDGES.map(([kind, text], i) => (
                <li key={kind} className="nudge" style={{ ["--i" as string]: i }} data-reveal>
                  <span className="nudge-ring" aria-hidden="true" />
                  <div>
                    <p className="nudge-kind">{kind}</p>
                    <p>{text}</p>
                  </div>
                  <span className="nudge-time">now</span>
                </li>
              ))}
            </ul>
            <div className="approve" data-ui data-reveal>
              <p className="approve-head">
                <span className="approve-dot" aria-hidden="true" />
                Tabby suggests
              </p>
              <p className="approve-text">
                Split Trader Joe&apos;s, $22.50, with Maya — $11.25 each.
              </p>
              <p className="approve-actions">
                <span className="approve-yes">
                  <Check aria-hidden="true" />
                  Approve
                </span>
                <span className="approve-no">Not now</span>
              </p>
              <p className="approve-note">Nothing moves without your yes.</p>
            </div>
          </div>
        </section>

        {/* 7. The real app, tilting up as it arrives. */}
        <section className="app" id="ask" aria-labelledby="app-title">
          <Showcase />
        </section>

        {/* 9. Questions. */}
        <section className="faq" id="faq" aria-labelledby="faq-title">
          <GlassRings uid="faq" className="faq-rings" />
          <div>
            <Mark>Questions</Mark>
            <h2 id="faq-title" data-reveal>
              <span className="wide">Fair</span>
              <span className="serif">questions.</span>
            </h2>
          </div>
          <div className="faq-list">
            {FAQ.map(([q, a], i) => (
              <details key={q} name="faq" open={i === 0}>
                <summary>
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  {q}
                  <span className="plus" aria-hidden="true" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 10. The close: the mark itself, two halves of one tab, in glass. */}
        <section className="start" id="start" aria-labelledby="start-title">
          <div className="start-stage" aria-hidden="true">
            <GlassRings uid="close" className="start-rings" />
            <GlassRings uid="close-r" className="start-reflection" />
          </div>
          <h2 id="start-title">
            <span className="wide">One tab.</span>
            <span className="serif">Two halves, settled.</span>
          </h2>
          <p className="lede">
            Snap your first receipt and watch Tabby read it. It takes a minute, and it&apos;s free.
          </p>
          <Link className="btn-lime" href={routes.start}>
            Get started free
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className="foot">
        <a className="foot-mark" href="#top" aria-label="Cotab, back to top">
          {/* eslint-disable-next-line @next/next/no-img-element -- the official wordmark */}
          <img
            src="/brand/cotab-horizontal-glass-on-dark.svg"
            alt="Cotab"
            width={1400}
            height={319}
          />
        </a>
        <div className="foot-row">
          <nav aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#splits">Splits</a>
            <a href="#budgets">Budgets</a>
            <a href="#faq">Questions</a>
          </nav>
          <nav aria-label="Account">
            <Link href={routes.login}>Sign in</Link>
            <Link href={routes.start}>New here</Link>
          </nav>
          <p>© 2026 Cotab. Receipts read, budgets honest, friends still friends.</p>
        </div>
      </footer>
      <LandingMotion />
    </div>
  );
}
