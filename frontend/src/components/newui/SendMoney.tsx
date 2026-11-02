"use client";
/* eslint-disable @next/next/no-img-element -- signed receipt links and Tabby's stock art */

import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui";
import { shopName } from "@/lib/brands";
import { mutate } from "@/lib/cache";
import type { SplitSummary } from "@/lib/api";
import { invalidateSpending, invalidateSplits, keys, useSplitBill } from "@/lib/data";
import { dayLabel } from "@/lib/format";
import { tabbyArt } from "@/lib/tabby";

import {
  billsFor,
  byCurrency,
  friendsIn,
  moneyLines,
  peopleIn,
  rowCurrency,
  useMyTabs,
  type Bill,
  type Owed,
} from "./bills";
import { BackHeader, Person, scanMoney } from "./parts";
import { PaySheet, Remind } from "./Tabs";

const billId = ({ tab, split }: Bill) => `${tab.group_id}~${split.split_id}`;

/** The pay and remind sheets, and the line saying what they did. */
export function useSettling(onLoad: (s: SplitSummary) => void) {
  const [paying, pay] = useState<Owed | null>(null);
  const [reminding, remind] = useState<Owed | null>(null);
  const [note, setNote] = useState("");
  const update = (s: SplitSummary) => {
    mutate(keys.group(s.group_id), s);
    onLoad(s);
    invalidateSplits();
    invalidateSpending();
  };
  const sheets = (
    <>
      {paying && (
        <PaySheet
          owed={paying}
          close={() => pay(null)}
          update={(s, message) => {
            update(s);
            setNote(message);
          }}
        />
      )}
      {reminding && (
        <Remind owed={reminding} close={() => remind(null)} update={update} done={setNote} />
      )}
      {note && (
        <p
          role="status"
          className="mt-4 rounded-[14px] glass-tint-pos px-4 py-3 text-[12px] font-semibold text-glass-pos"
        >
          {note}
        </p>
      )}
    </>
  );
  return { pay, remind, sheets };
}

/** One bill as a card: what's open on it, the shop and the way in. */
function BillCard({ bill, open }: { bill: Bill; open: (id: string) => void }) {
  const { split, amount } = bill;
  return (
    <button onClick={() => open(billId(bill))} className="bill-card ios-surface">
      <span className="flex items-center justify-between gap-3">
        <b className="text-[17px] font-medium tracking-[-.02em]">
          {scanMoney(amount, split.currency)}
        </b>
        <span className="flex items-center gap-2 text-[13px] text-glass-ink2">
          View bill
          <span className="arrow-chip">
            <Icon name="arrow_forward" size={16} />
          </span>
        </span>
      </span>
      <span className="bill-foot">
        <b className="truncate">{shopName(split.merchant) || "Expense"}</b>
        <span className="shrink-0">
          {split.purchased_at ? dayLabel(split.purchased_at) : "No date"}
        </span>
      </span>
    </button>
  );
}

/** A payment on a dashed stub, its action, and the bills behind it. */
function OpenPayment({
  owed,
  action,
  open,
}: {
  owed: Owed;
  action: ReactNode;
  open: (id: string) => void;
}) {
  const { tab, row } = owed;
  const toMe = row.to_id === tab.me;
  const other = toMe ? row.from : row.to;
  const bills = billsFor(owed);
  const sum = bills.reduce((total, b) => total + b.amount, 0);
  return (
    <section className="pay-stub mt-4">
      <div className="flex items-center gap-3">
        <Person name={other} size={42} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[15px]">{other}</b>
          <span className="block truncate text-[12px] text-glass-soft">{tab.group_name}</span>
        </span>
        <b className="text-[17px] font-medium tabular-nums">
          {scanMoney(row.amount, rowCurrency(tab, row))}
        </b>
      </div>
      <div className="mt-3 flex gap-2">{action}</div>
      {Math.abs(sum - row.amount) >= 0.01 && bills.length > 0 && (
        <p className="mt-3 text-[12px] leading-snug text-glass-soft">
          Less than the bills below add up to, after payments and what goes the other way.
        </p>
      )}
      {bills.length > 0 && (
        <div className="mt-3 grid gap-2">
          {bills.map((bill) => (
            <BillCard key={bill.split.split_id} bill={bill} open={open} />
          ))}
        </div>
      )}
    </section>
  );
}

