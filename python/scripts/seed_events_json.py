"""events.json → Supabase 초기 시드 (dedupe_key upsert, 옛 ID는 legacy_id로 보존)."""

from __future__ import annotations

import json
import logging
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.supabase_client import EventRepository  # noqa: E402
from models import (  # noqa: E402
    EventAmenities,
    EventCategory,
    EventStatus,
    NormalizedEvent,
    TargetAgeGroup,
)
from regions import detect_district, detect_region  # noqa: E402
from timeutil import now_utc  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("seed")

EVENTS_JSON = ROOT / "src" / "data" / "events.json"
BATCH = 80


def to_event(row: dict) -> NormalizedEvent | None:
    try:
        age = row.get("target_age_group")
        amenities = row.get("amenities") or {}
        region = row.get("region") or detect_region(row.get("address"))
        if not region:
            raise ValueError("region unknown")
        return NormalizedEvent(
            title=row["title"],
            category=EventCategory(row["category"]),
            description=row.get("description"),
            start_date=date.fromisoformat(str(row["start_date"])[:10]),
            end_date=date.fromisoformat(str(row["end_date"])[:10]),
            location_name=row["location_name"],
            address=row["address"],
            latitude=row.get("latitude"),
            longitude=row.get("longitude"),
            region=region,
            district=row.get("district") or detect_district(region, row.get("address")),
            is_family_friendly=bool(row.get("is_family_friendly")),
            target_age_group=TargetAgeGroup(age) if age else None,
            amenities=EventAmenities(
                parking=bool(amenities.get("parking")),
                stroller=bool(amenities.get("stroller")),
                nursing_room=bool(amenities.get("nursing_room")),
            ),
            booking_required=bool(row.get("booking_required")),
            price_info=row.get("price_info"),
            thumbnail_url=row.get("thumbnail_url"),
            official_link=row.get("official_link"),
            tags=row.get("tags") or [],
            place_types=row.get("place_types") or [],
            # status는 모델에서 KST 날짜로 다시 계산된다
            status=EventStatus.ONGOING,
            source="seed_json",
            source_id=row.get("id"),
            legacy_id=row.get("id"),
        )
    except Exception as exc:
        logger.warning("skip %s: %s", row.get("title"), exc)
        return None


def main() -> int:
    events_raw = json.loads(EVENTS_JSON.read_text(encoding="utf-8"))
    parsed = [ev for row in events_raw if (ev := to_event(row))]
    logger.info("Seeding %s / %s events", len(parsed), len(events_raw))

    repo = EventRepository()
    for i in range(0, len(parsed), BATCH):
        chunk = parsed[i : i + BATCH]
        repo.upsert_events(chunk)
        logger.info("upserted batch %s–%s", i + 1, i + len(chunk))

    try:
        repo.client.rpc("refresh_event_statuses").execute()
        logger.info("refreshed event statuses")
    except Exception as exc:
        logger.warning("status refresh skipped: %s", exc)

    logger.info("done at %s", now_utc().isoformat())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
