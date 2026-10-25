"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BulkToolbar, FilterBar } from "@/components/FilterBar";
import { CatAvatar } from "@/components/Tabby";
import { ErrorNote, Icon, PageHeader, PageSkeleton } from "@/components/ui";
import {
  bulkAction,
  CATEGORIES,
  createSavedView,
  deleteSavedView,
  type Receipt,
  type ReceiptFilters,
  type ReceiptPage,
  type SavedView,
} from "@/lib/api";
import { mutate, peek } from "@/lib/cache";
import {
  invalidateSpending,
  keys,
  useFacets,
  useReceiptPages,
  useSavedViews,
  useSummary,
} from "@/lib/data";
import { categoryLabel, categoryStyle, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";

const FILTER_KEYS: (keyof ReceiptFilters)[] = [
  "q",
  "category",
  "merchant",
  "status",
  "start_date",
  "end_date",
  "min_amount",
  "max_amount",
  "sort",
  "order",
];

/** The URL is the single source of truth for filter state, so a filtered list
 *  is shareable, survives reload, and works with the back button. */
function filtersFromParams(params: URLSearchParams): ReceiptFilters {
  const out: ReceiptFilters = {};
  FILTER_KEYS.forEach((k) => {
    const v = params.get(k);
    if (v) (out as Record<string, string>)[k] = v;
  });
  return out;
}

/** Status line under each purchase: where attention is needed, say so. */
function rowNote(r: Receipt): { text: string; tone: "muted" | "rose" } {
  if (r.status === "failed") return { text: "Couldn't read this one", tone: "rose" };
  if (r.status === "processing") return { text: "Reading every line…", tone: "muted" };
  const items = r.line_items?.length;
  const parts = [categoryLabel(r.category)];
  if (r.source === "tap") parts.push("Apple Pay");
  if (r.source === "email") parts.push("Email");
  if (r.source === "screenshot") parts.push("Screenshot");
  if (items) parts.push(`${items} item${items === 1 ? "" : "s"}`);
  if (r.status === "extracted") parts.push("to review");
  return { text: parts.join(", "), tone: "muted" };
}

function groupByDay(receipts: Receipt[]) {
  const groups: { label: string; total: number; rows: Receipt[] }[] = [];
  for (const r of receipts) {
    const label = dayLabel(r.purchased_at);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, total: 0, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
    if (r.status !== "failed") g.total += r.total;
  }
  return groups;
}

function Tab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => filtersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const filtersActive = Object.keys(filters).length > 0;

  const listQ = useReceiptPages(filters);
  const receipts = listQ.rows;
  const { data: summary } = useSummary(6);
  const monthTotal = summary
    ? money(summary.this_month.total_spent, summary.this_month.currency)
    : null;
  const { data: facets } = useFacets();
  const viewsQ = useSavedViews();
  const savedViews = viewsQ.data ?? [];

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");

  const applyFilters = useCallback(
    (next: ReceiptFilters) => {
      const p = new URLSearchParams();
      Object.entries(next).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== "") p.set(k, String(v));
      });
      const qs = p.toString();
      // replace, not push: typing in search shouldn't stack history entries.
      router.replace(qs ? `${routes.tab}?${qs}` : routes.tab, { scroll: false });
    },
    [router]
  );

  useEffect(() => setSelected(new Set()), [filters]);

  // A scan still being read (maybe started on another device): check back
  // until it has filled in.
  const reading = receipts.some((r) => r.status === "processing");
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(invalidateSpending, 4000);
    return () => clearInterval(timer);
  }, [reading]);

  const runBulk = useCallback(
    async (action: "categorize" | "delete", category?: string) => {
      if (selected.size === 0) return;
      const ids = Array.from(selected);
      const listKey = keys.receipts(filters);
      const before = peek<ReceiptPage>(listKey);
      // Show the result straight away; put it back if the server says no.
      mutate<ReceiptPage>(listKey, (page = { rows: [], total: 0 }) =>
        action === "delete"
          ? {
              rows: page.rows.filter((r) => !selected.has(r.id)),
              total: Math.max(0, page.total - selected.size),
            }
          : {
              ...page,
              rows: page.rows.map((r) =>
                selected.has(r.id) ? { ...r, category: category ?? r.category } : r
              ),
            }
      );
      setSelected(new Set());
      setSelecting(false);
      setBulkBusy(true);
      try {
        const res = await bulkAction(ids, action, category);
        setMessage(
          action === "delete"
            ? `Deleted ${res.updated} receipt${res.updated === 1 ? "" : "s"}.`
            : `Moved ${res.updated} to ${categoryLabel(category ?? "")}.`
        );
      } catch (e) {
        if (before) mutate(listKey, before);
        setMessage(`That didn't work: ${(e as Error).message}`);
      } finally {
        setBulkBusy(false);
        invalidateSpending();
      }
    },
    [selected, filters]
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groups = groupByDay(receipts);

  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-8 md:px-8 md:pt-10">
      <PageHeader
        back={{ href: routes.insights, label: "Insights" }}
        title="Receipts"
        sub={
          monthTotal ? (
            <>
              This month so far, <strong className="text-ink">{monthTotal}</strong>
            </>
          ) : undefined
        }
        action={
          receipts.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
              }}
              className="press min-h-10 rounded-full bg-card px-4 text-sm font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.06)]"
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : undefined
        }
      />

      {listQ.error && <ErrorNote>Couldn&apos;t load your tab: {listQ.error.message}</ErrorNote>}

      {listQ.loading && <PageSkeleton rows={7} />}

      <FilterBar
        filters={filters}
        facets={facets ?? null}
        savedViews={savedViews}
        resultCount={listQ.total}
        onChange={applyFilters}
        onSaveView={async (name) => {
          try {
            await createSavedView(name, filters);
            await viewsQ.refresh();
          } catch (e) {
            setMessage(`Couldn't save view: ${(e as Error).message}`);
          }
        }}
        onDeleteView={async (id) => {
          mutate<SavedView[]>(keys.views, (v = []) => v.filter((x) => x.id !== id));
          try {
            await deleteSavedView(id);
            await viewsQ.refresh();
          } catch (e) {
            setMessage(`Couldn't delete view: ${(e as Error).message}`);
          }
        }}
      />

      {selecting && (
        <BulkToolbar
          count={selected.size}
          categories={[...CATEGORIES]}
          busy={bulkBusy}
          onCategorize={(c) => runBulk("categorize", c)}
          onDelete={() => runBulk("delete")}
          onClear={() => setSelected(new Set())}
        />
      )}

      {message && (
        <p role="status" className="mb-4 text-sm text-muted">
          {message}
        </p>
      )}

      {!listQ.loading && receipts.length === 0 && !listQ.error && (
        <div className="mt-2 flex flex-col items-center rounded-card bg-card px-5 py-8 text-center">
          <CatAvatar
            choice={{ look: "hoodie", mood: filtersActive ? "hmm" : "hi", bg: "mood" }}
            size={72}
          />
          <p className="mt-3 font-extrabold">
            {filtersActive ? "Nothing matches these filters." : "Your tab is empty."}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtersActive
              ? "Try a different search or clear the filters."
              : "Tap Scan and Tabby will read your first receipt."}
          </p>
        </div>
      )}

      <div className="flex flex-col">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="mb-2">
            <div className="flex justify-between px-1 pb-2 pt-5 text-[13px] font-bold text-faint">
              <span>{g.label}</span>
              <span>{money(g.total)}</span>
            </div>
            <ul className="rounded-card bg-card px-4">
              {g.rows.map((r, i) => {
                const note = rowNote(r);
                const style = categoryStyle(r.category);
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-3 ${i ? "border-t border-line" : ""}`}
                  >
                    {selecting && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.merchant || "receipt"}`}
                        className="h-5 w-5 shrink-0 accent-[rgb(var(--c-forest))]"
                      />
                    )}
                    <Link
                      href={routes.receipt(r.id)}
                      className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3"
                    >
                      <span
                        className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[15px]"
                        style={
                          r.status === "failed"
                            ? { background: "#FCE6E9", color: "#C8373C" }
                            : { background: style.tile, color: style.ink }
                        }
                      >
                        <Icon
                          name={
                            r.status === "failed"
                              ? "error"
                              : r.status === "processing"
                                ? "hourglass_top"
                                : style.icon
                          }
                          fill
                          size={23}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold">
                          {r.status === "processing"
                            ? "New receipt"
                            : r.merchant || "Unreadable receipt"}
                        </span>
                        <span
                          className={`mt-0.5 block truncate text-[13px] ${note.tone === "rose" ? "font-semibold text-rose" : "text-faint"}`}
                        >
                          {note.text}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[15px] font-extrabold">
                          {r.status === "failed" || r.status === "processing"
                            ? "—"
                            : money(r.total, r.currency)}
                        </span>
                        {r.my_share != null && (
                          <span className="block text-[12px] font-bold text-faint">
                            yours {money(r.my_share, r.currency)}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {receipts.length > 0 && (
        <LoadMore
          shown={receipts.length}
          total={listQ.total}
          hasMore={listQ.hasMore}
          onMore={listQ.loadMore}
        />
      )}
    </main>
  );
}

