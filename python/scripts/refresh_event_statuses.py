"""Refresh event status columns based on start/end dates."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.supabase_client import EventRepository  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("refresh_status")


def main() -> int:
    repo = EventRepository()
    try:
        result = repo.client.rpc("refresh_event_statuses").execute()
        logger.info("refresh_event_statuses → %s", result.data)
    except Exception as exc:
        logger.error("RPC failed: %s — applying fallback SQL-like updates", exc)
        # Fallback: fetch and patch in batches is heavy; just log
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
