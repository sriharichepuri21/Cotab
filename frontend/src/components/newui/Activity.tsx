"use client";

import { useState } from "react";

import { Icon } from "@/components/ui";
import {
  CATEGORIES,
  bulkAction,
  createSavedView,
  deleteSavedView,
  reviewReceipt,
  type ReceiptFilters,
  type SavedView,
} from "@/lib/api";
import { invalidate } from "@/lib/cache";
import {
  invalidateSpending,
  useInsights,
  useReceiptPages,
  useSavedViews,
  useSummary,
} from "@/lib/data";
import { categoryLabel } from "@/lib/format";

import {
  DemoSheet,
  Header,
  ReceiptRow,
  Ticket,
  receiptFromApi,
  scanMoney,
  type Receipt,
} from "./parts";

type Scope = "everything" | "mine" | "shared";
type Range = "this" | "last" | "custom" | "any";
const SORTS = {
  "Newest first": { sort: "date", order: "desc" },
  "Oldest first": { sort: "date", order: "asc" },
  "Highest amount": { sort: "amount", order: "desc" },
  "Lowest amount": { sort: "amount", order: "asc" },
} as const;
type SortName = keyof typeof SORTS;
type Status = "Any status" | "Needs review" | "Split" | "Unsplit";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** [start, end] for a date chip; end is inclusive (the server's end_date is). */
export function rangeDates(range: Range, now = new Date()): [string?, string?] {
  if (range === "this") return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), undefined];
  if (range === "last")
    return [
      iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    ];
  return [undefined, undefined];
}

