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
  "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

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
    if (
      filters.start_date === dates.start_date &&
      filters.end_date === dates.end_date
    ) {
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

  const set = (patch: Partial<ReceiptFilters>) =>
    onChange({ ...filters, ...patch });

  const activeCount = Object.entries(filters).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== ""
  ).length;

  return (
    <section className="sticky top-2 z-20 mb-4 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder="Search merchants and items…"
          aria-label="Search receipts"
          className={`${FIELD} min-w-[200px] flex-1`}
        />

        <select
          value={filters.category ?? ""}
          onChange={(e) => set({ category: e.target.value || undefined })}
          aria-label="Category"
          className={FIELD}
        >
          <option value="">All categories</option>
          {(facets?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <input
          value={filters.merchant ?? ""}
          onChange={(e) => set({ merchant: e.target.value || undefined })}
          placeholder="Merchant"
          aria-label="Merchant"
          list="receipt-merchant-list"
          className={`${FIELD} min-w-[140px]`}
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
              {s}
            </option>
          ))}
        </select>

        <select
          value={selectedDatePreset(filters)}
          onChange={(e) => {
            const preset = e.target.value as DatePreset;
            if (!preset) {
              set({ start_date: undefined, end_date: undefined });
            } else if (preset === "custom") {
              set({ start_date: localDate(new Date()), end_date: undefined });
            } else {
              set(presetDates(preset));
            }
          }}
          aria-label="Date range"
          className={FIELD}
        >
          <option value="">Any date</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
          <option value="year">This year</option>
          <option value="custom">Custom</option>
        </select>

        {selectedDatePreset(filters) === "custom" && (
          <>
            <input
              type="date"
              value={filters.start_date ?? ""}
              onChange={(e) => set({ start_date: e.target.value || undefined })}
              aria-label="From date"
              className={FIELD}
            />
            <input
              type="date"
              value={filters.end_date ?? ""}
              onChange={(e) => set({ end_date: e.target.value || undefined })}
              aria-label="To date"
              className={FIELD}
            />
          </>
        )}

        <input
          type="number"
          min={0}
          value={filters.min_amount ?? ""}
          onChange={(e) => set({ min_amount: e.target.value || undefined })}
          placeholder="Min"
          aria-label="Minimum amount"
          className={`${FIELD} w-20`}
        />
        <input
          type="number"
          min={0}
          value={filters.max_amount ?? ""}
          onChange={(e) => set({ max_amount: e.target.value || undefined })}
          placeholder="Max"
          aria-label="Maximum amount"
          className={`${FIELD} w-20`}
        />

        <select
          value={`${filters.sort ?? "date"}:${filters.order ?? "desc"}`}
          onChange={(e) => {
            const [sort, order] = e.target.value.split(":");
            set({ sort, order });
          }}
          aria-label="Sort"
          className={FIELD}
        >
          <option value="date:desc">Newest</option>
          <option value="date:asc">Oldest</option>
          <option value="amount:desc">Largest</option>
          <option value="amount:asc">Smallest</option>
          <option value="merchant:asc">Merchant A–Z</option>
        </select>

        {activeCount > 0 && (
          <button
            onClick={() => onChange({})}
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <span className="text-sm text-gray-500">
          {resultCount} result{resultCount === 1 ? "" : "s"}
        </span>

        {savedViews.map((v) => (
          <span
            key={v.id}
            className="group inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1 text-sm"
          >
            <button
              onClick={() => onChange(v.filters)}
              className="font-medium text-gray-700 hover:text-blue-700"
            >
              {v.name}
            </button>
            <button
              onClick={() => onDeleteView(v.id)}
              aria-label={`Delete saved view ${v.name}`}
              className="rounded-full px-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
            >
              ×
            </button>
          </span>
        ))}

        {activeCount > 0 && (
          <button
            onClick={() => {
              const name = window.prompt("Name this view (e.g. Coffee this month)");
              if (name && name.trim()) onSaveView(name.trim());
            }}
            className="rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-700"
          >
            + Save view
          </button>
        )}
      </div>
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
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
      <span className="text-sm font-medium text-blue-900">
        {count} selected
      </span>
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
        className={`${FIELD} bg-white`}
      >
        <option value="">Set category…</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        onClick={onDelete}
        disabled={busy}
        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        Delete
      </button>
      <button
        onClick={onClear}
        className="ml-auto text-sm font-medium text-blue-700 hover:text-blue-900"
      >
        Clear selection
      </button>
    </div>
  );
}
