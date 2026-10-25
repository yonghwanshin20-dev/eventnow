"""좌표가 없는 행사에 카카오 지오코딩으로 위도·경도를 채운다.

기본: src/data/events.json 갱신. --db 를 주면 Supabase events 도 갱신.
결과는 data/geocode_cache.json 에 캐시되어 재실행 시 API를 다시 부르지 않는다.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geocode import KakaoGeocoder  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill_geocode")

EVENTS_JSON = ROOT / "src" / "data" / "events.json"


def backfill_json(geo: KakaoGeocoder, path: Path) -> int:
    rows = json.loads(path.read_text(encoding="utf-8"))
    filled = 0
    for row in rows:
        if row.get("latitude") is not None and row.get("longitude") is not None:
            continue
        coords = geo.geocode(row.get("address"), row.get("location_name"))
        if coords:
            row["latitude"], row["longitude"] = coords
            filled += 1
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    logger.info("events.json: filled %s / %s missing", filled, sum(1 for r in rows if r.get("latitude") is None) + filled)
    return filled


def backfill_db(geo: KakaoGeocoder) -> int:
    from db.supabase_client import EventRepository

    repo = EventRepository()
    resp = (
        repo.client.table("events")
        .select("id,address,location_name")
        .is_("latitude", "null")
        .limit(5000)
        .execute()
    )
    filled = 0
    for row in resp.data or []:
        coords = geo.geocode(row.get("address"), row.get("location_name"))
        if not coords:
            continue
        repo.client.table("events").update(
            {"latitude": coords[0], "longitude": coords[1]}
        ).eq("id", row["id"]).execute()
        filled += 1
    logger.info("Supabase: filled %s / %s missing", filled, len(resp.data or []))
    return filled


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", action="store_true", help="Supabase events 도 갱신")
    parser.add_argument("--no-json", action="store_true", help="events.json 은 건드리지 않음")
    args = parser.parse_args(argv)

    with KakaoGeocoder() as geo:
        if not args.no_json:
            backfill_json(geo, EVENTS_JSON)
        if args.db:
            backfill_db(geo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
