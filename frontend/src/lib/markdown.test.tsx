import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { blocks, Markdown } from "./markdown";

afterEach(cleanup);

describe("chat markdown", () => {
  it("renders bold amounts, lists and paragraphs", () => {
    const { container } = render(
      <Markdown
        text={"You spent **$412.30** this month.\n\n- Groceries **$180.00**\n- Dining $96.10"}
      />
    );
    expect(container.querySelector("strong")?.textContent).toBe("$412.30");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders a table with amounts aligned right", () => {
    const { container } = render(
      <Markdown
        text={"| Store | Spent |\n|---|---|\n| Corner Market | $60.50 |\n| Shell | $55.00 |"}
      />
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("td.text-right")?.textContent).toBe("$60.50");
  });

  it("hides a bold marker that hasn't closed yet while streaming", () => {
    const { container } = render(<Markdown text={"You spent **$41"} />);
    expect(container.textContent).toBe("You spent $41");
  });

  it("never turns text into markup", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("keeps a half-written table as plain text", () => {
    expect(blocks("| Store | Spent |").map((b) => b.kind)).toEqual(["p"]);
  });

  it("numbers lists from where they start", () => {
    const { container } = render(<Markdown text={"1. Scan\n2. Review"} />);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("1");
  });
});