function Hero({ mood, kicker, line, note }: Record<"mood" | "kicker" | "line" | "note", string>) {
  return (
    <div className="relative mt-4">
      <img
        src={tabbyArt(mood)}
        alt=""
        className="hero-peek pointer-events-none absolute right-4 top-3 z-10 h-[76px] w-[76px] object-contain object-bottom"
      />
      <section className="demo-gloss rounded-[22px] p-5 text-white">
        <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">{kicker}</p>
        <h2 className="mt-3 max-w-[86%]">{line}</h2>
        <p className="mt-3 text-[13px] text-white/65">{note}</p>
      </section>
    </div>
  );
}

const pill = "min-h-10 flex-1 rounded-full px-4 text-[13px] font-semibold";

/** Send money: everything you owe, tab by tab, each with the bills behind it. */
export function SendMoney({
  back,
  bill,
  openBill,
  goTabs,
}: {
  back: () => void;
  bill: string | null;
  openBill: (id: string | null) => void;
  goTabs: () => void;
}) {
  const { list, youPay, loading, error, onLoad, loaders } = useMyTabs();
  const { pay, remind, sheets } = useSettling(onLoad);
  const people = peopleIn(youPay);
  const total = moneyLines(byCurrency(youPay)).join(" + ");
  if (bill)
    return (
      <>
        {loaders}
        <BillPage
          id={bill}
          list={list}
          rows={youPay}
          loading={loading}
          close={() => openBill(null)}
          pay={pay}
          remind={remind}
        />
        {sheets}
      </>
    );
  return (
    <main className="px-5 pb-12 pt-5">
      {loaders}
      <BackHeader title="Send money" back={back} />
      <Hero
        mood={youPay.length ? "need-money" : "cool"}
        kicker="You owe"
        line={
          error
            ? "Couldn't load your tabs."
            : loading
              ? "Adding it up…"
              : youPay.length
                ? `${total} to ${people.length === 1 ? people[0].name : `${people.length} people`}.`
                : "You don't owe anyone."
        }
        note={
          youPay.length
            ? `Across ${new Set(youPay.map((o) => o.tab.group_id)).size} ${new Set(youPay.map((o) => o.tab.group_id)).size === 1 ? "tab" : "tabs"}. Cotab never moves money; you pay in their app.`
            : "Anything a friend covers for you will show up here."
        }
      />
      {sheets}
      {youPay.map((owed) => (
        <OpenPayment
          key={`${owed.tab.group_id}-${owed.index}`}
          owed={owed}
          open={openBill}
          action={
            <button onClick={() => pay(owed)} className={`${pill} glass-cta`}>
              Pay {owed.row.to}
            </button>
          }
        />
      ))}
      {!loading && !youPay.length && (
        <button onClick={goTabs} className={`${pill} glass-cta mt-5 w-full`}>
          See your tabs
        </button>
      )}
    </main>
  );
}

