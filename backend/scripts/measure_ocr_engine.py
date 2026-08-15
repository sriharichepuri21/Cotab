#!/usr/bin/env python3
"""OCR-engine measurement: run the row-reconstruction rule engine against the
local corpus and score against expected.json. No Gemini calls, no production
side effects. Bypasses the threshold gate entirely — measures raw capability.

Output: docs/phase2/results_ocr_v2.md
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_backend_dir = Path(__file__).parent.parent

from app.services import ocr_packs, ocr_rules, ocr_service  # noqa: E402

CORPUS_DIR = _backend_dir / "corpus"
OUT_FILE = _backend_dir.parent / "docs" / "phase2" / "results_ocr_v2.md"
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


def _match_items(expected: list, got: list) -> tuple:
    """Greedily pair extracted items to expected ones.

    Exact-count equality alone is a misleading metric: nine correct items out of
    ten scores the same as zero, and ten wrong items score the same as ten right
    ones. Pairing on price (with description overlap as the tiebreak) gives
    recall and precision, which is what a canary decision actually needs.
    """
    exp = list(expected or [])
    remaining = list(got or [])
    matched = 0
    for e in exp:
        e_price = round(float(e.get("total_price") or 0), 2)
        e_words = {
            w for w in str(e.get("description") or "").upper().split() if len(w) > 2
        }
        best, best_score = None, -1.0
        for g in remaining:
            if round(float(g.get("total_price") or 0), 2) != e_price:
                continue
            g_words = {
                w for w in str(g.get("description") or "").upper().split() if len(w) > 2
            }
            overlap = len(e_words & g_words) / max(len(e_words), 1) if e_words else 0.0
            if overlap > best_score:
                best, best_score = g, overlap
        if best is not None:
            remaining.remove(best)
            matched += 1
    return matched, len(exp), len(got or [])


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
            # Use the same pack-aware path as the future production extractor:
            # when a merchant fingerprint matches, anchor merchant+category and let
            # ocr_rules handle the rest of the fields.
            pack = ocr_packs.detect_pack(lines)
            if pack:
                ex = ocr_packs.extract_with_pack(pack, lines)
            else:
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
    item_matched = item_expected = item_got = 0
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
        m, n_exp, n_got = _match_items(exp.get("line_items"), got.get("line_items"))
        r["item_matched"], r["item_expected"], r["item_got"] = m, n_exp, n_got
        item_matched += m
        item_expected += n_exp
        item_got += n_got

    report = f"""# OCR v2.4 — corpus measurement

**Date:** {now}  
**Algorithm:** row-reconstruction + typo-tolerant labels + merchant packs + regional currency + OCR-damage recovery  
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

    recall = (100 * item_matched / item_expected) if item_expected else 0
    precision = (100 * item_matched / item_got) if item_got else 0
    report += f"""
## Line items (per-item, not just count)

| Metric | Value |
|---|---|
| matched | {item_matched} |
| expected | {item_expected} |
| extracted | {item_got} |
| recall | {recall:.0f}% |
| precision | {precision:.0f}% |

Matched = same price and best description overlap. Count-equality alone hides
whether the items are the *right* ones.
"""
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
        marks.append(
            f"{'✓' if exp_li == got_li else '✗'} "
            f"items({r.get('item_matched', 0)}✓/{got_li}got/{exp_li}exp)"
        )
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
        f"items: {field_pass.get('line_count', 0)}/{len(results)} exact-count,  "
        f"recall {recall:.0f}%  precision {precision:.0f}%"
    )


if __name__ == "__main__":
    main()
