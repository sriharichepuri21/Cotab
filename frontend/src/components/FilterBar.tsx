"use client";

import { useEffect, useState } from "react";

import type { Facets, ReceiptFilters, SavedView } from "@/lib/api";

/**
 * Filter controls for the receipts list.
 *
 * State lives in the URL (the parent owns that); this component is controlled
 * and only reports changes upward. That is what makes a filtered list
 * shareable and survive a reload — and it is why saved views are just a stored
 * copy of the same query object.
 *
 * The text box is debounced locally so typing doesn't fire a request per
 * keystroke; every other control commits immediately.
 */

const FIELD =
  "min-h-11 rounded-tile border border-ink/10 bg-card px-3 text-sm font-medium text-ink outline-none focus:border-forest focus:ring-4 focus:ring-gold/60";

const chip = (on: boolean) =>
  `inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium transition ${
    on ? "bg-forest font-bold text-paper" : "bg-card font-semibold text-muted hover:text-ink"
  }`;

const STATUS_LABEL: Record<string, string> = {
  processing: "Reading",
  extracted: "To review",
  reviewed: "Checked",
  failed: "Couldn't read",
};

type DatePreset = "" | "week" | "month" | "quarter" | "year" | "custom";

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetDates(preset: Exclude<DatePreset, "" | "custom">) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "week") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  } else if (preset === "month") {
    start.setDate(1);
  } else if (preset === "quarter") {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  } else {
    start.setMonth(0, 1);
  }
  return { start_date: localDate(start), end_date: localDate(today) };
}

function selectedDatePreset(filters: ReceiptFilters): DatePreset {
  if (!filters.start_date && !filters.end_date) return "";
  for (const preset of ["week", "month", "quarter", "year"] as const) {
    const dates = presetDates(preset);
    if (filters.start_date === dates.start_date && filters.end_date === dates.end_date) {
      return preset;
    }
  }
  return "custom";
}

