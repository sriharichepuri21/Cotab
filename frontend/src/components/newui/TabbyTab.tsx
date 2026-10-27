"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useState, type FormEvent } from "react";

import { suggestionsFor } from "@/components/ChatDrawer";
import { Activity, Memories, Rules, askTabby } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { useTabbyActivity, useTabbyMemories, useTabbyRules } from "@/lib/data";
import { Header } from "./parts";

const SUGGESTION_ICONS = ["payments", "call_split", "fact_check", "savings"];

type Section = "chat" | "activity" | "rules" | "memories";

const sections: Array<{ id: Section; label: string }> = [
  { id: "chat", label: "Ask" },
  { id: "activity", label: "Activity" },
  { id: "rules", label: "Rules" },
  { id: "memories", label: "Memories" },
];

/**
 * Tabby: ask in the chat (the app's one chat, which shows a plan and waits
 * for approval before changing anything), and see what Tabby did, the rules
 * it follows and what it remembers, each undoable or editable.
 */
export function TabbyTab() {
  const [section, setSection] = useState<Section>("chat");
  const [question, setQuestion] = useState("");
  const activity = useTabbyActivity();
  const rules = useTabbyRules();
  const memories = useTabbyMemories();
  const error = activity.error ?? rules.error ?? memories.error;
  const activeRules = (rules.data ?? []).filter((r) => r.active).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    askTabby(question.trim());
    setQuestion("");
  }

  return (
    <main className="px-5 pb-44 pt-6">
      <Header eyebrow="Your money assistant" title="Tabby" />
      <div
        className="seg mt-5 flex gap-1 rounded-full p-1"
        role="tablist"
        aria-label="Tabby sections"
      >
        {sections.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`tabby-section relative min-h-10 flex-1 rounded-full text-[12px] font-semibold ${section === id ? "is-on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "chat" && (
        <>
          <section className="tabby-hero tabby-stage relative mt-[72px] rounded-[22px] px-4 pb-4 pt-[76px] text-center">
            <span className="aura-orb" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-x-0 -top-[64px] z-10 flex justify-center">
              <img
                src={`/cat-v3-stock/png/${activeRules ? "autopilot" : "working"}.png`}
                alt=""
                className="tabby-v3-figure h-[138px] w-[138px] object-contain object-bottom"
              />
            </div>
            <p className="text-[20px] font-semibold leading-tight tracking-[-.03em] text-[#22231f]">
              What shall we look at?
            </p>
            <p className="ai-kicker mt-2 justify-center">
              <Icon name="auto_awesome" size={12} />{" "}
              {activeRules ? `${activeRules} rule${activeRules === 1 ? "" : "s"} running` : "Ready"}
              {" · you approve every change"}
            </p>
          </section>
          <form
            onSubmit={submit}
            className="ask-bar tabby-ask mt-3 flex items-center gap-2 rounded-full pl-4 pr-1.5"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask Tabby…"
              aria-label="Ask Tabby"
              className="min-h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            />
            <button
              type="submit"
              aria-label="Send to Tabby"
              disabled={!question.trim()}
              className="ask-send grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#103e33] text-white disabled:opacity-40"
            >
              <Icon name="arrow_upward" size={19} />
            </button>
          </form>
          <div className="ios-surface mt-3 rounded-[20px] px-1">
            {suggestionsFor("/app")
              .slice(0, 4)
              .map((q, i) => (
                <button
                  key={q}
                  onClick={() => askTabby(q)}
                  className={`flex min-h-12 w-full items-center gap-3 px-3 text-left text-[13.5px] font-semibold ${i ? "ios-divider" : ""}`}
                >
                  <Icon
                    name={SUGGESTION_ICONS[i] ?? "auto_awesome"}
                    size={17}
                    className="ai-glyph"
                  />
                  <span className="min-w-0 flex-1 truncate">{q}</span>
                  <Icon name="arrow_forward" size={15} className="text-[#9c9c95]" />
                </button>
              ))}
          </div>
        </>
      )}

      {error && section !== "chat" && (
        <p role="alert" className="mt-5 text-[12px] font-semibold text-[#a74132]">
          Couldn&apos;t load everything: {error.message}
        </p>
      )}
      <div className="profile-panel" role="tabpanel">
        {section === "activity" &&
          (activity.data ? (
            <Activity runs={activity.data} />
          ) : (
            <p className="mt-6 text-[13px] text-[#77776f]">Loading…</p>
          ))}
        {section === "rules" &&
          (rules.data ? (
            <Rules rules={rules.data} />
          ) : (
            <p className="mt-6 text-[13px] text-[#77776f]">Loading…</p>
          ))}
        {section === "memories" &&
          (memories.data ? (
            <Memories memories={memories.data} />
          ) : (
            <p className="mt-6 text-[13px] text-[#77776f]">Loading…</p>
          ))}
      </div>
    </main>
  );
}
