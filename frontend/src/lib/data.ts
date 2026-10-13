"use client";

/**
 * One hook per thing the app shows, all backed by the shared cache. Pages read
 * through these instead of calling the API directly, so a second visit to any
 * screen is instant and two screens never fetch the same data twice.
 */

import {
  filtersToParams,
  getFacets,
  getNetBalances,
  getReceipt,
  getSplitSummary,
  getSummary,
  listBudgets,
  listInsights,
  listReceipts,
  listSavedViews,
  listSplitGroups,
  me,
  type ReceiptFilters,
} from "@/lib/api";
import { invalidate, mutate, prefetch, useCached } from "@/lib/cache";

export const keys = {
  me: "me",
  summary: (months: number) => `summary:${months}`,
  receipts: (f: ReceiptFilters = {}) => `receipts:${filtersToParams(f).toString()}`,
  receipt: (id: string) => `receipt:${id}`,
  insights: "insights",
  facets: "facets",
  views: "views",
  budgets: "budgets",
  groups: "groups",
  nets: "nets",
  group: (id: string) => `group:${id}`,
};

export const useMe = () => useCached(keys.me, me);
export const useSummary = (months = 6) => useCached(keys.summary(months), () => getSummary(months));
/** Lists carry each receipt in full, so remember each one for its own page too. */
function listAndPrime(f: ReceiptFilters) {
  return listReceipts(f).then((rows) => {
    for (const r of rows) mutate(keys.receipt(r.id), r);
    return rows;
  });
}

export const useReceipts = (f: ReceiptFilters = {}) =>
  useCached(keys.receipts(f), () => listAndPrime(f));
export const useReceipt = (id: string) => useCached(keys.receipt(id), () => getReceipt(id));
export const useInsights = () => useCached(keys.insights, listInsights);
export const useFacets = () => useCached(keys.facets, getFacets);
export const useSavedViews = () => useCached(keys.views, listSavedViews);
export const useBudgets = () => useCached(keys.budgets, listBudgets);
export const useGroups = () => useCached(keys.groups, listSplitGroups);
export const useNetBalances = () => useCached(keys.nets, getNetBalances);
export const useGroup = (id: string) => useCached(keys.group(id), () => getSplitSummary(id));

/** The receipt lists Home and the Tab show with no filters applied. */
export const HOME_LIST: ReceiptFilters = { sort: "date", order: "desc" };
export const FAILED_LIST: ReceiptFilters = { status: "failed" };

/** Anything that changes spending (a scan, an edit, a delete) touches these. */
export function invalidateSpending() {
  invalidate("receipts", "receipt", "summary", "facets", "budgets", "insights");
}

export function invalidateSplits() {
  invalidate("groups", "nets", "group");
}

/**
 * Quietly load what the other tabs need, once the current page has settled,
 * so the first tap on Tab or House shows data instead of a spinner.
 */
export function prefetchTabs() {
  prefetch(keys.summary(6), () => getSummary(6));
  prefetch(keys.receipts(HOME_LIST), () => listAndPrime(HOME_LIST));
  prefetch(keys.receipts({}), () => listAndPrime({}));
  prefetch(keys.groups, listSplitGroups);
  prefetch(keys.nets, getNetBalances);
  prefetch(keys.budgets, listBudgets);
}
