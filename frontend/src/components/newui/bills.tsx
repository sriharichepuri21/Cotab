"use client";

import { useCallback, useEffect, useState } from "react";

import type { SplitSummary } from "@/lib/api";
import { useGroup, useGroups } from "@/lib/data";

import { scanMoney } from "./parts";

export type Row = SplitSummary["suggested_settlements"][number];
/** One suggested payment, with the tab it's on. */
export type Owed = { tab: SplitSummary; row: Row; index: number };
export type Split = SplitSummary["splits"][number];
/** One receipt behind a suggested payment, and the part of it still open. */
export type Bill = { tab: SplitSummary; split: Split; amount: number };

/** A suggested payment's currency: the server settles each one separately. */
export const rowCurrency = (tab: SplitSummary, row: { currency?: string }) =>
  row.currency || tab.currency || "USD";

/** Sums by currency: balances in different currencies never add together. */
export function byCurrency(items: Owed[]) {
  const out: Record<string, number> = {};
  for (const { tab, row } of items) {
    const cur = rowCurrency(tab, row);
    out[cur] = Math.round(((out[cur] ?? 0) + row.amount) * 100) / 100;
  }
  return out;
}

export const moneyLines = (sums: Record<string, number>) =>
  Object.entries(sums).map(([cur, amount]) => scanMoney(amount, cur));

/** The bills behind a payment, newest first: what the payer covered and the
 *  other person hasn't settled. They can add up to more than the payment, which
 *  is net of anything going the other way and of payments already recorded. */
export function billsFor({ tab, row }: Owed): Bill[] {
  return tab.splits
    .filter((s) => s.paid_by === row.to && s.currency === rowCurrency(tab, row))
    .flatMap((split) => {
      const share = split.shares.find((x) => x.member === row.from && !x.settled);
      return share ? [{ tab, split, amount: share.amount }] : [];
    })
    .sort((a, b) => (b.split.purchased_at ?? "").localeCompare(a.split.purchased_at ?? ""));
}

/** Who the money is with, across tabs. People are matched by their Cotab
 *  account, then by name, so the same friend on two tabs is one row. */
export function peopleIn(rows: Owed[]) {
  const out = new Map<string, { key: string; name: string; rows: Owed[] }>();
  for (const owed of rows) {
    const { tab, row } = owed;
    const id = row.to_id === tab.me ? row.from_id : row.to_id;
    const name = row.to_id === tab.me ? row.from : row.to;
    const key = tab.members.find((m) => m.id === id)?.account ?? name.trim().toLowerCase();
    const person = out.get(key);
    if (person) person.rows.push(owed);
    else out.set(key, { key, name, rows: [owed] });
  }
  return Array.from(out.values());
}

/** Every person you've shared a tab with, however things stand. */
export function friendsIn(list: SplitSummary[]) {
  return peopleIn(
    list.flatMap((tab) =>
      tab.members
        .filter((m) => m.id !== tab.me)
        .map((m, index) => ({
          tab,
          index,
          row: { from: m.name, to: "", from_id: m.id, to_id: tab.me ?? "", amount: 0 },
        }))
    )
  );
}

/** How much of a tab's money has been settled, as a whole percent. */
export function paidPercent(tab: SplitSummary) {
  const shares = tab.splits.flatMap((s) => s.shares);
  const total = shares.reduce((sum, s) => sum + s.amount, 0);
  if (!total) return 100;
  const settled = shares.reduce((sum, s) => sum + (s.settled ? s.amount : 0), 0);
  return tab.suggested_settlements.length ? Math.round((settled / total) * 100) : 100;
}

/** Loads one tab and hands its summary up; draws nothing itself. */
function TabLoader({
  id,
  onLoad,
  onFail,
}: {
  id: string;
  onLoad: (s: SplitSummary) => void;
  onFail: (id: string, failed: boolean) => void;
}) {
  const { data, error } = useGroup(id);
  useEffect(() => {
    if (data) onLoad(data);
  }, [data, onLoad]);
  useEffect(() => onFail(id, Boolean(error) && !data), [id, error, data, onFail]);
  return null;
}

/** Every tab you're on and what's open on them. Render `loaders` once. */
export function useMyTabs() {
  const groups = useGroups();
  const [tabs, setTabs] = useState<Record<string, SplitSummary>>({});
  const onLoad = useCallback(
    (s: SplitSummary) => setTabs((current) => ({ ...current, [s.group_id]: s })),
    []
  );
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const onFail = useCallback(
    (id: string, broken: boolean) =>
      setFailed((current) => (current[id] === broken ? current : { ...current, [id]: broken })),
    []
  );
  const list = (groups.data ?? []).map((g) => tabs[g.id]).filter(Boolean) as SplitSummary[];
  const anyFailed = (groups.data ?? []).some((g) => failed[g.id]);
  const rows = list.flatMap((tab) =>
    tab.suggested_settlements.map((row, index) => ({ tab, row, index }))
  );
  return {
    tabs,
    list,
    // A tab that won't load must not read as "nothing owed".
    error: groups.error ?? (anyFailed ? new Error("Couldn't load every tab.") : undefined),
    loading:
      !groups.error &&
      !anyFailed &&
      (groups.data === undefined || list.length < (groups.data?.length ?? 0)),
    youPay: rows.filter(({ tab, row }) => tab.me && row.from_id === tab.me),
    youGet: rows.filter(({ tab, row }) => tab.me && row.to_id === tab.me),
    onLoad,
    loaders: (groups.data ?? []).map((g) => (
      <TabLoader key={g.id} id={g.id} onLoad={onLoad} onFail={onFail} />
    )),
  };
}
