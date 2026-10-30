import type { Metadata } from "next";

import { StartFlow } from "@/components/onboarding/StartFlow";
import "@/styles/onboarding.css";

export const metadata: Metadata = {
  title: "Get started · Cotab",
  description: "Meet Tabby, the AI agent for your receipts.",
};

export default function StartPage() {
  return <StartFlow />;
}
