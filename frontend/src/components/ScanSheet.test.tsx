import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScanSheet } from "./ScanSheet";

afterEach(cleanup);

function paste(files: File[]) {
  const event = new Event("paste", { cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  window.dispatchEvent(event);
  return event;
}

describe("ScanSheet", () => {
  it("takes a pasted screenshot (Cmd+V) straight in", () => {
    const onPicked = vi.fn();
    render(<ScanSheet open onClose={() => {}} pick={() => {}} onPicked={onPicked} />);
    const shot = new File(["png"], "order.png", { type: "image/png" });
    const event = paste([shot]);
    expect(onPicked).toHaveBeenCalledWith([shot]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves pasted text alone, and listens only while open", () => {
    const onPicked = vi.fn();
    const { rerender } = render(
      <ScanSheet open onClose={() => {}} pick={() => {}} onPicked={onPicked} />
    );
    expect(paste([]).defaultPrevented).toBe(false);
    rerender(<ScanSheet open={false} onClose={() => {}} pick={() => {}} onPicked={onPicked} />);
    paste([new File(["png"], "late.png", { type: "image/png" })]);
    expect(onPicked).not.toHaveBeenCalled();
  });
});
