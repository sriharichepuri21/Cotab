import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { LineItem, PriceMemory } from "@/lib/api";

import { PricedLines, PriceTabby } from "./PriceMemory";

afterEach(cleanup);

const line = (id: string, description: string, total: number, extra = {}): LineItem => ({
  id,
  description,
  quantity: 1,
  unit_price: total,
  total_price: total,
  ...extra,
});

const memory: PriceMemory = {
  receipt_id: "r",
  store: "Costco",
  currency: "USD",
  compared: 2,
  trip_change: 0.3,
  tabby: { mood: "hmm", text: "Kirkland cage-free eggs went up $0.30 since Oct 3." },
  items: [
    {
      key: "c:637598",
      line_ids: ["e"],
      name: "Kirkland cage-free eggs",
      code: "637598",
      size_qty: null,
      size_unit: null,
      quantity: 1,
      lines: 1,
      price: 3.99,
      discounted: false,
      status: "up",
      last_price: 3.69,
      last_date: "2026-10-03",
      usual_price: 3.69,
      lowest_price: 3.49,
      times: 2,
      change: 0.3,
      history: [
        { receipt_id: "a", date: "2026-09-06", price: 3.49, quantity: 1 },
        { receipt_id: "b", date: "2026-10-03", price: 3.69, quantity: 1 },
      ],
    },
    {
      key: "c:1224482",
      line_ids: ["p1", "p2"],
      name: "Gopi paneer",
      code: "1224482",
      size_qty: null,
      size_unit: null,
      quantity: 2,
      lines: 2,
      price: 9.99,
      discounted: false,
      status: "same",
      more_than_usual: true,
      usual_quantity: 1,
      last_price: 9.99,
      last_date: "2026-10-03",
      usual_price: 9.99,
      lowest_price: 9.99,
      times: 2,
      change: 0,
      history: [],
    },
    {
      key: "c:1908636",
      line_ids: ["k"],
      name: "PINKMULTI",
      code: "1908636",
      size_qty: null,
      size_unit: null,
      quantity: 1,
      lines: 1,
      price: 5.97,
      discounted: false,
      status: "first",
      history: [],
    },
  ],
};

const lines = [
  line("e", "KS CAGE FREE", 3.99, { item_code: "637598", item_name: "Kirkland cage-free eggs" }),
  line("p1", "GOPI PANEER", 9.99, { item_code: "1224482" }),
  line("p2", "GOPI PANEER", 9.99, { item_code: "1224482" }),
  line("k", "PINKMULTI", 5.97, { item_code: "1908636" }),
];

describe("price memory on a receipt", () => {
  it("says what changed and puts the product number under the clean name", () => {
    render(<PricedLines lines={lines} memory={memory} />);
    expect(screen.getByText("Kirkland cage-free eggs")).toBeTruthy();
    expect(screen.getByText("637598 · KS CAGE FREE")).toBeTruthy();
    expect(screen.getByText(/\+\$0\.30 since Oct 3/)).toBeTruthy();
    expect(screen.getByText("Your usual price")).toBeTruthy();
    expect(screen.getByText(/×2 today · usually 1/)).toBeTruthy();
    // A badge only on the first of repeated lines, none for a first purchase.
    expect(screen.getAllByText("Your usual price")).toHaveLength(1);
  });

  it("opens the earlier visits for an item", () => {
    render(<PricedLines lines={lines} memory={memory} />);
    fireEvent.click(screen.getByRole("button", { name: /Kirkland cage-free eggs/ }));
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("$3.49")).toBeTruthy();
    expect(screen.getByText(/Bought here 2 times before/)).toBeTruthy();
  });

  it("shows Tabby's line and the trip total in plain words", () => {
    render(<PriceTabby memory={memory} />);
    expect(screen.getByRole("status").textContent).toContain("went up $0.30");
    expect(screen.getByText(/cost \$0\.30 more than last time/)).toBeTruthy();
  });
});
