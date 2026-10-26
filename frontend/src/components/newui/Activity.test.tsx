import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bulkAction = vi.fn();
const createSavedView = vi.fn();
vi.mock("@/lib/api", () => ({
  CATEGORIES: ["groceries", "dining"],
  bulkAction: (...a: unknown[]) => bulkAction(...a),
  createSavedView: (...a: unknown[]) => createSavedView(...a),
  deleteSavedView: vi.fn(),
  reviewReceipt: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn() }));

const pages = vi.fn();
const receipt = (id: string, merchant: string, total: number, my_share: number | null) => ({
  id,
  merchant,
  total,
  my_share,
  currency: "USD",
  category: "dining",
  status: "reviewed",
  line_items: [],
  purchased_at: null,
});
const ROWS = [receipt("a", "Costco", 77.57, 25.86), receipt("b", "Blue Bottle", 11.62, null)];
vi.mock("@/lib/data", () => ({
  invalidateSpending: vi.fn(),
  useInsights: () => ({ data: [] }),
  useSavedViews: () => ({ data: [] }),
  useSummary: () => ({ data: { this_month: { total_spent: 37.48, currency: "USD" } } }),
  useReceiptPages: (f: unknown) => {
    pages(f);
    return { rows: ROWS, total: 2, hasMore: false, loading: false, loadMore: vi.fn() };
  },
}));

import { Activity, rangeDates } from "./Activity";

beforeEach(() => {
  pages.mockReset();
  bulkAction.mockReset();
  createSavedView.mockReset();
});
afterEach(cleanup);

const lastQuery = () => pages.mock.calls.at(-1)?.[0];

describe("Activity", () => {
  it("knows this month and last month", () => {
    const oct24 = new Date(2026, 9, 24);
    expect(rangeDates("this", oct24)).toEqual(["2026-10-01", undefined]);
    expect(rangeDates("last", oct24)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(rangeDates("any", oct24)).toEqual([undefined, undefined]);
  });

  it("lists your receipts and totals your share", () => {
    render(<Activity openReceipt={vi.fn()} />);
    expect(screen.getByText(/2 of 2 expenses · \$37\.48 yours/)).toBeTruthy();
    expect(lastQuery()).toMatchObject({ sort: "date", order: "desc" });
  });

  it("splits Mine from Shared by whether a receipt is split", () => {
    render(<Activity openReceipt={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "shared" }));
    expect(screen.queryByText("Blue Bottle")).toBeNull();
    expect(screen.getByText("Costco")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "mine" }));
    expect(screen.queryByText("Costco")).toBeNull();
  });

  it("sends search, category and status to the server", () => {
    render(<Activity openReceipt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByPlaceholderText("Store or item"), { target: { value: "milk" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "dining" } });
    fireEvent.click(screen.getByRole("button", { name: "Needs review" }));
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));
    expect(lastQuery()).toEqual({
      q: "milk",
      category: "dining",
      status: "extracted",
      start_date: undefined,
      end_date: undefined,
      sort: "date",
      order: "desc",
    });
  });

  it("saves the current filters as a named view", async () => {
    createSavedView.mockResolvedValue({});
    render(<Activity openReceipt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByPlaceholderText("Store or item"), { target: { value: "milk" } });
    fireEvent.change(screen.getByLabelText("Saved view name"), { target: { value: "Milk runs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() =>
      expect(createSavedView).toHaveBeenCalledWith(
        "Milk runs",
        expect.objectContaining({ q: "milk" })
      )
    );
  });

  it("categorizes the selected expenses together", async () => {
    bulkAction.mockResolvedValue({});
    render(<Activity openReceipt={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Categorize" }));
    const sheet = screen.getByText("Categorize 2").closest("section")!;
    fireEvent.click(within(sheet).getByRole("button", { name: "Groceries" }));
    await waitFor(() =>
      expect(bulkAction).toHaveBeenCalledWith(["a", "b"], "categorize", "groceries")
    );
  });
});
