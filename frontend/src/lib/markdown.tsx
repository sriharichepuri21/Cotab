import { Fragment, type ReactNode } from "react";

/**
 * A small markdown renderer for chat answers: paragraphs, **bold**, *italic*,
 * `code`, bullet and numbered lists, simple tables and headings.
 *
 * It builds React elements directly (never HTML strings), so nothing in an
 * answer can inject markup. It is written for text that is still streaming
 * in: a bold marker that hasn't been closed yet is hidden rather than shown
 * as stray asterisks, and a half-written table row renders as text until the
 * row is complete.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

function inline(text: string, key: string): ReactNode[] {
  // An unfinished "**" at the end of a streaming answer: hide the marker.
  const open = (text.match(/\*\*/g) ?? []).length % 2 === 1;
  const clean = open ? text.replace(/\*\*(?!.*\*\*)/, "") : text;
  return clean.split(INLINE).map((piece, i) => {
    const k = `${key}-${i}`;
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4)
      return (
        <strong key={k} className="font-semibold">
          {piece.slice(2, -2)}
        </strong>
      );
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2)
      return (
        <code key={k} className="rounded bg-ink/[0.06] px-1 font-mono text-[0.9em]">
          {piece.slice(1, -1)}
        </code>
      );
    if (piece.startsWith("*") && piece.endsWith("*") && piece.length > 2)
      return <em key={k}>{piece.slice(1, -1)}</em>;
    return <Fragment key={k}>{piece}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const AMOUNT = /^[-+]?[$€£₹]?\s?[\d.,]+%?$|^\*\*[-+]?[$€£₹]?[\d.,]+%?\*\*$/;

/** A column of amounts or counts, which reads best aligned right. */
function numeric(rows: string[][], col: number): boolean {
  const values = rows.map((r) => (r[col] ?? "").replace(/^(CA|A)\$/, "$")).filter(Boolean);
  return values.length > 0 && values.every((v) => AMOUNT.test(v));
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number }
  | { kind: "h"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ kind: "table", head, rows });
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      out.push({ kind: "h", text: h[1] });
      i++;
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].match(BULLET)![1]);
      out.push({ kind: "ul", items });
      continue;
    }
    const n = line.match(NUMBERED);
    if (n) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED.test(lines[i]))
        items.push(lines[i++].match(NUMBERED)![2]);
      out.push({ kind: "ol", items, start: Number(n[1]) });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !(TABLE_ROW.test(lines[i]) && TABLE_RULE.test(lines[i + 1] ?? ""))
    )
      para.push(lines[i++]);
    out.push({ kind: "p", lines: para });
  }
  return out;
}

/** Render a chat answer. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks(text).map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h":
            return (
              <p key={k} className="font-semibold">
                {inline(b.text, k)}
              </p>
            );
          case "ul":
            return (
              <ul key={k} className="flex list-disc flex-col gap-1 pl-5 marker:text-muted">
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, `${k}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol
                key={k}
                start={b.start}
                className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted"
              >
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, `${k}-${j}`)}</li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={k} className="-mx-1 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/15">
                      {b.head.map((c, j) => (
                        <th
                          key={j}
                          className={`px-1 py-1.5 font-semibold ${j > 0 && numeric(b.rows, j) ? "text-right" : ""}`}
                        >
                          {inline(c, `${k}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-line/70">
                        {row.map((c, j) => (
                          <td
                            key={j}
                            className={`px-1 py-1.5 ${j > 0 && numeric(b.rows, j) ? "text-right tabular-nums" : ""}`}
                          >
                            {inline(c, `${k}-${r}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={k}>
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}-${j}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
