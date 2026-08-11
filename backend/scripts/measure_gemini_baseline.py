#!/usr/bin/env python3
"""Gemini baseline measurement: run existing extract_receipt_from_image against
the local corpus and score against expected.json.

Burns real Gemini quota (1 call per receipt). Expects backend/.env.production
to be loaded (same file dump_corpus.py uses).

Output: docs/phase2/baseline_gemini.md
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_backend_dir = Path(__file__).parent.parent

# Load .env.production exactly like dump_corpus.py does.
from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values(str(_backend_dir / ".env.production"))
for k, v in _env.items():
    if k and k not in os.environ:
        os.environ[k] = v

from app.config.settings import get_settings  # noqa: E402
from app.services import gemini_service  # noqa: E402

settings = get_settings()
if not settings.gemini_api_key:
    print("ERROR: GEMINI_API_KEY missing from production env.")
    sys.exit(1)

CORPUS_DIR = _backend_dir / "corpus"
OUT_FILE = _backend_dir.parent / "docs" / "phase2" / "baseline_gemini.md"
OUT_FILE.parent.mkdir(parents=True, exist_ok=True)


def _close(a: float, b: float, tol: float = 0.011) -> bool:
    return abs(a - b) <= tol


def _fail(field: str, expected, got) -> bool:
    label = "PASS" if _field_match(field, expected, got) else "FAIL"
    return f"{field}: {label}"


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


def _serialize_extraction(ext) -> dict:
    return {
        "merchant": ext.merchant,
        "merchant_raw": ext.merchant_raw,
        "total": ext.total,
        "subtotal": ext.subtotal,
        "tax": ext.tax,
        "currency": ext.currency,
        "category": ext.category,
        "purchased_at": ext.date,
        "confidence": ext.confidence,
        "line_items": [
            {
                "description": li.description,
                "quantity": li.quantity,
                "unit_price": li.unit_price,
                "total_price": li.total_price,
            }
            for li in ext.line_items
        ],
    }


def main() -> None:
    receipts = sorted(d for d in CORPUS_DIR.iterdir() if d.is_dir())
    if not receipts:
        print(f"Corpus is empty at {CORPUS_DIR}. Run dump_corpus.py first.")
        sys.exit(1)

    model = settings.gemini_model
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"Gemini model: {model}  ·  {now}")

    results = []
    for rdir in receipts:
        expected = json.loads((rdir / "expected.json").read_text())
        img_path = next(rdir.glob("image.*"))
        data = img_path.read_bytes()

        try:
            ext = gemini_service.extract_receipt_from_image(data, "image/webp")
            got = _serialize_extraction(ext)
        except Exception as e:
            got = {"error": str(e)[:200]}
            ext = None

        results.append(
            {
                "receipt_id": expected["receipt_id"],
                "merchant": expected.get("merchant"),
                "expected": expected,
                "got": got,
                "ok": ext is not None,
            }
        )

    # Build the report
    fields = ["merchant", "total", "subtotal", "tax", "currency"]
    # per-field counts
    field_pass = {f: 0 for f in fields}
    field_total = {f: 0 for f in fields}
    line_count_ok = 0
    any_rows = 0
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
        if r["ok"] and exp_li == got_li:
            field_pass["line_count"] = field_pass.get("line_count", 0) + 1
            field_total["line_count"] = field_total.get("line_count", 0) + 1
            line_count_ok += 1
        any_rows += 1
        if "line_count" not in field_total:
            field_total["line_count"] = len(results)

    report = f"""# Gemini Baseline — corpus measurement

**Date:** {now}  
**Model:** {model}  
**Corpus:** {len(results)} receipts ({', '.join(sorted({r['merchant'] for r in results if r['merchant']}))} merchants)  
**Engine:** `gemini_service.extract_receipt_from_image` (direct call, not HTTP)

> Note: 1 API call per receipt ({len(results)} total calls this run).

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
            report += f"- **{r['receipt_id'][:8]}…** {r['merchant']} — ERROR: {r['got'].get('error', 'unknown')}\n"
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
        f"  Overall — merchant: {field_pass['merchant']}/{field_total['merchant']}, "
        f"total: {field_pass['total']}/{field_total['total']}, "
        f"items: {field_pass.get('line_count',0)}/{len(results)} exact"
    )


if __name__ == "__main__":
    main()
