import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listReceiptPage = vi.fn();
vi.mock("@/lib/api", () => ({
  filtersToParams: (f: Record<string, string>) => new URLSearchParams(f),
  listReceiptPage: (...a: unknown[]) => listReceiptPage(...a),
}));

import { clearCache, peek } from "./cache";
import { keys, PAGE_SIZE, useReceiptPages } from "./data";

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${from + i}`, total: 1 }));

beforeEach(() => {
  clearCache();
  listReceiptPage.mockReset();
});

describe("receipt pages", () => {
  it("loads the first page, then the rest on request, until all are there", async () => {
    listReceiptPage.mockImplementation(async (_f, limit: number, offset = 0) => ({
      rows: rows(offset, Math.min(limit, 120 - offset)),
      total: 120,
    }));
    const { result } = renderHook(() => useReceiptPages({}));
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE_SIZE));
    expect(result.current.total).toBe(120);
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());
    await act(() => result.current.loadMore());
    expect(result.current.rows).toHaveLength(120);
    expect(new Set(result.current.rows.map((r) => r.id)).size).toBe(120);
    expect(result.current.hasMore).toBe(false);
    expect(listReceiptPage).toHaveBeenLastCalledWith({}, PAGE_SIZE, 100);
  });

  it("remembers each receipt so it opens instantly", async () => {
    listReceiptPage.mockResolvedValue({ rows: rows(0, 3), total: 3 });
    const { result } = renderHook(() => useReceiptPages({}));
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(peek(keys.receipt("r1"))).toEqual({ id: "r1", total: 1 });
  });

  it("does not ask for more when everything is already loaded", async () => {
    listReceiptPage.mockResolvedValue({ rows: rows(0, 3), total: 3 });
    const { result } = renderHook(() => useReceiptPages({}));
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    await act(() => result.current.loadMore());
    expect(listReceiptPage).toHaveBeenCalledTimes(1);
  });
});
