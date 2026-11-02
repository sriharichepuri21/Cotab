/* eslint-disable @next/next/no-img-element -- local art, served as is */
import type { Metadata } from "next";
import Link from "next/link";

import { CotabLogo } from "@/components/CotabLogo";
import { Catches } from "@/components/landing/Catches";
import { LandingNav } from "@/components/landing/LandingNav";
import { Month } from "@/components/landing/Month";
import { Motion } from "@/components/landing/Motion";
import { Story } from "@/components/landing/Story";
import { SpendChart } from "@/components/landing/SpendChart";
import { SplitDemo } from "@/components/landing/SplitDemo";
import { Switches } from "@/components/landing/Switches";
import { routes } from "@/lib/routes";
import { tabbyPose } from "@/lib/tabby";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Cotab: receipts, handled by Tabby",
  description:
    "Snap a photo or forward an email. Tabby reads every line, updates your budgets, and splits the bill with friends.",
};

const LEAKS: Array<[string, string]> = [
  ["Oat milk, ninth carton this month", "38.61"],
  ["The streaming plan you forgot", "15.49"],
  ["Gym, last visit in March", "49.00"],
  ["Dinner. Who paid?", "86.40"],
  ["Coffee, “just one” ×14", "64.75"],
  ["A price that quietly went up", "3.00"],
  ["Delivery fees", "27.96"],
];

const SPLIT_RULES = [
  ["Tap a name", "Each line goes to whoever had it."],
  ["Tax follows the food", "Shared by what each person had."],
  ["Every cent lands", "Nothing left over, nothing rounded away."],
];

const BUDGET_RULES = [
  ["Any size of plan", "A month, a category, a shop or one item."],
  ["Live as you spend", "Bars move the moment a receipt is filed."],
  ["Clear when you’re over", "A signal when it matters, no noise."],
];