/** Owed to you: everyone who owes you, then one person's bills. */
export function OwedToYou({
  back,
  person,
  bill,
  openPerson,
  openBill,
}: {
  back: () => void;
  person: string | null;
  bill: string | null;
  openPerson: (key: string | null) => void;
  openBill: (id: string | null) => void;
}) {
  const { list, youGet, youPay, loading, error, onLoad, loaders } = useMyTabs();
  const { pay, remind, sheets } = useSettling(onLoad);
  const people = peopleIn(youGet);
  const all = [...youGet, ...youPay];

  if (bill)
    return (
      <>
        {loaders}
        <BillPage
          id={bill}
          list={list}
          rows={all}
          loading={loading}
          close={() => openBill(null)}
          pay={pay}
          remind={remind}
        />
        {sheets}
      </>
    );

  if (person) {
    const rows = peopleIn(all).find((p) => p.key === person)?.rows ?? [];
    const name = friendsIn(list).find((f) => f.key === person)?.name ?? "";
    const owes = rows.filter((o) => o.row.to_id === o.tab.me);
    const owe = rows.filter((o) => o.row.from_id === o.tab.me);
    return (
      <main className="px-5 pb-12 pt-5">
        {loaders}
        <BackHeader
          title={name || "Friend"}
          back={() => openPerson(null)}
          backLabel="Owed to you"
        />
        <Hero
          mood={owes.length ? "payday" : owe.length ? "hmm" : "cool"}
          kicker={owes.length ? "Owes you" : owe.length ? "You owe" : "All even"}
          line={
            error
              ? "Couldn't load your tabs."
              : loading
                ? "Adding it up…"
                : owes.length
                  ? `${name} owes you ${moneyLines(byCurrency(owes)).join(" + ")}.`
                  : owe.length
                    ? `You owe ${name} ${moneyLines(byCurrency(owe)).join(" + ")}.`
                    : `Nothing open with ${name}.`
          }
          note={
            rows.length
              ? `On ${new Set(rows.map((o) => o.tab.group_id)).size === 1 ? rows[0].tab.group_name : `${new Set(rows.map((o) => o.tab.group_id)).size} tabs`}.`
              : "Every split you share is settled."
          }
        />
        {sheets}
        {rows.map((owed) => (
          <OpenPayment
            key={`${owed.tab.group_id}-${owed.index}`}
            owed={owed}
            open={openBill}
            action={
              owed.row.to_id === owed.tab.me ? (
                <>
                  <button onClick={() => remind(owed)} className={`${pill} glass-cta`}>
                    Remind {owed.row.from}
                  </button>
                  <button onClick={() => pay(owed)} className={`${pill} glass-surface`}>
                    {owed.row.from} paid me
                  </button>
                </>
              ) : (
                <button onClick={() => pay(owed)} className={`${pill} glass-cta`}>
                  Pay {owed.row.to}
                </button>
              )
            }
          />
        ))}
      </main>
    );
  }

  return (
    <main className="px-5 pb-12 pt-5">
      {loaders}
      <BackHeader title="Owed to you" back={back} backLabel="Tabs" />
      <Hero
        mood={youGet.length ? "payday" : "cool"}
        kicker="Owed to you"
        line={
          error
            ? "Couldn't load your tabs."
            : loading
              ? "Adding it up…"
              : youGet.length
                ? `${moneyLines(byCurrency(youGet)).join(" + ")} from ${people.length === 1 ? people[0].name : `${people.length} people`}.`
                : "Nobody owes you."
        }
        note={
          youGet.length
            ? "Tap someone to see what for."
            : error
              ? "Check your connection and try again."
              : "You're square with everyone."
        }
      />
      {people.length > 0 && (
        <section className="ios-surface mt-5 rounded-[22px] px-4">
          {people.map((p, i) => (
            <button
              key={p.key}
              onClick={() => openPerson(p.key)}
              className={`flex min-h-11 w-full items-center gap-2.5 py-1.5 text-left ${i ? "ios-divider" : ""}`}
            >
              <Person name={p.name} size={28} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[15px]">{p.name}</b>
                <span className="block text-[12px] text-glass-soft">
                  {p.rows.reduce((n, o) => n + billsFor(o).length, 0)} bills ·{" "}
                  {p.rows.map((o) => o.tab.group_name).join(", ")}
                </span>
              </span>
              <b className="tabular-nums">{moneyLines(byCurrency(p.rows)).join(" + ")}</b>
              <Icon name="chevron_right" size={18} className="text-glass-soft" />
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

/** One bill as a ticket over an ink band: who owes whom, the lines, the original. */
function BillPage({
  id,
  list,
  rows,
  loading,
  close,
  pay,
  remind,
}: {
  id: string;
  list: SplitSummary[];
  rows: Owed[];
  loading: boolean;
  close: () => void;
  pay: (o: Owed) => void;
  remind: (o: Owed) => void;
}) {
  const [groupId, splitId] = id.split("~");
  const tab = list.find((t) => t.group_id === groupId);
  const found = rows
    .filter((o) => o.tab.group_id === groupId)
    .flatMap((owed) => billsFor(owed).map((bill) => ({ owed, bill })))
    .find(({ bill }) => bill.split.split_id === splitId);
  const receipt = useSplitBill(groupId, splitId);
  const data = receipt.data;
  const split = found?.bill.split;
  const owed = found?.owed;
  const toMe = !!owed && owed.row.to_id === owed.tab.me;
  const currency = data?.currency ?? split?.currency ?? "USD";
  const mine = owed && split?.items?.[owed.row.from];

  return (
    <main className="relative isolate px-5 pb-12 pt-5">
      <div className="bill-band" aria-hidden="true" />
      <div className="bill-top">
        <button onClick={close} aria-label="Back">
          <Icon name="arrow_back" size={19} />
        </button>
        <h1>Bill</h1>
        <span className="w-[42px]" />
      </div>

      {!found && !loading ? (
        <section className="bill-ticket ios-surface mt-4 text-center">
          <b className="text-[15px]">This bill is settled.</b>
          <p className="mt-1 text-[13px] text-glass-soft">Nothing is open on it any more.</p>
        </section>
      ) : (
        <section className="bill-ticket ios-surface mt-4">
          <div className="bill-route">
            <span className="grid justify-items-center gap-1 text-[12px] font-medium">
              <Person name={owed?.row.from ?? "?"} me={!toMe && !!owed} size={42} />
              {toMe ? owed?.row.from : "You"}
            </span>
            <span className="bill-route-line">
              <span>
                <Icon name="north_east" size={17} />
              </span>
            </span>
            <span className="grid justify-items-center gap-1 text-[12px] font-medium">
              <Person name={owed?.row.to ?? "?"} me={toMe} size={42} />
              {toMe ? "You" : owed?.row.to}
            </span>
          </div>

          <p className="mt-5 text-center text-[13px] text-glass-ink2">
            {owed ? (toMe ? `${owed.row.from} owes you` : `You owe ${owed.row.to}`) : "…"}
          </p>
          <p className="mt-1 text-center text-[44px] font-semibold tracking-[-.05em]">
            {found ? scanMoney(found.bill.amount, currency) : "—"}
          </p>

          <dl className="bill-meta mt-4">
            <div>
              <dt>Shop</dt>
              <dd className="truncate">
                {shopName(data?.merchant || split?.merchant) || "Expense"}
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>
                {(data?.purchased_at ?? split?.purchased_at)
                  ? new Date((data?.purchased_at ?? split?.purchased_at)!).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" }
                    )
                  : "No date"}
              </dd>
            </div>
            <div>
              <dt>Tab</dt>
              <dd className="truncate">{tab?.group_name}</dd>
            </div>
            <div>
              <dt>Paid by</dt>
              <dd className="truncate">{split?.paid_by}</dd>
            </div>
          </dl>

          <div className="bill-tear" />

          <p className="text-[13px] font-semibold">What was on it</p>
          {receipt.error ? (
            <p role="alert" className="mt-2 text-[12px] text-glass-neg">
              Couldn&apos;t load this receipt.
            </p>
          ) : !data ? (
            <p className="mt-2 text-[12px] text-glass-soft">Loading…</p>
          ) : (
            <>
              {data.line_items.length > 0 ? (
                <ul className="mt-2 space-y-2 text-[13px]">
                  {data.line_items.map((line) => (
                    <li key={line.id} className="flex justify-between gap-4">
                      <span className="min-w-0 truncate text-glass-ink2">
                        {line.description || "Item"}
                        {mine?.includes(line.id) && (
                          <small className="ml-2 font-semibold text-glass-pos">yours</small>
                        )}
                      </span>
                      <b className="shrink-0 font-medium tabular-nums">
                        {scanMoney(line.total_price, currency)}
                      </b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[12px] text-glass-soft">No item lines on this one.</p>
              )}
              <div className="ios-divider mt-3 flex justify-between pt-3 text-[13px]">
                <span className="text-glass-soft">Receipt total</span>
                <b className="tabular-nums">{scanMoney(data.total, currency)}</b>
              </div>
              <p className="mt-5 text-[13px] font-semibold">Original receipt</p>
              {data.image?.kind === "photo" ? (
                <a href={data.image.url} target="_blank" rel="noreferrer">
                  <img
                    src={data.image.url}
                    alt={`Original receipt from ${shopName(data.merchant) || "the shop"}`}
                    className="mt-2 max-h-[420px] w-full rounded-[14px] object-contain"
                  />
                </a>
              ) : data.image ? (
                <a
                  href={data.image.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex min-h-10 items-center text-[13px] font-semibold underline underline-offset-4"
                >
                  Open the PDF
                </a>
              ) : (
                <p className="mt-1 text-[12px] text-glass-soft">
                  No photo was kept for this one, just the lines above.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {owed && (
        <>
          <button
            onClick={() => (toMe ? remind(owed) : pay(owed))}
            className="mt-5 min-h-[52px] w-full rounded-full glass-cta text-[14px] font-semibold"
          >
            {toMe ? `Remind ${owed.row.from}` : `Pay ${owed.row.to}`}
          </button>
          {Math.abs(owed.row.amount - (found?.bill.amount ?? 0)) >= 0.01 && (
            <p className="mt-2 text-center text-[12px] text-glass-soft">
              Settles {scanMoney(owed.row.amount, rowCurrency(owed.tab, owed.row))}, everything open
              with {toMe ? owed.row.from : owed.row.to} on this tab.
            </p>
          )}
        </>
      )}
    </main>
  );
}
