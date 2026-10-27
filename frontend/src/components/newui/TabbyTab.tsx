"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useState, type FormEvent } from "react";

import { suggestionsFor } from "@/components/ChatDrawer";
import { Activity, Memories, Rules, askTabby } from "@/components/TabbyPanels";
import { Icon } from "@/components/ui";
import { useTabbyActivity, useTabbyMemories, useTabbyRules } from "@/lib/data";
import { Header } from "./parts";

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
        className="mt-5 flex border-b border-black/[0.08]"
        role="tablist"
        aria-label="Tabby sections"
      >
        {sections.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={`tabby-section relative min-h-11 flex-1 text-[12px] font-semibold ${section === id ? "is-on" : ""}`}
          >
            {label}
            {section === id && (
              <span className="tabby-section-bar absolute inset-x-2 bottom-[-1px] h-0.5" />
            )}
          </button>
        ))}
      </div>

      {section === "chat" && (
        <>
          <section className="tabby-hero mt-5 grid min-h-[210px] grid-cols-[minmax(0,1fr)_145px] overflow-hidden rounded-[24px] bg-[#edf9b7] pl-5">
            <div className="relative z-10 py-5">
              <p className="text-[25px] font-semibold leading-[1.05] tracking-[-.045em] text-[#22231f]">
                Ask, check, or change something.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-[#526346]">
                Answers are immediate. Changes always wait for your approval and stay undoable.
              </p>
            </div>
            <div className="tabby-v3-stage tabby-v3-stage-hero relative flex items-end justify-center pr-2">
              <img
                src={`/cat-v3-stock/png/${activeRules ? "autopilot" : "working"}.png`}
                alt=""
                className="tabby-v3-figure relative z-10 h-[224px] w-full object-contain object-bottom"
              />
            </div>
          </section>
          <form onSubmit={submit} className="mt-5 flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask Tabby anything about your money"
              aria-label="Ask Tabby"
              className="tabby-ask min-h-12 min-w-0 flex-1 rounded-[16px] border border-black/[0.08] bg-[#fffefa] px-4 text-[14px] outline-none focus:ring-2 focus:ring-[#39a68e]"
            />
            <button
              type="submit"
              aria-label="Send to Tabby"
              disabled={!question.trim()}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#103e33] text-white disabled:opacity-50"
            >
              <Icon name="arrow_upward" size={20} />
            </button>
          </form>
          <div className="mt-3 space-y-2">
            {suggestionsFor("/app").map((q) => (
              <button
                key={q}
                onClick={() => askTabby(q)}
                className="tabby-suggestion flex min-h-12 w-full items-center justify-between rounded-[16px] border border-black/[0.08] bg-[#fffefa] px-4 py-3 text-left text-[13px] font-semibold"
              >
                <span>{q}</span>
                <Icon name="arrow_forward" size={17} />
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
