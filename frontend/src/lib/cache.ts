"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * A small in-memory cache shared by every page, so moving between tabs shows
 * what was already loaded straight away and refreshes it quietly behind the
 * scenes (stale-while-revalidate).
 *
 * - Identical requests made at the same time share one network call.
 * - `mutate` changes cached data immediately, for updates that should appear
 *   before the server confirms them.
 * - `invalidate` marks data as out of date after a change, so the next reader
 *   (or anyone showing it now) fetches it again.
 * - Everything is dropped on sign-out, so one person's data never shows for
 *   the next.
 */

type Entry = { data: unknown; at: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const fetchers = new Map<string, () => Promise<unknown>>();

/** Data younger than this is shown without refetching on a page visit. */
const FRESH_MS = 15_000;

function emit(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, fn: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/** Fetch once for everyone asking for `key` right now, and remember the result. */
export function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  fetchers.set(key, fetcher);
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      emit(key);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Warm the cache in the background; failures are ignored. */
export function prefetch<T>(key: string, fetcher: () => Promise<T>): void {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return;
  load(key, fetcher).catch(() => undefined);
}

/** Replace cached data now (optimistic update). Pass a function to derive it. */
export function mutate<T>(key: string, next: T | ((current: T | undefined) => T)): void {
  const current = store.get(key)?.data as T | undefined;
  const data =
    typeof next === "function" ? (next as (c: T | undefined) => T)(current) : (next as T);
  store.set(key, { data, at: Date.now() });
  emit(key);
}

/**
 * Mark every key starting with one of `prefixes` as stale. Keys someone is
 * looking at right now are refetched at once; the rest refetch when next shown.
 */
export function invalidate(...prefixes: string[]): void {
  for (const key of Array.from(store.keys())) {
    if (!prefixes.some((p) => key === p || key.startsWith(`${p}:`))) continue;
    const entry = store.get(key)!;
    store.set(key, { ...entry, at: 0 });
    const fetcher = fetchers.get(key);
    if (fetcher && listeners.get(key)?.size) load(key, fetcher).catch(() => undefined);
  }
}

export function clearCache(): void {
  store.clear();
  inflight.clear();
  fetchers.clear();
}

export type Cached<T> = {
  data: T | undefined;
  error: Error | null;
  /** True only when there is nothing to show yet. */
  loading: boolean;
  refresh: () => Promise<T | undefined>;
};

/**
 * Read `key`, showing cached data immediately and refreshing it if it is
 * older than a few seconds. Pass `null` as the key to wait (e.g. until a
 * dependency is known).
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>): Cached<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [error, setError] = useState<Error | null>(null);

  const data = useSyncExternalStore(
    useCallback((fn) => (key ? subscribe(key, fn) : () => undefined), [key]),
    () => (key ? (store.get(key)?.data as T | undefined) : undefined),
    () => undefined
  );

  const refresh = useCallback(async () => {
    if (!key) return undefined;
    try {
      const result = await load(key, () => fetcherRef.current());
      setError(null);
      return result;
    } catch (e) {
      setError(e as Error);
      return undefined;
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    fetchers.set(key, () => fetcherRef.current());
    const hit = store.get(key);
    if (!hit || Date.now() - hit.at >= FRESH_MS) refresh();
  }, [key, refresh]);

  return { data, error, loading: data === undefined && !error, refresh };
}
