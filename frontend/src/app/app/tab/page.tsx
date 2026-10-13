"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { BulkToolbar, FilterBar } from "@/components/FilterBar";
import { ErrorNote, PageHeader } from "@/components/ui";
import {
  ApiError,
  bulkAction,
  CATEGORIES,
  createSavedView,
  deleteSavedView,
  getFacets,
  getSummary,
  isAuthed,
  listReceipts,
  listSavedViews,
  type Facets,
  type Receipt,
  type ReceiptFilters,
  type SavedView,
} from "@/lib/api";
import { amount, categoryLabel, dayLabel, money } from "@/lib/format";
import { routes } from "@/lib/routes";
import { UPLOADED_EVENT } from "@/lib/upload";

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
  const items = r.line_items?.length;
  const parts = [categoryLabel(r.category)];
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

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [monthTotal, setMonthTotal] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const filters = useMemo(
    () => filtersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const filtersActive = Object.keys(filters).length > 0;

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push(routes.login);
        return true;
      }
      return false;
    },
    [router]
  );

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

  const refreshList = useCallback(async () => {
    try {
      setReceipts(await listReceipts(filters));
      setLoadError(null);
    } catch (e) {
      if (handleAuthError(e)) return;
      setLoadError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [filters, handleAuthError]);

  const refreshViews = useCallback(async () => {
    try {
      setSavedViews(await listSavedViews());
    } catch {
      setSavedViews([]);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed()) return;
    refreshViews();
    getFacets()
      .then(setFacets)
      .catch(() => setFacets(null));
    getSummary(1)
      .then((s) => setMonthTotal(money(s.this_month.total_spent, s.this_month.currency)))
      .catch(() => setMonthTotal(null));
  }, [refreshViews]);

  useEffect(() => {
    if (!isAuthed()) return;
    refreshList();
    setSelected(new Set());
  }, [refreshList]);

  useEffect(() => {
    const onUploaded = () => refreshList();
    window.addEventListener(UPLOADED_EVENT, onUploaded);
    return () => window.removeEventListener(UPLOADED_EVENT, onUploaded);
  }, [refreshList]);

  const runBulk = useCallback(
    async (action: "categorize" | "delete", category?: string) => {
      if (selected.size === 0) return;
      setBulkBusy(true);
      try {
        const res = await bulkAction(Array.from(selected), action, category);
        setMessage(`Updated ${res.updated} of ${res.requested}.`);
        setSelected(new Set());
        setSelecting(false);
        await refreshList();
      } catch (e) {
        if (handleAuthError(e)) return;
        setMessage(`That didn't work: ${(e as Error).message}`);
      } finally {
        setBulkBusy(false);
      }
    },
    [selected, refreshList, handleAuthError]
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
    <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <PageHeader
        title="Your tab"
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
              className="min-h-11 px-2 text-sm font-semibold underline underline-offset-4"
            >
              {selecting ? "Done" : "Select"}
            </button>
          ) : undefined
        }
      />

      {loadError && <ErrorNote>Couldn&apos;t load your tab: {loadError}</ErrorNote>}

      <FilterBar
        filters={filters}
        facets={facets}
        savedViews={savedViews}
        resultCount={receipts.length}
        onChange={applyFilters}
        onSaveView={async (name) => {
          try {
            await createSavedView(name, filters);
            await refreshViews();
          } catch (e) {
            setMessage(`Couldn't save view: ${(e as Error).message}`);
          }
        }}
        onDeleteView={async (id) => {
          try {
            await deleteSavedView(id);
            await refreshViews();
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

      {loaded && receipts.length === 0 && !loadError && (
        <div className="rounded-card border border-dashed border-line px-5 py-10 text-center">
          <p className="font-semibold">
            {filtersActive ? "Nothing matches these filters." : "Your tab is empty."}
          </p>
          <p className="mt-1 text-sm text-muted">
            {filtersActive
              ? "Try a different search or clear the filters."
              : "Tap the gold Scan button to add your first receipt."}
          </p>
        </div>
      )}

      <div className="flex flex-col">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="mb-2">
            <div className="flex justify-between border-b border-ink pb-2 pt-5 font-mono text-xs uppercase text-muted">
              <span>{g.label}</span>
              <span>{amount(g.total)}</span>
            </div>
            <ul>
              {g.rows.map((r) => {
                const note = rowNote(r);
                return (
                  <li key={r.id} className="flex items-center gap-3 border-b border-line/60">
                    {selecting && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.merchant || "receipt"}`}
                        className="h-5 w-5 shrink-0 accent-[rgb(var(--c-ink))]"
                      />
                    )}
                    <Link
                      href={routes.receipt(r.id)}
                      className="flex min-h-16 flex-1 items-center justify-between gap-3 py-3 hover:bg-ink/[0.03]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {r.merchant || "Unreadable receipt"}
                        </span>
                        <span
                          className={`block truncate text-sm ${note.tone === "rose" ? "text-rose" : "text-muted"}`}
                        >
                          {note.text}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold">
                        {r.status === "failed" ? "—" : amount(r.total)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary, or `next build` fails the page.
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted">Loading your tab…</main>}>
      <Tab />
    </Suspense>
  );
}
