"""Cleaning up after a process that stopped part-way (a deploy, a crash).

Runs at start-up and once a day from the cron workflow:

- Tabby plans left half-done are put back (tabby_agent.recover_stale)
- forwarded emails left mid-read are marked so the person can check
  (inbound_processor.recover_stale)
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def run_all(db: Session) -> Dict[str, Any]:
    from app.services import inbound_processor, tabby_agent

    return {
        "tabby": tabby_agent.recover_stale(db),
        "emails": inbound_processor.recover_stale(db),
    }


def on_startup() -> None:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        result = run_all(db)
        if result["tabby"]["runs"] or result["emails"]:
            logger.warning("Recovered work a previous process left: %s", result)
    except Exception:
        logger.exception("Start-up recovery failed")
    finally:
        db.close()
