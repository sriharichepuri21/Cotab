import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { LandingNav } from "@/components/LandingNav";
import { LogoIntro } from "@/components/LogoIntro";
import { TicketRail } from "@/components/TicketRail";
import { Meter, buttonClass } from "@/components/ui";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Cotab: keep tabs on everything you buy",
  description:
    "Snap a receipt and Cotab writes down every item, keeps you on budget and splits the bill with your household.",
};

/** The receipt in the hero, printed one line at a time. */
const HERO_LINES = [
  ["Starbucks", "5.75"],
  ["Trader Joe's", "23.48"],
  ["Safeway", "41.20"],
  ["Costco, your third", "62.13"],
] as const;

function Kicker({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`font-mono text-sm ${dark ? "text-mint" : "text-muted"}`}>{children}</p>;
}

function Soon() {
  return (
    <span className="ml-2 inline-block rounded-full border border-ink px-2 py-0.5 align-middle font-sans text-xs font-semibold">
      Coming soon
    </span>
  );
}

function StartButton({ className = "" }: { className?: string }) {
  return (
    <Link href={routes.register} className={`${buttonClass.primary} ${className}`}>
      <span aria-hidden="true">→</span>
      Start your tab
    </Link>
  );
}

const QUESTIONS = [
  [
    "Do I need to connect my bank?",
    "No. Snap a photo of a receipt and that's it. Cotab never asks for your bank login.",
  ],
  [
    "Who can see my receipts?",
    "Only you. When you split a bill, the people in that group see their share and the totals, not the rest of your tab.",
  ],
  [
    "Can I delete my data?",
    "Yes, from Settings. You can also download a copy of everything first.",
  ],
  [
    "What happens with a crumpled or faded receipt?",
    "Cotab tells you it couldn't read it. You can try again with a new photo or type it in.",
  ],
] as const;

