import type { Metadata } from "next";
import Link from "next/link";
/* eslint-disable @next/next/no-img-element -- local Tabby artwork is already optimized */

import { LandingMotion } from "@/components/LandingMotion";
import { LandingNav } from "@/components/LandingNav";
import { Logo } from "@/components/Logo";
import { routes } from "@/lib/routes";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Cotab — receipts, handled",
  description:
    "Give Cotab a receipt. Tabby reads every line, updates your budget and keeps shared costs clear.",
};

function Video({ name, label, eager = false }: { name: string; label: string; eager?: boolean }) {
  return (
    <video
      className="tabby-film"
      autoPlay={eager}
      muted
      loop
      playsInline
      preload={eager ? "auto" : "none"}
      poster={`/landing/tabby-${name}.jpg`}
      aria-label={label}
    >
      <source src={`/landing/tabby-${name}.mp4`} type="video/mp4" />
    </video>
  );
}

export default function Landing() {
  return (
    <div className="lp" id="top">
      <LandingNav />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title" className="hero-sentence">
            <span className="hero-line">Money</span>
            <span className="hero-line hero-line-media">
              <span className="hero-inline-film"><Video name="catch" label="Tabby catches and reads a receipt" eager /></span>
              makes sense.
            </span>
          </h1>
          <div className="hero-close">
            <p className="hero-deck">Ask Tabby anything about your money. Answers arrive now; every change waits for your approval.</p>
            <div className="hero-actions"><Link className="btn btn-paper" href={routes.register}>Start with one receipt <span aria-hidden="true">↗</span></Link><a className="text-link" href="#demo">See the New UI</a></div>
          </div>
        </section>

        <section className="manifesto" id="how" aria-labelledby="manifesto-title">
          <h2 id="manifesto-title">Answers now. Changes after you say yes.</h2>
          <div className="manifesto-grid">
            <p>
              Tabby can read the oat milk, find the train ticket, prepare the shared fries, and explain where the month went—without quietly changing your money behind your back.
            </p>
            <ul>
              <li>Ask in plain language</li>
              <li>Review every action</li>
              <li>Undo whenever you need</li>
            </ul>
          </div>
        </section>

        <section className="demo" id="demo" aria-labelledby="demo-title">
          <div className="demo-copy">
            <h2 id="demo-title">Tabby, on your terms.</h2>
            <p>
              Ask, review, automate, or correct what Tabby remembers. Every change stays visible and
              waits for your approval.
            </p>
            <div className="demo-tabs" role="tablist" aria-label="Tabby sections">
              <button
                className="is-active"
                type="button"
                role="tab"
                id="tabby-tab-ask"
                aria-controls="tabby-panel-ask"
                aria-selected="true"
                tabIndex={0}
                data-tabby-mode="ask"
              >
                Ask
              </button>
              <button type="button" role="tab" id="tabby-tab-activity" aria-controls="tabby-panel-activity" aria-selected="false" tabIndex={-1} data-tabby-mode="activity">
                Activity
              </button>
              <button type="button" role="tab" id="tabby-tab-rules" aria-controls="tabby-panel-rules" aria-selected="false" tabIndex={-1} data-tabby-mode="rules">
                Rules
              </button>
              <button type="button" role="tab" id="tabby-tab-memories" aria-controls="tabby-panel-memories" aria-selected="false" tabIndex={-1} data-tabby-mode="memories">
                Memories
              </button>
            </div>
          </div>
          <div className="tabby-product" data-tabby-product="ask" data-ui>
            <div className="tabby-product-head">
              <span>
                <b>Tabby</b>
                <small>Your money assistant</small>
              </span>
              <span className="tabby-status">Approval always on</span>
            </div>
            <div className="tabby-pane is-active" id="tabby-panel-ask" role="tabpanel" aria-labelledby="tabby-tab-ask" data-tabby-pane="ask">
              <div className="tabby-ask-hero">
                <div>
                  <strong>Ask, check, or change something.</strong>
                  <p>Answers are immediate. Changes always wait for your approval.</p>
                </div>
                <img src="/cat-v3-stock/png/working.png" alt="" />
              </div>
              <div className="tabby-question">
                <span>How much did I spend eating out this month?</span>
                <b aria-hidden="true">↑</b>
              </div>
            </div>
            <div className="tabby-pane" id="tabby-panel-activity" role="tabpanel" aria-labelledby="tabby-tab-activity" data-tabby-pane="activity" hidden>
              <h3>Everything Tabby did</h3>
              <p className="pane-intro">Clear, reversible, and timestamped.</p>
              <div className="activity-row">
                <b>Costco receipt categorized</b>
                <span>12 items · Groceries · 2m ago</span>
                <em>Done</em>
              </div>
              <div className="activity-row">
                <b>Dinner split prepared</b>
                <span>Waiting for your review</span>
                <em className="waiting">Approve</em>
              </div>
            </div>
            <div className="tabby-pane" id="tabby-panel-rules" role="tabpanel" aria-labelledby="tabby-tab-rules" data-tabby-pane="rules" hidden>
              <h3>Rules</h3>
              <p className="pane-intro">Automatic actions you can pause anytime.</p>
              <div className="rule-row">
                <span>
                  <b>Split every Costco receipt with Ben</b>
                  <small>Ran 6 times</small>
                </span>
                <i>On</i>
              </div>
              <div className="rule-row">
                <span>
                  <b>Tag Uber as Transport</b>
                  <small>Ran 14 times</small>
                </span>
                <i>On</i>
              </div>
            </div>
            <div className="tabby-pane" id="tabby-panel-memories" role="tabpanel" aria-labelledby="tabby-tab-memories" data-tabby-pane="memories" hidden>
              <h3>Memories</h3>
              <p className="pane-intro">Things you told Tabby. Editable and removable.</p>
              <div className="memory-row">
                <img src="/cat-v3-stock/png/remember.png" alt="" />
                <span>
                  <b>Maya and I split dinner evenly</b>
                  <small>Used only to personalize Tabby’s help</small>
                </span>
                <button type="button" aria-label="Remove example memory">
                  ×
                </button>
              </div>
              <div className="memory-row">
                <img src="/cat-v3-stock/png/remember.png" alt="" />
                <span>
                  <b>My monthly dining budget is $300</b>
                  <small>You stay in control of what is remembered</small>
                </span>
                <button type="button" aria-label="Remove example memory">
                  ×
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="chaos" id="cat" aria-labelledby="chaos-title">
          <div className="chaos-film">
            <Video name="receipt-chaos" label="Tabby escapes a long receipt" />
          </div>
          <div className="chaos-copy">
            <h2 id="chaos-title">Tiny cat. Zero patience for money admin.</h2>
            <p>
              Ask what you spent, set a rule, or teach Tabby how you split brunch. Nothing moves
              without your say-so.
            </p>
          </div>
        </section>

        <section className="proof" id="splits" aria-labelledby="proof-title">
          <div className="proof-copy">
            <h2 id="proof-title">The satisfying bit.</h2>
            <p>
              Receipts land where they belong. Your budget stays current. Your group tab stays
              honest.
            </p>
          </div>
          <div className="proof-film">
            <Video name="sorted" label="Tabby neatly sorts a pile of receipts" />
          </div>
          <div className="proof-facts" aria-label="Cotab capabilities">
            <p>
              <strong>1 snap</strong>
              <span>to capture every line</span>
            </p>
            <p>
              <strong>0 guessing</strong>
              <span>when the bill is shared</span>
            </p>
            <p>
              <strong>you approve</strong>
              <span>before anything changes</span>
            </p>
          </div>
        </section>

        <section className="finale" aria-labelledby="finale-title">
          <div className="finale-film">
            <Video name="wave" label="Tabby waves hello" />
          </div>
          <div className="finale-copy">
            <h2 id="finale-title">Ready to lose the paper trail?</h2>
            <p>Start with one receipt. Tabby will take it from there.</p>
            <Link className="btn btn-paper" href={routes.register}>
              Meet your money sidekick <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <a className="footer-logo" href="#top">
          <Logo height={28} tone="flat" />
        </a>
        <p>Receipts read. Budgets honest. Friends still friends.</p>
        <div>
          <Link href={routes.login}>Sign in</Link>
          <a href="mailto:hello@cotab.app">Contact</a>
        </div>
      </footer>
      <LandingMotion />
    </div>
  );
}
