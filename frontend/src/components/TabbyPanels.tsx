"use client";

/* Tabby's rules, memory and what it did: shared by the Tabby page and the
   app's Tabby tab. */

/* eslint-disable @next/next/no-img-element -- small local webps, already sized */
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Icon } from "@/components/ui";
import {
  addTabbyMemory,
  deleteTabbyMemory,
  deleteTabbyRule,
  setTabbyRule,
  undoTabbyRun,
  type TabbyMemory,
  type TabbyRule,
  type TabbyRun,
} from "@/lib/api";
import { mutate } from "@/lib/cache";
import { invalidateSpending, invalidateSplits, invalidateTabby, keys } from "@/lib/data";
import { dayLabel } from "@/lib/format";
import { newUiPath } from "@/lib/routes";

export function askTabby(text: string) {
  window.dispatchEvent(new CustomEvent("rw:chat", { detail: text }));
}

function TabbyPortrait({ mood }: { mood: string }) {
  return (
    <span className="tabby-v3-avatar block h-11 w-11 shrink-0 overflow-hidden rounded-full">
      <img
        src={`/cat-v3-stock/png/${mood}.png`}
        alt=""
        className="h-full w-full scale-[1.28] object-cover object-[50%_28%]"
      />
    </span>
  );
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${dayLabel(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function Rules({ rules }: { rules: TabbyRule[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  async function toggle(rule: TabbyRule) {
    setBusy(rule.id);
    setProblem("");
    mutate<TabbyRule[]>(keys.tabbyRules, (v = []) =>
      v.map((r) => (r.id === rule.id ? { ...r, active: !rule.active } : r))
    );
    try {
      await setTabbyRule(rule.id, !rule.active);
    } catch (error) {
      invalidateTabby();
      setProblem(error instanceof Error ? error.message : "That rule could not be updated.");
    } finally {
      setBusy(null);
    }
  }
  async function remove(rule: TabbyRule) {
    setBusy(rule.id);
    setProblem("");
    mutate<TabbyRule[]>(keys.tabbyRules, (v = []) => v.filter((r) => r.id !== rule.id));
    try {
      await deleteTabbyRule(rule.id);
      setConfirming(null);
    } catch (error) {
      invalidateTabby();
      setProblem(error instanceof Error ? error.message : "That rule could not be deleted.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="mt-9" aria-labelledby="rules">
      <h2 id="rules" className="text-lg font-extrabold tracking-[-0.02em]">
        Rules
      </h2>
      <p className="mt-0.5 text-[13px] text-faint">
        Automatic actions for new receipts. Pause or remove them any time.
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm font-semibold text-rose">
          {problem}
        </p>
      )}
      {rules.length === 0 ? (
        <button
          type="button"
          onClick={() => askTabby("Create a rule to split every Costco receipt with my roommate")}
          className="press mt-3 flex w-full items-center gap-3 rounded-card border-[1.5px] border-dashed border-[#B9C0BB] p-4 text-left"
        >
          <TabbyPortrait mood="autopilot" />
          <span>
            <span className="block text-[15px] font-bold">No rules yet</span>
            <span className="block text-[13px] text-faint">
              Try &ldquo;Split every Costco receipt with Ben&rdquo;
            </span>
          </span>
        </button>
      ) : (
        <ul className="mt-3 rounded-card bg-card px-4 py-1">
          {rules.map((rule, i) => (
            <li key={rule.id} className={`py-3.5 ${i ? "border-t border-line" : ""}`}>
              <div className="flex items-center gap-3">
                <TabbyPortrait mood={rule.active ? "autopilot" : "thinking"} />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[15px] font-bold leading-snug ${rule.active ? "" : "text-faint"}`}
                  >
                    {rule.summary}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-faint">
                    {rule.run_count
                      ? `Ran ${rule.run_count} time${rule.run_count === 1 ? "" : "s"}${rule.last_run_at ? `, last ${dayLabel(rule.last_run_at)}` : ""}`
                      : "Hasn't run yet"}
                    {rule.active ? "" : " · Paused"}
                  </span>
                </span>
                <label className="flex cursor-pointer items-center">
                  <span className="sr-only">{rule.active ? "Pause" : "Turn on"} this rule</span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={rule.active}
                    disabled={busy === rule.id}
                    onChange={() => toggle(rule)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-gold ${
                      rule.active ? "bg-forest" : "bg-ink/15"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        rule.active ? "left-6" : "left-1"
                      }`}
                    />
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setConfirming(rule.id)}
                  aria-label={`Delete rule: ${rule.summary}`}
                  className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-ink/[0.05] hover:text-rose"
                >
                  <Icon name="delete" size={21} />
                </button>
              </div>
              {confirming === rule.id && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-[16px] bg-blush px-3 py-2.5">
                  <span className="text-[13px] font-semibold">Delete this rule permanently?</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="min-h-10 px-3 text-[13px] font-bold"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      disabled={busy === rule.id}
                      onClick={() => remove(rule)}
                      className="min-h-10 rounded-full bg-rose px-4 text-[13px] font-bold text-white disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Memories({ memories }: { memories: TabbyMemory[] }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value.length < 3) return;
    setSaving(true);
    setProblem("");
    try {
      const row = await addTabbyMemory(value);
      mutate<TabbyMemory[]>(keys.tabbyMemories, (v = []) => [...v, row]);
      setText("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't save.");
    } finally {
      setSaving(false);
    }
  }
  async function forget(memory: TabbyMemory) {
    setForgetting(memory.id);
    setProblem("");
    mutate<TabbyMemory[]>(keys.tabbyMemories, (v = []) => v.filter((m) => m.id !== memory.id));
    try {
      await deleteTabbyMemory(memory.id);
      setConfirming(null);
    } catch (error) {
      invalidateTabby();
      setProblem(error instanceof Error ? error.message : "That memory could not be removed.");
    } finally {
      setForgetting(null);
    }
  }

  return (
    <section className="mt-9" aria-labelledby="memory">
      <h2 id="memory" className="text-lg font-extrabold tracking-[-0.02em]">
        Memories
      </h2>
      <p className="mt-0.5 text-[13px] text-faint">
        Things you told Tabby, so you don&apos;t have to say them twice.
      </p>
      {memories.length > 0 && (
        <ul className="mt-3 rounded-card bg-card px-4 py-1">
          {memories.map((m, i) => (
            <li
              key={m.id}
              className={`relative flex items-center gap-3 py-3 ${i ? "border-t border-line" : ""}`}
            >
              <TabbyPortrait mood="remember" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{m.text}</span>
                <span className="mt-0.5 block text-[12px] text-faint">
                  Used only to personalize Tabby&apos;s help
                </span>
              </span>
              <button
                type="button"
                onClick={() => setConfirming(m.id)}
                aria-label={`Forget: ${m.text}`}
                className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-ink/[0.05] hover:text-rose"
              >
                <Icon name="close" size={20} />
              </button>
              {confirming === m.id && (
                <div className="absolute inset-x-0 bottom-1 top-1 flex items-center justify-between gap-2 rounded-[16px] bg-blush px-3">
                  <span className="text-[13px] font-semibold">Forget this?</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="min-h-10 px-3 text-[13px] font-bold"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      disabled={forgetting === m.id}
                      onClick={() => forget(m)}
                      className="min-h-10 rounded-full bg-rose px-4 text-[13px] font-bold text-white disabled:opacity-50"
                    >
                      Forget
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-3 flex gap-2">
        <label htmlFor="memory-text" className="sr-only">
          Teach Tabby something
        </label>
        <input
          id="memory-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Ben is my roommate"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-card px-4 text-[15px] shadow-[0_0_0_1px_rgb(12_17_14/0.08)] outline-none focus:ring-4 focus:ring-gold/60"
        />
        <button
          type="submit"
          disabled={saving || text.trim().length < 3}
          className="press min-h-11 rounded-full bg-forest px-5 font-bold text-paper disabled:opacity-40"
        >
          Remember
        </button>
      </form>
      {problem && (
        <p role="alert" className="mt-2 text-sm font-semibold text-rose">
          {problem}
        </p>
      )}
    </section>
  );
}

export function Activity({ runs }: { runs: TabbyRun[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  async function undo(run: TabbyRun) {
    setBusy(run.run_id);
    setProblem("");
    try {
      await undoTabbyRun(run.run_id);
      invalidateSpending();
      invalidateSplits();
      invalidateTabby();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That couldn't be undone.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-9" aria-labelledby="did">
      <h2 id="did" className="text-lg font-extrabold tracking-[-0.02em]">
        What Tabby did
      </h2>
      {problem && (
        <p role="alert" className="mt-2 text-sm font-semibold text-rose">
          {problem}
        </p>
      )}
      {runs.length === 0 ? (
        <p className="mt-3 rounded-card bg-card p-4 text-[15px] text-muted">
          Nothing yet. When Tabby does something for you, it shows up here with an Undo.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {runs.map((run) => {
            const undone = run.status === "undone";
            const open = run.steps.find((s) => s.open)?.open;
            return (
              <li
                key={run.run_id}
                className="rounded-card bg-card p-4 shadow-[0_1px_0_rgb(12_17_14/0.04)]"
              >
                <div className="flex items-center gap-3">
                  <TabbyPortrait
                    mood={undone ? "oops" : run.source === "rule" ? "autopilot" : "done"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-faint">
                      {run.source === "rule" ? "By a rule" : "You asked"} · {when(run.at)}
                      {undone ? " · Undone" : ""}
                    </span>
                  </span>
                </div>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {run.steps.map((step) => (
                    <li
                      key={step.position}
                      className={`flex items-start gap-2 text-[15px] font-semibold leading-snug ${
                        step.status === "undone" ? "text-faint line-through" : ""
                      }`}
                    >
                      <Icon
                        name={step.status === "undone" ? "undo" : "check_circle"}
                        fill
                        size={19}
                        className={`mt-0.5 shrink-0 ${step.status === "undone" ? "text-faint" : "text-good"}`}
                      />
                      {step.summary}
                    </li>
                  ))}
                </ul>
                {(open || run.undoable) && !undone && (
                  <div className="mt-3 flex gap-2">
                    {open && (
                      <Link
                        href={newUiPath(open)}
                        className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-paper px-4 text-sm font-bold ring-1 ring-ink/[0.08]"
                      >
                        Open
                        <Icon name="arrow_forward" size={17} />
                      </Link>
                    )}
                    {run.undoable && (
                      <button
                        type="button"
                        disabled={busy === run.run_id}
                        onClick={() => undo(run)}
                        className="press inline-flex min-h-10 items-center gap-1 rounded-full bg-paper px-4 text-sm font-bold ring-1 ring-ink/[0.08] disabled:opacity-50"
                      >
                        <Icon name="undo" size={17} />
                        {busy === run.run_id ? "Undoing…" : "Undo"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
