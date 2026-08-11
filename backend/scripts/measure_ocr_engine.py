#!/usr/bin/env python3
"""OCR-engine measurement: run the row-reconstruction rule engine against the
local corpus and score against expected.json. No Gemini calls, no production
side effects. Bypasses the threshold gate entirely — measures raw capability.

Output: docs/phase2/results_ocr_v1.md
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_backend_dir = Path(__file__).parent.parent

from app.services import ocr_rules, ocr_service  # noqa: E402

CORPUS_DIR = _backend_dir / "corpus"
OUT_FILE = _backend_dir.parent / "docs" / "phase2" / "results_ocr_v1.md"
OUT_FILE.parent.mkdir(parents=True, exist_ok=True)


def _close(a: float, b: float, tol: float = 0.011) -> bool:
    return abs(a - b) <= tol


def _field_match(field: str, expected, got) -> bool:
    if expected is None and got is None:
        return True
    if expected is None or got is None:
        return False
    if field in ("total", "subtotal", "tax"):
        return _close(float(expected), float(got))
    if field == "merchant":
        return str(expected).strip().lower() == str(got).strip().lower()
    return str(expected) == str(got)


def main() -> None:
    receipts = sorted(d for d in CORPUS_DIR.iterdir() if d.is_dir())
    if not receipts:
        print(f"Corpus is empty at {CORPUS_DIR}. Run dump_corpus.py first.")
        sys.exit(1)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    fields = ["merchant", "total", "subtotal", "tax", "currency"]
    print(f"OCR rule engine ({ocr_rules.__name__})  ·  {now}")

    results = []
    for rdir in receipts:
        expected = json.loads((rdir / "expected.json").read_text())
        img_path = next(rdir.glob("image.*"))
        data = img_path.read_bytes()

        try:
            lines = ocr_service.ocr_image(data)
            ex = ocr_rules.extract_with_rules(lines)
            got = {
                "merchant": ex.merchant,
                "total": ex.total,
                "subtotal": ex.subtotal,
                "tax": ex.tax,
                "currency": ex.currency,
                "category": ex.category,
                "line_items": [
                    {
                        "description": li["description"],
                        "quantity": li["quantity"],
                        "unit_price": li["unit_price"],
                        "total_price": li["total_price"],
                    }
                    for li in ex.line_items
                ],
            }
            ok = True
        except Exception as e:
            got = {"error": str(e)}
            ok = False

        results.append(
            {
                "receipt_id": expected["receipt_id"],
                "merchant": expected.get("merchant"),
                "expected": expected,
                "got": got,
                "ok": ok,
            }
        )

    # Per-field accuracy
    field_pass = {f: 0 for f in fields}
    field_total = {f: 0 for f in fields}
    failures = []
    for r in results:
        exp, got = r["expected"], r["got"]
        for f in fields:
            field_total[f] += 1
            if r["ok"] and _field_match(f, exp.get(f), got.get(f)):
                field_pass[f] += 1
            if not r["ok"] or not _field_match(f, exp.get(f), got.get(f)):
                failures.append(
                    f"{r['receipt_id'][:8]}… {f}: expected={exp.get(f)!r} got={got.get(f)!r}"
                )
        # line-item count
        exp_li = len(exp.get("line_items") or [])
        got_li = len(got.get("line_items") or [])
        field_total["line_count"] = field_total.get("line_count", 0) + 1
        if r["ok"] and exp_li == got_li:
            field_pass["line_count"] = field_pass.get("line_count", 0) + 1

    report = f"""# OCR v1 — corpus measurement

**Date:** {now}  
**Algorithm:** row-reconstruction (`app.services.ocr_rules`) — generic engine only, no merchant packs  
**Corpus:** {len(results)} receipts ({', '.join(sorted({r['merchant'] for r in results if r['merchant']}))} merchants)

## Per-field accuracy

| Field | Pass | Total | % |
|---|---|---|---|
"""
    for f in fields + ["line_count"]:
        n = field_total.get(f, len(results))
        p = field_pass.get(f, 0)
        pct = (100 * p / n) if n else 0
        report += f"| {f} | {p} | {n} | {pct:.0f}% |\n"

    report += "\n## Per-receipt breakdown\n\n"
    for r in results:
        exp, got = r["expected"], r["got"]
        if not r["ok"]:
            report += (
                f"- **{r['merchant']}** — ERROR: {r['got'].get('error', 'unknown')}\n"
            )
            continue
        marks = []
        for f in fields:
            marks.append(
                f"{'✓' if _field_match(f, exp.get(f), got.get(f)) else '✗'} {f}"
            )
        exp_li = len(exp.get("line_items") or [])
        got_li = len(got.get("line_items") or [])
        marks.append(f"{'✓' if exp_li == got_li else '✗'} items({got_li}/{exp_li})")
        report += f"- **{r['merchant']}**: " + "  ".join(marks) + "\n"

    if failures:
        report += "\n## Failures\n\n"
        for f in failures[:20]:
            report += f"- `{f}`\n"

    OUT_FILE.write_text(report)
    print(f"\n✅ Report written to {OUT_FILE}")
    print(
        f"  merchant: {field_pass['merchant']}/{field_total['merchant']},  "
        f"total: {field_pass['total']}/{field_total['total']},  "
        f"items: {field_pass.get('line_count', 0)}/{len(results)} exact"
    )


if __name__ == "__main__":
    main()
