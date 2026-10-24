"use client";

/**
 * One hook per thing the app shows, all backed by the shared cache. Pages read
 * through these instead of calling the API directly, so a second visit to any
 * screen is instant and two screens never fetch the same data twice.
 */

import {
  filtersToParams,
  getCaptureStatus,
  getInbox,
  getFacets,
  getNetBalances,
  getReceipt,
  getReceiptPrices,
  getSplitSummary,
  getSummary,
  listBudgets,
  listInsights,
  listReceiptPage,
  listSavedViews,
  listSplitGroups,
  me,
  monthWrap,
  myPeople,
  tabbyActivity,
  tabbyMemories,
  tabbyRules,
  type Receipt,
  type ReceiptFilters,
  type ReceiptPage,
} from "@/lib/api";
import { invalidate, mutate, peek, prefetch, useCached } from "@/lib/cache";

export const keys = {
  me: "me",
  summary: (months: number) => `summary:${months}`,
  /** The Tab's list for these filters: every page loaded so far, plus the total. */
  receipts: (f: ReceiptFilters = {}) => `receipts:${filtersToParams(f).toString()}`,
  /** The first few receipts for these filters, for previews like Home. */
  preview: (f: ReceiptFilters, n: number) =>
    `receipts:preview:${n}:${filtersToParams(f).toString()}`,
  receipt: (id: string) => `receipt:${id}`,
  prices: (id: string) => `prices:${id}`,
  insights: "insights",
  facets: "facets",
  views: "views",
  budgets: "budgets",
  groups: "groups",
  people: "groups:people",
  nets: "nets",
  group: (id: string) => `group:${id}`,
  capture: "capture",
  inbox: "inbox",
  tabbyActivity: "tabby:activity",
  tabbyMemories: "tabby:memories",
  tabbyRules: "tabby:rules",
  wrap: (month: string) => `tabby:wrap:${month}`,
};

export const useMe = () => useCached(keys.me, me);
export const useSummary = (months = 6) => useCached(keys.summary(months), () => getSummary(months));
/** Receipts per page on the Tab. Small enough to load instantly on a phone. */
export const PAGE_SIZE = 50;

/** Lists carry each receipt in full, so remember each one for its own page too. */
function prime(rows: Receipt[]) {
  for (const r of rows) mutate(keys.receipt(r.id), r);
  return rows;
}

/**
 * (Re)load the Tab's list. After a change, refetch as many rows as were
 * already showing, so someone 200 receipts down doesn't get thrown back to
 * the first 50.
 */
function loadList(f: ReceiptFilters) {
  const shown = peek<ReceiptPage>(keys.receipts(f))?.rows.length ?? 0;
  const limit = Math.min(500, Math.max(PAGE_SIZE, Math.ceil(shown / PAGE_SIZE) * PAGE_SIZE));
  return listReceiptPage(f, limit).then((page) => {
    prime(page.rows);
    return page;
  });
}

/**
 * Every receipt matching `f`, a page at a time. `loadMore` appends the next
 * page; `hasMore` says whether there is one.
 */
export function useReceiptPages(f: ReceiptFilters = {}) {
  const key = keys.receipts(f);
  const q = useCached(key, () => loadList(f));
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const hasMore = rows.length < total;

  const loadMore = async () => {
    const current = peek<ReceiptPage>(key);
    if (!current || current.rows.length >= current.total) return;
    const next = await listReceiptPage(f, PAGE_SIZE, current.rows.length);
    prime(next.rows);
    mutate<ReceiptPage>(key, (page) => {
      const have = page?.rows ?? [];
      const seen = new Set(have.map((r) => r.id));
      return {
        rows: [...have, ...next.rows.filter((r) => !seen.has(r.id))],
        total: next.total,
      };
    });
  };

  return { ...q, rows, total, hasMore, loadMore };
}

/** Just the first `n` receipts for `f`, plus how many there are in all. */
export const useReceiptPreview = (f: ReceiptFilters, n: number) =>
  useCached(keys.preview(f, n), () =>
    listReceiptPage(f, n).then((page) => {
      prime(page.rows);
      return page;
    })
  );

export const useReceipt = (id: string) => useCached(keys.receipt(id), () => getReceipt(id));
export const usePrices = (id: string) => useCached(keys.prices(id), () => getReceiptPrices(id));
export const useInsights = () => useCached(keys.insights, listInsights);
export const useFacets = () => useCached(keys.facets, getFacets);
export const useSavedViews = () => useCached(keys.views, listSavedViews);
export const useBudgets = () => useCached(keys.budgets, listBudgets);
export const useGroups = () => useCached(keys.groups, listSplitGroups);
export const usePeople = () => useCached(keys.people, myPeople);
export const useNetBalances = () => useCached(keys.nets, getNetBalances);
export const useGroup = (id: string) => useCached(keys.group(id), () => getSplitSummary(id));
export const useCaptureStatus = () => useCached(keys.capture, getCaptureStatus);
export const useInbox = () => useCached(keys.inbox, getInbox);
export const useTabbyActivity = () => useCached(keys.tabbyActivity, tabbyActivity);
export const useTabbyMemories = () => useCached(keys.tabbyMemories, tabbyMemories);
export const useTabbyRules = () => useCached(keys.tabbyRules, tabbyRules);
export const useMonthWrap = (month: string) =>
  useCached(keys.wrap(month), () => monthWrap(month || undefined));

/** The receipt lists Home and the Tab show with no filters applied. */
export const HOME_LIST: ReceiptFilters = { sort: "date", order: "desc" };
export const FAILED_LIST: ReceiptFilters = { status: "failed" };
/** How many recent receipts Home asks for (it shows five that were read). */
export const HOME_PREVIEW = 8;

/** Anything that changes spending (a scan, an edit, a delete) touches these. */
export function invalidateSpending() {
  invalidate("receipts", "receipt", "prices", "summary", "facets", "budgets", "insights");
}

export function invalidateSplits() {
  invalidate("groups", "nets", "group");
}

// Friends add splits from their own phones: look again on coming back to the app.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") invalidateSplits();
  });

/** What Tabby did, remembers and its rules (anything Tabby does touches these). */
export function invalidateTabby() {
  invalidate("tabby", "me", "insights");
}

/**
 * Quietly load what the other tabs need, once the current page has settled,
 * so the first tap on Tab or House shows data instead of a spinner.
 */
export function prefetchTabs() {
  prefetch(keys.summary(6), () => getSummary(6));
  prefetch(keys.preview(HOME_LIST, HOME_PREVIEW), () => listReceiptPage(HOME_LIST, HOME_PREVIEW));
  prefetch(keys.receipts({}), () => loadList({}));
  prefetch(keys.groups, listSplitGroups);
  prefetch(keys.nets, getNetBalances);
  prefetch(keys.budgets, listBudgets);
}
