import type { Metadata } from "next";

import { LandingNav } from "@/components/LandingNav";
import { LandingMotion } from "@/components/LandingMotion";
import { LANDING_BODY } from "@/app/landingMarkup";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Cotab: your receipts, finally read for you",
  description:
    "Snap or forward any receipt. Cotab reads every line, keeps your budgets honest and splits the bill with friends, with Tabby the cat.",
};

/**
 * The landing page. Its markup and styles come straight from the approved
 * design (scoped under .lp); LandingMotion plays the receipt print, Tabby's
 * hop and the mood demo.
 */
export default function Landing() {
  return (
    <div className="lp">
      <LandingNav />
      <main dangerouslySetInnerHTML={{ __html: LANDING_BODY }} />
      <LandingMotion />
    </div>
  );
}
