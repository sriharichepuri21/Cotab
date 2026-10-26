"use client";
/* eslint-disable @next/next/no-img-element -- Tabby's stock art is served as is */

import { useCallback, useEffect, useState } from "react";

import { PayLinks } from "@/components/PayLinks";
import { PersonPicker } from "@/components/PersonPicker";
import { RemindSheet, remindedLabel, reminderText } from "@/components/RemindSheet";
import { Icon } from "@/components/ui";
import {
  createSplitGroup,
  recordSettlement,
  undoSettlement,
  type SplitMemberInput,
  type SplitSummary,
} from "@/lib/api";
import { invalidateSpending, invalidateSplits, keys, useGroup, useGroups, useMe } from "@/lib/data";
import { mutate } from "@/lib/cache";
import { dayLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import { Cat, DemoSheet, Header, Ticket, cats, scanMoney } from "./parts";

type Row = SplitSummary["suggested_settlements"][number];
/** One suggested payment, with the tab it's on. */
type Owed = { tab: SplitSummary; row: Row; index: number };

const METHOD_LABEL: Record<string, string> = {
  venmo: "Venmo",
  paypal: "PayPal",
  cashapp: "Cash App",
  zelle: "Zelle",
  cash: "Cash",
  other: "Other",
};

function moodFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return cats[hash % cats.length];
}

/** Sums by currency: balances in different currencies never add together. */
function byCurrency(items: Owed[]) {
  const out: Record<string, number> = {};
  for (const { tab, row } of items) {
    const cur = tab.currency || "USD";
    out[cur] = Math.round(((out[cur] ?? 0) + row.amount) * 100) / 100;
  }
  return out;
}

const moneyLines = (sums: Record<string, number>) =>
  Object.entries(sums).map(([cur, amount]) => scanMoney(amount, cur));

/** Loads one tab and hands its summary up; draws nothing itself. */
function TabLoader({ id, onLoad }: { id: string; onLoad: (s: SplitSummary) => void }) {
  const { data } = useGroup(id);
  useEffect(() => {
    if (data) onLoad(data);
  }, [data, onLoad]);
  return null;
}

/**
 * Tabs: what you're owed and what you owe, tab by tab, in each tab's own
 * currency. Paying happens in the payment app; Cotab only records it when
 * you say it's done, and a recorded payment can be undone.
 */