/** Every expense, searchable and filterable; totals are your share. */
export function Activity({ openReceipt }: { openReceipt: (r: Receipt) => void }) {
  const [scope, setScope] = useState<Scope>("everything");
  const [showFilters, setShowFilters] = useState(false);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SortName>("Newest first");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("Any status");
  const [range, setRange] = useState<Range>("this");
  const [custom, setCustom] = useState<[string, string]>(["", ""]);
  const [viewName, setViewName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"categorize" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const [start, end] = range === "custom" ? custom : rangeDates(range);
  const filters: ReceiptFilters = {
    q: query.trim() || undefined,
    category: category || undefined,
    status: status === "Needs review" ? "extracted" : undefined,
    start_date: start || undefined,
    end_date: end || undefined,
    ...SORTS[sort],
  };
  const list = useReceiptPages(filters);
  const views = useSavedViews().data ?? [];
  const summary = useSummary(6).data;
  const insight = (useInsights().data ?? []).find(
    (i) => i.kind === "top_category" || i.kind === "month_change"
  );

  // Your own receipts: split ones carry your share, the rest are all yours.
  const visible = list.rows.map(receiptFromApi).filter((r, i) => {
    const split = list.rows[i].my_share != null;
    if (scope === "mine" || status === "Unsplit") return !split;
    if (scope === "shared" || status === "Split") return split;
    return true;
  });
  const yours = list.rows
    .filter((r) => visible.some((v) => v.id === r.id))
    .reduce((sum, r) => sum + Math.round((r.my_share ?? r.total) * 100), 0);
  const currency = summary?.this_month.currency ?? "USD";
  const monthName = new Date().toLocaleDateString("en-US", { month: "long" });

  function applyView(view: SavedView) {
    const f = view.filters;
    setQuery(f.q ?? "");
    setCategory(f.category ?? "");
    setStatus(f.status === "extracted" ? "Needs review" : "Any status");
    const named = (Object.keys(SORTS) as SortName[]).find(
      (k) => SORTS[k].sort === f.sort && SORTS[k].order === f.order
    );
    setSort(named ?? "Newest first");
    if (f.start_date || f.end_date) {
      setRange("custom");
      setCustom([f.start_date ?? "", f.end_date ?? ""]);
    } else setRange("any");
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setProblem("");
    try {
      await action();
      invalidateSpending();
      setSelected([]);
      setBulk(null);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveView() {
    const name = viewName.trim();
    if (!name) return setProblem("Give the view a name.");
    try {
      await createSavedView(name, filters);
      invalidate("views");
      setViewName("");
      setShowFilters(false);
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  return (
    <>
      <main className="px-5 pb-32 pt-6">
        <Header
          eyebrow={
            summary
              ? `${monthName} · ${scanMoney(summary.this_month.total_spent, currency)} yours`
              : undefined
          }
          title="Activity"
          action={
            <button
              onClick={() => setShowFilters(true)}
              aria-label="Filter"
              className="ios-round-control grid h-10 w-10 place-items-center rounded-full"
            >
              <Icon name="tune" size={19} />
            </button>
          }
        />
        <div
          role="radiogroup"
          aria-label="Show"
          className="seg mt-6 grid grid-cols-3 rounded-full bg-black/[0.06] p-1 text-[12px] font-bold"
        >
          {(["everything", "mine", "shared"] as const).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={scope === option}
              onClick={() => setScope(option)}
              className={`rounded-full px-3 py-2.5 capitalize ${scope === option ? "seg-on bg-[#fffefa] shadow-sm" : "text-[#77776f]"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          {views.map((view) => (
            <span
              key={view.id}
              className="ios-chip flex min-h-9 shrink-0 items-center rounded-full pl-3 text-[11px] font-semibold"
            >
              <button onClick={() => applyView(view)}>{view.name}</button>
              <button
                aria-label={`Remove saved view ${view.name}`}
                onClick={async () => {
                  await deleteSavedView(view.id);
                  invalidate("views");
                }}
                className="grid h-9 w-8 place-items-center text-[#77776f]"
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowFilters(true)}
            className="min-h-9 shrink-0 rounded-full px-3 text-[11px] font-bold text-[#103e33]"
          >
            + Saved view
          </button>
        </div>
        <p className="mt-5 text-[11px] leading-relaxed text-[#77776f]">
          {scope === "everything"
            ? "Your receipts. Totals use your share after splits."
            : scope === "mine"
              ? "Receipts that aren't split: all yours."
              : "Your receipts split with other people. The amount shown is your share."}
        </p>
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#77776f]">
            {visible.length} of {list.total} expense{list.total === 1 ? "" : "s"} ·{" "}
            {scanMoney(yours / 100, currency)} yours
          </p>
          {list.error && (
            <p role="alert" className="rounded-[16px] bg-[#f7e9e3] p-4 text-[13px] text-[#a74132]">
              Couldn&apos;t load your activity. Check your connection and try again.
            </p>
          )}
          {visible.length > 0 ? (
            <Ticket className="rounded-[20px] px-4">
              {visible.map((r, i) => (
                <div key={r.id} className={`flex items-center gap-2 ${i ? "ios-divider" : ""}`}>
                  {selected.length > 0 && (
                    <input
                      aria-label={`Select ${r.merchant}`}
                      type="checkbox"
                      checked={selected.includes(r.id!)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(r.id!)
                            ? current.filter((id) => id !== r.id)
                            : [...current, r.id!]
                        )
                      }
                      className="h-5 w-5 shrink-0 accent-[#103e33]"
                    />
                  )}
                  <ReceiptRow item={r} onClick={() => openReceipt(r)} />
                </div>
              ))}
            </Ticket>
          ) : (
            !list.loading &&
            !list.error && (
              <p className="ios-surface rounded-[20px] p-4 text-[13px]">
                Nothing matches. Try another filter or date.
              </p>
            )
          )}
          <div className="mt-3 flex items-center justify-between">
            {visible.length > 0 && (
              <button
                onClick={() => setSelected(selected.length ? [] : visible.map((r) => r.id!))}
                className="min-h-10 text-[11px] font-bold text-[#103e33]"
              >
                {selected.length ? "Cancel selection" : "Select expenses"}
              </button>
            )}
            {list.hasMore && (
              <button
                onClick={() => list.loadMore()}
                className="min-h-10 text-[11px] font-bold text-[#103e33]"
              >
                Show more
              </button>
            )}
          </div>
        </div>
        {selected.length > 0 && (
          <div className="fixed inset-x-4 bottom-28 z-30 mx-auto flex max-w-[398px] items-center gap-2 rounded-[18px] bg-[#141816] p-3 text-white shadow-xl">
            <b className="flex-1 text-[12px]">{selected.length} selected</b>
            <button
              disabled={busy}
              onClick={() => setBulk("categorize")}
              className="min-h-10 rounded-full bg-white/10 px-3 text-[11px] font-bold"
            >
              Categorize
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(() =>
                  Promise.all(
                    list.rows
                      .filter((r) => selected.includes(r.id) && r.status === "extracted")
                      .map((r) => reviewReceipt(r.id, {}))
                  )
                )
              }
              className="min-h-10 rounded-full bg-white/10 px-3 text-[11px] font-bold"
            >
              Mark checked
            </button>
          </div>
        )}
        {problem && !showFilters && !bulk && (
          <p role="alert" className="mt-4 text-[13px] font-semibold text-[#a74132]">
            {problem}
          </p>
        )}
        {insight && (
          <section className="mt-8 rounded-[20px] bg-[#edf9b7] p-5">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#50713a]">
              {monthName} pattern
            </p>
            <h2 className="mt-2 text-[23px] font-semibold tracking-[-.04em]">{insight.title}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#526346]">{insight.body}</p>
          </section>
        )}
      </main>
      {bulk === "categorize" && (
        <DemoSheet
          title={`Categorize ${selected.length}`}
          subtitle="Moves them to one category everywhere: lists, budgets and insights."
          close={() => setBulk(null)}
        >
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                disabled={busy}
                onClick={() => run(() => bulkAction(selected, "categorize", c))}
                className="rounded-full bg-black/[0.05] py-3 text-[12px] font-bold"
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
          {problem && (
            <p role="alert" className="mt-4 text-[13px] font-semibold text-[#a74132]">
              {problem}
            </p>
          )}
        </DemoSheet>
      )}
      {showFilters && (
        <DemoSheet
          title="Filter activity"
          subtitle="Combine filters, then save the view if you use it often."
          close={() => setShowFilters(false)}
        >
          <label className="block text-[11px] font-bold">
            Search
            <input
              placeholder="Store or item"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-2 w-full rounded-[15px] border border-black/10 bg-black/[0.035] px-4 py-3.5 text-[13px] outline-none"
            />
          </label>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <label className="text-[11px] font-bold">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-2 w-full rounded-[14px] border border-black/10 bg-transparent p-3 text-[12px]"
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-bold">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortName)}
                className="mt-2 w-full rounded-[14px] border border-black/10 bg-transparent p-3 text-[12px]"
              >
                {(Object.keys(SORTS) as SortName[]).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-5 text-[11px] font-bold">Date</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {(
              [
                ["this", "This month"],
                ["last", "Last month"],
                ["custom", "Custom"],
                ["any", "Any time"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setRange(id)}
                aria-pressed={range === id}
                className={`rounded-full py-2.5 text-[11px] font-bold ${range === id ? "bg-[#103e33] text-white" : "bg-black/[0.05]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["From", "To"] as const).map((label, i) => (
                <label key={label} className="text-[11px] font-bold">
                  {label}
                  <input
                    type="date"
                    value={custom[i]}
                    onChange={(e) =>
                      setCustom((c) => (i ? [c[0], e.target.value] : [e.target.value, c[1]]))
                    }
                    className="mt-2 w-full rounded-[14px] border border-black/10 bg-transparent p-3 text-[12px]"
                  />
                </label>
              ))}
            </div>
          )}
          <p className="mt-5 text-[11px] font-bold">Status</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["Any status", "Needs review", "Split", "Unsplit"] as const).map((label) => (
              <button
                key={label}
                onClick={() => setStatus(label)}
                aria-pressed={status === label}
                className={`rounded-full px-3 py-2 text-[11px] font-bold ${status === label ? "bg-[#edf9b7]" : "border border-black/10"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowFilters(false)}
            className="mt-6 w-full rounded-full bg-[#103e33] py-3.5 text-[13px] font-bold text-white"
          >
            Show {list.loading ? "" : `${visible.length} `}expenses
          </button>
          <div className="mt-4 flex gap-2">
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="Name this view"
              aria-label="Saved view name"
              maxLength={60}
              className="min-w-0 flex-1 rounded-full border border-black/10 bg-black/[0.035] px-4 py-3 text-[13px] outline-none"
            />
            <button
              onClick={saveView}
              className="min-h-11 shrink-0 px-2 text-[12px] font-bold text-[#103e33]"
            >
              Save view
            </button>
          </div>
          {problem && (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-[#a74132]">
              {problem}
            </p>
          )}
        </DemoSheet>
      )}
    </>
  );
}