export default function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <LogoIntro />
      <LandingNav />

      <main id="top">
        {/* Hero */}
        <section className="mx-auto grid max-w-5xl gap-10 px-5 pb-12 pt-10 md:grid-cols-[1.1fr_1fr] md:items-center md:gap-14 md:pb-20 md:pt-20">
          <div>
            <h1 className="lp-rise font-display text-[40px] leading-[1.02] [animation-delay:.1s] sm:text-5xl lg:text-[64px]">
              Keep tabs on <span className="hl">everything</span> you buy.
            </h1>
            <p className="lp-rise mt-5 max-w-md text-lg leading-relaxed [animation-delay:.25s]">
              Snap a receipt and Cotab writes down every item, keeps you on budget and splits the
              bill with your household.
            </p>
            <div className="lp-rise mt-7 flex flex-col gap-3 [animation-delay:.4s] sm:max-w-xs">
              <StartButton />
              <p className="text-center text-sm text-muted sm:text-left">
                No bank login needed. Delete your data anytime.
              </p>
            </div>
          </div>

          <div className="relative mb-8" aria-label="A receipt printing your purchases" role="img">
            <div className="torn-b border border-b-0 border-ink bg-card px-5 pb-8 pt-5 font-mono">
              <div className="flex justify-between text-xs text-muted">
                <span>YOUR TAB</span>
                <span>TODAY</span>
              </div>
              <div className="mt-3 flex flex-col gap-1.5 text-sm">
                {HERO_LINES.map(([name, price], i) => (
                  <div
                    key={name}
                    className="lp-print flex items-end"
                    style={{ animationDelay: `${0.6 + i * 0.3}s` }}
                  >
                    <span>{name}</span>
                    <span className="leader" />
                    <span>{price}</span>
                  </div>
                ))}
                <div
                  className="lp-print mt-2 flex items-end border-t border-dashed border-muted/60 pt-2.5 text-[15px] font-medium"
                  style={{ animationDelay: "1.9s" }}
                >
                  <span>TOTAL</span>
                  <span className="leader" />
                  <span>132.56</span>
                </div>
              </div>
            </div>
            <div className="lp-note relative z-10 -mt-1 ml-auto mr-2 w-52 rounded-card bg-mint p-3.5 ring-1 ring-ink md:absolute md:-bottom-24 md:-right-6 md:m-0">
              <p className="text-sm font-bold">Costco, split three ways</p>
              <p className="mt-1 text-[13px]">Sam and Dev each owe you $62.13</p>
            </div>
          </div>
        </section>

        {/* Ways in */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-5xl px-5 py-14 md:py-20">
            <Kicker>How it works</Kicker>
            <h2 className="mt-3 font-display text-[31px] leading-[1.05] md:text-[44px]">
              Three ways in. <span className="hl">One tab.</span>
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-card bg-mint p-6">
                <h3 className="text-xl font-bold">Snap</h3>
                <p className="mt-2 leading-relaxed">
                  Photograph a paper receipt. Every line is read and every price is kept, so you can
                  search for one item months later.
                </p>
              </div>
              <div className="rounded-card border border-ink p-6">
                <h3 className="text-xl font-bold">
                  Forward
                  <Soon />
                </h3>
                <p className="mt-2 leading-relaxed">
                  Order emails from Amazon, Uber and your café land on your tab, itemized, from your
                  private Cotab address.
                </p>
              </div>
              <div className="rounded-card bg-blush p-6">
                <h3 className="text-xl font-bold">Tap</h3>
                <p className="mt-2 leading-relaxed">
                  Pay with Apple Pay on your iPhone and the store and amount are on your tab before
                  you leave the counter. Scan the receipt later and its items join the same
                  purchase.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Household */}
        <section className="bg-ink/[0.05]">
          <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 md:grid-cols-2 md:items-center md:py-20">
            <div>
              <Kicker>Household</Kicker>
              <h2 className="mt-3 font-display text-[31px] leading-[1.05] md:text-[44px]">
                Settle the tab, <span className="hl">fairly.</span>
              </h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed">
                Split a receipt evenly or item by item. Tax is shared the way you choose, and Cotab
                works out the fewest payments to make everyone even.
              </p>
            </div>
            <TicketRail
              tickets={[
                { key: "sam", name: "Sam", label: "owes you", amount: "62.13" },
                { key: "maya", name: "Maya", label: "even", amount: "0.00", tone: "mint" },
                { key: "dev", name: "Dev", label: "you owe", amount: "18.40", tone: "blush" },
              ]}
            />
          </div>
        </section>

        {/* Budgets */}
        <section>
          <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 md:grid-cols-2 md:items-center md:py-20">
            <div className="md:order-2">
              <Kicker>Budgets</Kicker>
              <h2 className="mt-3 font-display text-[31px] leading-[1.05] md:text-[44px]">
                Know <span className="hl">before</span> you overspend.
              </h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed">
                Set a limit for everything, one category, one store or even one item, like coffee.
                Every new receipt is checked against it.
              </p>
            </div>
            <div className="rounded-card border border-ink bg-card p-5 md:order-1">
              {(
                [
                  ["Groceries", "$286 of $350", 82],
                  ["Coffee", "$41 of $60", 68],
                  ["Dining", "$134 of $120", 112],
                ] as const
              ).map(([label, text, pct]) => (
                <div key={label} className="mb-5 last:mb-0">
                  <div className="mb-1.5 flex justify-between gap-3 text-sm">
                    <span className="font-semibold">{label}</span>
                    <span className={pct > 100 ? "font-semibold text-rose" : ""}>
                      {text}
                      {pct > 100 ? ", over" : pct >= 80 ? ", close" : ""}
                    </span>
                  </div>
                  <Meter percent={pct} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Ask */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-5xl gap-10 px-5 py-14 md:grid-cols-2 md:items-center md:py-20">
            <div>
              <Kicker>Ask Cotab</Kicker>
              <h2 className="mt-3 font-display text-[31px] leading-[1.05] md:text-[44px]">
                Ask your receipts anything.
              </h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed">
                Answers come from your own purchases, down to the item.
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-card border border-ink bg-card p-5">
              <p className="max-w-[82%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-[15px] text-paper">
                Did we buy paper towels this month?
              </p>
              <p className="max-w-[90%] self-start rounded-[14px_14px_14px_4px] bg-ink/[0.07] px-3.5 py-3 text-[15px] leading-relaxed">
                Yes, twice. A 12-pack at Costco on Oct 11 and 2 rolls at Target on Oct 3.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["Coffee in October?", "What did Dev pay for?"].map((c) => (
                  <span key={c} className="rounded-full border border-line px-3 py-1.5 text-[13px]">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Coming next */}
        <section className="bg-ink text-paper">
          <div className="mx-auto max-w-5xl px-5 py-14 md:py-20">
            <Kicker dark>Coming next</Kicker>
            <h2 className="mt-3 font-display text-[31px] leading-[1.05] md:text-[44px]">
              It reads the receipt you never check.
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-card bg-paper p-5 text-ink">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-bold">Overcharge alerts</h3>
                  <span className="font-bold text-rose">$1.99</span>
                </div>
                <div className="mt-3 rounded-button border border-line bg-card px-3 py-2.5 font-mono text-[13px]">
                  <div className="flex items-end">
                    <span>BANANAS</span>
                    <span className="leader" />
                    <span>1.99</span>
                  </div>
                  <div className="flex items-end text-rose">
                    <span>BANANAS</span>
                    <span className="leader" />
                    <span>1.99</span>
                  </div>
                </div>
                <p className="mt-3 text-[15px]">
                  Rung up twice? Cotab will flag it so you can ask for the refund.
                </p>
              </div>
              <div className="rounded-card bg-paper p-5 text-ink">
                <h3 className="text-lg font-bold">What things really cost</h3>
                <div className="mt-3 flex h-24 items-end gap-2 border-b border-ink">
                  {[75, 82, 89, 100].map((h, i) => (
                    <span
                      key={h}
                      className={`flex-1 rounded-t ${i === 3 ? "bg-ink" : "bg-mint"}`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[15px]">
                  See how the price of eggs has moved across your own receipts, and where it was
                  cheapest.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Questions */}
        <section>
          <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
            <h2 className="font-display text-[28px] md:text-4xl">Questions</h2>
            <div className="mt-4 border-t border-line">
              {QUESTIONS.map(([q, a]) => (
                <details key={q} className="lp-q border-b border-line">
                  <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 py-4 text-[17px] font-semibold">
                    {q}
                    <span aria-hidden="true" className="lp-plus text-xl transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="pb-5 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call */}
        <section className="px-3 pb-3">
          <div className="mx-auto flex max-w-5xl flex-col gap-5 rounded-2xl bg-gold px-5 py-11 md:flex-row md:items-center md:justify-between md:px-12 md:py-14">
            <h2 className="font-display text-[34px] leading-[1.05] md:text-5xl">
              Never type an expense again.
            </h2>
            <StartButton className="md:w-64 md:shrink-0" />
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-col gap-3 px-5 pb-10 pt-6 text-sm text-muted sm:flex-row sm:justify-between">
        <Link href={routes.login} className="font-semibold text-ink underline underline-offset-4">
          Sign in
        </Link>
        <span>© 2026 Cotab</span>
      </footer>
    </div>
  );
}