/**
 * Loads the next page by itself when the bottom of the list comes into view,
 * with a button as the fallback (and for keyboard and screen-reader users).
 */
function LoadMore({
  shown,
  total,
  hasMore,
  onMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  onMore: () => Promise<void>;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const more = useCallback(async () => {
    if (busy || !hasMore) return;
    setBusy(true);
    setFailed(false);
    try {
      await onMore();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, hasMore, onMore]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || failed || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && more(), {
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, failed, more]);

  return (
    <div ref={sentinel} className="mt-6 flex flex-col items-center gap-3 pb-6 text-sm">
      <p className="font-semibold text-faint" aria-live="polite">
        {hasMore
          ? `Showing ${shown} of ${total} receipts`
          : `All ${total} receipt${total === 1 ? "" : "s"}`}
      </p>
      {hasMore && (
        <button
          type="button"
          onClick={more}
          disabled={busy}
          className="press min-h-11 rounded-full bg-card px-5 font-bold shadow-[0_0_0_1px_rgb(12_17_14/0.08)] disabled:opacity-60"
        >
          {busy ? "Loading…" : failed ? "Couldn't load. Try again" : "Load more"}
        </button>
      )}
    </div>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary, or `next build` fails the page.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
          <PageSkeleton />
        </main>
      }
    >
      <Tab />
    </Suspense>
  );
}