export function Tabs() {
  const { data: user } = useMe();
  const groups = useGroups();
  const [tabs, setTabs] = useState<Record<string, SplitSummary>>({});
  const [detail, setDetail] = useState<string | null>(null);
  const [paying, setPaying] = useState<Owed | null>(null);
  const [reminding, setReminding] = useState<Owed | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const onLoad = useCallback(
    (s: SplitSummary) => setTabs((current) => ({ ...current, [s.group_id]: s })),
    []
  );

  const list = (groups.data ?? []).map((g) => tabs[g.id]).filter(Boolean) as SplitSummary[];
  const rows = list.flatMap((tab) =>
    tab.suggested_settlements.map((row, index) => ({ tab, row, index }))
  );
  const youPay = rows.filter(({ tab, row }) => tab.me && row.from_id === tab.me);
  const youGet = rows.filter(({ tab, row }) => tab.me && row.to_id === tab.me);
  const owed = byCurrency(youGet);
  const owe = byCurrency(youPay);
  const mood = youPay.length ? "hmm" : youGet.length ? "payday" : "cool";
  const loading = groups.data === undefined || list.length < (groups.data?.length ?? 0);
  const update = (s: SplitSummary) => {
    mutate(keys.group(s.group_id), s);
    setTabs((current) => ({ ...current, [s.group_id]: s }));
    invalidateSplits();
    invalidateSpending();
  };
  const open = detail ? tabs[detail] : null;

  return (
    <>
      {(groups.data ?? []).map((g) => (
        <TabLoader key={g.id} id={g.id} onLoad={onLoad} />
      ))}
      <main className="px-5 pb-32 pt-6">
        <Header
          eyebrow="Settle without chasing"
          title="Tabs"
          action={
            <button
              onClick={() => setCreating(true)}
              className="tabs-action min-h-10 rounded-full bg-[#103e33] px-4 py-2.5 text-[12px] font-bold text-white"
            >
              + New
            </button>
          }
        />
        {groups.error && (
          <p
            role="alert"
            className="mt-5 rounded-[16px] bg-[#fde7e7] px-4 py-3 text-[12px] text-[#7a2b20]"
          >
            Couldn&apos;t load your tabs. Check your connection and try again.
          </p>
        )}
        <button
          onClick={() =>
            youPay[0] ? setPaying(youPay[0]) : youGet[0] && setDetail(youGet[0].tab.group_id)
          }
          disabled={!youPay.length && !youGet.length}
          className="tabs-hero demo-gloss mt-7 w-full overflow-hidden rounded-[24px] bg-[#103e33] p-5 text-left text-white"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_112px] items-end gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.14em] text-white/55">
                Your tabs today
              </p>
              <p className="mt-2 text-[28px] font-semibold leading-tight tracking-[-.045em]">
                {loading
                  ? "Adding up your tabs…"
                  : youPay.length
                    ? youPay.length === 1
                      ? "One payment needs you."
                      : `${youPay.length} payments need you.`
                    : youGet.length
                      ? `${moneyLines(owed).join(" + ")} is coming back.`
                      : "You're all even."}
              </p>
              <p className="mt-3 text-[12px] text-white/65">
                {youPay[0]
                  ? `Pay ${youPay[0].row.to} for ${youPay[0].tab.group_name}.`
                  : youGet.length
                    ? `From ${youGet.length} ${youGet.length === 1 ? "person" : "people"}.`
                    : list.length
                      ? "Nobody owes anybody."
                      : "Split a receipt to start a tab."}
              </p>
            </div>
            <img
              src={`/cat-v3-stock/png/${mood}.png`}
              alt=""
              className="tabby-v3-figure h-[132px] w-full object-contain object-bottom"
            />
          </div>
        </button>
        <section className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => youGet[0] && setDetail(youGet[0].tab.group_id)}
            className="ios-surface rounded-[19px] p-4 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#50713a]">
              Owed to you
            </span>
            {(youGet.length ? moneyLines(owed) : [scanMoney(0, list[0]?.currency)]).map((m) => (
              <b key={m} className="mt-2 block text-[25px]">
                {m}
              </b>
            ))}
            <small className="text-[#77776f]">
              {youGet.length
                ? `${youGet.length} ${youGet.length === 1 ? "person" : "people"} →`
                : "Nothing yet"}
            </small>
          </button>
          <button
            onClick={() => youPay[0] && setPaying(youPay[0])}
            className="tabs-owe rounded-[19px] bg-[#f7e9e3] p-4 text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a74132]">
              You owe
            </span>
            {(youPay.length ? moneyLines(owe) : [scanMoney(0, list[0]?.currency)]).map((m) => (
              <b key={m} className="mt-2 block text-[25px]">
                {m}
              </b>
            ))}
            <small className="text-[#715f59]">
              {youPay[0] ? `Pay ${youPay[0].row.to} →` : "Settled"}
            </small>
          </button>
        </section>

        {note && (
          <p
            role="status"
            className="mt-4 rounded-[14px] bg-[#e7f7df] px-4 py-3 text-[12px] font-semibold text-[#285c3c]"
          >
            {note}
          </p>
        )}

        {list.map((tab) => {
          const mine = tab.suggested_settlements
            .map((row, index) => ({ tab, row, index }))
            .filter(({ row }) => tab.me && (row.from_id === tab.me || row.to_id === tab.me));
          return (
            <section key={tab.group_id}>
              <h2 className="mt-8 text-[19px] font-semibold tracking-[-.03em]">{tab.group_name}</h2>
              <Ticket className="mt-3 rounded-[20px] border border-black/[0.07] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex -space-x-2">
                    {tab.members.slice(0, 5).map((m) => (
                      <span key={m.id} className="rounded-full ring-2 ring-[#fffefa]">
                        <Cat mood={m.id === tab.me ? "cool" : moodFor(m.name)} size={38} />
                      </span>
                    ))}
                  </div>
                  <span className="text-[12px] font-semibold text-[#77776f]">
                    {scanMoney(tab.total_spend, tab.currency)} shared
                  </span>
                </div>
                <div className="mt-5 space-y-4">
                  {mine.length ? (
                    mine.map((o) => {
                      const toMe = o.row.to_id === tab.me;
                      const other = toMe ? o.row.from : o.row.to;
                      return (
                        <div
                          key={`${o.row.from_id}-${o.row.to_id}`}
                          className="flex items-center gap-3"
                        >
                          <Cat mood={moodFor(other)} size={38} />
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[14px]">{other}</b>
                            <span className="text-[11px] text-[#77776f]">
                              {toMe ? "owes you" : "you owe"}
                              {toMe && remindedLabel(o.row.last_reminded_at)
                                ? ` · ${remindedLabel(o.row.last_reminded_at)}`
                                : ""}
                            </span>
                          </span>
                          <b>{scanMoney(o.row.amount, tab.currency)}</b>
                          <button
                            onClick={() => (toMe ? setReminding(o) : setPaying(o))}
                            className="tabs-remind min-h-9 rounded-full bg-[#edf9b7] px-3 py-2 text-[11px] font-bold text-[#22231f]"
                          >
                            {toMe ? "Remind" : "Pay"}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-[12px] text-[#77776f]">You&apos;re even on this tab.</p>
                  )}
                </div>
                <button
                  onClick={() => setDetail(tab.group_id)}
                  className="mt-4 min-h-10 w-full border-t border-black/[0.07] pt-3 text-left text-[12px] font-bold text-[#103e33]"
                >
                  Tab history and payments →
                </button>
              </Ticket>
            </section>
          );
        })}
        {!loading && !list.length && !groups.error && (
          <p className="mt-8 rounded-[18px] bg-black/[0.035] px-4 py-4 text-[13px] text-[#77776f]">
            No tabs yet. Split a receipt with someone, or start a tab with + New.
          </p>
        )}
      </main>

      {open && (
        <TabDetail
          tab={open}
          close={() => setDetail(null)}
          pay={setPaying}
          remind={setReminding}
          update={update}
        />
      )}
      {paying && (
        <PaySheet
          owed={paying}
          close={() => setPaying(null)}
          update={(s, message) => {
            update(s);
            setNote(message);
          }}
        />
      )}
      {reminding && user && (
        <RemindSheet
          groupId={reminding.tab.group_id}
          friend={{
            id: reminding.row.from_id ?? "",
            name: reminding.row.from,
            notify: reminding.tab.members.find((m) => m.id === reminding.row.from_id)?.notify,
          }}
          me={reminding.row.to}
          amount={reminding.row.amount}
          currency={reminding.tab.currency ?? "USD"}
          text={reminderText({
            friend: reminding.row.from,
            me: reminding.row.to,
            amount: reminding.row.amount,
            currency: reminding.tab.currency ?? "USD",
            // Your own payment options: the person paying you needs them.
            links: reminding.row.pay_links ?? [],
            shareUrl: `${window.location.origin}${routes.share(reminding.tab.share_code)}`,
          })}
          onClose={() => setReminding(null)}
          onSent={(summary, message) => {
            if (summary) update(summary);
            setNote(message);
            setReminding(null);
          }}
        />
      )}
      {creating && (
        <NewTab
          myName={user?.full_name || user?.email?.split("@")[0] || "Me"}
          close={() => setCreating(false)}
          created={(name) => {
            setCreating(false);
            invalidateSplits();
            setNote(`${name} is ready. Split a receipt onto it from the receipt.`);
          }}
        />
      )}
    </>
  );
}

/** Pay someone: open their payment app if they've added one, then say it's
 *  done. Cotab never moves money and never marks a payment from the app. */
function PaySheet({
  owed,
  close,
  update,
}: {
  owed: Owed;
  close: () => void;
  update: (s: SplitSummary, message: string) => void;
}) {
  const { tab, row } = owed;
  const links = row.pay_links ?? [];
  const [method, setMethod] = useState<string>(links[0]?.method ?? "cash");
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<SplitSummary | null>(null);
  const toMe = row.to_id === tab.me;
  const amount = scanMoney(row.amount, tab.currency);

  async function confirm() {
    if (!row.from_id || !row.to_id) return;
    setBusy(true);
    setError("");
    try {
      const next = await recordSettlement(tab.group_id, {
        from_member_id: row.from_id,
        to_member_id: row.to_id,
        amount: row.amount,
        method,
      });
      setRecorded(next);
      update(next, `${toMe ? row.from : "You"} paid ${toMe ? "you" : row.to} ${amount}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const payment = recorded?.settlements?.find(
      (p) => p.amount === row.amount && p.from === row.from && p.to === row.to
    );
    if (!payment) return;
    setBusy(true);
    try {
      const next = await undoSettlement(tab.group_id, payment.id);
      update(next, "Payment undone.");
      close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (recorded)
    return (
      <DemoSheet title="Payment recorded" subtitle={tab.group_name} close={close}>
        <div className="flex items-center gap-3 rounded-[18px] bg-[#e7f7df] p-4 text-[#285c3c]">
          <Cat mood="payday" size={48} />
          <b className="flex-1 text-[14px]">
            {toMe ? row.from : "You"} paid {toMe ? "you" : row.to} {amount}.
          </b>
        </div>
        <button
          onClick={close}
          className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
        >
          Done
        </button>
        <button
          onClick={undo}
          disabled={busy}
          className="mt-2 min-h-11 w-full text-[12px] font-bold underline underline-offset-4"
        >
          Undo
        </button>
        {error && (
          <p role="alert" className="mt-2 text-center text-[12px] text-[#a74132]">
            {error}
          </p>
        )}
      </DemoSheet>
    );

  return (
    <DemoSheet
      title={toMe ? `${row.from} paid you?` : `Pay ${row.to} ${amount}`}
      subtitle={`${tab.group_name} · your share after tax and discounts`}
      close={close}
    >
      <div className="ios-surface flex items-center gap-3 rounded-[18px] p-4">
        <Cat mood={moodFor(toMe ? row.from : row.to)} size={48} />
        <b className="flex-1">{toMe ? row.from : row.to}</b>
        <b>{amount}</b>
      </div>
      {!toMe && links.length > 0 && (
        <>
          <p className="mt-5 text-[12px] font-bold">Pay in their app</p>
          <div className="mt-2">
            <PayLinks
              links={links}
              onOpened={(m) => {
                setMethod(m);
                setOpened(true);
              }}
            />
          </div>
        </>
      )}
      {!toMe && links.length === 0 && (
        <p className="mt-4 text-[12px] text-[#77776f]">
          {row.to} hasn&apos;t added Venmo, PayPal, Cash App or Zelle yet. Pay them however you
          like, then record it here.
        </p>
      )}
      <p className="mt-5 text-[12px] font-bold">How was it paid?</p>
      <div role="radiogroup" aria-label="How was it paid" className="mt-2 flex flex-wrap gap-2">
        {Array.from(new Set([...links.map((l) => l.method), "cash", "other"])).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={`pay-method min-h-10 rounded-full border px-3 text-[12px] font-bold ${method === m ? "is-on border-[#103e33]" : "border-black/10"}`}
          >
            {METHOD_LABEL[m] ?? m}
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-[#77776f]">
        {opened
          ? "Back from paying? Record it so the tab is even."
          : "Cotab doesn't move money. A payment counts once you record it here."}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-[#a74132]">
          {error}
        </p>
      )}
      <button
        onClick={confirm}
        disabled={busy}
        className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : toMe ? `${row.from} paid me ${amount}` : `I've paid ${row.to}`}
      </button>
    </DemoSheet>
  );
}

/** One tab: who settles with whom, payments (with undo), people and its link. */
function TabDetail({
  tab,
  close,
  pay,
  remind,
  update,
}: {
  tab: SplitSummary;
  close: () => void;
  pay: (o: Owed) => void;
  remind: (o: Owed) => void;
  update: (s: SplitSummary) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [shared, setShared] = useState("");
  const shareUrl = `${window.location.origin}${routes.share(tab.share_code)}`;

  async function undo(id: string) {
    setBusy(id);
    setError("");
    try {
      update(await undoSettlement(tab.group_id, id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: tab.group_name, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setShared("Link copied.");
    } catch (e) {
      // Closing the share sheet isn't an error.
      if ((e as Error).name !== "AbortError") setShared("Couldn't share. Copy the link below.");
    }
  }

  return (
    <DemoSheet
      title={tab.group_name}
      subtitle={`${tab.members.map((m) => m.name).join(", ")} · ${scanMoney(tab.total_spend, tab.currency)} shared`}
      close={close}
    >
      <h3 className="text-[15px] font-semibold">To settle up</h3>
      {tab.suggested_settlements.length ? (
        <div className="mt-2 space-y-2">
          {tab.suggested_settlements.map((row, index) => {
            const o = { tab, row, index };
            const youPay = row.from_id === tab.me;
            const youGet = row.to_id === tab.me;
            return (
              <div
                key={`${row.from_id}-${row.to_id}`}
                className="ios-surface rounded-[16px] p-3 text-[13px]"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <b>{youPay ? "You" : row.from}</b> {youPay ? "pay" : "pays"}{" "}
                    <b>{youGet ? "you" : row.to}</b>
                  </span>
                  <b>{scanMoney(row.amount, tab.currency)}</b>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => pay(o)}
                    className="min-h-10 rounded-full bg-[#103e33] px-3 text-[12px] font-bold text-white"
                  >
                    {youPay ? `Pay ${row.to}` : youGet ? `${row.from} paid me` : "Mark as paid"}
                  </button>
                  {youGet && (
                    <button
                      onClick={() => remind(o)}
                      className="min-h-10 rounded-full bg-black/[0.05] px-3 text-[12px] font-bold"
                    >
                      Remind {row.from}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 rounded-[14px] bg-[#e7f7df] px-3 py-3 text-[12px] font-semibold text-[#285c3c]">
          Everyone is even.
        </p>
      )}

      {(tab.settlements?.length ?? 0) > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold">Payments</h3>
          <div className="mt-2 divide-y divide-black/[0.07]">
            {tab.settlements!.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b>{p.from}</b> paid <b>{p.to}</b> {scanMoney(p.amount, tab.currency)}
                  <span className="block text-[11px] text-[#77776f]">
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.created_at ? ` · ${dayLabel(p.created_at)}` : ""}
                  </span>
                </span>
                <button
                  onClick={() => undo(p.id)}
                  disabled={busy === p.id}
                  className="min-h-10 px-2 text-[12px] font-bold underline underline-offset-4"
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-[#a74132]">
          {error}
        </p>
      )}

      <section className="tabs-share mt-6 rounded-[20px] bg-[#dff0ff] p-4">
        <b className="block text-[13px]">Share this tab</b>
        <p className="mt-1 text-[11px] leading-snug text-[#45667b]">
          Anyone with the link sees only this tab, without phone numbers or emails, and can join it.
        </p>
        <button
          onClick={share}
          className="mt-3 min-h-11 w-full rounded-full bg-[#103e33] text-[13px] font-bold text-white"
        >
          Share link
        </button>
        <input
          readOnly
          aria-label="Tab link"
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 w-full truncate rounded-[12px] bg-white/60 px-3 py-2 text-[11px] text-[#22231f] outline-none"
        />
        {shared && (
          <p role="status" className="mt-2 text-[11px] font-semibold text-[#285c3c]">
            {shared}
          </p>
        )}
      </section>
    </DemoSheet>
  );
}

/** Start a tab with a name and people; receipts go on it when split. */
function NewTab({
  myName,
  close,
  created,
}: {
  myName: string;
  close: () => void;
  created: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [people, setPeople] = useState<SplitMemberInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const tab = await createSplitGroup({ name: name.trim(), my_name: myName, members: people });
      created(tab.name);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <DemoSheet
      title="New tab"
      subtitle="For a trip, a home, or anyone you share with."
      close={close}
    >
      <label className="block text-[12px] font-semibold text-[#77776f]" htmlFor="tab-name">
        Name
      </label>
      <input
        id="tab-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Lake trip"
        className="mt-2 h-12 w-full rounded-[15px] bg-black/[0.045] px-4 text-[14px] outline-none"
      />
      {people.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {people.map((p) => (
            <span
              key={p.from_member || p.name}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.05] py-1 pl-3 pr-1 text-[12px] font-bold"
            >
              {p.name}
              <button
                onClick={() => setPeople((list) => list.filter((x) => x !== p))}
                aria-label={`Remove ${p.name}`}
                className="grid h-8 w-8 place-items-center rounded-full"
              >
                <Icon name="close" size={15} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="split-picker mt-4">
        <PersonPicker
          label="Who's on it?"
          existing={[{ name: myName }, ...people.map((p) => ({ ...p, ref: p.from_member }))]}
          onAdd={(person) => {
            if (person.name.trim().toLowerCase() === myName.toLowerCase())
              throw new Error("You're on it already. Add who you share with.");
            setPeople((list) => [...list, person]);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-[#a74132]">
          {error}
        </p>
      )}
      <button
        onClick={create}
        disabled={busy || !name.trim() || !people.length}
        className="mt-5 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start tab"}
      </button>
    </DemoSheet>
  );
}