export function FilterBar({
  filters,
  facets,
  savedViews,
  onChange,
  onSaveView,
  onDeleteView,
  resultCount,
}: {
  filters: ReceiptFilters;
  facets: Facets | null;
  savedViews: SavedView[];
  onChange: (next: ReceiptFilters) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  resultCount: number;
}) {
  const [qLocal, setQLocal] = useState(filters.q ?? "");
  const [open, setOpen] = useState(false);

  // Keep the box in sync when filters change from outside (saved view, back
  // button) without clobbering what the user is mid-way through typing.
  useEffect(() => {
    setQLocal(filters.q ?? "");
  }, [filters.q]);

  useEffect(() => {
    if ((filters.q ?? "") === qLocal) return;
    const t = setTimeout(() => onChange({ ...filters, q: qLocal }), 300);
    return () => clearTimeout(t);
    // onChange/filters intentionally omitted: re-running on every parent render
    // would restart the debounce forever and the request would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  const set = (patch: Partial<ReceiptFilters>) => onChange({ ...filters, ...patch });

  const activeCount = Object.entries(filters).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== ""
  ).length;

  const preset = selectedDatePreset(filters);
  // Everything except search and the quick date chips lives behind "More".
  const moreCount = [
    filters.category,
    filters.merchant,
    filters.status,
    filters.min_amount,
    filters.max_amount,
    filters.sort,
    preset === "custom" ? "custom" : undefined,
  ].filter((v) => v !== undefined && v !== null && String(v).trim() !== "").length;

  return (
    <section className="mb-4">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search receipts</span>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            placeholder="Search stores and items"
            aria-label="Search receipts"
            className={`${FIELD.replace("rounded-tile", "rounded-full")} min-h-12 w-full pl-10 text-base`}
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`press min-h-12 shrink-0 rounded-full px-4 text-sm font-bold ${
            open || moreCount
              ? "bg-forest text-paper"
              : "bg-card shadow-[0_0_0_1px_rgb(12_17_14/0.08)]"
          }`}
        >
          Filters{moreCount ? ` (${moreCount})` : ""}
        </button>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ["", "All"],
            ["week", "This week"],
            ["month", "This month"],
            ["year", "This year"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={preset === value}
            onClick={() =>
              set(value ? presetDates(value) : { start_date: undefined, end_date: undefined })
            }
            className={`${chip(preset === value)} shrink-0`}
          >
            {label}
          </button>
        ))}
        {savedViews.map((v) => (
          <span key={v.id} className="inline-flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => onChange(v.filters)}
              className="inline-flex min-h-9 items-center rounded-l-full bg-gold pl-3.5 pr-2 text-sm font-medium"
            >
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => onDeleteView(v.id)}
              aria-label={`Delete saved view ${v.name}`}
              className="inline-flex min-h-9 items-center rounded-r-full bg-gold pl-1 pr-3 text-sm"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="rise mt-3 grid gap-2 rounded-card bg-card p-4 sm:grid-cols-2">
          <select
            value={filters.category ?? ""}
            onChange={(e) => set({ category: e.target.value || undefined })}
            aria-label="Category"
            className={FIELD}
          >
            <option value="">All categories</option>
            {(facets?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>

          <input
            value={filters.merchant ?? ""}
            onChange={(e) => set({ merchant: e.target.value || undefined })}
            placeholder="Store"
            aria-label="Merchant"
            list="receipt-merchant-list"
            className={FIELD}
          />
          <datalist id="receipt-merchant-list">
            {(facets?.merchants ?? []).map((merchant) => (
              <option key={merchant} value={merchant} />
            ))}
          </datalist>

          <select
            value={filters.status ?? ""}
            onChange={(e) => set({ status: e.target.value || undefined })}
            aria-label="Status"
            className={FIELD}
          >
            <option value="">Any status</option>
            {(facets?.statuses ?? []).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>

          <select
            value={`${filters.sort ?? "date"}:${filters.order ?? "desc"}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(":");
              set({ sort, order });
            }}
            aria-label="Sort"
            className={FIELD}
          >
            <option value="date:desc">Newest first</option>
            <option value="date:asc">Oldest first</option>
            <option value="amount:desc">Largest first</option>
            <option value="amount:asc">Smallest first</option>
            <option value="merchant:asc">Store A to Z</option>
          </select>

          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={filters.min_amount ?? ""}
              onChange={(e) => set({ min_amount: e.target.value || undefined })}
              placeholder="Min $"
              aria-label="Minimum amount"
              className={`${FIELD} w-full`}
            />
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={filters.max_amount ?? ""}
              onChange={(e) => set({ max_amount: e.target.value || undefined })}
              placeholder="Max $"
              aria-label="Maximum amount"
              className={`${FIELD} w-full`}
            />
          </div>

          <select
            value={preset === "quarter" ? "quarter" : preset === "custom" ? "custom" : ""}
            onChange={(e) => {
              const v = e.target.value as DatePreset;
              if (v === "quarter") set(presetDates("quarter"));
              else if (v === "custom")
                set({ start_date: localDate(new Date()), end_date: undefined });
              else set({ start_date: undefined, end_date: undefined });
            }}
            aria-label="Date range"
            className={FIELD}
          >
            <option value="">Other dates…</option>
            <option value="quarter">This quarter</option>
            <option value="custom">Pick dates</option>
          </select>

          {preset === "custom" && (
            <div className="flex gap-2 sm:col-span-2">
              <input
                type="date"
                value={filters.start_date ?? ""}
                onChange={(e) => set({ start_date: e.target.value || undefined })}
                aria-label="From date"
                className={`${FIELD} w-full`}
              />
              <input
                type="date"
                value={filters.end_date ?? ""}
                onChange={(e) => set({ end_date: e.target.value || undefined })}
                aria-label="To date"
                className={`${FIELD} w-full`}
              />
            </div>
          )}
        </div>
      )}

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted">
            {resultCount} match{resultCount === 1 ? "" : "es"}
          </span>
          <button
            type="button"
            onClick={() => onChange({})}
            className="min-h-9 font-semibold underline underline-offset-4"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Name this view, like Coffee this month");
              if (name && name.trim()) onSaveView(name.trim());
            }}
            className="min-h-9 font-semibold underline underline-offset-4"
          >
            Save as a view
          </button>
        </div>
      )}
    </section>
  );
}

export function BulkToolbar({
  count,
  categories,
  onCategorize,
  onDelete,
  onClear,
  busy,
}: {
  count: number;
  categories: string[];
  onCategorize: (category: string) => void;
  onDelete: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-tile bg-forest px-4 py-3 text-paper">
      <span className="text-sm font-semibold">{count} selected</span>
      <select
        defaultValue=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) {
            onCategorize(e.target.value);
            e.target.value = "";
          }
        }}
        aria-label="Apply category to selected"
        className={FIELD}
      >
        <option value="">Move to category…</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="min-h-11 rounded-full bg-rose px-4 text-sm font-semibold text-paper disabled:opacity-60"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto min-h-11 text-sm font-semibold underline underline-offset-4"
      >
        Clear
      </button>
    </div>
  );
}
