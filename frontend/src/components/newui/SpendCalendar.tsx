"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/ui";
import { shopName } from "@/lib/brands";
import { useMonthReceipts } from "@/lib/data";
import { categoryLabel } from "@/lib/format";

import { heat, iso, monthCells, monthOf, shiftMonth, spendByDay, type SpendDay } from "./calendar";
import { DemoSheet, ReceiptRow, receiptFromApi, scanMoney } from "./parts";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const when = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-US", o);

/**
 * The month as a heat map, GitHub style: one square a day, darker the more of
 * your share went out. Tap a day or the list button for the calendar list.
 */
export function SpendCalendar({
  month,
  setMonth,
  currency,
  openReceipt,
}: {
  month: string;
  setMonth: (month: string) => void;
  currency: string;
  openReceipt: (id: string) => void;
}) {
  const { data, error } = useMonthReceipts(month || null);
  const days = useMemo(() => spendByDay(data ?? [], currency), [data, currency]);
  const [listAt, setListAt] = useState<string | null>(null);
  const today = iso(new Date());
  const totals = Array.from(days.values()).map((d) => d.total);
  const top = Math.max(0, ...totals);
  const spent = Array.from(days.keys()).filter((d) => d.startsWith(month));
  const biggest = Array.from(days.values()).find((d) => d.total === top && top > 0);
  const atNow = month >= monthOf(new Date());
  if (!month) return null;
  const name = when(`${month}-15`, { month: "long", year: "numeric" });

  return (
    <>
      <section className="ios-surface mt-4 rounded-[24px] p-4" aria-label="Spending calendar">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-.02em]">{name}</h2>
            <p className="text-[12px] text-glass-soft">
              {error
                ? "Couldn't load this month."
                : !data
                  ? "Loading…"
                  : spent.length
                    ? `Spent on ${spent.length} ${spent.length === 1 ? "day" : "days"}`
                    : "Nothing counted this month."}
            </p>
          </div>
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="ios-round-control grid h-10 w-10 place-items-center rounded-full"
          >
            <Icon name="chevron_left" size={20} />
          </button>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={atNow}
            aria-label="Next month"
            className="ios-round-control grid h-10 w-10 place-items-center rounded-full disabled:opacity-40"
          >
            <Icon name="chevron_right" size={20} />
          </button>
        </div>

        <div className="heat-head mt-4" aria-hidden="true">
          {WEEK.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="heat-grid mt-1.5">
          {monthCells(month).map((day, i) => {
            if (!day) return <span key={`pad-${i}`} />;
            const entry = days.get(day);
            const level = entry ? Math.max(1, heat(entry.total, totals)) : 0;
            const label = when(day, { month: "short", day: "numeric" });
            return entry ? (
              <button
                key={day}
                onClick={() => setListAt(day)}
                data-heat={level}
                className={`heat-cell ${day === today ? "is-today" : ""}`}
                aria-label={`${label}: ${scanMoney(entry.total, currency)}, ${entry.rows.length} ${entry.rows.length === 1 ? "receipt" : "receipts"}`}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              <span
                key={day}
                data-heat={0}
                className={`heat-cell ${day === today ? "is-today" : ""}`}
                aria-label={`${label}: nothing spent`}
              >
                {Number(day.slice(8))}
              </span>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="heat-legend" aria-hidden="true">
            Less
            {[0, 1, 2, 3, 4].map((n) => (
              <i key={n} style={{ background: `var(--heat-${n})` }} />
            ))}
            More
          </span>
          <button
            onClick={() => setListAt(spent[spent.length - 1] ?? `${month}-01`)}
            disabled={!spent.length}
            className="min-h-10 rounded-full glass-cta px-4 text-[12px] font-semibold disabled:opacity-40"
          >
            View as list
          </button>
        </div>
        {biggest && (
          <p className="mt-3 text-[13px] text-glass-ink2">
            Biggest day: {when(biggest.day, { month: "short", day: "numeric" })},{" "}
            {scanMoney(biggest.total, currency)}.
          </p>
        )}
      </section>
      {/* Outside the glass: a backdrop filter would trap this sheet inside the card. */}
      {listAt && (
        <CalendarList
          title={name}
          days={days}
          at={listAt}
          currency={currency}
          close={() => setListAt(null)}
          openReceipt={(id) => {
            setListAt(null);
            openReceipt(id);
          }}
        />
      )}
    </>
  );
}

/** Like a calendar app's list: a strip of days on top, each day's spending below. */
function CalendarList({
  title,
  days,
  at,
  currency,
  close,
  openReceipt,
}: {
  title: string;
  days: Map<string, SpendDay>;
  at: string;
  currency: string;
  close: () => void;
  openReceipt: (id: string) => void;
}) {
  const [day, setDay] = useState(at);
  const list = useRef<HTMLDivElement>(null);
  const sorted = useMemo(
    () => Array.from(days.values()).sort((a, b) => a.day.localeCompare(b.day)),
    [days]
  );
  useEffect(() => {
    list.current?.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ block: "start" });
    document
      .querySelector(`[data-chip="${day}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day]);
  return (
    <DemoSheet title={title} subtitle="Every day you spent, and what on." close={close}>
      <div className="day-strip" role="group" aria-label="Days with spending">
        {sorted.map((d) => (
          <button
            key={d.day}
            data-chip={d.day}
            onClick={() => setDay(d.day)}
            aria-pressed={d.day === day}
            className="day-chip"
          >
            {when(d.day, { weekday: "short" })}
            <b>{Number(d.day.slice(8))}</b>
            <u />
          </button>
        ))}
      </div>
      <div ref={list} className="mt-3 grid gap-3">
        {sorted.map((d) => (
          <article key={d.day} data-day={d.day} className="agenda-day">
            <p className="agenda-date">
              <b>{Number(d.day.slice(8))}</b>
              {when(d.day, { weekday: "short" })}
            </p>
            <div className="ios-surface rounded-[20px] px-4">
              {d.rows.map((r, i) => {
                const item = receiptFromApi(r);
                return (
                  <div key={r.id} className={i ? "ios-divider" : ""}>
                    {r.owned ? (
                      <ReceiptRow item={item} onClick={() => openReceipt(r.id)} />
                    ) : (
                      <p className="py-3.5 text-[13px]">
                        <b className="block truncate text-[15px]">{shopName(item.merchant)}</b>
                        <span className="text-glass-soft">
                          {categoryLabel(r.category || "other")} · Added by a friend ·{" "}
                          {scanMoney(r.my_share ?? r.total, r.currency)} yours
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
              {d.rows.length > 1 && (
                <p className="ios-divider flex justify-between py-2.5 text-[12px] text-glass-soft">
                  Day total <b className="text-glass-ink">{scanMoney(d.total, currency)}</b>
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </DemoSheet>
  );
}
