import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCache, invalidate, load, mutate, peek, useCached } from "./cache";

beforeEach(() => clearCache());

describe("cache", () => {
  it("shares one request between everyone asking at the same time", async () => {
    const fetcher = vi.fn(async () => [1, 2, 3]);
    const [a, b] = await Promise.all([load("k", fetcher), load("k", fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(peek("k")).toEqual([1, 2, 3]);
  });

  it("shows cached data at once on a second visit, without refetching while fresh", async () => {
    const fetcher = vi.fn(async () => "fresh");
    await load("page", fetcher);
    const { result } = renderHook(() => useCached("page", fetcher));
    expect(result.current.data).toBe("fresh");
    expect(result.current.loading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("applies optimistic changes immediately to anyone showing the data", async () => {
    await load("list", async () => ["a", "b"]);
    const { result } = renderHook(() => useCached<string[]>("list", async () => ["a", "b"]));
    act(() => mutate<string[]>("list", (rows = []) => rows.filter((r) => r !== "a")));
    expect(result.current.data).toEqual(["b"]);
  });

  it("refetches data someone is looking at when it is invalidated", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const { result } = renderHook(() => useCached("receipts:x", fetcher));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => invalidate("receipts"));
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("forgets everything on sign-out so the next person never sees it", async () => {
    await load("me", async () => ({ email: "a@b.c" }));
    clearCache();
    expect(peek("me")).toBeUndefined();
  });

  it("reports an error instead of loading forever", async () => {
    const { result } = renderHook(() =>
      useCached("bad", async () => {
        throw new Error("nope");
      })
    );
    await waitFor(() => expect(result.current.error?.message).toBe("nope"));
    expect(result.current.loading).toBe(false);
  });
});
