"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useState, type FormEvent } from "react";
import { tabbyArt } from "@/lib/tabby";

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
        className="seg mt-2 flex gap-1 rounded-full p-0.5"
        role="tablist"
        aria-label="Tabby sections"
      >
        {sections.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`tabby-section relative min-h-8 flex-1 rounded-full text-[12px] font-semibold ${section === id ? "is-on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "chat" && (
        <>
          <section className="tabby-hero tabby-stage mt-2 flex items-center gap-2.5 rounded-[22px] p-3">
            <img
              src={tabbyArt(activeRules ? "autopilot" : "working", 256)}
              alt=""
              className="tabby-v3-figure h-10 w-10 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-glass-ink">What shall we look at?</p>
              <p className="text-[12px] text-glass-soft">
                {activeRules
                  ? `${activeRules} rule${activeRules === 1 ? "" : "s"} running`
                  : "Ready"}
                {" · you approve every change"}
              </p>
            </div>
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
              className="min-h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            <button
              type="submit"
              aria-label="Send to Tabby"
              disabled={!question.trim()}
              className="ask-send grid h-8 w-8 shrink-0 place-items-center rounded-full glass-cta text-white disabled:opacity-40"
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
                  className={`flex min-h-10 w-full items-center gap-2.5 px-2 text-left text-[13px] font-semibold ${i ? "ios-divider" : ""}`}
                >
                  <Icon
                    name={SUGGESTION_ICONS[i] ?? "auto_awesome"}
                    size={17}
                    className="ai-glyph"
                  />
                  <span className="min-w-0 flex-1 truncate">{q}</span>
                  <Icon name="arrow_forward" size={14} className="text-glass-soft" />
                </button>
              ))}
          </div>
        </>
      )}

      {error && section !== "chat" && (
        <p role="alert" className="mt-5 text-[12px] font-semibold text-glass-neg">
          Couldn&apos;t load everything: {error.message}
        </p>
      )}
      <div className="profile-panel" role="tabpanel">
        {section === "activity" &&
          (activity.data ? (
            <Activity runs={activity.data} />
          ) : (
            <p className="mt-6 text-[13px] text-glass-soft">Loading…</p>
          ))}
        {section === "rules" &&
          (rules.data ? (
            <Rules rules={rules.data} />
          ) : (
            <p className="mt-6 text-[13px] text-glass-soft">Loading…</p>
          ))}
        {section === "memories" &&
          (memories.data ? (
            <Memories memories={memories.data} />
          ) : (
            <p className="mt-6 text-[13px] text-glass-soft">Loading…</p>
          ))}
      </div>
    </main>
  );
}
