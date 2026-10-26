"use client";

/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useScanItems, useScanPickers } from "@/components/ScanSheet";
import { Icon } from "@/components/ui";
import {
  CATEGORIES,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  reviewReceipt,
  retryReceipt,
  type LineItem,
  type UploadResult,
} from "@/lib/api";
import { invalidateSpending } from "@/lib/data";
import { categoryLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import { centsText, parseCents, reconcile, unitCents } from "./money";
import {
  Cat,
  DemoSheet,
  Header,
  ReceiptRow,
  Ticket,
  cats,
  receiptFromApi,
  scanMoney,
  type Receipt,
} from "./parts";
import { Activity } from "./Activity";
import { Today } from "./Today";
import {
  addFiles,
  clearFinished,
  isFinished,
  remove,
  retry,
  sendAnyway,
  type ScanItem,
} from "@/lib/scanQueue";

type Tab = "today" | "activity" | "circles" | "tabby";
const receipts: Receipt[] = [
  {
    merchant: "DoorDash",
    note: "Dinner · 5 items",
    amount: "$28.00",
    mine: "$14.00 yours",
    icon: "restaurant",
    tone: "sand",
    date: "Today, 8:42 PM",
  },
  {
    merchant: "Shell",
    note: "Gas · Road trip",
    amount: "$45.00",
    mine: "$11.25 yours",
    icon: "local_gas_station",
    tone: "coral",
    date: "Today, 5:18 PM",
  },
  {
    merchant: "Trader Joe’s",
    note: "Groceries · 3 items",
    amount: "$34.00",
    mine: "$34.00 yours",
    icon: "shopping_basket",
    tone: "lime",
    date: "Yesterday",
  },
  {
    merchant: "Blue Bottle",
    note: "Coffee · 2 items",
    amount: "$11.62",
    mine: "$5.81 yours",
    icon: "coffee",
    tone: "sky",
    date: "Tuesday",
  },
];
function Circles() {
  const [flow, setFlow] = useState<"collect" | "pay" | "new" | "share" | "history" | null>(null);
  const [youOwe, setYouOwe] = useState(18.5);
  const [reminded, setReminded] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Venmo");
  const [paymentOpened, setPaymentOpened] = useState(false);
  const [linkShared, setLinkShared] = useState(false);
  const [newTabCreated, setNewTabCreated] = useState(false);
  const tabbyMood = youOwe > 0 ? "hmm" : "payday";
  return (
    <>
      <main className="px-5 pb-32 pt-6">
        <Header
          eyebrow="Settle without chasing"
          title="Tabs"
          action={
            <button
              onClick={() => setFlow("new")}
              className="tabs-action rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
            >
              + New
            </button>
          }
        />
        <button
          onClick={() => youOwe > 0 && setFlow("pay")}
          className="tabs-hero demo-gloss mt-7 w-full overflow-hidden rounded-[24px] bg-[#103e33] p-5 text-left text-white"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
                Your tabs today
              </p>
              <p className="mt-2 text-[28px] font-semibold leading-tight tracking-[-.045em]">
                {youOwe > 0 ? "One payment needs you." : "$10.20 is coming back."}
              </p>
              <p className="mt-3 text-[12px] text-white/65">Pay Priya for family groceries.</p>
            </div>
            <img
              src={`/cat-v3-stock/png/${tabbyMood}.png`}
              alt="Tabby reacting to your tabs"
              className="tabby-v3-figure h-[132px] w-full object-contain object-bottom"
            />
          </div>
        </button>
        <section className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => setFlow("collect")}
            className="ios-surface rounded-[19px] p-4 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#50713a]">
              Owed to you
            </span>
            <b className="mt-2 block text-[25px]">$10.20</b>
            <small className="text-[#77776f]">3 friends →</small>
          </button>
          <button
            onClick={() => setFlow("pay")}
            className="rounded-[19px] bg-[#f7e9e3] p-4 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a74132]">
              You owe
            </span>
            <b className="mt-2 block text-[25px]">${youOwe.toFixed(2)}</b>
            <small className="text-[#715f59]">{youOwe ? "Pay Priya →" : "Settled"}</small>
          </button>
        </section>
        <h2 className="mt-8 text-[19px] font-semibold tracking-[-.03em]">Lake trip</h2>
        <Ticket className="mt-3 rounded-[20px] border border-black/[0.07] p-4">
          <div className="flex items-center justify-between">
            <div className="flex -space-x-2">
              {cats.map((c) => (
                <span key={c} className="rounded-full ring-2 ring-[#fffefa]">
                  <Cat mood={c} size={38} />
                </span>
              ))}
            </div>
            <span className="text-[12px] font-semibold text-[#77776f]">$17 shared</span>
          </div>
          <div className="mt-5 space-y-4">
            {[
              ["Cara", "$3.40", "love"],
              ["Dev", "$3.40", "cool"],
              ["Ben Lee", "$3.40", "hi"],
            ].map(([n, a, m]) => (
              <div key={n} className="flex items-center gap-3">
                <Cat mood={m} size={38} />
                <span className="flex-1">
                  <b className="block text-[14px]">{n}</b>
                  <span className="text-[11px] text-[#77776f]">owes you</span>
                </span>
                <b>{a}</b>
                <button
                  onClick={() => setFlow("collect")}
                  className="tabs-remind rounded-full bg-[#edf9b7] px-3 py-2 text-[11px] font-bold"
                >
                  {reminded ? "Sent" : "Remind"}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setFlow("history")}
            className="mt-4 min-h-10 w-full border-t border-black/[0.07] pt-3 text-left text-[12px] font-bold text-[#103e33]"
          >
            Tab history and payments →
          </button>
        </Ticket>
        <section className="mt-6 rounded-[20px] bg-[#dff0ff] p-5">
          <div className="flex items-center gap-3">
            <img
              src="/cat-v3-stock/png/love.png"
              alt="Tabby celebrating a shared tab"
              className="tabby-v3-scene h-16 w-20 rounded-[14px] object-contain"
            />
            <div>
              <b className="block">Share one link</b>
              <p className="mt-1 text-[12px] leading-snug text-[#45667b]">
                Friends see only this tab and can pay without joining Cotab.
              </p>
            </div>
          </div>
          <button
            onClick={() => setFlow("share")}
            className="tabs-action mt-4 w-full rounded-full bg-[#103e33] py-3 text-[13px] font-bold text-white"
          >
            Copy lake trip link
          </button>
        </section>
      </main>
      {flow === "collect" && (
        <DemoSheet
          title="Bring $10.20 back"
          subtitle="Choose a friendly reminder. Cotab never marks a balance paid from a reminder."
          close={() => setFlow(null)}
        >
          <div className="space-y-2">
            {[
              ["Cara", "$3.40", "In-app push"],
              ["Dev", "$3.40", "Text link"],
              ["Ben Lee", "$3.40", "In-app push"],
            ].map(([name, amount, route]) => (
              <div key={name} className="ios-surface flex items-center gap-3 rounded-[16px] p-3">
                <Cat mood="hi" size={38} />
                <span className="flex-1">
                  <b className="block text-[13px]">
                    {name} · {amount}
                  </b>
                  <small className="text-[#77776f]">{route}</small>
                </span>
                <Icon name="check_circle" size={19} />
              </div>
            ))}
          </div>
          <section className="mt-4 rounded-[16px] bg-[#dff0ff] p-4">
            <b className="text-[12px]">“Hey! Your Lake trip share is $3.40.”</b>
            <p className="mt-1 text-[10px] text-[#45667b]">
              Includes the tab link and your saved payment options. People without Cotab only see
              this tab.
            </p>
          </section>
          <button
            onClick={() => setReminded(true)}
            className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
          >
            {reminded ? "Reminders prepared" : "Send 2 pushes · prepare 1 text"}
          </button>
          <p className="mt-3 text-center text-[10px] text-[#77776f]">
            Cotab sends only to people with notifications enabled. Text reminders open in Messages
            for you to send. Repeat pushes are suppressed for 20 hours.
          </p>
        </DemoSheet>
      )}
      {flow === "pay" && (
        <DemoSheet
          title={youOwe ? "Pay Priya $18.50" : "Payment recorded"}
          subtitle="Family groceries · your exact share after tax and discounts"
          close={() => setFlow(null)}
        >
          {youOwe ? (
            <>
              <div className="ios-surface flex items-center gap-3 rounded-[18px] p-4">
                <Cat mood="love" size={48} />
                <span className="flex-1">
                  <b className="block">Priya Shah</b>
                  <small className="text-[#77776f]">Verified mobile · ••• 6631</small>
                </span>
                <b>$18.50</b>
              </div>
              <p className="mt-5 text-[12px] font-bold">How will you pay?</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {["Venmo", "PayPal", "Zelle", "Cash App", "Cash / other"].map((method) => (
                  <button
                    key={method}
                    onClick={() => {
                      setPaymentMethod(method);
                      setPaymentOpened(false);
                    }}
                    className={`rounded-[15px] border p-3 text-[12px] font-bold ${paymentMethod === method ? "border-[#103e33] bg-[#edf9b7]" : "border-black/10"}`}
                  >
                    {method}
                  </button>
                ))}
              </div>
              <section className="mt-4 rounded-[16px] bg-black/[0.04] p-4">
                <b className="text-[12px]">
                  {paymentMethod === "Zelle" || paymentMethod === "Cash / other"
                    ? "Pay, then return here"
                    : `Continue in ${paymentMethod}`}
                </b>
                <p className="mt-1 text-[10px] leading-relaxed text-[#77776f]">
                  {paymentMethod === "Zelle"
                    ? "Copy Priya’s verified mobile ending 6631. Zelle does not provide a universal payment link."
                    : paymentMethod === "Cash / other"
                      ? "Cotab records the settlement but does not move the money."
                      : `Cotab opens ${paymentMethod} with Priya, $18.50 and “Family groceries” filled in.`}
                </p>
                <p className="mt-2 text-[10px] font-semibold text-[#715f59]">
                  Cotab cannot verify that an external payment was sent. Confirm only after you
                  complete it.
                </p>
              </section>
              {!paymentOpened ? (
                <button
                  onClick={() => setPaymentOpened(true)}
                  className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
                >
                  {paymentMethod === "Zelle" || paymentMethod === "Cash / other"
                    ? "I’m ready to confirm"
                    : `Open ${paymentMethod}`}
                </button>
              ) : (
                <div className="mt-5">
                  <p className="mb-3 text-center text-[11px] text-[#77776f]">
                    Back from {paymentMethod}? Only confirm if the payment was sent.
                  </p>
                  <button
                    onClick={() => {
                      setYouOwe(0);
                      setPaymentOpened(false);
                    }}
                    className="w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
                  >
                    Yes, mark $18.50 paid
                  </button>
                </div>
              )}
            </>
          ) : (
            <section className="text-center">
              <img
                src="/cat-v3-stock/png/done.png"
                alt="Tabby celebrating a settled tab"
                className="tabby-v3-scene mx-auto h-40 w-40 rounded-[28px] object-contain"
              />
              <h3 className="mt-4 text-[21px] font-semibold">You’re even with Priya.</h3>
              <p className="mt-2 text-[11px] text-[#77776f]">
                Recorded today · undo is available from tab history.
              </p>
            </section>
          )}
        </DemoSheet>
      )}
      {flow === "new" && (
        <DemoSheet
          title="Start a tab"
          subtitle="A tab keeps shared expenses and repayments together."
          close={() => setFlow(null)}
        >
          {newTabCreated ? (
            <section className="text-center">
              <img
                src="/cat-v3-stock/png/hi.png"
                alt="Tabby welcoming a new tab"
                className="tabby-v3-scene mx-auto h-40 w-40 rounded-[28px] object-contain"
              />
              <h3 className="mt-4 text-[20px] font-semibold">Roommates is ready.</h3>
              <p className="mt-2 text-[11px] text-[#77776f]">
                Add a receipt now or share the private invite link.
              </p>
              <button
                onClick={() => setFlow("share")}
                className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
              >
                Invite people
              </button>
            </section>
          ) : (
            <>
              <label className="text-[11px] font-bold">
                Tab name
                <input
                  defaultValue="Roommates"
                  className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[13px] outline-none"
                />
              </label>
              <p className="mt-5 text-[11px] font-bold">People</p>
              <div className="mt-2 ios-surface rounded-[18px] px-4">
                {[
                  ["Ben Lee", "••• 0199"],
                  ["Maya Chen", "maya.chen@icloud.com"],
                ].map(([name, contact]) => (
                  <label
                    key={name}
                    className="flex items-center gap-3 border-b border-black/[0.07] py-3 last:border-0"
                  >
                    <Cat mood="hi" size={38} />
                    <span className="flex-1">
                      <b className="block text-[13px]">{name}</b>
                      <small className="text-[#77776f]">{contact}</small>
                    </span>
                    <input type="checkbox" className="h-5 w-5 accent-[#103e33]" />
                  </label>
                ))}
              </div>
              <button
                onClick={() => setNewTabCreated(true)}
                className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
              >
                Create tab
              </button>
              <p className="mt-3 text-center text-[10px] text-[#77776f]">
                No charges or balances exist until a receipt or manual expense is added.
              </p>
            </>
          )}
        </DemoSheet>
      )}
      {flow === "share" && (
        <DemoSheet
          title="Share Lake trip"
          subtitle="This private link opens only this tab—not your profile or other spending."
          close={() => setFlow(null)}
        >
          <div className="rounded-[18px] bg-[#edf9b7] p-4">
            <b className="text-[13px]">cotab.app/t/lake-7F2</b>
            <p className="mt-1 text-[10px] text-[#526346]">
              People can review their share, join the tab and find your payment options.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["sms", "Message"],
              ["ios_share", "Share"],
              ["link", "Copy link"],
            ].map(([icon, label]) => (
              <button
                key={label}
                onClick={() => setLinkShared(true)}
                className="rounded-[16px] border border-black/10 p-3 text-center"
              >
                <Icon name={icon} size={20} />
                <span className="mt-1 block text-[10px] font-bold">{label}</span>
              </button>
            ))}
          </div>
          <label className="mt-5 flex items-start gap-3 rounded-[16px] bg-black/[0.04] p-4">
            <input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 accent-[#103e33]" />
            <span>
              <b className="block text-[12px]">Personal invite links</b>
              <small className="text-[#77776f]">
                Each selected person gets a link tied to their invited identity, reducing accidental
                joins.
              </small>
            </span>
          </label>
          {linkShared && (
            <p className="mt-4 text-center text-[12px] font-bold text-[#50713a]">
              Ready to send — demo link copied.
            </p>
          )}
        </DemoSheet>
      )}
      {flow === "history" && (
        <DemoSheet
          title="Lake trip history"
          subtitle="Receipts, changes, reminders and recorded payments in one audit trail."
          close={() => setFlow(null)}
        >
          <div className="space-y-1">
            {[
              ["receipt_long", "North Market added", "$17.00 · You paid", "Today, 6:42 PM"],
              ["notifications", "Cara reminded", "$3.40 still owed", "Today, 9:10 AM"],
              ["payments", "Dev paid you", "+$3.40 · Cash App", "Yesterday, 7:24 PM"],
            ].map(([icon, title, detail, time], index) => (
              <div
                key={title}
                className={`flex items-center gap-3 py-4 ${index ? "border-t border-black/[0.07]" : ""}`}
              >
                <Icon name={icon} size={19} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px]">{title}</b>
                  <small className="text-[#77776f]">{detail}</small>
                </span>
                <span className="text-right text-[9px] text-[#77776f]">{time}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-[16px] bg-black/[0.04] p-4">
            <b className="text-[12px]">Undo recorded payments</b>
            <p className="mt-1 text-[10px] leading-relaxed text-[#77776f]">
              The person who recorded a payment, the people involved, or the tab owner can remove
              it. This changes the balance but never reverses money in another app.
            </p>
          </div>
        </DemoSheet>
      )}
    </>
  );
}

type DemoPlanState = "ready" | "working" | "done" | "cancelled" | "undone";

const TABBY_DEMO_PLANS = {
  split: {
    reply: "I found your latest Costco receipt from Saturday. Ben already has a tab with you.",
    steps: [
      "Use the $64.20 Costco receipt from Saturday",
      "Split it evenly between you and Ben",
      "Add it to your existing tab with Ben",
    ],
    result: "Costco was split. Ben owes you $32.10.",
  },
  insight: {
    reply: "You spent $53.67 more than September. Shared dining explains most of the change.",
    steps: [],
    result: "",
  },
  budget: {
    reply:
      "Dining has $30 left. I can move $20 from Groceries without changing your $700 total plan.",
    steps: [
      "Lower the October Groceries budget from $200 to $180",
      "Raise the October Dining budget from $150 to $170",
      "Keep the October total plan at $700",
    ],
    result: "$20 moved to Dining. Your total plan is still $700.",
  },
  remind: {
    reply:
      "Cara owes you $3.40 on Lake trip. She has Cotab notifications turned on and has not been reminded today.",
    steps: ["Send Cara one Cotab reminder", "Open the Lake trip tab when she taps it"],
    result: "Reminder sent to Cara. Cotab will not send another today.",
  },
} as const;

function Tabby() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<keyof typeof TABBY_DEMO_PLANS | null>(null);
  const [planState, setPlanState] = useState<DemoPlanState>("ready");
  const [step, setStep] = useState(0);
  const [section, setSection] = useState<"chat" | "activity" | "rules" | "memory">("chat");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const ask = (key: keyof typeof TABBY_DEMO_PLANS) => {
    if (timer.current) clearTimeout(timer.current);
    setConversation(key);
    setPlanState("ready");
    setStep(0);
    setQuestion("");
  };

  const approve = () => {
    const total = conversation ? TABBY_DEMO_PLANS[conversation].steps.length : 0;
    if (!total) return;
    setPlanState("working");
    setStep(1);
    let current = 1;
    const tick = () => {
      if (current >= total) {
        setPlanState("done");
        return;
      }
      current += 1;
      setStep(current);
      timer.current = setTimeout(tick, 520);
    };
    timer.current = setTimeout(tick, 520);
  };

  const submit = () => {
    const text = question.toLowerCase();
    if (!text.trim()) return;
    ask(
      text.includes("remind")
        ? "remind"
        : text.includes("budget") || text.includes("move")
          ? "budget"
          : text.includes("month") || text.includes("spent")
            ? "insight"
            : "split"
    );
  };

  const plan = conversation ? TABBY_DEMO_PLANS[conversation] : null;
  return (
    <main className="px-5 pb-44 pt-6">
      <Header eyebrow="Your money assistant" title="Tabby" />
      <div
        className="mt-5 flex border-b border-black/[0.08]"
        role="tablist"
        aria-label="Tabby sections"
      >
        {(["chat", "activity", "rules", "memory"] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={section === item}
            onClick={() => setSection(item)}
            className={`relative min-h-11 flex-1 text-[12px] font-semibold capitalize ${section === item ? "text-[#103e33]" : "text-[#77776f]"}`}
          >
            {item}
            {section === item && (
              <span className="absolute inset-x-2 bottom-[-1px] h-0.5 bg-[#103e33]" />
            )}
          </button>
        ))}
      </div>

      {section === "chat" && (
        <>
          <section className="mt-5 grid min-h-[210px] grid-cols-[minmax(0,1fr)_145px] overflow-hidden rounded-[24px] bg-[#edf9b7] pl-5">
            <div className="relative z-10 py-5">
              <p className="text-[25px] font-semibold leading-[1.05] tracking-[-.045em]">
                Ask, check, or change something.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-[#526346]">
                Answers are immediate. Changes always wait for your approval and stay undoable.
              </p>
            </div>
            <div className="tabby-v3-stage tabby-v3-stage-hero relative flex items-end justify-center pr-2">
              <img
                src="/cat-v3-stock/png/working.png"
                alt="Tabby ready to help"
                className="tabby-v3-figure relative z-10 h-[224px] w-full object-contain object-bottom"
              />
            </div>
          </section>
          {!conversation && (
            <div className="mt-5 space-y-2">
              {[
                ["split", "Split my last Costco receipt with Ben"],
                ["insight", "Tell me what changed this month"],
                ["budget", "Move $20 into dining"],
                ["remind", "Remind Cara about the lake trip"],
              ].map(([key, q]) => (
                <button
                  key={q}
                  onClick={() => ask(key as keyof typeof TABBY_DEMO_PLANS)}
                  className="flex w-full items-center justify-between rounded-[16px] border border-black/[0.08] bg-[#fffefa] px-4 py-3.5 text-left text-[13px] font-semibold"
                >
                  <span>{q}</span>
                  <Icon name="arrow_forward" size={17} />
                </button>
              ))}
            </div>
          )}

          {plan && (
            <section className="mt-5" aria-live="polite">
              <div className="flex justify-end">
                <div className="max-w-[86%] rounded-[18px] rounded-br-[5px] bg-[#103e33] px-4 py-3 text-[13px] leading-relaxed text-white">
                  {conversation === "split"
                    ? "Split my last Costco receipt with Ben"
                    : conversation === "insight"
                      ? "Tell me what changed this month"
                      : conversation === "budget"
                        ? "Move $20 into dining"
                        : "Remind Cara about the lake trip"}
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2.5">
                <Cat
                  mood={
                    planState === "working"
                      ? "working"
                      : planState === "done"
                        ? "done"
                        : planState === "undone"
                          ? "oops"
                          : "thinking"
                  }
                  size={42}
                />
                <div className="min-w-0 flex-1 rounded-[18px] rounded-tl-[5px] bg-[#fffefa] px-4 py-3 text-[13px] leading-relaxed shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
                  {plan.reply}
                </div>
              </div>
              {plan.steps.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-[20px] border border-black/[0.08] bg-[#fffefa]">
                  <header className="flex items-center gap-3 px-4 py-4">
                    <Cat
                      mood={
                        planState === "working"
                          ? "working"
                          : planState === "done"
                            ? "done"
                            : planState === "undone"
                              ? "oops"
                              : "thinking"
                      }
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <b className="block text-[15px]">
                        {planState === "ready"
                          ? "Tabby’s plan"
                          : planState === "working"
                            ? "Working on it"
                            : planState === "done"
                              ? "Done"
                              : planState === "cancelled"
                                ? "Cancelled"
                                : "Undone"}
                      </b>
                      <span className="text-[11px] text-[#77776f]">
                        {planState === "ready"
                          ? `${plan.steps.length} steps · nothing changes until you approve`
                          : planState === "working"
                            ? `Step ${step} of ${plan.steps.length}`
                            : planState === "done"
                              ? "One action · undo available"
                              : planState === "undone"
                                ? "Everything is back how it was"
                                : "Nothing changed"}
                      </span>
                    </div>
                  </header>
                  <ol className="border-y border-black/[0.07] px-4 py-2">
                    {plan.steps.map((item, index) => {
                      const complete =
                        planState === "done" || (planState === "working" && step > index);
                      return (
                        <li
                          key={item}
                          className={`flex gap-3 py-2.5 text-[12px] ${planState === "cancelled" || planState === "undone" ? "text-[#77776f] line-through" : ""}`}
                        >
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${complete ? "bg-[#2f7d49] text-white" : planState === "working" && step === index + 1 ? "bg-[#d7f45b] text-[#103e33]" : "bg-black/[0.06]"}`}
                          >
                            {complete ? <Icon name="check" size={13} /> : index + 1}
                          </span>
                          <span>{item}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="p-3.5">
                    {planState === "ready" && (
                      <div className="flex gap-2">
                        <button
                          onClick={approve}
                          className="min-h-11 flex-1 rounded-full bg-[#103e33] px-4 text-[12px] font-bold text-white"
                        >
                          Approve all
                        </button>
                        <button
                          onClick={() => setPlanState("cancelled")}
                          className="min-h-11 rounded-full border border-black/10 px-5 text-[12px] font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {planState === "working" && (
                      <div className="flex min-h-11 items-center gap-3 text-[12px] font-semibold">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#2f7d49]" />
                        Tabby is applying the approved steps…
                      </div>
                    )}
                    {planState === "done" && (
                      <>
                        <p className="text-[12px] font-semibold text-[#2f7d49]">{plan.result}</p>
                        <button
                          onClick={() => setPlanState("undone")}
                          className="mt-3 min-h-10 rounded-full border border-black/10 px-4 text-[12px] font-bold"
                        >
                          <Icon name="undo" size={15} /> Undo
                        </button>
                      </>
                    )}
                    {(planState === "cancelled" || planState === "undone") && (
                      <button
                        onClick={() => {
                          setConversation(null);
                          setPlanState("ready");
                        }}
                        className="min-h-10 text-[12px] font-bold text-[#103e33]"
                      >
                        Start a new request
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!plan.steps.length && (
                <div className="mt-3 rounded-[18px] bg-black/[0.035] p-4">
                  <div className="flex justify-between text-[12px]">
                    <span>October</span>
                    <b>$540.83</b>
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-[#77776f]">
                    <span>September</span>
                    <span>$487.16</span>
                  </div>
                  <button className="mt-4 text-[12px] font-bold text-[#103e33]">
                    Open October insights →
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {section === "activity" && (
        <section className="mt-5">
          <p className="text-[13px] text-[#77776f]">
            Every change Tabby makes is recorded here and can be undone when the underlying data
            still exists.
          </p>
          <div className="ios-surface mt-4 rounded-[20px] px-4">
            {[
              ["done", "Moved $20 to Dining", "Today · You approved 3 steps"],
              ["autopilot", "Categorized Blue Bottle as Dining", "Yesterday · Standing rule"],
              ["oops", "Removed a duplicate receipt", "Oct 22 · Undone"],
            ].map(([mood, title, meta], index) => (
              <div
                key={title}
                className={`flex items-center gap-3 py-4 ${index ? "border-t border-black/[0.07]" : ""}`}
              >
                <Cat mood={mood} size={42} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px]">{title}</b>
                  <small className="text-[#77776f]">{meta}</small>
                </span>
                <Icon name="chevron_right" size={17} />
              </div>
            ))}
          </div>
        </section>
      )}

      {section === "rules" && (
        <section className="mt-5">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-[18px] font-semibold">Standing rules</h2>
              <p className="mt-1 text-[11px] text-[#77776f]">
                Run after a new receipt lands. Failures never block the receipt.
              </p>
            </div>
            <button className="min-h-10 rounded-full bg-[#103e33] px-4 text-[11px] font-bold text-white">
              New rule
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {[
              [
                "Blue Bottle receipts",
                "Categorize as Dining",
                "12 runs · last ran yesterday",
                true,
              ],
              ["Costco grocery items", "Split evenly with Ben", "3 runs · last ran Oct 18", false],
            ].map(([title, action, meta, on]) => (
              <article key={String(title)} className="ios-surface rounded-[20px] p-4">
                <div className="flex items-start gap-3">
                  <Cat mood="autopilot" size={44} />
                  <div className="min-w-0 flex-1">
                    <b className="block text-[13px]">{title}</b>
                    <p className="mt-1 text-[12px]">{action}</p>
                    <small className="mt-2 block text-[#77776f]">{meta}</small>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-bold ${on ? "bg-[#dff0df] text-[#275f3d]" : "bg-black/[0.06] text-[#77776f]"}`}
                  >
                    {on ? "On" : "Paused"}
                  </span>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[#77776f]">
            Rules can categorize or split matching receipts. Tabby still validates ownership,
            people, currency and duplicate splits before each run.
          </p>
        </section>
      )}

      {section === "memory" && (
        <section className="mt-5">
          <h2 className="text-[18px] font-semibold">What Tabby remembers</h2>
          <p className="mt-1 text-[11px] text-[#77776f]">
            Memory helps with suggestions. It never bypasses approval for changes.
          </p>
          <Ticket className="mt-4 rounded-[20px] border border-black/[0.07] p-4">
            <div className="flex items-center gap-3">
              <Cat mood="remember" size={44} />
              <div className="flex-1">
                <b className="block text-[14px]">Ben is your roommate</b>
                <span className="text-[12px] text-[#77776f]">Used when suggesting splits</span>
              </div>
              <button className="min-h-10 text-[11px] font-bold text-[#a74132]">Forget</button>
            </div>
          </Ticket>
          <button className="mt-3 min-h-11 w-full rounded-full border border-black/10 text-[12px] font-bold">
            Add a memory
          </button>
        </section>
      )}

      <div className="ios-glass-nav fixed bottom-[88px] left-1/2 z-20 flex w-[min(398px,calc(100%-32px))] -translate-x-1/2 gap-2 rounded-full p-2">
        <input
          aria-label="Ask Tabby"
          placeholder="Ask about your money"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          className="min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none"
        />
        <button
          onClick={submit}
          aria-label="Send to Tabby"
          className="grid h-11 w-11 place-items-center rounded-full bg-[#103e33] text-white"
        >
          <Icon name="arrow_upward" size={20} />
        </button>
      </div>
    </main>
  );
}

function BackHeader({
  title,
  back,
  action,
  backLabel = "Today",
}: {
  title: string;
  back: () => void;
  action?: ReactNode;
  backLabel?: string;
}) {
  return (
    <header>
      <button
        onClick={back}
        className="flex min-h-10 items-center gap-1 text-[13px] font-bold text-[#103e33]"
      >
        <Icon name="arrow_back" size={18} /> {backLabel}
      </button>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.045em]">{title}</h1>
        {action}
      </div>
    </header>
  );
}

function Notifications({
  back,
  openReceipt,
}: {
  back: () => void;
  openReceipt: (r: Receipt) => void;
}) {
  const [read, setRead] = useState<string[]>([]);
  const notices = [
    {
      id: "review",
      icon: "receipt_long",
      tone: "coral",
      title: "Check the Trader Joe’s receipt",
      body: "Tabby matched 3 items with 82% confidence. A quick review keeps your plan accurate.",
      time: "12 min ago",
      action: "Review receipt",
    },
    {
      id: "paid",
      icon: "south_west",
      tone: "sky",
      title: "Cara paid you $3.40",
      body: "Her share of the lake trip is settled. Your tab now has $6.80 left to collect.",
      time: "1 hr ago",
      action: "View lake trip",
    },
    {
      id: "budget",
      icon: "restaurant",
      tone: "sand",
      title: "Dining has $30 left",
      body: "At your current pace, dining may run out three days before the month ends.",
      time: "Yesterday",
      action: "See insight",
    },
  ];
  const unread = notices.length - read.length;
  const markRead = (id: string) =>
    setRead((current) => (current.includes(id) ? current : [...current, id]));
  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader title="Notifications" back={back} />
      <section className="ios-surface mt-7 grid grid-cols-[minmax(0,1fr)_92px] items-end overflow-hidden rounded-[22px] pl-5">
        <div className="relative z-10 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
            {unread ? `${unread} worth a look` : "You're all caught up"}
          </p>
          <h2 className="mt-2 text-[21px] font-semibold leading-[1.12] tracking-[-.035em]">
            Only the money updates that matter.
          </h2>
        </div>
        <img
          src="/cat-v3-stock/png/done.png"
          alt="Tabby keeping watch over your updates"
          className="tabby-v3-figure h-[124px] w-full object-contain object-bottom"
        />
      </section>
      <div className="mt-7 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">Recent</p>
        <button
          onClick={() => setRead(notices.map((notice) => notice.id))}
          className="text-[12px] font-bold text-[#103e33]"
        >
          Mark all read
        </button>
      </div>
      <section className="ios-surface mt-3 overflow-hidden rounded-[22px] px-4">
        {notices.map((notice, index) => {
          const isRead = read.includes(notice.id);
          return (
            <button
              key={notice.id}
              onClick={() => {
                markRead(notice.id);
                if (notice.id === "review") openReceipt(receipts[2]);
              }}
              className={`relative flex w-full gap-3 py-4 text-left ${index ? "border-t border-black/[0.07]" : ""}`}
            >
              {!isRead && (
                <span className="absolute right-0 top-4 h-2 w-2 rounded-full bg-[#ff453a]" />
              )}
              <span
                className={`demo-${notice.tone} grid h-11 w-11 shrink-0 place-items-center rounded-[14px]`}
              >
                <Icon name={notice.icon} size={20} />
              </span>
              <span className={`min-w-0 flex-1 pr-4 ${isRead ? "opacity-55" : ""}`}>
                <span className="flex items-start justify-between gap-2">
                  <b className="text-[14px] leading-snug">{notice.title}</b>
                  <small className="shrink-0 text-[10px] font-semibold text-[#77776f]">
                    {notice.time}
                  </small>
                </span>
                <span className="mt-1.5 block text-[12px] leading-relaxed text-[#77776f]">
                  {notice.body}
                </span>
                <span className="mt-2 block text-[11px] font-bold text-[#103e33]">
                  {notice.action} →
                </span>
              </span>
            </button>
          );
        })}
      </section>
      <p className="mx-auto mt-5 max-w-[280px] text-center text-[11px] leading-relaxed text-[#77776f]">
        Tabby keeps routine activity quiet and surfaces only decisions, payments, and plan changes.
      </p>
    </main>
  );
}

function Insights({ back, goBudgets }: { back: () => void; goBudgets: () => void }) {
  const monthData = {
    May: {
      total: 318.24,
      pace: -42,
      finding: "Transport was unusually low.",
      values: [72.1, 81.24, 64.5, 58.4],
    },
    Jun: {
      total: 286.42,
      pace: -68,
      finding: "A quieter month across every category.",
      values: [65.2, 74.62, 51.3, 49.8],
    },
    Jul: {
      total: 356.18,
      pace: -18,
      finding: "Groceries rose while dining stayed steady.",
      values: [78.4, 82.18, 63.2, 94.4],
    },
    Aug: {
      total: 414.8,
      pace: 12,
      finding: "Two trips increased transport spending.",
      values: [91.6, 88.2, 132.4, 76.2],
    },
    Sep: {
      total: 487.16,
      pace: 49,
      finding: "Shared dinners drove the increase.",
      values: [136.2, 104.16, 116.8, 89.4],
    },
    Oct: {
      total: 540.83,
      pace: 85,
      finding: "Shared meals explain most of the rise.",
      values: [119.68, 118.62, 97.4, 96.59],
    },
  };
  const [selectedMonth, setSelectedMonth] = useState<keyof typeof monthData>("Oct");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const currentMonth = monthData[selectedMonth];
  const insightMood =
    currentMonth.pace > 60 ? "over-budget" : currentMonth.pace > 0 ? "hmm" : "cool";
  const categoryNames = ["Dining", "Utilities", "Transport", "Groceries"];
  const categoryTones = ["demo-sand", "demo-sky", "demo-coral", "demo-lime"];
  const shownTotal = currentMonth.values.reduce((sum, value) => sum + value, 0);
  const categories = categoryNames.map((name, index) => ({
    name,
    amount: currentMonth.values[index],
    tone: categoryTones[index],
  }));
  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader
        title="Insights"
        back={back}
        action={
          <button
            onClick={goBudgets}
            className="rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
          >
            Budgets
          </button>
        }
      />
      <section className="demo-gloss mt-7 grid min-h-[240px] grid-cols-[minmax(0,1fr)_145px] items-end overflow-hidden rounded-[24px] bg-[#103e33] pl-5 text-white">
        <div className="relative z-10 py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
            {selectedMonth} finding
          </p>
          <h2 className="mt-3 text-[25px] font-semibold leading-[1.08] tracking-[-.045em]">
            {currentMonth.finding}
          </h2>
          <p className="mt-3 text-[12px] leading-relaxed text-white/65">
            {currentMonth.pace > 0
              ? `$${currentMonth.pace} ahead of pace. Tap a category to see why.`
              : `$${Math.abs(currentMonth.pace)} below pace. Your plan had room.`}
          </p>
        </div>
        <div className="tabby-v3-stage tabby-v3-stage-hero relative flex h-[222px] items-end justify-center pr-2">
          <img
            src={`/cat-v3-stock/png/${insightMood}.png`}
            alt={`Tabby reacting to ${selectedMonth} spending`}
            className="tabby-v3-figure relative z-10 h-[210px] w-full object-contain object-bottom"
          />
        </div>
      </section>
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Spent this month
            </p>
            <p className="mt-1 text-[36px] font-semibold tracking-[-.05em]">
              ${Math.floor(currentMonth.total)}
              <span className="text-[22px] text-[#9c9c95]">
                .{currentMonth.total.toFixed(2).split(".")[1]}
              </span>
            </p>
          </div>
          <span
            className={`text-[12px] font-bold ${currentMonth.pace > 0 ? "text-[#a74132]" : "text-[#50713a]"}`}
          >
            {currentMonth.pace > 0 ? "+" : ""}${currentMonth.pace} vs pace
          </span>
        </div>
        <div className="mt-5 flex h-36 items-end gap-3 border-b border-black/10 px-2">
          {(
            [
              [18, "May"],
              [12, "Jun"],
              [22, "Jul"],
              [31, "Aug"],
              [47, "Sep"],
              [100, "Oct"],
            ] as const
          ).map(([h, m]) => (
            <button
              key={m}
              onClick={() => setSelectedMonth(m)}
              className="flex h-full flex-1 flex-col justify-end gap-2"
              aria-label={`Show ${m} insights`}
            >
              <div
                className={`${m === selectedMonth ? "bg-[#103e33]" : "bg-black/[0.08]"} w-full rounded-t-[6px] transition-[height]`}
                style={{ height: `${h}%` }}
              />
              <span
                className={`text-center text-[10px] font-semibold ${m === selectedMonth ? "text-[#141512]" : "text-[#9c9c95]"}`}
              >
                {m}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[19px] font-semibold tracking-[-.03em]">Where it went</h2>
          <span className="text-[12px] text-[#77776f]">${shownTotal.toFixed(2)} shown</span>
        </div>
        <div className="ios-surface mt-3 rounded-[20px] px-4">
          {categories.map(({ name, amount, tone }) => {
            const share = Math.round((amount / currentMonth.total) * 100);
            const width = `${Math.round((amount / Math.max(...currentMonth.values)) * 100)}%`;
            return (
              <button
                onClick={() => setSelectedCategory(name)}
                key={name}
                className="block w-full border-b border-black/[0.06] py-4 text-left last:border-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{name}</span>
                  <span>
                    <b>${amount.toFixed(2)}</b>
                    <small className="ml-2 text-[#77776f]">{share}%</small>
                    <Icon name="chevron_right" size={15} className="ml-1 inline text-[#9c9c95]" />
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className={`h-full rounded-full ${tone}`} style={{ width }} />
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="mt-8 rounded-[20px] bg-[#edf9b7] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#50713a]">
          Best next move
        </p>
        <h2 className="mt-2 text-[21px] font-semibold tracking-[-.035em]">
          Move $20 from groceries to dining.
        </h2>
        <p className="mt-2 text-[13px] text-[#526346]">
          Groceries are $57 under pace. Dining is likely to finish $8 over.
        </p>
        <button className="mt-4 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white">
          Review the change
        </button>
      </section>
      {selectedCategory && (
        <DemoSheet
          title={`${selectedCategory} · ${selectedMonth}`}
          subtitle={`Expenses included in your $${currentMonth.total.toFixed(2)} monthly total.`}
          close={() => setSelectedCategory(null)}
        >
          <section className="ios-surface rounded-[20px] px-4">
            {receipts
              .filter((receipt) =>
                receipt.note
                  .toLowerCase()
                  .includes(
                    selectedCategory === "Dining" ? "dinner" : selectedCategory.toLowerCase()
                  )
              )
              .map((receipt, index) => (
                <div key={receipt.merchant} className={index ? "border-t border-black/[0.07]" : ""}>
                  <ReceiptRow item={receipt} />
                </div>
              ))}
          </section>
          <div className="mt-4 rounded-[16px] bg-black/[0.04] p-4">
            <b className="text-[12px]">How this total is calculated</b>
            <p className="mt-1 text-[10px] leading-relaxed text-[#77776f]">
              Personal receipts count in full. Shared receipts count only your assigned share.
              Refunds reduce the month in which they were recorded.
            </p>
          </div>
          <button className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white">
            View all {selectedCategory.toLowerCase()} activity
          </button>
        </DemoSheet>
      )}
    </main>
  );
}

function Budgets({ back }: { back: () => void }) {
  const [creating, setCreating] = useState(false);
  const [level, setLevel] = useState<"total" | "category" | "merchant" | "item">("total");
  const [target, setTarget] = useState("Dining");
  const [amount, setAmount] = useState("700");
  const [period, setPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [thresholds, setThresholds] = useState([80, 100, 120]);
  const [saved, setSaved] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState("Coffee");
  const budgets = [
    {
      label: "October total",
      kind: "Overall",
      spent: 540.83,
      limit: 700,
      icon: "account_balance_wallet",
      tone: "lime",
    },
    {
      label: "Dining",
      kind: "Category",
      spent: 119.68,
      limit: 150,
      icon: "restaurant",
      tone: "sand",
    },
    { label: "Coffee", kind: "Item", spent: 46.42, limit: 40, icon: "coffee", tone: "coral" },
  ];
  const focusedBudget = budgets.find((budget) => budget.label === selectedBudget) ?? budgets[0];
  const focusedUsed = Math.round((focusedBudget.spent / focusedBudget.limit) * 100);
  const focusedOver = focusedBudget.spent > focusedBudget.limit;
  const focusedClose = !focusedOver && focusedUsed >= 75;
  const budgetMood = focusedOver ? "over-budget" : focusedClose ? "hmm" : "cool";
  const categories = ["Dining", "Groceries", "Transport", "Utilities"];
  const preview =
    level === "total"
      ? "$540.83 would count this month"
      : level === "category"
        ? `$119.68 in ${target.toLowerCase()} would count`
        : level === "merchant"
          ? `Every receipt from ${target || "this merchant"} would count`
          : "Latte, espresso, cold brew and similar item lines count";
  return (
    <>
      <main className="px-5 pb-12 pt-5">
        <BackHeader
          title="Budgets"
          back={back}
          backLabel="Insights"
          action={
            <button
              onClick={() => {
                setSaved(false);
                setCreating(true);
              }}
              className="rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
            >
              + New
            </button>
          }
        />
        <section className="demo-gloss mt-7 grid min-h-[222px] grid-cols-[minmax(0,1fr)_142px] items-end overflow-hidden rounded-[24px] pl-5 text-white">
          <div className="relative z-10 py-5">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
              {focusedBudget.label} · October
            </p>
            <h2 className="mt-2 text-[25px] font-semibold leading-[1.05] tracking-[-.045em]">
              {focusedOver
                ? `$${(focusedBudget.spent - focusedBudget.limit).toFixed(2)} over limit.`
                : focusedClose
                  ? `$${(focusedBudget.limit - focusedBudget.spent).toFixed(2)} left.`
                  : "Comfortably on pace."}
            </h2>
            <p className="mt-3 text-[12px] leading-relaxed text-white/65">
              {focusedOver
                ? "Tabby caught it. Review matching purchases or adjust the plan."
                : focusedClose
                  ? "Tabby will alert you before the next matching purchase puts it over."
                  : "No change needed right now."}
            </p>
          </div>
          <div className="tabby-v3-stage tabby-v3-stage-hero relative flex h-[210px] items-end justify-center pr-2">
            <img
              src={`/cat-v3-stock/png/${budgetMood}.png`}
              alt={`Tabby reacting to the ${focusedBudget.label} budget`}
              className="tabby-v3-figure relative z-10 h-[200px] w-full object-contain object-bottom"
            />
          </div>
        </section>
        <div className="mt-7 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
            Monthly budgets
          </p>
          <span className="text-[11px] text-[#77776f]">6 days left</span>
        </div>
        <section className="ios-surface mt-3 overflow-hidden rounded-[22px] px-4">
          {budgets.map((budget, index) => {
            const used = Math.round((budget.spent / budget.limit) * 100);
            const over = budget.spent > budget.limit;
            const close = !over && used >= 75;
            return (
              <button
                key={budget.label}
                onClick={() => setSelectedBudget(budget.label)}
                className={`w-full py-4 text-left ${index ? "border-t border-black/[0.07]" : ""} ${selectedBudget === budget.label ? "bg-black/[0.025]" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`demo-${budget.tone} grid h-11 w-11 place-items-center rounded-[14px]`}
                  >
                    <Icon name={budget.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[14px]">{budget.label}</b>
                    <span className="text-[11px] text-[#77776f]">
                      {budget.kind} · ${budget.spent.toFixed(2)} of ${budget.limit}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${over || close ? "bg-[#f7e9e3] text-[#a74132]" : "bg-[#e6f3e5] text-[#286036]"}`}
                  >
                    {over
                      ? `Over $${(budget.spent - budget.limit).toFixed(2)}`
                      : close
                        ? "Close"
                        : "On pace"}
                  </span>
                </div>
                <div className="ml-14 mt-3 h-2 overflow-hidden rounded-full bg-black/[0.07]">
                  <div
                    className={`h-full rounded-full ${over || close ? "bg-[#d26a53]" : "bg-[#103e33]"}`}
                    style={{ width: `${Math.min(used, 100)}%` }}
                  />
                </div>
                {selectedBudget === budget.label && (
                  <div className="ml-14 mt-3 flex gap-2">
                    <span className="rounded-full bg-black/[0.05] px-3 py-1.5 text-[10px] font-bold">
                      View activity
                    </span>
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        setCreating(true);
                      }}
                      className="rounded-full bg-black/[0.05] px-3 py-1.5 text-[10px] font-bold"
                    >
                      Edit budget
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </section>
        <section className="mt-6 rounded-[20px] bg-[#dff0ff] p-4">
          <div className="flex gap-3">
            <Icon name="info" size={20} />
            <div>
              <b className="block text-[13px]">What counts?</b>
              <p className="mt-1 text-[11px] leading-relaxed text-[#45667b]">
                Budgets use your share after splits. Item budgets count matching receipt lines—not
                the whole purchase.
              </p>
            </div>
          </div>
        </section>
      </main>
      {creating && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[430px] bg-black/50">
          <section className="ios-surface flex h-full flex-col overflow-hidden sm:rounded-[30px]">
            <div className="flex items-start justify-between border-b border-black/[0.07] px-5 pb-4 pt-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                  Monthly by default
                </p>
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">Set a budget</h2>
              </div>
              <button
                onClick={() => setCreating(false)}
                aria-label="Close budget setup"
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-5">
              <p className="text-[12px] font-bold">What should Tabby watch?</p>
              <div className="mt-3 space-y-2">
                {(
                  [
                    [
                      "total",
                      "Overall spending",
                      "Your share of every purchase",
                      "account_balance_wallet",
                    ],
                    ["category", "A category", "Dining, groceries, transport…", "category"],
                    ["merchant", "A merchant", "Costco, DoorDash, Blue Bottle…", "storefront"],
                    [
                      "item",
                      "Specific items",
                      "Coffee, takeout, subscriptions…",
                      "shopping_basket",
                    ],
                  ] as const
                ).map(([key, title, sub, icon]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setLevel(key);
                      setTarget(
                        key === "category"
                          ? "Dining"
                          : key === "merchant"
                            ? "Costco"
                            : key === "item"
                              ? "coffee"
                              : ""
                      );
                      setAmount(key === "total" ? "700" : key === "category" ? "150" : "40");
                    }}
                    className={`flex w-full items-center gap-3 rounded-[17px] border p-3 text-left ${level === key ? "border-[#103e33] bg-[#edf9b7]" : "border-black/[0.08] bg-black/[0.025]"}`}
                  >
                    <span
                      className={`grid h-10 w-10 place-items-center rounded-[13px] ${level === key ? "bg-[#103e33] text-white" : "bg-black/[0.05]"}`}
                    >
                      <Icon name={icon} size={20} />
                    </span>
                    <span className="flex-1">
                      <b className="block text-[13px]">{title}</b>
                      <span className="text-[10px] text-[#77776f]">{sub}</span>
                    </span>
                    {level === key && (
                      <Icon name="check_circle" fill size={20} className="text-[#103e33]" />
                    )}
                  </button>
                ))}
              </div>
              {level === "category" && (
                <section className="mt-6">
                  <p className="text-[12px] font-bold">Which category?</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => setTarget(category)}
                        className={`rounded-full px-3 py-2 text-[11px] font-bold ${target === category ? "bg-[#103e33] text-white" : "bg-black/[0.05]"}`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {level === "item" && (
                <section className="mt-6">
                  <p className="text-[12px] font-bold">What item should match?</p>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="coffee"
                    className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[14px] outline-none"
                  />
                  <div className="mt-3 rounded-[15px] bg-[#dff0ff] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#45667b]">
                      Recent matches
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#45667b]">
                      Caffe latte $5.80 · Cold brew $4.90 · Espresso $3.20
                    </p>
                    <p className="mt-2 text-[10px] text-[#45667b]">
                      Only these line items count. The rest of their receipts do not.
                    </p>
                  </div>
                </section>
              )}
              {level === "merchant" && (
                <section className="mt-6">
                  <p className="text-[12px] font-bold">Which merchant?</p>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="Costco"
                    className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[14px] outline-none"
                  />
                  <p className="mt-2 text-[10px] text-[#77776f]">
                    Merchant matching ignores capitalization but does not combine unrelated stores.
                  </p>
                </section>
              )}
              <section className="mt-6">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-bold">
                    {period[0].toUpperCase() + period.slice(1)} limit
                  </p>
                  <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold">
                    {period === "weekly"
                      ? "Resets Monday"
                      : period === "monthly"
                        ? "Resets Nov 1"
                        : "Resets Jan 1"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 rounded-full bg-black/[0.05] p-1">
                  {(["weekly", "monthly", "yearly"] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setPeriod(option)}
                      className={`min-h-9 rounded-full text-[10px] font-bold capitalize ${period === option ? "bg-[#fffefa] text-[#103e33] shadow-sm" : "text-[#77776f]"}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <label className="mt-2 flex items-center rounded-[18px] border border-black/10 bg-black/[0.035] px-4">
                  <span className="text-[26px] font-semibold text-[#77776f]">$</span>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    className="h-16 min-w-0 flex-1 bg-transparent px-2 text-[30px] font-semibold tracking-[-.04em] outline-none"
                  />
                </label>
                <div className="mt-2 flex gap-2">
                  {(level === "total"
                    ? [500, 700, 1000]
                    : level === "category"
                      ? [100, 150, 250]
                      : [25, 40, 60]
                  ).map((value) => (
                    <button
                      key={value}
                      onClick={() => setAmount(String(value))}
                      className={`flex-1 rounded-full py-2 text-[11px] font-bold ${Number(amount) === value ? "bg-[#edf9b7] text-[#103e33]" : "bg-black/[0.05]"}`}
                    >
                      ${value}
                    </button>
                  ))}
                </div>
              </section>
              <section className="mt-6 rounded-[18px] bg-black/[0.04] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#77776f]">
                  Before you save
                </p>
                <h3 className="mt-2 text-[16px] font-semibold">
                  ${amount || "0"} for {level === "total" ? "all spending" : target}
                </h3>
                <p className="mt-2 text-[11px] leading-relaxed text-[#77776f]">
                  {preview}. Your share after splits is always used.
                </p>
                <div className="mt-3 flex gap-1.5">
                  {[80, 100, 120].map((threshold) => (
                    <button
                      key={threshold}
                      onClick={() =>
                        setThresholds((current) =>
                          current.includes(threshold)
                            ? current.filter((value) => value !== threshold)
                            : [...current, threshold].sort()
                        )
                      }
                      className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${thresholds.includes(threshold) ? "bg-[#fffefa] text-[#103e33] ring-1 ring-black/10" : "bg-black/[0.05] text-[#77776f]"}`}
                    >
                      Alert at {threshold}%
                    </button>
                  ))}
                </div>
              </section>
              {saved && (
                <p className="mt-4 text-center text-[12px] font-bold text-[#50713a]">
                  Budget saved. Existing matching budget updated—no duplicate alerts.
                </p>
              )}
              <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] bg-[#141816] px-5 pb-5 pt-5">
                <button
                  onClick={() => setSaved(true)}
                  className="w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
                >
                  {saved ? "Saved" : `Add ${period} budget`}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Profile({
  back,
  dark,
  toggleTheme,
}: {
  back: () => void;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const [view, setView] = useState<
    "personal" | "tabby" | "tabbydata" | "notifications" | "inbox" | "money" | "privacy" | null
  >(null);
  const [reacts, setReacts] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [mood, setMood] = useState("cool");
  const [portraitStyle, setPortraitStyle] = useState<"Portrait" | "Full body" | "Soft frame">(
    "Soft frame"
  );
  const [email, setEmail] = useState("demo@cotab.local");
  const [mobile, setMobile] = useState("(415) 555-0199");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [suggestSplits, setSuggestSplits] = useState(true);
  const [runRules, setRunRules] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  const rows = [
    {
      id: "personal" as const,
      icon: "person",
      title: "Personal information",
      sub: "Name, phone, email and time zone",
      meta: phoneVerified ? "Verified" : "Verify mobile",
    },
    {
      id: "notifications" as const,
      icon: "notifications_none",
      title: "Notifications",
      sub: "Reminders and Tabby notes on this device",
      meta: "On",
    },
    {
      id: "inbox" as const,
      icon: "mail",
      title: "Receipt capture",
      sub: "Email forwarding and Apple Pay taps",
      meta: "Email on",
    },
    {
      id: "money" as const,
      icon: "account_balance_wallet",
      title: "Money and payments",
      sub: "Budgets and ways friends can pay you",
      meta: "2 connected",
    },
    {
      id: "privacy" as const,
      icon: "shield",
      title: "Data and privacy",
      sub: "Export data or delete the account",
      meta: "",
    },
  ];
  if (view) {
    const titles = {
      personal: "Personal information",
      tabby: "Your Tabby",
      tabbydata: "Tabby controls",
      notifications: "Notifications",
      inbox: "Receipt capture",
      money: "Money and payments",
      privacy: "Data and privacy",
    };
    return (
      <main className="px-5 pb-12 pt-5">
        <BackHeader title={titles[view]} back={() => setView(null)} backLabel="Profile" />
        {view === "personal" && (
          <div className="mt-7 space-y-5">
            <section className="ios-surface rounded-[22px] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                Identity
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1.5 block text-[11px] text-[#77776f]">First name</span>
                  <input
                    defaultValue="Demo"
                    className="w-full rounded-[13px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[11px] text-[#77776f]">Last name</span>
                  <input
                    defaultValue="User"
                    className="w-full rounded-[13px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                  />
                </label>
              </div>
              <button className="mt-4 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white">
                Save name
              </button>
            </section>
            <section className="ios-surface rounded-[22px] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                Contact
              </p>
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="flex justify-between text-[10px] text-[#77776f]">
                    <span>Email</span>
                    <b>Verified</b>
                  </span>
                  <input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setContactSaved(false);
                    }}
                    className="mt-1 w-full rounded-[13px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between text-[10px] text-[#77776f]">
                    <span>Mobile</span>
                    <b className={phoneVerified ? "text-[#2f7d49]" : "text-[#a74132]"}>
                      {phoneVerified ? "Verified" : "Verification required"}
                    </b>
                  </span>
                  <input
                    value={mobile}
                    onChange={(e) => {
                      setMobile(e.target.value);
                      setPhoneVerified(false);
                      setContactSaved(false);
                    }}
                    className="mt-1 w-full rounded-[13px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                  />
                </label>
                {!phoneVerified && (
                  <div className="rounded-[14px] bg-[#fff2d5] p-3">
                    <b className="text-[11px] text-[#79552b]">Verify before matching invitations</b>
                    <p className="mt-1 text-[10px] leading-relaxed text-[#79552b]">
                      Cotab will not connect tabs invited to this number until the SMS code is
                      confirmed.
                    </p>
                    <button
                      onClick={() => setPhoneVerified(true)}
                      className="mt-2 min-h-9 rounded-full bg-[#103e33] px-3 text-[10px] font-bold text-white"
                    >
                      Send and verify demo code
                    </button>
                  </div>
                )}
                <label className="block">
                  <span className="text-[10px] text-[#77776f]">Time zone</span>
                  <select className="mt-1 w-full rounded-[13px] border border-black/10 bg-transparent px-3 py-3 text-[13px]">
                    <option>America / Los Angeles · Automatic</option>
                    <option>America / New York</option>
                    <option>Europe / London</option>
                  </select>
                </label>
              </div>
              <button
                onClick={() => setContactSaved(true)}
                className="mt-4 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
              >
                {contactSaved ? "Saved" : "Save contact changes"}
              </button>
            </section>
            <p className="px-2 text-[11px] leading-relaxed text-[#77776f]">
              Changing your mobile number never connects an invitation by itself. Cotab matches
              invitations only after the new number is confirmed by SMS.
            </p>
          </div>
        )}
        {view === "tabby" && (
          <div className="mt-7">
            <section className="ios-surface rounded-[24px] p-5 text-center">
              <div
                className={`tabby-profile-preview tabby-profile-${portraitStyle.toLowerCase().replace(" ", "-")} mx-auto flex aspect-square h-48 items-end justify-center overflow-hidden rounded-[28px]`}
              >
                <img
                  src={`/cat-v3-stock/png/${mood}.png`}
                  alt="Your selected Tabby"
                  className="h-full w-full object-contain"
                />
              </div>
              <h2 className="mt-4 text-[20px] font-semibold">
                Tabby · {mood.charAt(0).toUpperCase() + mood.slice(1)}
              </h2>
              <p className="mt-1 text-[12px] text-[#77776f]">
                Sage plush · Cotab’s money companion
              </p>
            </section>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Profile picture style
            </p>
            <div className="mt-3 grid grid-cols-3 rounded-full bg-black/[0.06] p-1">
              {(["Portrait", "Full body", "Soft frame"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => setPortraitStyle(style)}
                  className={`rounded-full py-2.5 text-[10px] font-bold ${portraitStyle === style ? "bg-[#fffefa] shadow-sm" : "text-[#77776f]"}`}
                >
                  {style}
                </button>
              ))}
            </div>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Profile expression
            </p>
            <div className="mt-3 grid grid-cols-5 gap-3">
              {["hi", "cool", "hmm", "love", "remember"].map((option) => (
                <button
                  key={option}
                  onClick={() => setMood(option)}
                  aria-label={`Use ${option} expression`}
                  className={`rounded-full ${mood === option ? "ring-2 ring-[#6d846d] ring-offset-2 ring-offset-transparent" : ""}`}
                >
                  <Cat mood={option} size={52} />
                </button>
              ))}
            </div>
            <label className="ios-surface mt-6 flex items-center gap-3 rounded-[18px] p-4">
              <span className="flex-1">
                <b className="block text-[14px]">Let Tabby react</b>
                <span className="text-[11px] text-[#77776f]">
                  Home expression follows your budget health
                </span>
              </span>
              <input
                type="checkbox"
                checked={reacts}
                onChange={(event) => setReacts(event.target.checked)}
                className="h-5 w-5 accent-[#103e33]"
              />
            </label>
          </div>
        )}
        {view === "tabbydata" && (
          <div className="mt-7 space-y-3">
            <section className="rounded-[22px] bg-[#edf9b7] p-4">
              <div className="flex items-center gap-3">
                <Cat mood="working" size={48} />
                <span>
                  <b className="block text-[14px]">You stay in control</b>
                  <span className="text-[11px] text-[#526346]">
                    Tabby suggests first. Only approved rules run automatically.
                  </span>
                </span>
              </div>
            </section>
            {[
              ["React to budget health", "Changes Tabby’s expression and tone", reacts, setReacts],
              [
                "Suggest likely splits",
                "Uses past people, never adds them automatically",
                suggestSplits,
                setSuggestSplits,
              ],
              [
                "Run approved rules",
                "Categorize or split new matching receipts; every run stays undoable",
                runRules,
                setRunRules,
              ],
            ].map(([title, sub, checked, setter]) => (
              <label
                key={String(title)}
                className="ios-surface flex items-center gap-3 rounded-[18px] p-4"
              >
                <span className="flex-1">
                  <b className="block text-[13px]">{String(title)}</b>
                  <span className="text-[10px] text-[#77776f]">{String(sub)}</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(checked)}
                  onChange={(e) => (setter as (value: boolean) => void)(e.target.checked)}
                  className="h-5 w-5 accent-[#103e33]"
                />
              </label>
            ))}
            <p className="px-1 pt-3 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Approved rules
            </p>
            <section className="ios-surface rounded-[20px] px-4">
              {[
                ["Coffee → Dining", "Categorize matching receipt lines"],
                ["Lake trip", "Suggest Cara, Dev and Ben—confirm before adding"],
              ].map(([title, sub], index) => (
                <div
                  key={title}
                  className={`flex items-center gap-3 py-4 ${index ? "border-t border-black/[0.07]" : ""}`}
                >
                  <Icon name="rule" size={19} />
                  <span className="flex-1">
                    <b className="block text-[13px]">{title}</b>
                    <small className="text-[#77776f]">{sub}</small>
                  </span>
                  <button className="text-[10px] font-bold text-[#103e33]">Edit</button>
                </div>
              ))}
            </section>
            {[
              [
                "history",
                "Activity history",
                "Review and undo actions Tabby took",
                "3 recent actions",
              ],
              ["rule", "Active rules", "Pause automatic rules without deleting them", "2 running"],
              [
                "memory",
                "What Tabby remembers",
                "Relationships and preferences used in suggestions",
                "4 memories",
              ],
            ].map(([icon, title, sub, meta]) => (
              <button
                key={title}
                className="ios-surface flex w-full items-center gap-3 rounded-[18px] p-4 text-left"
              >
                <Icon name={icon} size={20} />
                <span className="flex-1">
                  <b className="block text-[14px]">{title}</b>
                  <span className="text-[11px] text-[#77776f]">{sub}</span>
                </span>
                <span className="text-[10px] font-bold text-[#77776f]">{meta}</span>
                <Icon name="chevron_right" size={17} />
              </button>
            ))}
          </div>
        )}
        {view === "notifications" && (
          <div className="mt-7">
            <section className="ios-surface rounded-[22px] p-5">
              <div className="flex items-center gap-3">
                <span className="demo-sky grid h-12 w-12 place-items-center rounded-[15px]">
                  <Icon name="notifications" size={22} />
                </span>
                <span className="flex-1">
                  <b className="block text-[15px]">This device</b>
                  <span className="text-[11px] text-[#77776f]">
                    Friends’ reminders and Tabby notes
                  </span>
                </span>
                <button
                  onClick={() => setNotifications((current) => !current)}
                  className={`relative h-7 w-12 rounded-full ${notifications ? "bg-[#103e33]" : "bg-black/15"}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${notifications ? "left-6" : "left-1"}`}
                  />
                </button>
              </div>
            </section>
            <section className="mt-4 rounded-[20px] bg-[#dff0ff] p-4">
              <b className="text-[13px]">Device-specific setting</b>
              <p className="mt-1 text-[11px] leading-relaxed text-[#45667b]">
                Turning this on here does not enable notifications on your other devices. On iPhone
                web, Cotab must first be added to the Home Screen.
              </p>
            </section>
          </div>
        )}
        {view === "inbox" && (
          <div className="mt-7 space-y-4">
            <section className="ios-surface rounded-[22px] p-4">
              <div className="flex items-center gap-3">
                <span className="demo-lime grid h-11 w-11 place-items-center rounded-[14px]">
                  <Icon name="forward_to_inbox" size={20} />
                </span>
                <span className="flex-1">
                  <b className="block text-[14px]">Forward receipts by email</b>
                  <span className="text-[11px] text-[#77776f]">Active · 2 approved senders</span>
                </span>
              </div>
              <div className="mt-4 rounded-[14px] bg-black/[0.04] p-3">
                <small className="text-[10px] text-[#77776f]">Your private Cotab address</small>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-[11px]">
                    demo-7f2@inbox.cotab.app
                  </code>
                  <button className="text-[11px] font-bold text-[#103e33]">Copy</button>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[#77776f]">
                Only mail from approved sender addresses is read. Generating a new inbox address
                disables this one.
              </p>
              <button className="mt-3 text-[11px] font-bold text-[#a74132]">
                Manage senders and address
              </button>
            </section>
            <section className="ios-surface rounded-[22px] p-4">
              <div className="flex items-center gap-3">
                <span className="demo-sky grid h-11 w-11 place-items-center rounded-[14px]">
                  <Icon name="phone_iphone" size={20} />
                </span>
                <span className="flex-1">
                  <b className="block text-[14px]">Apple Pay taps</b>
                  <span className="text-[11px] text-[#77776f]">iPhone · 8 taps this month</span>
                </span>
                <span className="rounded-full bg-[#e6f3e5] px-2 py-1 text-[9px] font-bold text-[#286036]">
                  Connected
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[#77776f]">
                Uses an iOS 17 Shortcut and a revocable device key. New secrets are shown only once.
              </p>
              <button className="mt-3 rounded-full border border-black/10 px-3 py-2 text-[11px] font-bold">
                Manage iPhone keys
              </button>
            </section>
          </div>
        )}
        {view === "money" && (
          <div className="mt-7 space-y-4">
            <section className="ios-surface rounded-[22px] p-4">
              <div className="flex items-center gap-3">
                <span className="demo-lime grid h-11 w-11 place-items-center rounded-[14px]">
                  <Icon name="donut_large" size={20} />
                </span>
                <span className="flex-1">
                  <b className="block text-[14px]">Budgets</b>
                  <span className="text-[11px] text-[#77776f]">3 monthly budgets · 2 on pace</span>
                </span>
                <Icon name="chevron_right" size={18} />
              </div>
            </section>
            <section className="ios-surface rounded-[22px] p-4">
              <h3 className="text-[15px] font-semibold">Get paid</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-[#77776f]">
                Only people you split with can see these payment options.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ["Venmo", "@demo-user"],
                  ["PayPal", "demo-user"],
                  ["Cash App", ""],
                  ["Zelle", ""],
                ].map(([label, value]) => (
                  <label key={label}>
                    <span className="mb-1 block text-[10px] text-[#77776f]">{label}</span>
                    <input
                      defaultValue={value}
                      placeholder="Not connected"
                      className="w-full rounded-[13px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[12px] outline-none"
                    />
                  </label>
                ))}
              </div>
              <button className="mt-4 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white">
                Save payment options
              </button>
            </section>
          </div>
        )}
        {view === "privacy" && (
          <div className="mt-7 space-y-4">
            <section className="ios-surface rounded-[22px] p-4">
              <div className="flex items-start gap-3">
                <Icon name="download" size={21} />
                <span className="flex-1">
                  <b className="block text-[14px]">Download your data</b>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#77776f]">
                    A JSON copy of your receipts, budgets, splits and account data. Download links
                    expire after 7 days.
                  </p>
                  <button className="mt-3 rounded-full border border-black/10 px-3 py-2 text-[11px] font-bold">
                    Prepare my copy
                  </button>
                </span>
              </div>
            </section>
            <section className="rounded-[22px] border border-[#d26a53]/35 bg-[#f7e9e3] p-4">
              <b className="text-[14px] text-[#a74132]">Delete account</b>
              <p className="mt-1 text-[11px] leading-relaxed text-[#715f59]">
                Permanently removes every receipt, budget and split. Password accounts confirm with
                a password; Apple or Google accounts receive a six-digit email code.
              </p>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 rounded-full border border-[#a74132]/30 px-3 py-2 text-[11px] font-bold text-[#a74132]"
                >
                  Delete my account
                </button>
              ) : (
                <div className="mt-3 rounded-[16px] bg-black/[0.04] p-3">
                  <label className="text-[10px] font-bold text-[#715f59]">
                    Type your password to continue
                  </label>
                  <input
                    type="password"
                    placeholder="Password"
                    className="mt-2 w-full rounded-[12px] border border-black/10 bg-[#fffefa] px-3 py-3 text-[12px]"
                  />
                  <div className="mt-3 flex gap-2">
                    <button className="rounded-full bg-[#a74132] px-3 py-2 text-[11px] font-bold text-white">
                      Delete everything
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-2 text-[11px] font-bold"
                    >
                      Keep account
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    );
  }
  return (
    <main className="px-5 pb-12 pt-5">
      <BackHeader title="Profile" back={back} />
      <section className="ios-surface mt-7 grid grid-cols-[minmax(0,1fr)_110px] items-end overflow-hidden rounded-[24px] pl-5">
        <div className="py-5">
          <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
            Your Cotab
          </p>
          <h2 className="mt-2 text-[24px] font-semibold tracking-[-.04em]">Demo User</h2>
          <p className="mt-1 text-[12px] text-[#77776f]">demo@cotab.local</p>
          <button
            onClick={() => setView("personal")}
            className="mt-4 text-[12px] font-bold text-[#103e33]"
          >
            Edit account details →
          </button>
        </div>
        <div className="tabby-v3-stage tabby-v3-stage-profile relative flex h-[142px] items-end justify-center">
          <img
            src="/cat-v3-stock/png/cool.png"
            alt="Your Tabby"
            className="tabby-v3-figure h-[148px] w-full object-contain object-bottom"
          />
        </div>
      </section>
      <button
        onClick={toggleTheme}
        className="ios-surface mt-4 flex w-full items-center gap-3 rounded-[18px] p-4 text-left"
      >
        <span className="ios-theme-glyph grid h-10 w-10 place-items-center rounded-[13px]">
          <Icon name={dark ? "dark_mode" : "light_mode"} size={20} />
        </span>
        <span className="flex-1">
          <b className="block text-[14px]">Appearance</b>
          <span className="text-[11px] text-[#77776f]">
            {dark ? "Dark material" : "Light material"}
          </span>
        </span>
        <span className="text-[12px] font-semibold text-[#77776f]">{dark ? "Dark" : "Light"}</span>
        <Icon name="chevron_right" size={18} className="text-[#9c9c95]" />
      </button>
      <section className="mt-8">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
          Your Tabby
        </p>
        <button
          onClick={() => setView("tabby")}
          className="mt-3 w-full rounded-[20px] bg-[#edf9b7] p-4 text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <b className="block">Sage Tabby · {mood.charAt(0).toUpperCase() + mood.slice(1)}</b>
              <span className="text-[12px] text-[#526346]">Reacts when your spending changes</span>
            </div>
            <Cat mood={mood} size={52} />
          </div>
          <div className="mt-4 flex justify-between">
            {["hi", "cool", "hmm", "love", "remember"].map((m) => (
              <span
                key={m}
                className={`rounded-full ${m === mood ? "ring-2 ring-[#103e33] ring-offset-2 ring-offset-[#edf9b7]" : ""}`}
              >
                <Cat mood={m} size={42} />
              </span>
            ))}
          </div>
        </button>
        <button
          onClick={() => setView("tabbydata")}
          className="ios-surface mt-3 flex w-full items-center gap-3 rounded-[18px] p-4 text-left"
        >
          <Icon name="psychology" size={20} />
          <span className="flex-1">
            <b className="block text-[14px]">Rules, actions and memory</b>
            <span className="text-[11px] text-[#77776f]">Review, pause or undo Tabby’s work</span>
          </span>
          <Icon name="chevron_right" size={18} />
        </button>
      </section>
      <section className="mt-8">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
          Account
        </p>
        <div className="ios-surface rounded-[20px] px-4">
          {rows.map((row, i) => (
            <button
              key={row.id}
              onClick={() => setView(row.id)}
              className={`flex w-full items-center gap-3 py-4 text-left ${i ? "border-t border-black/[0.07]" : ""}`}
            >
              <Icon name={row.icon} size={20} />
              <span className="flex-1">
                <b className="block text-[14px]">{row.title}</b>
                <span className="text-[11px] text-[#77776f]">{row.sub}</span>
              </span>
              {row.meta && <span className="text-[9px] font-bold text-[#77776f]">{row.meta}</span>}
              <Icon name="chevron_right" size={18} className="text-[#9c9c95]" />
            </button>
          ))}
        </div>
      </section>
      <button className="mt-6 w-full rounded-full border border-black/10 bg-[#fffefa] py-3.5 text-[13px] font-bold">
        Sign out
      </button>
    </main>
  );
}

type V2EditItem = {
  id: number;
  backendId?: string;
  name: string;
  quantity: number;
  /** The line's total as typed; checked and turned into cents on save. */
  price: string;
};

/** What was bought: each item line, then tax, tip and fees (or discounts)
 *  as whatever the total adds beyond the items. */
function boughtRows(item: Receipt): Array<[string, string]> {
  const lines = item.lineItems ?? [];
  const rows: Array<[string, string]> = lines.map((line) => [
    `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.item_name || line.description}`,
    scanMoney(line.total_price, item.currency),
  ]);
  const itemsCents = lines.reduce((sum, line) => sum + Math.round(line.total_price * 100), 0);
  const extra = Math.round((item.total ?? 0) * 100) - itemsCents;
  if (lines.length && extra)
    rows.push([
      extra > 0 ? "Tax, tip and fees" : "Discounts",
      scanMoney(Math.abs(extra) / 100, item.currency),
    ]);
  return rows;
}

/** The edit form, from the receipt as last saved. */
function editState(item: Receipt) {
  return {
    items: (item.lineItems ?? []).map(
      (line, index): V2EditItem => ({
        id: index + 1,
        backendId: line.id,
        name: line.description,
        quantity: line.quantity || 1,
        price: centsText(Math.round((line.total_price || 0) * 100)),
      })
    ),
    merchant: item.merchant,
    purchaseDate: item.purchasedAt ? item.purchasedAt.slice(0, 10) : "",
    category: item.category || "other",
    currency: item.currency || "USD",
    subtotal: centsText(Math.round((item.subtotal ?? 0) * 100)),
    tax: centsText(Math.round((item.tax ?? 0) * 100)),
    total: centsText(Math.round((item.total ?? 0) * 100)),
  };
}

function ReceiptDetail({
  item,
  close,
  onChange,
}: {
  item: Receipt;
  close: () => void;
  /** The receipt as the server now has it, after a save or a second read. */
  onChange: (receipt: Receipt) => void;
}) {
  const [mode, setMode] = useState<"edit" | "split" | "scan" | null>(null);
  const [splitType, setSplitType] = useState<"even" | "itemized" | "exact" | "percent" | "shares">(
    "even"
  );
  const [taxMode, setTaxMode] = useState<"items" | "even" | "payer">("items");
  const [payer, setPayer] = useState("You");
  const [addingPerson, setAddingPerson] = useState(false);
  const [splitPeople, setSplitPeople] = useState([
    { name: "You", mood: "cool", detail: "Receipt owner", status: "you" },
    { name: "Ben Lee", mood: "hi", detail: "••• 0199 · On Cotab", status: "joined" },
  ]);
  const [form, setForm] = useState(() => editState(item));
  const editItems = form.items;
  const setEditItems = (next: (current: V2EditItem[]) => V2EditItem[]) =>
    setForm((current) => ({ ...current, items: next(current.items) }));
  const { merchant, purchaseDate, category, currency, subtotal, tax, total } = form;
  const setField =
    (field: "merchant" | "purchaseDate" | "category" | "currency") => (value: string) =>
      setForm((current) => ({ ...current, [field]: value }));
  const [setMerchant, setPurchaseDate, setCategory, setCurrency] = (
    ["merchant", "purchaseDate", "category", "currency"] as const
  ).map(setField);
  const setMoney = (field: "subtotal" | "tax" | "total") => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const startEdit = () => {
    setForm(editState(item));
    setReceiptMessage(null);
    setMode("edit");
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(editState(item));
  const closeEdit = () => {
    if (dirty && !window.confirm("Discard your changes to this receipt?")) return;
    setMode(null);
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [itemOwners, setItemOwners] = useState<Record<number, string[]>>({
    1: ["You"],
    2: ["Ben Lee"],
  });
  const lineCents = editItems.map((line) => parseCents(line.price));
  const subtotalCents = parseCents(subtotal);
  const taxCents = parseCents(tax);
  const totalCents = parseCents(total);
  const moneyOk =
    lineCents.every((c) => c !== null) &&
    subtotalCents !== null &&
    taxCents !== null &&
    totalCents !== null;
  const itemsCents = lineCents.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const itemsTotal = itemsCents / 100;
  const money = (cents: number) => scanMoney(cents / 100, currency);
  const check = moneyOk
    ? reconcile(itemsCents, subtotalCents, taxCents, totalCents, money)
    : { ok: false, message: "Some amounts aren’t numbers. Fix the highlighted fields." };
  const namesOk = merchant.trim().length > 0 && editItems.every((line) => line.name.trim());
  const updateEditItem = (id: number, patch: Partial<(typeof editItems)[number]>) =>
    setEditItems((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );

  useEffect(() => {
    if (!item.id) return;
    getReceiptImage(item.id)
      .then((image) => setImageUrl(image.url))
      .catch(() => setImageUrl(null));
  }, [item.id]);

  const saveReceipt = async () => {
    if (!item.id) {
      setMode(null);
      return;
    }
    if (!moneyOk || !namesOk) return;
    setSavingReceipt(true);
    setReceiptMessage(null);
    try {
      const updated = await reviewReceipt(item.id, {
        merchant: merchant.trim(),
        purchased_at: purchaseDate || null,
        category,
        currency,
        subtotal: (subtotalCents as number) / 100,
        tax: (taxCents as number) / 100,
        total: (totalCents as number) / 100,
        line_items: editItems.map((line, index) => {
          const cents = lineCents[index] as number;
          return {
            id: line.backendId,
            description: line.name.trim(),
            quantity: line.quantity,
            unit_price: unitCents(cents, line.quantity) / 100,
            total_price: cents / 100,
          };
        }),
      });
      onChange(receiptFromApi(updated as UploadResult));
      invalidateSpending();
      setReceiptMessage("Receipt changes saved.");
      setMode(null);
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t save this receipt.");
    } finally {
      setSavingReceipt(false);
    }
  };
  const retryScan = async () => {
    if (!item.id) return;
    setReceiptMessage("Tabby is reading the receipt again…");
    try {
      const updated = await retryReceipt(item.id);
      onChange(receiptFromApi(updated as UploadResult));
      invalidateSpending();
      setReceiptMessage(
        updated.status === "extracted"
          ? "Read it this time. Check the items below."
          : updated.error_message
            ? `Still couldn’t read it: ${updated.error_message}`
            : "Still couldn’t read it. You can type it in with Edit receipt."
      );
    } catch (error) {
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t retry this receipt.");
    }
  };
  const deleteSavedReceipt = async () => {
    if (!item.id) return;
    try {
      await deleteReceipt(item.id);
      invalidateSpending();
      close();
    } catch (error) {
      setConfirmingDelete(false);
      setReceiptMessage(error instanceof Error ? error.message : "Couldn’t delete this receipt.");
    }
  };
  const toggleOwner = (id: number, person: string) =>
    setItemOwners((current) => {
      const owners = current[id] || [];
      return {
        ...current,
        [id]: owners.includes(person)
          ? owners.filter((name) => name !== person)
          : [...owners, person],
      };
    });
  return (
    <>
      <main className="receipt-detail min-h-screen bg-[#eee8dc] px-5 pb-10 pt-5">
        <button onClick={close} className="flex min-h-11 items-center gap-1 text-[13px] font-bold">
          <Icon name="arrow_back" size={19} />
          Activity
        </button>
        <Ticket className="mt-3 rounded-t-[22px] px-5 pb-8 pt-6">
          <div className="text-center">
            <span
              className={`demo-${item.tone} mx-auto grid h-14 w-14 place-items-center rounded-[17px]`}
            >
              <Icon name={item.icon} size={25} />
            </span>
            <h1 className="mt-4 text-[24px] font-semibold tracking-[-.04em]">{item.merchant}</h1>
            <p className="mt-1 text-[12px] text-[#77776f]">{item.date}</p>
            <p className="mt-5 text-[44px] font-semibold tracking-[-.055em]">{item.amount}</p>
          </div>
          <div className="my-6 border-t border-dashed border-black/20" />
          <div className="space-y-3 text-[13px]">
            <div className="flex justify-between">
              <span>Receipt total</span>
              <b>{item.amount}</b>
            </div>
            <div className="flex justify-between">
              <span>Your share</span>
              <b>{item.mine.split(" ")[0]}</b>
            </div>
            {typeof item.confidence === "number" && (
              <div className="flex justify-between text-[#77776f]">
                <span>Read by Tabby</span>
                <span>{Math.round(item.confidence * 100)}% confidence</span>
              </div>
            )}
          </div>
          <div className="my-6 border-t border-dashed border-black/20" />
          <h2 className="text-[15px] font-bold">What was bought</h2>
          {boughtRows(item).map(([n, a], index) => (
            <div
              key={`${n}-${index}`}
              className="flex justify-between gap-3 border-b border-black/[0.06] py-3 text-[13px]"
            >
              <span className="min-w-0">{n}</span>
              <b className="shrink-0">{a}</b>
            </div>
          ))}
          {!item.lineItems?.length && (
            <p className="py-3 text-[12px] text-[#77776f]">
              No item lines. Add them with Edit receipt.
            </p>
          )}
          {imageUrl && (
            <button
              onClick={() => setMode("scan")}
              className="mt-5 flex w-full items-center gap-3 rounded-[16px] border border-black/[0.08] bg-black/[0.025] p-3 text-left"
            >
              <span className="relative grid h-[74px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[#f7f0df] text-[#554b3e] shadow-sm">
                <span className="absolute inset-x-2 top-2 h-1 rounded-full bg-black/15" />
                <span className="absolute inset-x-2 top-5 h-px bg-black/10" />
                <span className="absolute inset-x-2 top-8 h-px bg-black/10" />
                <span className="absolute inset-x-2 top-11 h-px bg-black/10" />
                <Icon name="receipt_long" size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13px]">Original receipt</b>
                <span className="mt-1 block text-[11px] leading-relaxed text-[#77776f]">
                  Uploaded photo · Tap to inspect the scan
                </span>
              </span>
              <Icon name="open_in_full" size={17} className="text-[#77776f]" />
            </button>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={startEdit}
              className="rounded-full border border-black/15 py-3 text-[13px] font-bold"
            >
              Edit receipt
            </button>
            <button
              onClick={() => setMode("split")}
              className="rounded-full bg-[#103e33] py-3 text-[13px] font-bold text-white"
            >
              Split this
            </button>
          </div>
          {item.id && (
            <div className="mt-3 flex justify-center gap-5 text-[11px] font-bold">
              {item.status === "failed" && (
                <button
                  onClick={retryScan}
                  className="min-h-11 text-[#103e33] underline underline-offset-4"
                >
                  Read it again
                </button>
              )}
              {!confirmingDelete && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="min-h-11 text-[#a74132] underline underline-offset-4"
                >
                  Delete receipt
                </button>
              )}
            </div>
          )}
          {confirmingDelete && (
            <div
              role="alertdialog"
              aria-label="Delete this receipt?"
              className="receipt-delete-confirm mt-3 rounded-[16px] bg-[#fde7e7] p-4 text-[12px] text-[#7a2b20]"
            >
              <b className="block text-[13px]">Delete this receipt?</b>
              It comes off your spending and off any tab it was split on.
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="min-h-11 rounded-full bg-white/70 font-bold text-[#22231f]"
                >
                  Keep it
                </button>
                <button
                  onClick={deleteSavedReceipt}
                  className="min-h-11 rounded-full bg-[#a74132] font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {receiptMessage && (
            <p role="status" className="mt-3 text-center text-[11px] font-semibold text-[#77776f]">
              {receiptMessage}
            </p>
          )}
        </Ticket>
      </main>
      {mode === "scan" && (
        <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col bg-black/90 px-5 pb-8 pt-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <b className="block text-[15px]">Original receipt</b>
              <span className="text-[11px] text-white/55">{item.date}</span>
            </div>
            <button
              onClick={() => setMode(null)}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
              aria-label="Close receipt photo"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="my-8 flex min-h-0 flex-1 items-center justify-center">
            {imageUrl && (
              <img
                src={imageUrl}
                alt={`Original receipt from ${item.merchant}`}
                className="max-h-full max-w-full rounded-[10px] object-contain shadow-2xl"
              />
            )}
          </div>
        </div>
      )}
      {(mode === "edit" || mode === "split") && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[430px] bg-black/45">
          <section className="ios-surface full-sheet flex h-full w-full flex-col overflow-hidden sm:rounded-[30px]">
            <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 pb-4 pt-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                  {mode === "edit" ? "Correct what Tabby read" : "Create or update a tab"}
                </p>
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">
                  {mode === "edit" ? "Edit receipt" : `Split ${item.amount}`}
                </h2>
              </div>
              <button
                onClick={mode === "edit" ? closeEdit : () => setMode(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
                aria-label={`Close ${mode} receipt`}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            {mode === "edit" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-5">
                <section className="grid grid-cols-2 gap-3">
                  <label className="col-span-2 block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Store
                    </span>
                    <input
                      value={merchant}
                      onChange={(event) => setMerchant(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-4 py-3 text-[14px] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Date
                    </span>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(event) => setPurchaseDate(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Category
                    </span>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    >
                      {CATEGORIES.map((id) => (
                        <option key={id} value={id}>
                          {categoryLabel(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-[#77776f]">
                      Currency
                    </span>
                    <select
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      className="w-full rounded-[14px] border border-black/10 bg-black/[0.035] px-3 py-3 text-[13px] outline-none"
                    >
                      {Array.from(new Set([currency, "USD", "CAD", "GBP", "EUR", "AUD"])).map(
                        (code) => (
                          <option key={code}>{code}</option>
                        )
                      )}
                    </select>
                  </label>
                </section>
                <section className="mt-6">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                        Line items
                      </p>
                      <h3 className="mt-1 text-[19px] font-semibold">{editItems.length} items</h3>
                    </div>
                    <span className="text-[12px] font-semibold text-[#77776f]">
                      {scanMoney(itemsTotal, currency)}
                    </span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {editItems.map((line, index) => {
                      const duplicate = editItems.some(
                        (other, otherIndex) =>
                          otherIndex < index &&
                          other.name.trim().toLowerCase() === line.name.trim().toLowerCase()
                      );
                      return (
                        <div
                          key={line.id}
                          className={`rounded-[18px] border p-3 ${duplicate ? "border-[#f0a08f]/60 bg-[#f7e9e3]" : "border-black/[0.08] bg-black/[0.025]"}`}
                        >
                          {duplicate && (
                            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#a74132]">
                              <Icon name="content_copy" size={14} />
                              Possible duplicate
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              aria-label={`Item ${index + 1} name`}
                              value={line.name}
                              onChange={(event) =>
                                updateEditItem(line.id, { name: event.target.value })
                              }
                              className="min-w-0 flex-1 rounded-[12px] border border-black/10 bg-transparent px-3 py-2.5 text-[14px] font-semibold outline-none"
                            />
                            <button
                              onClick={() =>
                                setEditItems((current) =>
                                  current.filter((entry) => entry.id !== line.id)
                                )
                              }
                              aria-label={`Delete ${line.name}`}
                              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#c84c3d]"
                            >
                              <Icon name="delete" size={19} />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#77776f]">Qty</span>
                            <button
                              onClick={() =>
                                updateEditItem(line.id, {
                                  quantity: Math.max(1, line.quantity - 1),
                                })
                              }
                              aria-label={`Fewer ${line.name || "of this item"}`}
                              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.06]"
                            >
                              <Icon name="remove" size={16} />
                            </button>
                            <b className="w-5 text-center text-[13px]">{line.quantity}</b>
                            <button
                              onClick={() =>
                                updateEditItem(line.id, { quantity: line.quantity + 1 })
                              }
                              aria-label={`More ${line.name || "of this item"}`}
                              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.06]"
                            >
                              <Icon name="add" size={16} />
                            </button>
                            <span className="flex-1" />
                            <label
                              className={`flex items-center rounded-[12px] border px-3 ${lineCents[index] === null ? "border-[#c84c3d]" : "border-black/10"}`}
                            >
                              <span className="text-[12px] text-[#77776f]">$</span>
                              <input
                                aria-label={`Item ${index + 1} price`}
                                aria-invalid={lineCents[index] === null}
                                inputMode="decimal"
                                value={line.price}
                                onChange={(event) =>
                                  updateEditItem(line.id, { price: event.target.value })
                                }
                                className="h-10 w-16 bg-transparent text-right text-[14px] font-bold outline-none"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() =>
                      setEditItems((current) => [
                        ...current,
                        { id: Date.now(), name: "", quantity: 1, price: "" },
                      ])
                    }
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border border-dashed border-black/20 py-3 text-[12px] font-bold"
                  >
                    <Icon name="add" size={18} />
                    Add an item
                  </button>
                </section>
                <section className="mt-6 rounded-[18px] bg-black/[0.04] p-4">
                  <h3 className="text-[14px] font-bold">Money check</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["Subtotal", subtotal, subtotalCents, setMoney("subtotal")],
                        ["Tax + tip", tax, taxCents, setMoney("tax")],
                        ["Total", total, totalCents, setMoney("total")],
                      ] as Array<[string, string, number | null, (value: string) => void]>
                    ).map(([label, value, cents, setter]) => (
                      <label key={label}>
                        <span className="block text-[10px] font-semibold text-[#77776f]">
                          {label}
                        </span>
                        <span
                          className={`mt-1 flex items-center rounded-[11px] border px-2 ${cents === null ? "border-[#c84c3d]" : "border-black/10"}`}
                        >
                          <span className="text-[11px] text-[#77776f]">$</span>
                          <input
                            aria-label={label}
                            aria-invalid={cents === null}
                            inputMode="decimal"
                            value={value}
                            onChange={(event) => setter(event.target.value)}
                            className="h-10 min-w-0 w-full bg-transparent text-right text-[13px] font-bold outline-none"
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                  <p
                    role="status"
                    className={`mt-3 flex items-center gap-1.5 text-[11px] font-semibold ${check.ok ? "text-[#50713a]" : "text-[#a74132]"}`}
                  >
                    <Icon name={check.ok ? "check_circle" : "error"} size={16} fill />
                    {check.message}
                  </p>
                  {!check.ok && moneyOk && (
                    <p className="mt-1 text-[10px] text-[#77776f]">
                      You can still save; the total you enter is what counts.
                    </p>
                  )}
                </section>
                <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] bg-[#141816] px-5 pb-5 pt-5">
                  {!namesOk && (
                    <p className="mb-2 text-center text-[11px] font-semibold text-[#f0b5a9]">
                      Give the store and every item a name.
                    </p>
                  )}
                  <button
                    onClick={saveReceipt}
                    disabled={savingReceipt || !moneyOk || !namesOk}
                    className="w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    {savingReceipt ? "Saving…" : "Save receipt changes"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 pt-5">
                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[16px] font-semibold">People</h3>
                    <button className="text-[12px] font-bold text-[#103e33]">
                      Use an existing tab
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {splitPeople.map((person) => (
                      <div
                        key={person.name}
                        className="flex items-center gap-3 rounded-[15px] bg-black/[0.035] p-2.5"
                      >
                        <Cat mood={person.mood} size={40} />
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13px]">{person.name}</b>
                          <span className="block truncate text-[10px] text-[#77776f]">
                            {person.detail}
                          </span>
                        </span>
                        {person.status === "joined" && (
                          <span className="rounded-full bg-[#dff0ff] px-2 py-1 text-[9px] font-bold text-[#365f78]">
                            Connected
                          </span>
                        )}
                        {person.status !== "you" && (
                          <button
                            onClick={() => {
                              setSplitPeople((current) =>
                                current.filter((entry) => entry.name !== person.name)
                              );
                              if (payer === person.name) setPayer("You");
                            }}
                            aria-label={`Remove ${person.name}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-[#77776f]"
                          >
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setAddingPerson(true)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-black/15 py-3 text-[12px] font-bold"
                  >
                    <Icon name="person_add" size={17} />
                    Add another person
                  </button>
                </section>
                <section className="mt-6">
                  <h3 className="text-[16px] font-semibold">Who paid?</h3>
                  <div className="mt-3 flex gap-2">
                    {splitPeople.map((person) => (
                      <button
                        key={person.name}
                        onClick={() => setPayer(person.name)}
                        className={`flex items-center gap-2 rounded-full px-3 py-2 text-[12px] font-bold ${payer === person.name ? "bg-[#103e33] text-white" : "bg-black/[0.05]"}`}
                      >
                        <Cat mood={person.mood} size={26} />
                        {person.name}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="mt-6">
                  <h3 className="text-[16px] font-semibold">How should it split?</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {(
                      [
                        ["even", "Evenly", "drag_handle", "Same amount"],
                        ["itemized", "By item", "checklist", "Pick who had what"],
                        ["exact", "Exact amounts", "payments", "Type each amount"],
                        ["percent", "Percentages", "percent", "Must total 100%"],
                        ["shares", "Shares", "pie_chart", "Like 2 : 1"],
                      ] as const
                    ).map(([key, title, icon, sub]) => (
                      <button
                        key={key}
                        onClick={() => setSplitType(key)}
                        className={`rounded-[16px] border p-3 text-left ${splitType === key ? "border-[#103e33] bg-[#edf9b7]" : "border-black/[0.08] bg-black/[0.025]"}`}
                      >
                        <Icon name={icon} size={19} />
                        <b className="mt-2 block text-[13px]">{title}</b>
                        <span className="text-[10px] text-[#77776f]">{sub}</span>
                      </button>
                    ))}
                  </div>
                </section>
                {splitType === "itemized" && (
                  <section className="mt-6">
                    <div className="flex justify-between">
                      <h3 className="text-[16px] font-semibold">Who had what</h3>
                      <span className="text-[11px] font-bold text-[#a74132]">
                        Shared items allowed
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      {editItems.map((line) => (
                        <div
                          key={line.id}
                          className="rounded-[16px] border border-black/[0.08] p-3"
                        >
                          <div className="flex justify-between text-[13px]">
                            <b>{line.name || "New item"}</b>
                            <b>{scanMoney((parseCents(line.price) ?? 0) / 100, currency)}</b>
                          </div>
                          <div className="mt-2 flex gap-2">
                            {splitPeople.map((person) => {
                              const on = (itemOwners[line.id] || []).includes(person.name);
                              return (
                                <button
                                  key={person.name}
                                  onClick={() => toggleOwner(line.id, person.name)}
                                  className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[11px] font-bold ${on ? "bg-[#103e33] text-white" : "bg-black/[0.05]"}`}
                                >
                                  <Cat mood={person.mood} size={24} />
                                  {person.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {(splitType === "exact" || splitType === "percent" || splitType === "shares") && (
                  <section className="mt-6">
                    <h3 className="text-[16px] font-semibold">
                      {splitType === "exact"
                        ? "Who owes how much"
                        : splitType === "percent"
                          ? "Who pays what share"
                          : "How many shares each"}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {splitPeople.map((person) => (
                        <label
                          key={person.name}
                          className="flex items-center gap-3 rounded-[14px] bg-black/[0.035] p-3"
                        >
                          <Cat mood={person.mood} size={34} />
                          <b className="flex-1 text-[13px]">{person.name}</b>
                          <input
                            defaultValue={
                              splitType === "exact" ? "14.00" : splitType === "percent" ? "50" : "1"
                            }
                            className="w-16 bg-transparent text-right text-[14px] font-bold outline-none"
                          />
                          <span className="text-[12px] text-[#77776f]">
                            {splitType === "exact" ? "$" : splitType === "percent" ? "%" : "×"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-[#50713a]">
                      {splitType === "shares" ? "2 shares" : "All assigned"}
                    </p>
                  </section>
                )}
                {(splitType === "even" || splitType === "itemized") && (
                  <section className="mt-6">
                    <h3 className="text-[16px] font-semibold">Tax, tip, fees and discounts</h3>
                    <div className="mt-3 grid grid-cols-3 rounded-full bg-black/[0.06] p-1">
                      {(
                        [
                          ["items", "By items"],
                          ["even", "Evenly"],
                          ["payer", "Payer covers"],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setTaxMode(key)}
                          className={`rounded-full py-2.5 text-[10px] font-bold ${taxMode === key ? "bg-[#fffefa] shadow-sm" : "text-[#77776f]"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <section className="mt-6 rounded-[18px] bg-black/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold">Live preview</h3>
                    <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#50713a]">
                      Adds to $28.00
                    </span>
                  </div>
                  {splitPeople.map((person, index) => {
                    const cents =
                      Math.floor(2800 / splitPeople.length) +
                      (index < 2800 % splitPeople.length ? 1 : 0);
                    return (
                      <div key={person.name} className="mt-3 flex items-center gap-3">
                        <Cat mood={person.mood} size={34} />
                        <span className="flex-1 text-[13px] font-semibold">
                          {person.name}
                          {person.name === payer && (
                            <small className="ml-2 text-[#77776f]">Paid</small>
                          )}
                        </span>
                        <b>${(cents / 100).toFixed(2)}</b>
                      </div>
                    );
                  })}
                </section>
                <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[430px] bg-[#141816] px-5 pb-5 pt-5">
                  <button
                    onClick={() => setMode(null)}
                    className="w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
                  >
                    Review split · {splitPeople.length} people
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {addingPerson && (
        <div className="fixed inset-0 z-[60] mx-auto flex max-w-[430px] items-end bg-black/55">
          <section className="ios-surface max-h-[88vh] w-full overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-4">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-black/15" />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
                  Choose carefully
                </p>
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-.04em]">Add someone</h2>
              </div>
              <button
                onClick={() => setAddingPerson(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06]"
                aria-label="Close add person"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="mt-5 rounded-[18px] border border-[#83d5df]/20 bg-[#dff0ff] p-4">
              <div className="flex items-start gap-3">
                <Icon name="auto_awesome" size={20} />
                <div>
                  <b className="block text-[13px]">Suggested, never automatic</b>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#45667b]">
                    Cara was on 4 previous DoorDash splits. Confirm the identity before adding her.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-black/[0.04] p-2.5">
                <Cat mood="love" size={40} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px]">Cara Mills</b>
                  <span className="text-[10px] text-[#77776f]">••• 4421 · On Cotab</span>
                </span>
                {splitPeople.some((person) => person.name === "Cara Mills") ? (
                  <span className="text-[10px] font-bold text-[#77776f]">Added</span>
                ) : (
                  <button
                    onClick={() => {
                      setSplitPeople((current) => [
                        ...current,
                        {
                          name: "Cara Mills",
                          mood: "love",
                          detail: "••• 4421 · On Cotab",
                          status: "joined",
                        },
                      ]);
                      setAddingPerson(false);
                    }}
                    className="rounded-full bg-[#103e33] px-3 py-2 text-[11px] font-bold text-white"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Recent people
            </p>
            <div className="mt-2 divide-y divide-black/[0.07] rounded-[18px] border border-black/[0.08] px-3">
              {[
                ["Dev Shah", "••• 7834 · On Cotab", "cool"],
                ["Maya Chen", "maya.chen@icloud.com · On Cotab", "remember"],
                ["Ben Carter", "••• 8841 · Different from Ben Lee", "hmm"],
              ].map(([name, detail, mood]) => {
                const added = splitPeople.some((person) => person.name === name);
                return (
                  <button
                    key={name}
                    disabled={added}
                    onClick={() => {
                      setSplitPeople((current) => [
                        ...current,
                        { name, mood, detail, status: "joined" },
                      ]);
                      setAddingPerson(false);
                    }}
                    className="flex w-full items-center gap-3 py-3 text-left disabled:opacity-45"
                  >
                    <Cat mood={mood} size={38} />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[13px]">{name}</b>
                      <span className="block truncate text-[10px] text-[#77776f]">{detail}</span>
                    </span>
                    <span className="text-[10px] font-bold text-[#103e33]">
                      {added ? "Already added" : "Add"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
              Someone else
            </p>
            <input
              placeholder="Mobile number or email"
              aria-label="Mobile number or email"
              className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[13px] outline-none"
            />
            <p className="mt-2 text-[10px] leading-relaxed text-[#77776f]">
              Names only search people you have already split with. Cotab does not expose a global
              people search. New contacts are invited only after you review their number or email.
            </p>
          </section>
        </div>
      )}
    </>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-12 flex-col items-center justify-end gap-0.5 text-[10px] font-bold ${active ? "text-[#103e33]" : "text-[#92928b]"}`}
    >
      <Icon name={icon} size={21} fill={active} />
      <span>{label}</span>
    </button>
  );
}
function BottomNav({
  tab,
  setTab,
  scan,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  scan: () => void;
}) {
  const items: [Tab, string, string][] = [
    ["today", "Today", "home"],
    ["activity", "Activity", "receipt_long"],
    ["circles", "Tabs", "group"],
    ["tabby", "Tabby", "pets"],
  ];
  return (
    <nav
      aria-label="Main"
      className="ios-glass-nav fixed inset-x-3 bottom-3 z-30 mx-auto max-w-[404px] rounded-[28px] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="grid grid-cols-5 items-end">
        {items.slice(0, 2).map(([id, l, i]) => (
          <NavButton key={id} active={tab === id} label={l} icon={i} onClick={() => setTab(id)} />
        ))}
        <button onClick={scan} aria-label="Scan a receipt" className="-mt-7 flex justify-center">
          <span className="grid h-[58px] w-[58px] place-items-center rounded-full border-[5px] border-[#f4f1eb] bg-[#103e33] text-[#d7f45b] shadow-md">
            <Icon name="document_scanner" size={25} />
          </span>
        </button>
        {items.slice(2).map(([id, l, i]) => (
          <NavButton key={id} active={tab === id} label={l} icon={i} onClick={() => setTab(id)} />
        ))}
      </div>
    </nav>
  );
}

function scanStatus(item: ScanItem) {
  if (item.status === "checking") return "Checking light, framing and clarity";
  if (item.status === "needs_ok") return item.title || "This photo needs a look";
  if (item.status === "waiting") return "Waiting to upload";
  if (item.status === "reading") return item.uploaded ? "Reading every line" : "Uploading securely";
  if (item.status === "added") return "Added to Activity";
  if (item.status === "duplicate") return "Already on your tab";
  return item.message || "This receipt needs attention";
}

function Scanner({
  close,
  review,
  openReceipt,
}: {
  close: () => void;
  review: (receipt: Receipt) => void;
  openReceipt: (id: string) => void;
}) {
  const scanItems = useScanItems();
  const [stage, setStage] = useState<
    | "start"
    | "camera"
    | "review"
    | "batch"
    | "reading"
    | "done"
    | "manual"
    | "manualDone"
    | "manualSplit"
    | "manualSplitDone"
  >("start");
  const [flash, setFlash] = useState(false);
  const [batch, setBatch] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualCategory, setManualCategory] = useState("Dining");
  const [manualDate, setManualDate] = useState("Today · Oct 25");
  const [manualPicker, setManualPicker] = useState<"date" | "category" | null>(null);
  const [manualSplitType, setManualSplitType] = useState("Evenly");
  const [manualSplitTab, setManualSplitTab] = useState("Roommates");
  const [readingStep, setReadingStep] = useState(0);
  const [showItems, setShowItems] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [manualItems, setManualItems] = useState([
    { name: "", price: "" },
    { name: "", price: "" },
  ]);
  const manualItemsTotal = manualItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const manualTotal =
    showItems && manualItemsTotal > 0 ? manualItemsTotal : (Number(manualAmount) || 0) / 100;
  const manualValid = manualName.trim().length > 0 && manualTotal > 0;

  const onPicked = useCallback(
    (files: File[]) => {
      const result = addFiles(files);
      if (!result.added) {
        setScanMessage(
          result.unsupported
            ? "Cotab can read receipt photos, HEIC images and PDFs."
            : "The current batch is full. Finish or clear it before adding more."
        );
        return;
      }
      setScanMessage(
        result.tooMany
          ? `${result.tooMany} file${result.tooMany === 1 ? " was" : "s were"} left out. Add them in the next batch.`
          : result.unsupported
            ? `${result.unsupported} unsupported file${result.unsupported === 1 ? " was" : "s were"} left out.`
            : null
      );
      setBatch(result.added > 1 || scanItems.length > 0);
      setStage(result.added > 1 || scanItems.length > 0 ? "batch" : "reading");
    },
    [scanItems.length]
  );
  const scanPickers = useScanPickers(onPicked);

  const activeScans = scanItems.filter((item) => !isFinished(item.status));
  const needsDecision = scanItems.some((item) => item.status === "needs_ok");
  const completedScans = scanItems.filter((item) => item.status === "added");
  const duplicateScans = scanItems.filter((item) => item.status === "duplicate");
  // Real budget news from the upload: the first budget it pushed past a line.
  const budgetAlert = completedScans.flatMap((item) => item.result?.budget_alerts ?? [])[0];
  const matchedTap = completedScans.some((item) => item.result?.matched_tap);
  const failedScans = scanItems.filter(
    (item) => item.status === "error" || item.status === "refused"
  );
  const needsSignIn = failedScans.some((item) => item.title === "Sign in to scan");

  useEffect(() => {
    if (!scanItems.length || stage === "start" || stage === "camera") return;
    if (needsDecision) {
      setStage("batch");
      return;
    }
    if (activeScans.length) {
      setStage("reading");
      return;
    }
    setStage("done");
  }, [activeScans.length, needsDecision, scanItems.length, stage]);

  useEffect(() => {
    if (stage !== "reading") return;
    setReadingStep(0);
    const timers = [
      window.setTimeout(() => setReadingStep(1), 900),
      window.setTimeout(() => setReadingStep(2), 2100),
      window.setTimeout(() => setReadingStep(3), 3200),
    ];
    if (!scanItems.length) timers.push(window.setTimeout(() => setStage("done"), 4200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [scanItems.length, stage]);

  const reset = () => {
    clearFinished();
    setBatch(false);
    setManualName("");
    setManualAmount("");
    setShowItems(false);
    setManualItems([
      { name: "", price: "" },
      { name: "", price: "" },
    ]);
    setStage("start");
  };

  if (stage === "camera") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receipt camera"
        className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col overflow-hidden bg-[#090d0b] text-white"
      >
        {scanPickers.inputs}
        <div className="flex items-center justify-between px-5 pb-3 pt-[max(18px,env(safe-area-inset-top))]">
          <button
            onClick={() => setStage("start")}
            aria-label="Back"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10"
          >
            <Icon name="close" size={21} />
          </button>
          <span className="text-[13px] font-semibold">Receipt camera</span>
          <button
            onClick={() => setFlash((value) => !value)}
            aria-label="Toggle flash"
            className={`grid h-11 w-11 place-items-center rounded-full ${flash ? "bg-[#d7f45b] text-[#10231d]" : "bg-white/10"}`}
          >
            <Icon name={flash ? "flash_on" : "flash_off"} size={20} />
          </button>
        </div>
        <div className="relative mx-4 flex-1 overflow-hidden rounded-[28px] bg-[#28322d]">
          <div className="absolute inset-x-1/3 inset-y-0 border-x border-white/5" />
          <div className="absolute inset-x-0 inset-y-1/3 border-y border-white/5" />
          <div className="absolute inset-0 grid place-items-center px-10 text-center text-[13px] text-white/55">
            <span>
              <Icon name="receipt_long" size={34} />
              <span className="mt-2 block">Tap the shutter to open your camera</span>
            </span>
          </div>
          <span className="absolute left-5 top-5 h-12 w-12 rounded-tl-[18px] border-l-2 border-t-2 border-[#d7f45b]" />
          <span className="absolute right-5 top-5 h-12 w-12 rounded-tr-[18px] border-r-2 border-t-2 border-[#d7f45b]" />
          <span className="absolute bottom-5 left-5 h-12 w-12 rounded-bl-[18px] border-b-2 border-l-2 border-[#d7f45b]" />
          <span className="absolute bottom-5 right-5 h-12 w-12 rounded-br-[18px] border-b-2 border-r-2 border-[#d7f45b]" />
        </div>
        <p className="px-6 py-4 text-center text-[12px] text-white/70">
          Keep the whole receipt inside the corners
        </p>
        <div className="flex items-center justify-around pb-[max(28px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => scanPickers.open("photos")}
            className="min-h-11 px-3 text-[12px] font-semibold"
          >
            Photos
          </button>
          <button
            onClick={() => scanPickers.open("camera")}
            aria-label="Take photo"
            className="grid h-[76px] w-[76px] place-items-center rounded-full border-[4px] border-white"
          >
            <span className="h-[62px] w-[62px] rounded-full bg-white active:scale-95" />
          </button>
          <button
            onClick={() => scanPickers.open("camera")}
            className="min-h-11 px-3 text-[12px] font-semibold"
          >
            Auto
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-title"
      className="fixed inset-0 z-50 grid place-items-end bg-black/45"
    >
      {scanPickers.inputs}
      <div className="ios-surface scan-sheet mx-auto max-h-[96vh] w-full max-w-[430px] overflow-y-auto rounded-t-[30px] px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-black/15" />
        <div className="flex items-center justify-between">
          <div>
            <h2 id="scanner-title" className="text-[26px] font-semibold tracking-[-.045em]">
              {stage === "start" && "Add a receipt"}
              {stage === "review" && "Check the photo"}
              {stage === "batch" &&
                `${scanItems.length} receipt${scanItems.length === 1 ? "" : "s"} ready`}
              {stage === "reading" &&
                `Tabby is reading${scanItems.length > 1 ? ` ${scanItems.length} receipts` : ""}`}
              {stage === "done" &&
                (completedScans.length
                  ? `${completedScans.length} added to your tab`
                  : duplicateScans.length && !failedScans.length
                    ? "Already on your tab"
                    : needsSignIn
                      ? "Sign in to finish scanning"
                      : "These receipts need attention")}
              {stage === "manual" && "Add an expense"}
              {stage === "manualDone" && "Expense added"}
              {stage === "manualSplit" && "Split this expense"}
              {stage === "manualSplitDone" && "Split created"}
            </h2>
            <p className="mt-1 text-[12px] text-[#77776f]">
              {stage === "start" && "Photos stay private and can be corrected before saving."}
              {stage === "review" && "Clear, bright and fully inside the frame."}
              {stage === "batch" && "Up to 20 photos or PDFs in one batch."}
              {stage === "reading" && "You can close this—reading continues in the background."}
              {stage === "done" &&
                (completedScans.length
                  ? "Items, tax and totals are ready to review."
                  : duplicateScans.length && !failedScans.length
                    ? "Nothing new was added."
                    : needsSignIn
                      ? "Your session ended before anything was uploaded."
                      : "Nothing was added. Review the messages below.")}
              {stage === "manual" && "Cash, a bill, or anything without a receipt."}
              {stage === "manualDone" && "Saved to Activity and included in your budgets."}
              {stage === "manualSplit" && "Choose the Tab, people and how the amount is shared."}
              {stage === "manualSplitDone" && "Everyone’s share is ready in the Tab."}
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close scanner"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.05]"
          >
            <Icon name="close" />
          </button>
        </div>

        {stage === "start" && (
          <>
            <button
              onClick={() => setStage("camera")}
              className="scan-take-card mt-6 flex w-full items-center rounded-[24px] bg-[#103e33] p-5 text-left text-white active:scale-[.985]"
            >
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#d7f45b] text-[#103e33]">
                <Icon name="photo_camera" size={29} />
              </span>
              <span className="ml-4 flex-1">
                <b className="block text-[18px] tracking-[-.02em]">Take a photo</b>
                <span className="mt-1 block text-[12px] text-white/65">
                  Best for a paper receipt in front of you
                </span>
              </span>
              <Icon name="chevron_right" />
            </button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                onClick={() => scanPickers.open("photos")}
                className="min-h-[104px] rounded-[20px] bg-[#dff0ff] p-4 text-left active:scale-[.985]"
              >
                <Icon name="photo_library" size={23} />
                <b className="mt-4 block text-[14px]">Choose photos</b>
                <span className="text-[11px] text-[#45667b]">Select several at once</span>
              </button>
              <button
                onClick={() => scanPickers.open("files")}
                className="scan-file-card min-h-[104px] rounded-[20px] bg-[#f4e9dc] p-4 text-left active:scale-[.985]"
              >
                <Icon name="upload_file" size={23} />
                <b className="mt-4 block text-[14px]">Browse files</b>
                <span className="text-[11px] text-[#76604e]">PDF, HEIC or image</span>
              </button>
            </div>
            <button
              onClick={() => setStage("manual")}
              className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-[18px] bg-black/[0.035] px-4 text-left"
            >
              <Icon name="edit_note" size={22} />
              <span className="flex-1">
                <b className="block text-[13px]">Add without a receipt</b>
                <span className="text-[11px] text-[#77776f]">
                  Enter a cash purchase or bill by hand
                </span>
              </span>
              <Icon name="chevron_right" size={18} />
            </button>
            <div className="scan-privacy-note mt-5 flex items-start gap-3 rounded-[16px] px-2 py-2">
              <Cat mood="cool" size={43} />
              <p className="pt-1 text-[11px] leading-relaxed text-[#77776f]">
                <b className="text-[12px] text-[#22231f]">Tabby checks before uploading.</b>
                <br />
                Blurry, dark or tiny photos stay on your phone until you choose to use them.
              </p>
            </div>
            {scanMessage && (
              <p
                role="status"
                className="mt-3 rounded-[14px] bg-[#fff0d9] px-3 py-2.5 text-[11px] font-semibold text-[#725024]"
              >
                {scanMessage}
              </p>
            )}
          </>
        )}

        {stage === "review" && (
          <>
            <div className="relative mx-auto mt-5 h-[280px] w-[202px] overflow-hidden rounded-[12px] bg-[#fff9ea] px-5 py-6 text-[#38352f] shadow-lg">
              <div className="text-center text-[10px] font-bold tracking-[.16em]">NORTH MARKET</div>
              {["Organic milk", "Sourdough", "Avocados", "Coffee beans", "Dish soap"].map(
                (line, i) => (
                  <div key={line} className="mt-6 flex justify-between text-[8px]">
                    <span>{line}</span>
                    <span>{["5.49", "6.25", "4.98", "14.50", "7.99"][i]}</span>
                  </div>
                )
              )}
              <div className="mt-6 flex justify-between border-t border-dashed border-black/20 pt-3 text-[11px] font-bold">
                <span>TOTAL</span>
                <span>$42.68</span>
              </div>
              <div className="absolute inset-x-0 top-[42%] h-px bg-[#49bfa7] shadow-[0_0_12px_2px_rgb(73_191_167/.55)]" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-semibold">
              {[
                ["check_circle", "Sharp"],
                ["light_mode", "Bright"],
                ["crop_free", "Full receipt"],
              ].map(([icon, label]) => (
                <div
                  key={label}
                  className="scan-quality-chip rounded-[13px] bg-[#e6f5df] px-2 py-3 text-[#285c3c]"
                >
                  <Icon name={icon} size={17} />
                  <span className="mt-1 block">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-[1fr_1.45fr] gap-3">
              <button
                onClick={() => setStage("camera")}
                className="min-h-12 rounded-full bg-black/[0.05] text-[13px] font-bold"
              >
                Retake
              </button>
              <button
                onClick={() => setStage("reading")}
                className="min-h-12 rounded-full bg-[#103e33] text-[13px] font-bold text-white"
              >
                Read receipt
              </button>
            </div>
          </>
        )}

        {stage === "batch" && (
          <>
            <div className="mt-5 space-y-2">
              {scanItems.map((item) => (
                <div
                  key={item.id}
                  className={`scan-batch-row flex items-center gap-3 rounded-[17px] p-3 ${item.status === "needs_ok" ? "scan-batch-review bg-[#fff0d9]" : "bg-black/[0.035]"}`}
                >
                  <span className="scan-batch-thumb grid h-14 w-11 shrink-0 place-items-center rounded-[8px] bg-[#fff9ea] text-[10px] font-bold">
                    {item.preview ? (
                      <img
                        src={item.preview}
                        alt=""
                        className="h-full w-full rounded-[8px] object-cover"
                      />
                    ) : (
                      "PDF"
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px]">{item.name}</b>
                    <span className="text-[11px] text-[#77776f]">{scanStatus(item)}</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold ${item.status === "needs_ok" ? "text-[#9a5a13]" : "text-[#34704c]"}`}
                  >
                    {item.status === "needs_ok" ? "Review" : "Ready"}
                  </span>
                  <button
                    onClick={() => remove(item.id)}
                    aria-label={`Remove ${item.name}`}
                    className="grid h-9 w-9 place-items-center rounded-full"
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              ))}
            </div>
            {needsDecision && (
              <div className="scan-batch-warning mt-4 rounded-[15px] bg-[#fff0d9] p-3 text-[11px] leading-relaxed text-[#725024]">
                <b>One or more photos need a look.</b> You can use them anyway, remove them, or
                choose clearer photos.
              </div>
            )}
            <button
              onClick={() => {
                scanItems
                  .filter((item) => item.status === "needs_ok")
                  .forEach((item) => sendAnyway(item.id));
                setStage("reading");
              }}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
            >
              {needsDecision ? "Use selected photos and read" : "Continue reading"}
            </button>
            <button
              onClick={() => scanPickers.open("photos")}
              className="mt-2 min-h-11 w-full text-[12px] font-semibold text-[#77776f]"
            >
              Add more photos
            </button>
          </>
        )}

        {stage === "reading" && (
          <div className="py-7 text-center">
            <div className="scan-motion mx-auto" aria-hidden="true">
              <div className="scan-receipt">
                <div className="mx-auto h-2 w-16 rounded-full bg-black/15" />
                <div className="mt-5 flex justify-between">
                  <span className="h-1.5 w-20 rounded-full bg-black/12" />
                  <span className="h-1.5 w-7 rounded-full bg-black/15" />
                </div>
                <div className="mt-4 flex justify-between">
                  <span className="h-1.5 w-24 rounded-full bg-black/10" />
                  <span className="h-1.5 w-8 rounded-full bg-black/15" />
                </div>
                <div className="mt-4 flex justify-between">
                  <span className="h-1.5 w-16 rounded-full bg-black/10" />
                  <span className="h-1.5 w-7 rounded-full bg-black/15" />
                </div>
                <div className="mt-6 flex justify-between border-t border-dashed border-black/20 pt-4">
                  <span className="h-2 w-12 rounded-full bg-black/20" />
                  <span className="h-2 w-10 rounded-full bg-black/25" />
                </div>
                <div className="scan-beam" />
              </div>
              <div className="scan-data-chip scan-data-chip-one">
                <Icon name="storefront" size={15} /> Merchant
              </div>
              <div className="scan-data-chip scan-data-chip-two">
                <Icon name="list_alt" size={15} /> Items
              </div>
              <div className="scan-data-chip scan-data-chip-three">
                <Icon name="calculate" size={15} /> Total
              </div>
              <div className="scan-orbit">
                <Cat mood={readingStep < 2 ? "working" : "cool"} size={52} />
              </div>
              <div className="scan-tabby-thought">
                {
                  [
                    "Got the photo—keeping it secure.",
                    "Looking for the store and the date.",
                    "Reading each item, then tax and tip.",
                    "Checking it isn’t already on your tab.",
                  ][readingStep]
                }
              </div>
            </div>
            <p aria-live="polite" className="mt-14 text-[15px] font-semibold tracking-[-.015em]">
              {
                [
                  "Securing your upload",
                  "Reading merchant and date",
                  "Finding items, tax and tip",
                  "Checking duplicates and budgets",
                ][readingStep]
              }
            </p>
            <p className="mt-1 text-[11px] text-[#77776f]">
              {readingStep === 0
                ? "Your original stays private."
                : "You can close this—Tabby keeps working."}
            </p>
            <div className="mx-auto mt-5 flex max-w-[220px] gap-1.5">
              {[0, 1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 flex-1 rounded-full ${step <= readingStep ? "bg-[#39a68e]" : "bg-black/[0.08]"}`}
                />
              ))}
            </div>
          </div>
        )}

        {stage === "done" && (
          <>
            <div
              className={`mt-5 rounded-[22px] p-5 ${completedScans.length ? "scan-success-card bg-[#e7f7df]" : "bg-[#fde7e7]"}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-11 w-11 place-items-center rounded-full text-white ${completedScans.length ? "scan-success-check bg-[#2e7450]" : "bg-[#a74132]"}`}
                >
                  <Icon name={completedScans.length ? "check" : "error"} />
                </span>
                <span className="flex-1">
                  <b className="block text-[17px]">
                    {completedScans.length > 1
                      ? `${completedScans.length} receipts saved`
                      : completedScans[0]?.result
                        ? `${completedScans[0].result.merchant || "Receipt"} · ${scanMoney(completedScans[0].result.total, completedScans[0].result.currency)}`
                        : needsSignIn
                          ? "Nothing was uploaded"
                          : "Nothing was added"}
                  </b>
                  <span className="text-[11px] text-[#4b6d55]">
                    {completedScans.length
                      ? `${completedScans.length} ready to review`
                      : "Nothing was added. Check the messages below."}
                  </span>
                </span>
              </div>
              {budgetAlert && (
                <div className="scan-budget-row mt-4 flex justify-between rounded-[13px] bg-white/55 px-3 py-3 text-[12px]">
                  <span>
                    {budgetAlert.level === "total"
                      ? budgetAlert.label
                      : `${budgetAlert.label} budget`}
                  </span>
                  <b>
                    {budgetAlert.over_budget
                      ? `${scanMoney(-budgetAlert.remaining, completedScans[0]?.result?.currency ?? "USD")} over`
                      : `${scanMoney(budgetAlert.remaining, completedScans[0]?.result?.currency ?? "USD")} left`}
                  </b>
                </div>
              )}
            </div>
            <div className="scan-success-copy mt-3 flex items-center gap-3 px-2">
              <Cat mood={completedScans.length ? "done" : "hmm"} size={48} />
              <p className="text-left text-[11px] leading-relaxed text-[#77776f]">
                <b className="block text-[13px] text-[#22231f]">
                  {completedScans.length
                    ? "I’ve got this receipt."
                    : needsSignIn
                      ? "Your receipts are still on this device."
                      : "I couldn’t add these yet."}
                </b>
                {completedScans.length
                  ? "Review the items now, or come back from Activity later."
                  : needsSignIn
                    ? "Sign in, then choose the receipts again to upload them."
                    : "Check each message below and try again when you’re ready."}
              </p>
            </div>
            {matchedTap && (
              <div className="scan-match-card mt-3 flex items-center gap-3 rounded-[17px] bg-[#dff0ff] p-4">
                <Icon name="link" size={21} />
                <span className="flex-1">
                  <b className="block text-[12px]">Matched your Apple Pay tap</b>
                  <span className="text-[10px] text-[#45667b]">
                    The items were added to that purchase instead of a second one
                  </span>
                </span>
              </div>
            )}
            {duplicateScans.length > 0 && (
              <div className="mt-3 space-y-2">
                {duplicateScans.map((item) => (
                  <div
                    key={item.id}
                    className="scan-duplicate-row flex items-center gap-3 rounded-[15px] bg-[#fff0d9] p-3 text-left text-[11px] text-[#725024]"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{item.name}</b>
                      <span>Already on your tab</span>
                    </span>
                    {item.receiptId && (
                      <button
                        onClick={() => openReceipt(item.receiptId as string)}
                        className="min-h-9 rounded-full bg-white/70 px-3 font-bold"
                      >
                        Open it
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {failedScans.length > 0 && (
              <div className="mt-3 space-y-2">
                {failedScans.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[15px] bg-[#fde7e7] p-3 text-left text-[11px]"
                  >
                    <b className="block">{item.title || item.name}</b>
                    <span>{scanStatus(item)}</span>
                    {item.status === "error" && !needsSignIn && (
                      <button onClick={() => retry(item.id)} className="ml-2 font-bold underline">
                        Try again
                      </button>
                    )}
                    {item.status === "refused" && (
                      <button
                        onClick={() => {
                          remove(item.id);
                          scanPickers.open("camera");
                        }}
                        className="ml-2 font-bold underline"
                      >
                        Take another photo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {needsSignIn && (
              <button
                onClick={() => window.location.assign("/login")}
                className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
              >
                Sign in to scan
              </button>
            )}
            <button
              onClick={() => {
                const result = completedScans.find((item) => item.result)?.result;
                if (result) review(receiptFromApi(result));
                else close();
              }}
              className={`${needsSignIn ? "mt-2 bg-black/[0.05] text-[#22231f]" : "mt-5 bg-[#103e33] text-white"} min-h-12 w-full rounded-full text-[13px] font-bold`}
            >
              {completedScans.some((item) => item.result) ? "Review receipt" : "Back to Activity"}
            </button>
            <button onClick={reset} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Scan another
            </button>
          </>
        )}

        {stage === "manual" && (
          <div className="mt-5">
            <label className="block text-[12px] font-semibold text-[#77776f]" htmlFor="manual-name">
              What was it for?
            </label>
            <input
              id="manual-name"
              value={manualName}
              onChange={(event) => {
                const value = event.target.value;
                setManualName(value);
                if (/uber|taxi|train|parking/i.test(value)) setManualCategory("Transport");
                else if (/market|grocery|food/i.test(value)) setManualCategory("Groceries");
                else if (/dinner|lunch|coffee|restaurant/i.test(value)) setManualCategory("Dining");
              }}
              placeholder="Dinner at Nopa"
              autoFocus
              className="manual-field mt-2 h-12 w-full rounded-[15px] bg-black/[0.045] px-4 text-[14px] outline-none focus:ring-2 focus:ring-[#39a68e]"
            />

            <div className="mt-5 flex items-end justify-between">
              <label className="text-[12px] font-semibold text-[#77776f]" htmlFor="manual-amount">
                Total amount
              </label>
              {showItems && manualItemsTotal > 0 && (
                <span className="text-[10px] font-semibold text-[#34704c]">
                  Calculated from items
                </span>
              )}
            </div>
            <label className="manual-field mt-2 flex h-[72px] items-center rounded-[18px] bg-black/[0.045] px-4 focus-within:ring-2 focus-within:ring-[#39a68e]">
              <span className="text-[28px] font-semibold text-[#77776f]">$</span>
              <input
                id="manual-amount"
                type="text"
                inputMode="numeric"
                disabled={showItems && manualItemsTotal > 0}
                value={
                  showItems && manualItemsTotal > 0
                    ? manualItemsTotal.toFixed(2)
                    : ((Number(manualAmount) || 0) / 100).toFixed(2)
                }
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "");
                  setManualAmount(digits && Number(digits) ? String(Number(digits)) : "");
                }}
                aria-describedby="amount-entry-hint"
                className="h-full min-w-0 flex-1 bg-transparent px-2 text-[34px] font-semibold tracking-[-.04em] outline-none disabled:opacity-100"
              />
            </label>
            <p id="amount-entry-hint" className="mt-2 text-[10px] text-[#77776f]">
              Type digits continuously: 558 becomes $5.58.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setManualPicker(manualPicker === "date" ? null : "date")}
                className={`manual-field rounded-[16px] bg-black/[0.035] px-3 py-2 text-left ${manualPicker === "date" ? "ring-2 ring-[#39a68e]" : ""}`}
              >
                <span className="block text-[10px] font-semibold text-[#77776f]">Date</span>
                <span className="mt-1 flex items-center justify-between text-[12px] font-semibold">
                  <span>{manualDate}</span>
                  <Icon name="calendar_today" size={15} />
                </span>
              </button>
              <button
                onClick={() => setManualPicker(manualPicker === "category" ? null : "category")}
                className={`manual-field rounded-[16px] bg-black/[0.035] px-3 py-2 text-left ${manualPicker === "category" ? "ring-2 ring-[#39a68e]" : ""}`}
              >
                <span className="block text-[10px] font-semibold text-[#77776f]">Category</span>
                <span className="mt-1 flex items-center justify-between text-[12px] font-semibold">
                  <span>{manualCategory}</span>
                  <Icon name="expand_more" size={16} />
                </span>
              </button>
            </div>
            {manualPicker === "date" && (
              <div className="manual-picker mt-3 rounded-[18px] bg-black/[0.035] p-3">
                <div className="grid grid-cols-3 gap-2">
                  {["Today · Oct 25", "Yesterday · Oct 24", "Oct 23"].map((date) => (
                    <button
                      key={date}
                      onClick={() => {
                        setManualDate(date);
                        setManualPicker(null);
                      }}
                      className={`rounded-[13px] px-2 py-3 text-[10px] font-bold ${manualDate === date ? "bg-[#103e33] text-white" : "bg-black/[0.045]"}`}
                    >
                      {date.replace(" · ", "\n")}
                    </button>
                  ))}
                </div>
                <button className="mt-2 min-h-10 w-full text-[11px] font-bold text-[#103e33]">
                  Choose another date
                </button>
              </div>
            )}
            {manualPicker === "category" && (
              <div className="manual-picker mt-3 grid grid-cols-2 gap-2 rounded-[18px] bg-black/[0.035] p-3">
                {[
                  ["Dining", "restaurant"],
                  ["Groceries", "shopping_basket"],
                  ["Transport", "directions_car"],
                  ["Shopping", "shopping_bag"],
                  ["Bills", "receipt_long"],
                  ["Other", "more_horiz"],
                ].map(([category, icon]) => (
                  <button
                    key={category}
                    onClick={() => {
                      setManualCategory(category);
                      setManualPicker(null);
                    }}
                    className={`flex min-h-12 items-center gap-2 rounded-[13px] px-3 text-[11px] font-bold ${manualCategory === category ? "bg-[#103e33] text-white" : "bg-black/[0.045]"}`}
                  >
                    <Icon name={icon} size={17} />
                    {category}
                  </button>
                ))}
              </div>
            )}
            {manualName && (
              <p className="mt-2 text-[10px] text-[#77776f]">
                Tabby suggested {manualCategory} from what you typed. You can change it.
              </p>
            )}

            {!showItems ? (
              <button
                onClick={() => setShowItems(true)}
                className="mt-4 flex min-h-11 items-center gap-2 text-[12px] font-bold text-[#103e33]"
              >
                <Icon name="add" size={18} /> Add item details
              </button>
            ) : (
              <div className="mt-5 rounded-[18px] bg-black/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <b className="text-[12px]">Item details</b>
                  <button
                    onClick={() => setShowItems(false)}
                    className="min-h-9 text-[10px] font-semibold text-[#77776f]"
                  >
                    Use one total
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {manualItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_86px] gap-2">
                      <input
                        aria-label={`Item ${index + 1} name`}
                        value={item.name}
                        onChange={(event) =>
                          setManualItems((current) =>
                            current.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                        placeholder={index === 0 ? "Entrée" : "Drink"}
                        className="h-11 rounded-[12px] bg-white/55 px-3 text-[12px] outline-none"
                      />
                      <input
                        aria-label={`Item ${index + 1} price`}
                        type="number"
                        inputMode="decimal"
                        value={item.price}
                        onChange={(event) =>
                          setManualItems((current) =>
                            current.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, price: event.target.value } : entry
                            )
                          )
                        }
                        placeholder="0.00"
                        className="h-11 rounded-[12px] bg-white/55 px-3 text-right text-[12px] outline-none"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setManualItems((current) => [...current, { name: "", price: "" }])}
                  className="mt-2 min-h-9 text-[11px] font-bold text-[#103e33]"
                >
                  + Another item
                </button>
              </div>
            )}

            <div className="manual-budget-preview mt-5 flex items-center gap-3 rounded-[16px] bg-[#e7f7df] p-3">
              <Icon name="account_balance_wallet" size={20} />
              <span className="flex-1 text-[11px]">
                <b className="block">{manualCategory} budget</b>
                {manualTotal > 0
                  ? `$${Math.max(0, 200 - manualTotal).toFixed(2)} will remain this month`
                  : "$200.00 available this month"}
              </span>
            </div>
            <button
              disabled={!manualValid}
              onClick={() => setStage("manualDone")}
              className="manual-submit mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white disabled:opacity-35"
            >
              Add ${manualTotal > 0 ? manualTotal.toFixed(2) : "0.00"} expense
            </button>
            <button
              onClick={() => setStage("start")}
              className="mt-2 min-h-11 w-full text-[12px] font-semibold text-[#77776f]"
            >
              Back to scan options
            </button>
          </div>
        )}

        {stage === "manualDone" && (
          <div className="mt-5">
            <div className="scan-success-card rounded-[22px] bg-[#e7f7df] p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#2e7450] text-white">
                  <Icon name="check" />
                </span>
                <span className="flex-1">
                  <b className="block text-[17px]">{manualName}</b>
                  <span className="text-[11px] text-[#4b6d55]">
                    ${manualTotal.toFixed(2)} · {manualCategory} · Added by hand
                  </span>
                </span>
              </div>
              <div className="mt-4 flex justify-between rounded-[13px] bg-white/55 px-3 py-3 text-[12px]">
                <span>{manualCategory} budget</span>
                <b>${Math.max(0, 200 - manualTotal).toFixed(2)} left</b>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-[17px] bg-[#dff0ff] p-4">
              <Icon name="receipt_long" size={21} />
              <span className="flex-1">
                <b className="block text-[12px]">Saved without a receipt image</b>
                <span className="text-[10px] text-[#45667b]">
                  You can edit, delete or split it from Activity.
                </span>
              </span>
            </div>
            <button
              onClick={() => setStage("manualSplit")}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
            >
              Split this expense
            </button>
            <button className="mt-2 min-h-11 w-full rounded-full bg-black/[0.045] text-[12px] font-bold">
              Done — keep only in Activity
            </button>
            <button onClick={reset} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Add another expense
            </button>
          </div>
        )}

        {stage === "manualSplit" && (
          <div className="mt-5">
            <div className="flex items-center justify-between rounded-[17px] bg-black/[0.035] p-4">
              <span>
                <b className="block text-[14px]">{manualName}</b>
                <span className="text-[10px] text-[#77776f]">{manualCategory} · Added by hand</span>
              </span>
              <b className="text-[20px] tracking-[-.03em]">${manualTotal.toFixed(2)}</b>
            </div>

            <p className="mt-5 text-[11px] font-bold text-[#77776f]">Add to a Tab</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {["Roommates", "Weekend trip"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setManualSplitTab(tab)}
                  className={`min-h-12 rounded-[15px] px-3 text-left text-[12px] font-bold ${manualSplitTab === tab ? "bg-[#103e33] text-white" : "bg-black/[0.04]"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button className="mt-2 min-h-10 text-[11px] font-bold text-[#103e33]">
              + Create a new Tab
            </button>

            <div className="mt-4 flex items-end justify-between">
              <p className="text-[11px] font-bold text-[#77776f]">People included</p>
              <button className="min-h-9 text-[11px] font-bold text-[#103e33]">Add person</button>
            </div>
            <div className="mt-1 flex items-center gap-4 rounded-[17px] bg-black/[0.035] px-4 py-3">
              {[
                ["You", "cool"],
                ["Maya", "remember"],
                ["Ben", "hi"],
              ].map(([name, mood]) => (
                <div key={name} className="text-center">
                  <Cat mood={mood} size={39} />
                  <span className="mt-1 block text-[10px] font-semibold">{name}</span>
                </div>
              ))}
              <span className="ml-auto text-[10px] text-[#77776f]">3 people</span>
            </div>

            <p className="mt-5 text-[11px] font-bold text-[#77776f]">Split method</p>
            <div className="mt-2 flex gap-1 overflow-x-auto rounded-[14px] bg-black/[0.045] p-1">
              {["Evenly", "Items", "Amounts", "Percent", "Shares"].map((method) => (
                <button
                  key={method}
                  onClick={() => setManualSplitType(method)}
                  className={`min-h-10 shrink-0 rounded-[11px] px-3 text-[10px] font-bold ${manualSplitType === method ? "bg-white text-[#103e33] shadow-sm" : "text-[#77776f]"}`}
                >
                  {method}
                </button>
              ))}
            </div>

            {manualSplitType === "Items" && showItems && manualItemsTotal > 0 ? (
              <div className="mt-3 space-y-2 rounded-[17px] bg-black/[0.03] p-3">
                {manualItems
                  .filter((item) => item.name && item.price)
                  .map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center gap-3 rounded-[12px] bg-white/55 p-3"
                    >
                      <span className="flex-1">
                        <b className="block text-[11px]">{item.name}</b>
                        <span className="text-[10px] text-[#77776f]">
                          Assigned to {index % 2 ? "Maya" : "You"}
                        </span>
                      </span>
                      <b className="text-[11px]">${Number(item.price).toFixed(2)}</b>
                      <Icon name="chevron_right" size={16} />
                    </div>
                  ))}
              </div>
            ) : manualSplitType === "Items" ? (
              <div className="mt-3 rounded-[15px] bg-[#fff0d9] p-3 text-[11px] text-[#725024]">
                This expense has no item details. Add items first, or choose another split method.
              </div>
            ) : (
              <div className="mt-3 rounded-[17px] bg-[#e7f7df] p-4">
                <div className="flex justify-between text-[12px]">
                  <span>
                    {manualSplitType === "Evenly"
                      ? "Each person pays"
                      : `${manualSplitType} split preview`}
                  </span>
                  <b>
                    {manualSplitType === "Evenly"
                      ? `$${(manualTotal / 3).toFixed(2)}`
                      : `$${manualTotal.toFixed(2)} total`}
                  </b>
                </div>
                <p className="mt-1 text-[10px] text-[#4b6d55]">
                  The final cent goes to the payer so the total always reconciles.
                </p>
              </div>
            )}

            <label className="mt-4 flex min-h-14 items-center gap-3 rounded-[16px] bg-black/[0.035] px-4">
              <Icon name="payments" size={20} />
              <span className="flex-1">
                <b className="block text-[12px]">Paid by</b>
                <span className="text-[10px] text-[#77776f]">
                  Who covered the original expense?
                </span>
              </span>
              <select
                aria-label="Paid by"
                className="bg-transparent text-[12px] font-bold outline-none"
              >
                <option>You</option>
                <option>Maya</option>
                <option>Ben</option>
              </select>
            </label>

            <button
              disabled={manualSplitType === "Items" && !(showItems && manualItemsTotal > 0)}
              onClick={() => setStage("manualSplitDone")}
              className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white disabled:opacity-35"
            >
              Confirm split in {manualSplitTab}
            </button>
            <button
              onClick={() => setStage("manualDone")}
              className="mt-2 min-h-11 w-full text-[12px] font-semibold text-[#77776f]"
            >
              Back
            </button>
          </div>
        )}

        {stage === "manualSplitDone" && (
          <div className="mt-5">
            <div className="rounded-[22px] bg-[#e7f7df] p-5 text-center">
              <Cat mood="love" size={82} />
              <h3 className="mt-2 text-[20px] font-semibold tracking-[-.035em]">
                Added to {manualSplitTab}
              </h3>
              <p className="mt-1 text-[11px] text-[#4b6d55]">
                {manualName} · ${manualTotal.toFixed(2)} · {manualSplitType}
              </p>
            </div>
            <div className="mt-3 rounded-[17px] bg-black/[0.035] px-4">
              {[
                ["You", manualTotal / 3, "Paid"],
                ["Maya", manualTotal / 3, "Owes you"],
                ["Ben", manualTotal - (manualTotal / 3) * 2, "Owes you"],
              ].map(([name, amount, status]) => (
                <div
                  key={String(name)}
                  className="flex items-center justify-between border-b border-black/[0.06] py-3 last:border-0"
                >
                  <span>
                    <b className="block text-[12px]">{name}</b>
                    <span className="text-[9px] text-[#77776f]">{status}</span>
                  </span>
                  <b className="text-[12px]">${Number(amount).toFixed(2)}</b>
                </div>
              ))}
            </div>
            <button className="mt-5 min-h-12 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white">
              Open {manualSplitTab}
            </button>
            <button onClick={close} className="mt-2 min-h-11 w-full text-[12px] font-semibold">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type Panel = "insights" | "budgets" | "profile" | "notifications";
const TABS: Tab[] = ["today", "activity", "circles", "tabby"];
const PANELS: Panel[] = ["insights", "budgets", "profile", "notifications"];

/** The signed-in app. Where you are lives in the address (/app?tab=activity,
 *  &panel=insights, &receipt=<id>), so Back works and links can open a screen. */
export default function NewApp() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get("tab")) ?? "today";
  const panel: Panel | null = PANELS.find((p) => p === params.get("panel")) ?? null;
  const receiptId = params.get("receipt");
  // The receipt being shown: from the list that opened it, or loaded from a link.
  const [opened, setOpened] = useState<Receipt | null>(null);
  const [scan, setScan] = useState(false);
  const go = useCallback(
    (to: { tab?: Tab; panel?: Panel | null; receipt?: string | null }) => {
      const q = new URLSearchParams();
      if (to.tab && to.tab !== "today") q.set("tab", to.tab);
      if (to.panel) q.set("panel", to.panel);
      if (to.receipt) q.set("receipt", to.receipt);
      router.push(q.toString() ? `${routes.home}?${q}` : routes.home, { scroll: false });
    },
    [router]
  );
  const setTab = (next: Tab) => go({ tab: next });
  const setPanel = (next: Panel | null) => go({ tab, panel: next });
  const setReceipt = (next: Receipt | null) => {
    setOpened(next);
    go({ tab, panel, receipt: next?.id ?? null });
  };
  useEffect(() => {
    if (!receiptId || opened?.id === receiptId) return;
    let live = true;
    getReceipt(receiptId)
      .then((r) => live && setOpened(receiptFromApi(r as UploadResult)))
      .catch(() => live && go({ tab, panel }));
    return () => {
      live = false;
    };
  }, [receiptId, opened?.id, go, tab, panel]);
  // Receipts without an id (not saved yet) open in place, without a link.
  const receipt = receiptId
    ? opened?.id === receiptId
      ? opened
      : null
    : opened?.id
      ? null
      : opened;
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("cotab-demo-theme");
    setDark(
      savedTheme ? savedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, panel, receipt]);
  const toggleTheme = () =>
    setDark((current) => {
      const next = !current;
      window.localStorage.setItem("cotab-demo-theme", next ? "dark" : "light");
      return next;
    });
  return (
    <div className="ios-stage min-h-screen sm:py-6" data-theme={dark ? "dark" : "light"}>
      <style jsx global>{`
        :root {
          --ios-label: rgb(29 29 31);
          --ios-secondary: rgb(60 60 67 / 0.62);
          --ios-glass: rgb(255 255 255 / 0.56);
          --ios-glass-thick: rgb(255 255 255 / 0.72);
          --ios-spring: linear(
            0,
            0.007,
            0.029 2.2%,
            0.118 4.7%,
            0.625 14.4%,
            0.843 19%,
            0.968 24.2%,
            1.011 29.9%,
            1.024 36.8%,
            1.012 52.7%,
            1.002 68.3%,
            1
          );
        }
        .ios-stage {
          background: #d9dde1;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
            "Helvetica Neue", system-ui, sans-serif;
          font-optical-sizing: auto;
        }
        .ios-stage[data-theme="dark"] {
          background: #161917;
        }
        .ios-shell {
          background: #eef1ee;
          isolation: isolate;
        }
        .tabby-v3-avatar {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.78),
            0 0 0 1px rgb(52 74 59 / 0.16),
            0 8px 16px -9px rgb(52 74 59 / 0.58);
        }
        .tabby-v3-avatar img {
          transform: scale(1.2);
          filter: saturate(0.94) contrast(1.02) drop-shadow(0 5px 4px rgb(47 66 52 / 0.22));
        }
        .tabby-v3-stage::before {
          content: "";
          position: absolute;
          pointer-events: none;
          border-radius: 999px;
          background: rgb(185 205 178 / 0.44);
          filter: blur(18px);
          opacity: 0.94;
          transform: translateZ(0);
        }
        .tabby-v3-stage-card::before {
          inset: -28% -36% -24% -72%;
        }
        .tabby-v3-stage-hero::before {
          inset: -18% -42% -22% -76%;
        }
        .tabby-v3-stage-profile::before {
          inset: -22% -38% -24% -72%;
        }
        .tabby-v3-figure {
          transform: scale(1.045);
          transform-origin: 50% 100%;
          filter: saturate(0.96) drop-shadow(0 16px 10px rgb(47 66 52 / 0.3));
        }
        .tabby-v3-scene {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.72),
            0 13px 24px -17px rgb(52 74 59 / 0.68);
        }
        .tabby-profile-preview {
          background: #dce7d6;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.72),
            0 18px 30px -20px rgb(52 74 59 / 0.7);
        }
        .tabby-profile-portrait img {
          transform: scale(1.55) translateY(12%);
        }
        .tabby-profile-full-body img {
          transform: scale(0.94);
        }
        .tabby-profile-soft-frame {
          background: #e5ede1;
          box-shadow: none;
        }
        .tabby-profile-soft-frame img {
          transform: scale(0.96);
          filter: drop-shadow(0 15px 10px rgb(47 66 52 / 0.28));
        }
        button .tabby-v3-avatar {
          transition:
            transform 220ms var(--ios-spring),
            box-shadow 220ms ease-out;
        }
        button:active .tabby-v3-avatar {
          transform: scale(0.94);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.42),
            0 0 0 1px rgb(52 74 59 / 0.18);
        }
        .ios-aurora {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: #eef1ee;
        }
        .ios-surface {
          background: #fffefa;
          box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.055);
        }
        .ios-glass-nav {
          background: rgb(247 249 247 / 0.64);
          -webkit-backdrop-filter: blur(28px) saturate(190%);
          backdrop-filter: blur(28px) saturate(190%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.92),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.48),
            0 0 0 0.5px rgb(0 0 0 / 0.08),
            0 14px 38px rgb(28 39 34 / 0.2);
        }
        .ios-round-control {
          background: #fffefa;
          box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.07);
        }
        .ios-theme-glyph {
          background: #dce7d6;
          color: #31563d;
        }
        .ios-shell [class*="bg-[#edf9b7]"] {
          background: #e1eadc;
        }
        .ios-shell [class*="bg-[#dff0ff]"] {
          background: #dbe6de;
        }
        .ios-shell[data-theme="dark"] {
          --ios-label: #f5f5f7;
          --ios-secondary: rgb(235 235 245 / 0.62);
          --ios-glass: rgb(37 42 40 / 0.58);
          --ios-glass-thick: rgb(31 36 34 / 0.72);
          background: #060807;
          color: #f5f5f7;
          color-scheme: dark;
        }
        .ios-shell[data-theme="dark"] .ios-aurora {
          background: #060807;
        }
        .ios-shell[data-theme="dark"] .tabby-v3-avatar {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.2),
            0 0 0 1px rgb(198 218 192 / 0.16),
            0 10px 22px -10px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-v3-stage::before {
          background: rgb(76 103 82 / 0.32);
          filter: blur(22px);
          opacity: 0.82;
        }
        .ios-shell[data-theme="dark"] .tabby-v3-figure {
          filter: brightness(0.96) saturate(0.9) drop-shadow(0 17px 11px rgb(0 0 0 / 0.62));
        }
        .ios-shell[data-theme="dark"] .tabby-v3-scene {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.15),
            0 14px 28px -16px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-profile-preview {
          background: #33463a;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.14),
            0 18px 34px -18px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .tabby-profile-soft-frame {
          background: #26372c;
          box-shadow: none;
        }
        .ios-shell[data-theme="dark"] .home-insight-copy h2 {
          color: #f5f5f7;
        }
        .ios-shell[data-theme="dark"] .home-insight-copy p:last-of-type {
          color: rgb(245 245 247 / 0.72);
        }
        .ios-shell[data-theme="dark"] .ios-surface {
          /* The light surface was kept in dark mode: light text on cream. */
          background: rgb(30 34 32 / 0.92);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.16),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 0 0 0.5px rgb(0 0 0 / 0.55),
            0 18px 42px rgb(0 0 0 / 0.3);
        }
        .ios-shell[data-theme="dark"] .ios-glass-nav {
          background: rgb(27 31 29 / 0.72);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.17),
            inset 0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 0 0 0.5px rgb(0 0 0 / 0.58),
            0 18px 45px rgb(0 0 0 / 0.48);
        }
        .ios-shell[data-theme="dark"] .ios-round-control {
          background: rgb(42 48 45 / 0.64);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.18),
            0 0 0 0.5px rgb(255 255 255 / 0.08),
            0 10px 24px rgb(0 0 0 / 0.28);
        }
        .ios-shell[data-theme="dark"] .ios-theme-glyph {
          background: rgb(128 157 119 / 0.2);
          color: #bed0b8;
        }
        .ios-shell[data-theme="dark"] [class*="text-[#77776f]"],
        .ios-shell[data-theme="dark"] [class*="text-[#9c9c95]"],
        .ios-shell[data-theme="dark"] [class*="text-[#62625d]"],
        .ios-shell[data-theme="dark"] [class*="text-[#526346]"],
        .ios-shell[data-theme="dark"] [class*="text-[#45667b]"],
        .ios-shell[data-theme="dark"] [class*="text-[#715f59]"] {
          color: rgb(235 235 245 / 0.62);
        }
        .ios-shell[data-theme="dark"] [class*="text-[#103e33]"],
        .ios-shell[data-theme="dark"] [class*="text-[#50713a]"] {
          color: #b8cdb2;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#103e33]"] {
          background: #a8c3a0;
          color: #102016;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#fffefa]"] {
          background: rgb(50 54 52 / 0.78);
          color: #f5f5f7;
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#f7e9e3]"] {
          background: rgb(133 58 43 / 0.34);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#edf9b7]"] {
          background: rgb(83 107 76 / 0.42);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#dff0ff]"] {
          background: rgb(57 81 65 / 0.48);
        }
        .ios-shell[data-theme="dark"] [class*="bg-black/[0.07]"] {
          background: rgb(255 255 255 / 0.11);
        }
        .ios-shell[data-theme="dark"] [class*="bg-black/[0.05]"] {
          background: rgb(255 255 255 / 0.1);
        }
        .ios-shell[data-theme="dark"] [class*="bg-[#e6f3e5]"] {
          background: rgb(70 120 76 / 0.3);
        }
        .ios-shell[data-theme="dark"] [class*="text-[#286036]"] {
          color: #a9d7a3;
        }
        .ios-shell[data-theme="dark"] [class*="text-[#a74132]"] {
          color: #ff9f8f;
        }
        .ios-shell[data-theme="dark"] [class*="border-black"] {
          border-color: rgb(255 255 255 / 0.12);
        }
        .ios-shell[data-theme="dark"] .demo-ticket:after {
          background: rgb(31 36 34 / 0.72);
        }
        .ios-shell[data-theme="dark"] .demo-soft-gloss {
          background: rgb(34 40 37 / 0.67);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.15),
            inset -1px -1px 0 rgb(215 244 91 / 0.06),
            0 20px 38px -20px rgb(0 0 0 / 0.65);
        }
        .ios-shell[data-theme="dark"] .demo-nav-gloss {
          background: rgb(27 31 29 / 0.78);
        }
        .ios-shell[data-theme="dark"] .tabs-hero {
          background: #24392d;
          color: #f3f6f1;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.22),
            inset 0 0 0 0.5px rgb(184 205 178 / 0.16),
            0 20px 38px -20px rgb(0 15 7 / 0.82);
        }
        .ios-shell[data-theme="dark"] .tabs-hero .ring-\[\#103e33\] {
          --tw-ring-color: #24392d;
        }
        .ios-shell[data-theme="dark"] .tabs-action {
          background: #789570;
          color: #f4f7f2;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.24);
        }
        .ios-shell[data-theme="dark"] .tabs-remind {
          background: rgb(126 155 117 / 0.18);
          color: #bed0b8;
          box-shadow: inset 0 0 0 0.5px rgb(176 202 169 / 0.16);
        }
        .ios-shell[data-theme="dark"][data-active-tab="circles"]
          .ios-glass-nav
          button[class*="text-[#103e33]"] {
          color: #b9ceb2;
        }
        .ios-shell[data-theme="dark"] .receipt-detail {
          background: transparent;
        }
        button {
          -webkit-tap-highlight-color: transparent;
          transition:
            transform 420ms var(--ios-spring),
            filter 180ms ease-out;
        }
        button:active {
          transform: scale(0.97);
          filter: brightness(0.97);
          transition-duration: 90ms;
        }
        main {
          animation: ios-materialize 360ms var(--ios-spring) both;
        }
        @keyframes ios-materialize {
          from {
            opacity: 0;
            transform: scale(0.985) translateY(8px);
          }
        }
        .demo-ticket:after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: -7px;
          height: 14px;
          background: rgb(255 255 255 / 0.72);
          clip-path: polygon(
            0 0,
            5% 100%,
            10% 0,
            15% 100%,
            20% 0,
            25% 100%,
            30% 0,
            35% 100%,
            40% 0,
            45% 100%,
            50% 0,
            55% 100%,
            60% 0,
            65% 100%,
            70% 0,
            75% 100%,
            80% 0,
            85% 100%,
            90% 0,
            95% 100%,
            100% 0
          );
        }
        .demo-sand {
          background: #f2e7d5;
          color: #79552b;
        }
        .demo-coral {
          background: #f8ddd5;
          color: #a74132;
        }
        .demo-lime {
          background: #edf9b7;
          color: #50713a;
        }
        .demo-sky {
          background: #dff0ff;
          color: #365f78;
        }
        .demo-gloss {
          background: #103e33;
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.48),
            inset 1px 0 0 rgb(255 255 255 / 0.12),
            inset 0 -1px 0 rgb(0 0 0 / 0.24),
            0 18px 32px -22px rgb(15 62 51 / 0.62);
        }
        .demo-soft-gloss {
          background: rgb(255 255 255 / 0.64);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 1),
            inset -1px -1px 0 rgb(80 113 58 / 0.08),
            0 16px 30px -20px rgb(20 21 18 / 0.34);
        }
        .demo-nav-gloss {
          background: rgb(255 254 250 / 0.78);
          -webkit-backdrop-filter: saturate(180%) blur(22px);
          backdrop-filter: saturate(180%) blur(22px);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 1),
            0 -14px 30px -22px rgb(20 21 18 / 0.38);
        }
        .scan-motion {
          position: relative;
          width: 270px;
          height: 270px;
        }
        .scan-receipt {
          position: absolute;
          left: 50%;
          top: 14px;
          width: 154px;
          height: 224px;
          overflow: hidden;
          padding: 24px 18px;
          border-radius: 10px;
          background: #fff9ea;
          box-shadow: 0 18px 36px -22px rgb(20 21 18 / 0.45);
          transform: translateX(-50%) rotate(-1.5deg);
          animation: scan-receipt-float 2.2s ease-in-out infinite alternate;
        }
        .scan-beam {
          position: absolute;
          left: 8px;
          right: 8px;
          top: 16px;
          height: 2px;
          border-radius: 99px;
          background: #39a68e;
          box-shadow: 0 0 14px 3px rgb(57 166 142 / 0.38);
          animation: scan-beam-pass 1.15s ease-in-out infinite alternate;
          will-change: transform;
        }
        .scan-data-chip {
          position: absolute;
          display: flex;
          align-items: center;
          gap: 5px;
          min-height: 34px;
          padding: 0 10px;
          border-radius: 11px;
          background: rgb(255 255 255 / 0.9);
          box-shadow: 0 8px 20px -14px rgb(20 21 18 / 0.48);
          color: #285c4d;
          font-size: 10px;
          font-weight: 700;
          opacity: 0;
          transform: translateY(8px) scale(0.96);
          animation: scan-chip-in 0.45s var(--ios-spring) forwards;
        }
        .scan-data-chip-one {
          right: 0;
          top: 42px;
          animation-delay: 0.85s;
        }
        .scan-data-chip-two {
          left: 0;
          top: 114px;
          animation-delay: 1.8s;
        }
        .scan-data-chip-three {
          right: 2px;
          top: 182px;
          animation-delay: 2.8s;
        }
        .scan-orbit {
          position: absolute;
          bottom: 0;
          left: 50%;
          display: grid;
          width: 52px;
          height: 52px;
          place-items: center;
          border-radius: 50%;
          background: #d7f45b;
          transform: translateX(-50%);
          animation: scan-tabby-pulse 1.6s ease-in-out infinite alternate;
        }
        .scan-tabby-thought {
          position: absolute;
          left: 50%;
          bottom: -38px;
          width: 228px;
          padding: 10px 13px;
          border-radius: 15px;
          background: rgb(255 255 255 / 0.92);
          box-shadow: 0 10px 28px -18px rgb(20 21 18 / 0.55);
          color: #315a4d;
          font-size: 10px;
          font-weight: 650;
          transform: translateX(-50%);
          animation: scan-thought-in 0.42s var(--ios-spring) both;
        }
        .scan-tabby-thought::before {
          content: "";
          position: absolute;
          left: 50%;
          top: -6px;
          width: 12px;
          height: 12px;
          background: inherit;
          transform: translateX(-50%) rotate(45deg);
        }
        .scan-success-card {
          transform-origin: 50% 80%;
          animation: scan-success-card-in 0.55s var(--ios-spring) both;
        }
        .scan-success-check {
          animation: scan-success-check-in 0.58s 0.12s var(--ios-spring) both;
        }
        .ios-shell[data-theme="dark"] .scan-success-card {
          background: #20392d;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(170 205 175 / 0.12);
        }
        .ios-shell[data-theme="dark"] .scan-success-card [class*="text-[#4b6d55]"] {
          color: #b9cabb;
        }
        .ios-shell[data-theme="dark"] .scan-budget-row {
          background: rgb(255 255 255 / 0.08);
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-success-copy b {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-success-copy p {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .scan-match-card {
          background: #26382f;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-match-card [class*="text-[#45667b]"] {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .scan-data-chip {
          background: #2b3530;
          color: #d5e7dc;
          box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.08),
            0 9px 22px -14px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .scan-tabby-thought {
          background: #2b3530;
          color: #d5e7dc;
          box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.08),
            0 10px 24px -14px rgb(0 0 0 / 0.9);
        }
        .ios-shell[data-theme="dark"] .scan-quality-chip {
          background: #26382f;
          color: #c5ddca;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        .ios-shell[data-theme="dark"] .scan-file-card {
          background: #382f29;
          color: #f5f1ed;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.07);
        }
        .ios-shell[data-theme="dark"] .scan-file-card [class*="text-[#76604e]"] {
          color: #c8bcb2;
        }
        .ios-shell[data-theme="dark"] .scan-take-card [class*="text-white/65"] {
          color: #355241;
        }
        .ios-shell[data-theme="dark"] .scan-privacy-note b {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-privacy-note p {
          color: #aeb8b1;
        }
        .ios-shell[data-theme="dark"] .manual-field {
          background: #202723;
          color: #f5f7f4;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.055);
        }
        .ios-shell[data-theme="dark"] .manual-field input,
        .ios-shell[data-theme="dark"] .manual-field select {
          color: #f5f7f4;
          color-scheme: dark;
        }
        .ios-shell[data-theme="dark"] .manual-field input::placeholder {
          color: #8f9992;
          opacity: 1;
        }
        .ios-shell[data-theme="dark"] .manual-budget-preview {
          background: #20392d;
          color: #e6f1e8;
          box-shadow: inset 0 0 0 1px rgb(170 205 175 / 0.12);
        }
        .ios-shell[data-theme="dark"] .manual-submit:disabled {
          background: #425148;
          color: #b9c2bc;
          opacity: 1;
        }
        .ios-shell[data-theme="dark"] .scan-batch-row {
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-batch-review,
        .ios-shell[data-theme="dark"] .scan-batch-warning,
        .ios-shell[data-theme="dark"] .scan-duplicate-row {
          background: #3a3027;
          color: #ead7c0;
          box-shadow: inset 0 0 0 1px rgb(239 205 165 / 0.12);
        }
        /* A full sheet over the page: the see-through card surface let the
           screen behind show through the text. */
        .ios-shell[data-theme="dark"] .scan-sheet,
        .ios-shell[data-theme="dark"] .full-sheet {
          background: rgb(30 34 32);
        }
        .ios-shell[data-theme="dark"] .receipt-delete-confirm {
          background: #3a2522;
          color: #f3c3b8;
          box-shadow: inset 0 0 0 1px rgb(243 195 184 / 0.14);
        }
        .ios-shell[data-theme="dark"] .receipt-delete-confirm button:first-child {
          background: rgb(255 255 255 / 0.12);
          color: #f5f7f4;
        }
        .ios-shell[data-theme="dark"] .scan-duplicate-row button {
          background: rgb(255 255 255 / 0.12);
          color: #f5e6d3;
        }
        .ios-shell[data-theme="dark"] .scan-batch-review [class*="text-[#9a5a13]"] {
          color: #efba76;
        }
        .ios-shell[data-theme="dark"] .scan-batch-thumb {
          background: #f3eadb;
          color: #544536;
        }
        .ios-shell[data-theme="dark"] .manual-picker {
          background: #1d2420;
          box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
        }
        @keyframes scan-beam-pass {
          from {
            transform: translateY(0);
            opacity: 0.65;
          }
          to {
            transform: translateY(184px);
            opacity: 1;
          }
        }
        @keyframes scan-receipt-float {
          from {
            transform: translateX(-50%) translateY(0) rotate(-1.5deg);
          }
          to {
            transform: translateX(-50%) translateY(-3px) rotate(-0.5deg);
          }
        }
        @keyframes scan-chip-in {
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes scan-tabby-pulse {
          from {
            transform: translateX(-50%) scale(0.96);
          }
          to {
            transform: translateX(-50%) scale(1.04);
          }
        }
        @keyframes scan-thought-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
        @keyframes scan-success-card-in {
          from {
            opacity: 0;
            transform: translateY(18px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes scan-success-check-in {
          from {
            opacity: 0;
            transform: scale(0.45) rotate(-12deg);
          }
          to {
            opacity: 1;
            transform: scale(1) rotate(0);
          }
        }
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .ios-surface,
          .ios-glass-nav,
          .demo-soft-gloss {
            background: rgb(255 255 255 / 0.94);
          }
        }
        @media (prefers-reduced-transparency: reduce) {
          .ios-surface,
          .ios-glass-nav,
          .demo-soft-gloss {
            background: #fff;
            -webkit-backdrop-filter: none;
            backdrop-filter: none;
          }
        }
        @media (prefers-contrast: more) {
          .ios-surface,
          .ios-glass-nav {
            box-shadow: 0 0 0 1px #1d1d1f;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          main {
            animation: ios-crossfade 140ms ease-out both;
          }
          button {
            transition-duration: 0.01ms;
          }
          .scan-receipt,
          .scan-beam,
          .scan-data-chip,
          .scan-orbit,
          .scan-tabby-thought,
          .scan-success-card,
          .scan-success-check {
            animation: none;
          }
          .scan-data-chip {
            opacity: 1;
            transform: none;
          }
          @keyframes ios-crossfade {
            from {
              opacity: 0;
            }
          }
        }
      `}</style>
      <div
        className="ios-shell relative mx-auto min-h-screen max-w-[430px] overflow-hidden text-[#141512] sm:min-h-[880px] sm:rounded-[34px]"
        data-theme={dark ? "dark" : "light"}
        data-active-tab={tab}
      >
        <div className="ios-aurora" aria-hidden="true" />
        <div className="relative z-[1]">
          {receipt && (
            <ReceiptDetail item={receipt} close={() => setReceipt(null)} onChange={setOpened} />
          )}
          {!receipt && (
            <>
              {panel === "insights" && (
                <Insights back={() => setPanel(null)} goBudgets={() => setPanel("budgets")} />
              )}
              {panel === "budgets" && <Budgets back={() => setPanel("insights")} />}
              {panel === "notifications" && (
                <Notifications back={() => setPanel(null)} openReceipt={setReceipt} />
              )}
              {panel === "profile" && (
                <Profile back={() => setPanel(null)} dark={dark} toggleTheme={toggleTheme} />
              )}
              {!panel && tab === "today" && (
                <Today
                  goActivity={() => setTab("activity")}
                  goCircles={() => setTab("circles")}
                  goInsights={() => setPanel("insights")}
                  goBudgets={() => setPanel("budgets")}
                  goProfile={() => setPanel("profile")}
                  goNotifications={() => setPanel("notifications")}
                  dark={dark}
                  toggleTheme={toggleTheme}
                  openReceipt={setReceipt}
                />
              )}{" "}
              {!panel && tab === "activity" && <Activity openReceipt={setReceipt} />}{" "}
              {!panel && tab === "circles" && <Circles />} {!panel && tab === "tabby" && <Tabby />}
              {!panel && <BottomNav tab={tab} setTab={setTab} scan={() => setScan(true)} />}
              {scan && (
                <Scanner
                  close={() => setScan(false)}
                  openReceipt={(id) => {
                    setScan(false);
                    go({ tab, panel, receipt: id });
                  }}
                  review={(next) => {
                    setScan(false);
                    setReceipt(next);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
