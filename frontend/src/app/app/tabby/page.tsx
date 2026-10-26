"use client";

/* eslint-disable @next/next/no-img-element -- small local webps, already sized */
import Link from "next/link";

import { CatAvatar, TabbyStand } from "@/components/Tabby";
import { Activity, Memories, Rules, askTabby } from "@/components/TabbyPanels";
import { ErrorNote, Icon, PageSkeleton } from "@/components/ui";
import { useMonthWrap, useTabbyActivity, useTabbyMemories, useTabbyRules } from "@/lib/data";
import { money } from "@/lib/format";
import { routes } from "@/lib/routes";

function lastMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function TabbyPage() {
  const activity = useTabbyActivity();
  const rules = useTabbyRules();
  const memories = useTabbyMemories();
  const month = lastMonth();
  const wrap = useMonthWrap(month).data;

  if (activity.loading && rules.loading && memories.loading) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
        <PageSkeleton />
      </main>
    );
  }
  const runs = activity.data ?? [];
  const ruleRows = rules.data ?? [];
  const memoryRows = memories.data ?? [];
  const error = activity.error ?? rules.error ?? memories.error;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-12 pt-7 md:px-8 md:pt-10">
      <h1 className="text-[28px] font-extrabold tracking-[-0.04em]">Tabby</h1>
      <p className="mt-1 text-[15px] text-muted">
        What Tabby did for you, the rules it follows, and what it remembers.
      </p>

      <div className="mt-4">
        <TabbyStand
          mood={ruleRows.some((r) => r.active) ? "autopilot" : "working"}
          height={150}
          side="right"
          bubble={
            ruleRows.some((r) => r.active)
              ? `On autopilot with ${ruleRows.filter((r) => r.active).length} rule${ruleRows.filter((r) => r.active).length === 1 ? "" : "s"}.`
              : "Tell me what to do. I'll show you the plan first."
          }
          alt="Tabby"
        />
        <div className="card-in relative rounded-[28px] bg-forest px-5 pb-5 pt-6 text-[#F3F6F1] shadow-[0_28px_40px_-24px_rgb(15_61_49/0.8)]">
          <p className="relative text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
            Ask me to do anything in Cotab.
          </p>
          <p className="relative mt-1.5 text-sm text-[#F3F6F1]/70">
            Split a purchase, fix a receipt, change a budget, remind a friend. Nothing changes until
            you approve, and everything can be undone.
          </p>
          <div className="relative mt-4 flex flex-wrap gap-2">
            {[
              "Split my last Costco trip with Ben",
              "Split every Costco receipt with Ben",
              "Remember Ben is my roommate",
            ].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => askTabby(s)}
                className="press min-h-10 rounded-full border border-[#F3F6F1]/[0.16] bg-[#F3F6F1]/10 px-3.5 text-left text-[13px] font-bold"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6">
          <ErrorNote>Couldn&apos;t load everything: {error.message}</ErrorNote>
        </div>
      )}

      {wrap && wrap.receipts > 0 && (
        <Link
          href={routes.tabbyWrap(month)}
          className="press mt-6 flex items-center gap-3.5 rounded-card bg-[linear-gradient(115deg,#E4F6A0_0%,#F2FAD3_55%,#FFFFFF_100%)] p-4"
        >
          <CatAvatar choice={{ look: "hoodie", mood: "celebrate", bg: "mood" }} size={52} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold">
              Your {wrap.label.split(" ")[0]} wrap-up
            </span>
            <span className="block text-[13px] text-muted">
              {money(wrap.total, wrap.currency)} across {wrap.receipts} receipt
              {wrap.receipts === 1 ? "" : "s"}
            </span>
          </span>
          <Icon name="chevron_right" className="text-faint" />
        </Link>
      )}

      <Rules rules={ruleRows} />
      <Memories memories={memoryRows} />
      <Activity runs={runs} />
    </main>
  );
}
