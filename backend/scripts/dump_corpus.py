#!/usr/bin/env python3
"""Dump production receipts to local corpus for OCR measurement.

Reads production DATABASE_URL (and S3 credentials for image downloads) from
backend/.env.production — never committed, never read by the app itself.
Saves each receipt's image + expected.json to backend/corpus/{receipt_id}/.

Read-only: zero writes to the production database.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ── Resolve backend/.env.production into process env BEFORE touching settings ──
# The app's settings caches on first access via .env; the dump needs prod values,
# so we load the file manually with python-dotenv (already a transitive dep).
_backend_dir = Path(__file__).parent.parent
_env_file = _backend_dir / ".env.production"

if not _env_file.exists():
    print(
        f"ERROR: {_env_file} not found. Create it locally with your prod credentials."
    )
    sys.exit(1)

from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values(str(_env_file))
# Apply only if the key is not already present in os.environ (env vars win).
import os  # noqa: E402

for k, v in _env.items():
    if k and k not in os.environ:
        os.environ[k] = v

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

# Now safe to import app modules — they pick up the injected env values.
from app.config.settings import get_settings  # noqa: E402
from app.db import s3 as s3_mod  # noqa: E402
from app.models import Receipt  # noqa: E402

settings = get_settings()

# The user's email — we filter receipts to only this account.
TARGET_EMAIL = os.environ.get("CORPUS_OWNER_EMAIL", "")
if not TARGET_EMAIL:
    # fall back to asking
    TARGET_EMAIL = input("Corpus owner email (production): ").strip()

# NullPool: standalone script, no need to keep connections warm.
engine = create_engine(settings.database_url, poolclass=NullPool)
SessionLocal = sessionmaker(bind=engine)

CORPUS_DIR = _backend_dir / "corpus"
CORPUS_DIR.mkdir(exist_ok=True)


def main() -> None:
    db = SessionLocal()
    try:
        receipts = (
            db.query(Receipt)
            .filter(Receipt.deleted_at.is_(None), Receipt.user.has(email=TARGET_EMAIL))
            .order_by(Receipt.created_at)
            .all()
        )
        if not receipts:
            print(f"No receipts found for {TARGET_EMAIL}.")
            return

        dumped = 0
        total_bytes = 0
        skipped = []
        for r in receipts:
            rd = CORPUS_DIR / r.id
            rd.mkdir(exist_ok=True)

            # Image
            if not r.image_key:
                print(f"  SKIP {r.id} — no image_key", file=sys.stderr)
                skipped.append((r.id, "no image_key"))
                continue
            try:
                img_bytes = s3_mod.download_bytes(r.image_key)
                ext = Path(r.image_key).suffix or ".webp"
                (rd / f"image{ext}").write_bytes(img_bytes)
                total_bytes += len(img_bytes)
            except Exception as e:
                print(f"  SKIP {r.id} — image download failed: {e}", file=sys.stderr)
                skipped.append((r.id, f"image error: {e}"))
                continue

            # Ground truth JSON
            expected = {
                "receipt_id": r.id,
                "merchant": r.merchant,
                "merchant_raw": r.merchant_raw,
                "purchased_at": r.purchased_at.isoformat() if r.purchased_at else None,
                "total": r.total,
                "subtotal": r.subtotal,
                "tax": r.tax,
                "currency": r.currency,
                "category": r.category,
                "confidence": r.confidence,
                "status": r.status,
                "line_items": [
                    {
                        "description": li.description,
                        "quantity": li.quantity,
                        "unit_price": li.unit_price,
                        "total_price": li.total_price,
                    }
                    for li in r.line_items
                ],
            }
            (rd / "expected.json").write_text(json.dumps(expected, indent=2))
            dumped += 1

        print(f"\n✔ Dumped {dumped}/{len(receipts)} receipts")
        print(f"  Total image bytes: {total_bytes:,}")
        print(f"  Corpus dir: {CORPUS_DIR}")
        if skipped:
            print(f"  Skipped {len(skipped)}:")
            for reason, rid in skipped:
                print(f"    {rid} — {reason}")

        # List merchants seen
        merchants = sorted({r.merchant for r in receipts if r.merchant})
        print(f"  Merchants: {', '.join(merchants)}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
