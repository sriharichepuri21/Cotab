import { describe, expect, it } from "vitest";

import { lineSplitter } from "./api";

describe("chat stream lines", () => {
  it("joins lines split across chunks and skips blanks", () => {
    const got: string[] = [];
    const s = lineSplitter((l) => got.push(l));
    s.push('{"type":"delta","te');
    s.push('xt":"Hi"}\n\n{"type":"do');
    s.push('ne","session_id":"s1"}');
    expect(got).toEqual(['{"type":"delta","text":"Hi"}']);
    s.end();
    expect(got[1]).toBe('{"type":"done","session_id":"s1"}');
  });
});