const FAQ = [
  [
    "What can Tabby read?",
    "Photos of paper receipts, PDFs and the receipts you forward from email. Every line is read with its price, so later you can search for one item.",
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
];

export default function Landing() {
  return (
    <div className="ln" id="top">
      <Motion />
      <LandingNav />

      <section className="ln-hero" aria-labelledby="hero-title">
        <div className="ln-hero-copy">
          <h1 id="hero-title" data-intro>
            Receipts, handled by Tabby
          </h1>
          <p data-intro>
            Snap it or forward it. Tabby reads every line, keeps the budget and splits the bill.
          </p>
          <div className="ln-acts" data-intro>
            <Link className="ln-btn" href={routes.start}>
              Get started free
            </Link>
            <a className="ln-btn ln-btn-quiet" href="#how">
              See how it works
            </a>
          </div>
        </div>
        <img src="/tabby/hero.webp" alt="Tabby hugging a big heart" className="ln-hero-tabby" />
      </section>

      <main>
        <section className="ln-lost" aria-labelledby="lost-title">
          <video
            className="ln-film"
            data-film
            poster="/landing/hero-rain.webp"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          >
            <source src="/landing/hero-rain.webm" type="video/webm" />
            <source src="/landing/hero-rain.mp4" type="video/mp4" />
          </video>
          <div className="ln-wrap ln-split ln-lost-grid">
            <div>
              <h2 id="lost-title" data-rise>
                Where did the money go?
              </h2>
              <p data-rise>
                Receipts pile up in pockets, inboxes and group chats. The small stuff adds up long
                before anyone notices.
              </p>
            </div>
            <div className="ln-card ln-lost-card" data-ui>
              <p className="ln-card-head">
                <b>What slipped past you</b>
                <span>Oct 1 – 28</span>
              </p>
              <ul>
                {LEAKS.map(([name, price]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <span>{price}</span>
                  </li>
                ))}
              </ul>
              <p className="ln-card-total">
                <span>Gone, quietly</span>
                <b>$285.21</b>
              </p>
            </div>
          </div>
        </section>

        <Story />

        <Catches />

        <section className="ln-gallery" data-gallery aria-label="What Cotab does for you">
          <div className="ln-track" data-track>
            <section className="ln-panel ln-split ln-try" id="split" aria-labelledby="try-title">
              <div className="ln-copy">
                <h2 id="try-title">Who had the fries?</h2>
                <p>Try it. This one is yours to split.</p>
                <ul className="ln-rail">
                  {SPLIT_RULES.map(([title, text]) => (
                    <li key={title}>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="ln-stage ln-stage-fit">
                <SplitDemo />
                <img
                  src={tabbyPose("love", 256)}
                  alt=""
                  className="ln-stage-tabby ln-stage-tabby-on"
                />
              </div>
            </section>

            <section
              className="ln-panel ln-split ln-budgets"
              id="budgets"
              aria-labelledby="budgets-title"
            >
              <div className="ln-copy">
                <h2 id="budgets-title">Budgets down to the oat milk</h2>
                <p>Every line counts against the plan, the moment it’s read.</p>
                <ul className="ln-rail">
                  {BUDGET_RULES.map(([title, text]) => (
                    <li key={title}>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="ln-stage">
                <div className="ln-card ln-stage-card ln-chart-card">
                  <p className="ln-card-head">
                    <b>October by category</b>
                    <span>Against budget</span>
                  </p>
                  <SpendChart />
                </div>
                <div className="ln-float">
                  <p>Oat milk</p>
                  <b>$14.61 over</b>
                  <p>$38.61 of $24</p>
                </div>
                <img
                  src={tabbyPose("worried", 256)}
                  alt=""
                  className="ln-stage-tabby ln-stage-tabby-on"
                />
              </div>
            </section>

            <section className="ln-panel ln-split ln-agent" aria-labelledby="agent-title">
              <div className="ln-copy">
                <h2 id="agent-title">Nothing moves without your yes</h2>
                <p>
                  Tabby answers straight away and speaks up only when it matters. A change waits for
                  you, and can be undone.
                </p>
                <div>
                  <Switches />
                </div>
              </div>
              <div className="ln-stage ln-plan" data-ui>
                <div className="ln-card ln-stage-card">
                  <p className="ln-plan-who">Tabby suggests</p>
                  <p className="ln-plan-say">Split Trader Joe’s, $22.50, with Maya. $11.25 each.</p>
                  <p className="ln-plan-acts">
                    <span>Approve</span>
                    <span>Not now</span>
                  </p>
                </div>
                <div className="ln-float">
                  <p>Changed your mind?</p>
                  <b>Undo anytime</b>
                </div>
                <img
                  src={tabbyPose("idea", 256)}
                  alt=""
                  className="ln-stage-tabby ln-stage-tabby-on"
                />
              </div>
            </section>

            <section className="ln-panel ln-over" id="month" aria-labelledby="month-title">
              <h2 id="month-title">One number a day</h2>
              <Month />
            </section>
          </div>
          <i className="ln-gallery-bar" data-gallery-bar aria-hidden="true" />
        </section>

        <section className="ln-wrap ln-faq" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions</h2>
          <div>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <div className="ln-end">
        <section className="ln-close" aria-labelledby="close-title">
          <h2 id="close-title" data-rise>
            One tab. Two halves, settled.
          </h2>
          <p data-rise>Snap your first receipt. It takes a minute, and it’s free.</p>
          <Link className="ln-btn" href={routes.start} data-rise>
            Get started free
          </Link>
        </section>
        <footer className="ln-wrap ln-footer">
          <CotabLogo height={22} />
          <nav aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#split">Try it</a>
            <a href="#month">Your month</a>
            <a href="#faq">Questions</a>
            <Link href={routes.login}>Log in</Link>
          </nav>
          <p>© 2026 Cotab</p>
        </footer>
      </div>
    </div>
  );
}
