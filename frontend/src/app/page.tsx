"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { BudgetBar } from "@/components/BudgetBar";
import { BudgetHealth, DashboardCards } from "@/components/DashboardCards";
import { EmptyState } from "@/components/EmptyState";
import { BulkToolbar, FilterBar } from "@/components/FilterBar";
import { SpendCharts } from "@/components/SpendCharts";
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
  logout,
  me,
  sendChat,
  uploadReceipt,
  type DashboardSummary,
  type Facets,
  type BudgetState,
  type Receipt,
  type ReceiptFilters,
  type SavedView,
  type User,
} from "@/lib/api";

/**
 * Client-side compress before upload. Two goals: (1) upload is fast on mobile
 * data, (2) the image is small enough for the vision call but retains enough
 * detail to read receipt text. Target ~1MB — NOT a hard cap: this is a quality
 * knob, and the app uploads whatever comes out (only the server's 5MB ceiling
 * can refuse). Phone photos are 12–24MP, so we step down dimensions+quality
 * toward the target instead of assuming one pass is enough.
 */
const COMPRESS_TARGET_BYTES = 1024 * 1024;

async function compressImage(file: File): Promise<Blob> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Failed to load image"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error("No canvas context");
  }

  const encode = (maxDim: number, quality: number) =>
    new Promise<Blob>((res, rej) => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/webp",
        quality
      );
    });

  let best = await encode(1600, 0.85);
  if (best.size <= COMPRESS_TARGET_BYTES) {
    URL.revokeObjectURL(url);
    return best;
  }
  for (const [maxDim, quality] of [
    [1400, 0.8],
    [1200, 0.75],
    [1000, 0.7],
  ] as const) {
    const b = await encode(maxDim, quality);
    if (b.size < best.size) best = b;
    if (best.size <= COMPRESS_TARGET_BYTES) break;
  }
  URL.revokeObjectURL(url);
  return best;
}

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

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [budgetToast, setBudgetToast] = useState<BudgetState[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const filters = useMemo(
    () => filtersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const filtersActive = Object.keys(filters).length > 0;

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
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
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          p.set(k, String(v));
        }
      });
      const qs = p.toString();
      // replace, not push: typing in the search box shouldn't stack a history
      // entry per keystroke-debounce.
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router]
  );

  const refreshList = useCallback(async () => {
    try {
      setReceipts(await listReceipts(filters));
      setLoadError(null);
    } catch (e) {
      if (handleAuthError(e)) return;
      // Surface this: a silent failure renders as an empty account.
      setLoadError((e as Error).message);
    }
  }, [filters, handleAuthError]);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await getSummary(6));
    } catch (e) {
      if (!handleAuthError(e)) {
        // A broken dashboard shouldn't take the receipts list down with it.
        setSummary(null);
      }
    }
  }, [handleAuthError]);

  const refreshViews = useCallback(async () => {
    try {
      setSavedViews(await listSavedViews());
    } catch {
      setSavedViews([]);
    }
  }, []);

  // Boot: identity first, then everything that depends on being signed in.
  useEffect(() => {
    if (!isAuthed()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const u = await me();
        if (!u.intent) {
          router.push("/welcome");
          return;
        }
        setUser(u);
        await Promise.all([refreshSummary(), refreshViews()]);
        try {
          setFacets(await getFacets());
        } catch {
          setFacets(null); // dropdowns degrade to "All"; not worth failing over
        }
      } catch (e) {
        if (!handleAuthError(e)) setLoadError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // Runs once on mount; filter-driven reloads are the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-query whenever the URL filters change.
  useEffect(() => {
    if (!isAuthed()) return;
    refreshList();
    setSelected(new Set());
  }, [refreshList]);

  const onUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setMessage("Compressing…");
      try {
        const blob = await compressImage(file);
        setMessage(`Uploading ${Math.round(blob.size / 1024)}KB…`);
        const r = await uploadReceipt(blob);
        setMessage(`Uploaded — status: ${r.status}`);
        // Show the toast with the upload that caused it, not on the next render.
        if (r.budget_alerts?.length) setBudgetToast(r.budget_alerts);
        await Promise.all([refreshList(), refreshSummary()]);
      } catch (e) {
        if (handleAuthError(e)) return;
        setMessage(`Upload failed: ${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    },
    [refreshList, refreshSummary, handleAuthError]
  );

  const runBulk = useCallback(
    async (action: "categorize" | "delete", category?: string) => {
      if (selected.size === 0) return;
      setBulkBusy(true);
      try {
        const res = await bulkAction(Array.from(selected), action, category);
        setMessage(`Updated ${res.updated} of ${res.requested} receipts.`);
        setSelected(new Set());
        await Promise.all([refreshList(), refreshSummary()]);
      } catch (e) {
        if (handleAuthError(e)) return;
        setMessage(`Bulk action failed: ${(e as Error).message}`);
      } finally {
        setBulkBusy(false);
      }
    },
    [selected, refreshList, refreshSummary, handleAuthError]
  );

  const onChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const q = chatInput;
    setChatLog((l) => [...l, `You: ${q}`]);
    setChatInput("");
    try {
      const d = await sendChat(q, sessionId);
      setSessionId(d.session_id);
      setChatLog((l) => [...l, `Assistant: ${d.message}`]);
    } catch (e) {
      if (handleAuthError(e)) return;
      setChatLog((l) => [...l, `Error: ${(e as Error).message}`]);
    }
  }, [chatInput, sessionId, handleAuthError]);

  const onLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }, [router]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = receipts.length > 0 && selected.size === receipts.length;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  // The "scan your first receipt" prompt is only right for a genuinely empty
  // account. With filters applied, zero rows means "nothing matched" — telling
  // someone with 40 receipts to scan their first one would be nonsense.
  const showEmptyState = receipts.length === 0 && !loadError && !filtersActive;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ReceiptWise</h1>
            {user && (
              <p className="text-sm text-gray-500">Signed in as {user.email}</p>
            )}
          </div>
          <button
            onClick={onLogout}
            className="text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            Log out
          </button>
        </header>

        {loadError && (
          <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Couldn&apos;t load receipts: {loadError}
          </p>
        )}

        {budgetToast.length > 0 && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-amber-900">
                {budgetToast.length === 1
                  ? "Budget alert"
                  : `${budgetToast.length} budget alerts`}
              </p>
              <button
                onClick={() => setBudgetToast([])}
                aria-label="Dismiss budget alerts"
                className="text-amber-700 hover:text-amber-900"
              >
                ×
              </button>
            </div>
            <ul className="space-y-3">
              {budgetToast.map((b) => (
                <li key={b.budget_id}>
                  <BudgetBar state={b} compact />
                </li>
              ))}
            </ul>
            <Link
              href="/budgets"
              className="mt-3 inline-block text-sm font-medium text-amber-900 underline"
            >
              Manage budgets
            </Link>
          </div>
        )}

        {summary && !showEmptyState && (
          <>
            <DashboardCards summary={summary} />
            <SpendCharts summary={summary} />
            <BudgetHealth summary={summary} />
          </>
        )}

        {showEmptyState ? (
          <EmptyState
            intent={user?.intent ?? null}
            onFile={onUpload}
            busy={uploading}
            message={message}
          />
        ) : (
          <>
            <section className="mb-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-900">
                Scan a receipt
              </h2>
              <label className="inline-block cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
                {uploading ? "Working…" : "Choose photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) =>
                    e.target.files?.[0] && onUpload(e.target.files[0])
                  }
                />
              </label>
              {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
            </section>

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

            <BulkToolbar
              count={selected.size}
              categories={[...CATEGORIES]}
              busy={bulkBusy}
              onCategorize={(c) => runBulk("categorize", c)}
              onDelete={() => runBulk("delete")}
              onClear={() => setSelected(new Set())}
            />

            <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected ? new Set() : new Set(receipts.map((r) => r.id))
                      )
                    }
                    aria-label="Select all receipts"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Receipts
                </label>
                <button
                  onClick={refreshList}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Refresh
                </button>
              </div>

              {receipts.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No receipts match these filters.
                </p>
              ) : (
                <ul className="text-sm">
                  {receipts.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 border-b border-gray-100 last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.merchant || "receipt"}`}
                        className="h-4 w-4 shrink-0 rounded border-gray-300"
                      />
                      <Link
                        href={`/receipts/${r.id}`}
                        className="-mx-2 flex flex-1 justify-between rounded px-2 py-2 transition-colors hover:bg-gray-50"
                      >
                        <span className="truncate text-gray-900">
                          {r.merchant || "(unparsed)"}{" "}
                          <span className="text-gray-400">— {r.category}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-900">
                          {r.currency} {r.total.toFixed(2)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Chat with your data
          </h2>
          <div className="mb-3 h-48 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            {chatLog.length === 0 ? (
              <p className="text-gray-400">
                Ask things like &ldquo;how much did I spend on groceries this
                month?&rdquo;
              </p>
            ) : (
              chatLog.map((m, i) => (
                <p key={i} className="mb-1 whitespace-pre-wrap">
                  {m}
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onChat()}
              placeholder="Ask about your spending…"
            />
            <button
              onClick={onChat}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Send
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary, or `next build` fails the page
  // with a "should be wrapped in a suspense boundary" prerender error.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">Loading…</p>
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
