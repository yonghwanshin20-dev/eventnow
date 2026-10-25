"""수집 → 스테이징 → 변경 감지 → 정제 → 검증 → 지오코딩 → 저장 오케스트레이터.

기본(키 없음·무료): kfes(+팝업) 수집 → 규칙 기반 정제 → src/data/events.json 저장(git 커밋).
키를 넣으면 자동으로 확장: TourAPI·서울시·네이버 수집, Claude 정제, Supabase 저장, 카카오 지오코딩.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from config import settings
from models import NormalizedEvent, RawRecord
from timeutil import now_utc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pipeline")

ALLOWED_SOURCES = {
    "kfes", "culture", "seoulportal", "mcst", "city", "public", "tour", "popup", "web", "seoul",
}
# 키 없이 동작하는 소스만 기본값. 키가 필요한 소스는 키가 있을 때 auto 로 추가된다.
# kfes: 축제 달력 / culture: 문화포털 전시·아동·체험 / seoulportal: 서울문화포털(자치구 행사)
# mcst: 문화체육관광부 지역축제(전국 시·군) / city: 시·군청 연간 행사 일정표 / popup: 팝업스토어
# public: 공공데이터포털 표준데이터(지자체·문화재단이 등록한 축제·행사, 좌표 포함)
KEYLESS_SOURCES = "kfes,culture,seoulportal,mcst,city,public,popup"


def default_sources() -> str:
    names = KEYLESS_SOURCES.split(",")
    if settings.tour_api_service_key:
        names.append("tour")
    if settings.seoul_api_key:
        names.append("seoul")
    return ",".join(names)


def save_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def _collect_one(
    name: str, *, area_code: str | None, event_start: date | None
) -> list[RawRecord]:
    if name == "kfes":
        from collectors.kfes import KfesCollector

        with KfesCollector() as collector:
            return collector.collect()
    if name == "culture":
        from collectors.culture_portal import CulturePortalCollector

        # 상세 화면(관람 연령·도로명 주소·운영 시간)까지 — 읽은 결과는 저장해 두고 새 행사만 읽는다
        with CulturePortalCollector(
            details=True, cache_path=settings.culture_detail_cache_path
        ) as collector:
            return collector.collect()
    if name == "mcst":
        from collectors.mcst_festival import McstFestivalCollector

        with McstFestivalCollector() as collector:
            return collector.collect()
    if name == "city":
        from collectors.city_calendar import CityCalendarCollector

        with CityCalendarCollector() as collector:
            return collector.collect()
    if name == "public":
        from collectors.public_data import PublicDataCollector

        with PublicDataCollector() as collector:
            return collector.collect()
    if name == "seoulportal":
        # 서울 자치구·구 문화재단 행사 (키 없음) — 상세 화면(대상·요금·시간)은 저장본 우선
        from collectors.seoul_portal import SeoulPortalCollector

        with SeoulPortalCollector(
            details=True, cache_path=settings.seoul_detail_cache_path
        ) as collector:
            return collector.collect()
    if name == "tour":
        if not settings.tour_api_service_key:
            logger.warning("TOUR_API_SERVICE_KEY not set; skipping tour source")
            return []
        from collectors.tour_api import TourApiCollector

        with TourApiCollector() as collector:
            return collector.collect(event_start_date=event_start, area_code=area_code)
    if name == "popup":
        # 브라우저(Playwright) 없이 HTML만 읽는 팝플리 수집기
        from collectors.popply import PopplyCollector

        with PopplyCollector() as collector:
            return collector.collect()
    if name == "seoul":
        if not settings.seoul_api_key:
            logger.warning("SEOUL_API_KEY not set; skipping seoul source")
            return []
        from collectors.seoul_culture import SeoulCultureCollector

        with SeoulCultureCollector() as collector:
            return collector.collect()
    if name == "web":
        from collectors.web_search import WebSearchCollector, default_queries

        if settings.naver_client_id and settings.naver_client_secret:
            from collectors.naver_search import NaverSearchCollector

            with NaverSearchCollector(default_queries()) as collector:
                return collector.collect()
        logger.info("Naver keys not set; falling back to DuckDuckGo")
        with WebSearchCollector() as collector:
            return collector.collect()
    raise ValueError(f"unknown source {name}")


def collect_raw(
    *,
    sources: set[str],
    area_code: str | None,
    event_start: date | None,
) -> tuple[list[RawRecord], dict[str, str]]:
    """소스별로 독립 수집. 한 소스가 실패해도 나머지는 계속한다."""
    records: list[RawRecord] = []
    errors: dict[str, str] = {}
    for name in sorted(sources):
        try:
            got = _collect_one(name, area_code=area_code, event_start=event_start)
            logger.info("source=%s → %s raw records", name, len(got))
            records.extend(got)
        except Exception as exc:
            logger.exception("Source %s failed", name)
            errors[name] = f"{type(exc).__name__}: {exc}"
    return records, errors


def drop_unchanged(
    records: list[RawRecord], repo: Any, *, touch: bool
) -> tuple[list[RawRecord], int]:
    """DB에 같은 (source, source_id, content_hash)가 있으면 LLM 호출을 건너뛴다."""
    by_source: dict[str, list[RawRecord]] = defaultdict(list)
    for r in records:
        by_source[r.source].append(r)

    changed: list[RawRecord] = []
    skipped = 0
    for source, items in by_source.items():
        ids = [r.source_id for r in items if r.source_id]
        try:
            existing = repo.existing_hashes(source, ids)
        except Exception:
            logger.exception("Change lookup failed for %s; parsing all", source)
            existing = {}
        unchanged_ids: list[str] = []
        for r in items:
            if r.source_id and existing.get(r.source_id) == r.content_hash:
                unchanged_ids.append(r.source_id)
            else:
                changed.append(r)
        skipped += len(unchanged_ids)
        if touch and unchanged_ids:
            try:
                repo.touch_last_seen(source, unchanged_ids)
            except Exception:
                logger.exception("touch_last_seen failed for %s", source)
    if skipped:
        logger.info("Skipped %s unchanged records (no LLM call)", skipped)
    return changed, skipped


def geocode_missing(events: list[NormalizedEvent]) -> int:
    if not settings.kakao_rest_api_key:
        return 0
    from geocode import KakaoGeocoder

    filled = 0
    with KakaoGeocoder() as geo:
        for ev in events:
            if ev.latitude is not None and ev.longitude is not None:
                continue
            coords = geo.geocode(ev.address, ev.location_name)
            if coords:
                ev.latitude, ev.longitude = coords
                filled += 1
    logger.info("Geocoded %s events", filled)
    return filled


def _has_supabase() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_role_key)


def resolve_store(choice: str) -> str:
    if choice == "auto":
        return "supabase" if _has_supabase() else "json"
    if choice == "supabase" and not _has_supabase():
        raise ValueError("--store supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    return choice


def resolve_parser(choice: str) -> str:
    if choice == "auto":
        return "claude" if settings.anthropic_api_key else "rules"
    if choice == "claude" and not settings.anthropic_api_key:
        raise ValueError("--parser claude requires ANTHROPIC_API_KEY")
    return choice


def make_parser(kind: str) -> Any:
    if kind == "claude":
        from parsers.claude_parser import ClaudeEventParser

        return ClaudeEventParser()
    from parsers.rule_parser import RuleEventParser

    return RuleEventParser()


# 목록 전체를 끝까지 읽는 수집기 (사라진 행사 = 취소·제외로 볼 수 있음) → 레코드 출처 이름
COMPLETE_LISTING_SOURCES = {"kfes": "kfes", "culture": "culture_portal"}


def complete_listings(
    records: list[RawRecord], source_errors: dict[str, str]
) -> dict[str, set[str]]:
    """오류 없이 끝난 전체 목록 수집기별로 받은 source_id 집합."""
    out: dict[str, set[str]] = {}
    for name, record_source in COMPLETE_LISTING_SOURCES.items():
        if name in source_errors:
            continue
        ids = {r.source_id for r in records if r.source == record_source and r.source_id}
        if ids:
            out[record_source] = ids
    return out


def osm_backfill(store: Any) -> dict[str, int]:
    """키 없이 OpenStreetMap으로 좌표를 채운다. 실패해도 수집 결과는 그대로 둔다."""
    from geocode_osm import OsmGeocoder
    from store.json_store import fill_coordinates

    try:
        with OsmGeocoder(settings.osm_cache_path, max_lookups=settings.osm_max_lookups) as geo:
            stats = fill_coordinates(store, geo)
    except Exception:
        logger.exception("OSM geocoding failed; keeping data without new coordinates")
        stats = {"filled": 0, "not_found": 0, "skipped_budget": 0}
    # 좌표가 생긴 김에 동(카드의 '성수동')도 채운다 — 실패해도 수집 결과는 그대로
    try:
        from geocode_osm import OsmReverse
        from store.json_store import fill_dong

        with OsmReverse(settings.osm_reverse_cache_path, max_lookups=settings.osm_max_lookups) as rev:
            fill_dong(store, rev)
    except Exception:
        logger.exception("dong backfill failed; keeping data without dong")
    return stats


def make_json_store() -> Any:
    from store.json_store import JsonEventStore

    return JsonEventStore(
        settings.events_json_path,
        settings.events_meta_path,
        retention_days=settings.json_retention_days,
    )


def run_pipeline(
    *,
    sources: set[str],
    area_code: str | None = None,
    event_start: date | None = None,
    skip_upsert: bool = False,
    dry_run: bool | None = None,
    store: str | None = None,
    parser: str | None = None,
) -> dict[str, Any]:
    from validation import validate_events

    dry = settings.dry_run if dry_run is None else dry_run
    write = not (dry or skip_upsert)
    store_kind = resolve_store(store or settings.store)
    parser_kind = resolve_parser(parser or settings.parser)
    started = now_utc()
    stamp = started.strftime("%Y%m%d_%H%M%S")
    summary: dict[str, Any] = {
        "sources": sorted(sources),
        "store": store_kind,
        "parser": parser_kind,
        "raw": 0,
        "skipped_unchanged": 0,
        "parsed": 0,
        "rejected": 0,
        "failed_batches": 0,
        "upserted": 0,
        "status": "ok",
        "error": None,
        "details": {},
    }
    logger.info("store=%s parser=%s write=%s", store_kind, parser_kind, write)

    repo: Any = None
    if store_kind == "supabase":
        from db.supabase_client import EventRepository

        repo = EventRepository()
    else:
        repo = make_json_store()

    try:
        logger.info("Collecting raw data from sources=%s", sorted(sources))
        raw_records, source_errors = collect_raw(
            sources=sources, area_code=area_code, event_start=event_start
        )
        summary["raw"] = len(raw_records)
        summary["details"]["source_errors"] = source_errors
        raw_path = settings.raw_data_dir / f"raw_{stamp}.json"
        save_json(raw_path, [r.model_dump(mode="json") for r in raw_records])
        logger.info("Staged %s raw records → %s", len(raw_records), raw_path)

        to_parse = raw_records
        # 비용이 드는 Claude 정제일 때만 변경 없는 원본을 건너뛴다 (규칙 정제는 공짜라 전부 다시 계산)
        if parser_kind == "claude" and store_kind == "supabase" and raw_records:
            to_parse, skipped = drop_unchanged(raw_records, repo, touch=write)
            summary["skipped_unchanged"] = skipped

        events: list[NormalizedEvent] = []
        corrections: list[NormalizedEvent] = []
        if to_parse:
            parse = make_parser(parser_kind).parse_records(to_parse)
            summary["failed_batches"] = parse.failed_batches
            summary["details"]["invalid_items"] = parse.invalid_items
            if parse.failed_records:
                failed_path = settings.parsed_data_dir / f"failed_{stamp}.json"
                save_json(failed_path, [r.model_dump(mode="json") for r in parse.failed_records])
                logger.warning("Wrote %s failed raw records → %s", len(parse.failed_records), failed_path)

            checked = validate_events(parse.events)
            events = checked.kept
            corrections = checked.ended
            summary["details"]["ended_for_correction"] = len(corrections)
            summary["rejected"] = checked.rejected_count
            summary["details"]["rejected_by_reason"] = dict(checked.rejected)
            summary["details"]["flagged_long"] = checked.flagged_long
            summary["details"]["geocoded"] = geocode_missing(events)

        summary["parsed"] = len(events)
        parsed_path = settings.parsed_data_dir / f"parsed_{stamp}.json"
        save_json(parsed_path, [e.model_dump(mode="json") for e in events])
        logger.info("Kept %s events → %s", len(events), parsed_path)

        if len(source_errors) == len(sources) or (
            summary["failed_batches"] and not events and to_parse
        ):
            summary["status"] = "failed"
        elif source_errors or summary["failed_batches"]:
            summary["status"] = "partial"

        if not write:
            logger.info("Skip write (dry_run=%s skip_upsert=%s)", dry, skip_upsert)
        elif store_kind == "supabase":
            summary["upserted"] = len(repo.upsert_events(events))
        elif summary["status"] != "failed":
            stats = repo.save(
                events,
                summary=summary,
                corrections=corrections,
                seen=complete_listings(raw_records, source_errors),
            )
            summary["upserted"] = stats.inserted + stats.updated
            summary["details"]["json_store"] = stats.__dict__
            if settings.osm_geocode:
                summary["details"]["osm_geocode"] = osm_backfill(repo)
    except Exception as exc:
        logger.exception("Pipeline failed")
        summary["status"] = "failed"
        summary["error"] = f"{type(exc).__name__}: {exc}"

    if write and store_kind == "supabase":
        repo.record_run(
            {
                "started_at": started.isoformat(),
                "finished_at": now_utc().isoformat(),
                "sources": summary["sources"],
                "raw_count": summary["raw"],
                "skipped_unchanged": summary["skipped_unchanged"],
                "parsed_count": summary["parsed"],
                "rejected_count": summary["rejected"],
                "failed_batches": summary["failed_batches"],
                "upserted": summary["upserted"],
                "status": summary["status"],
                "error": summary["error"],
                "details": summary["details"],
            }
        )

    if summary["status"] != "ok":
        from notify import notify_slack

        notify_slack(
            f":warning: EventNow 파이프라인 {summary['status']} — "
            f"raw={summary['raw']} parsed={summary['parsed']} "
            f"failed_batches={summary['failed_batches']} "
            f"errors={summary['details'].get('source_errors') or summary['error']}"
        )
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "EventNow data pipeline. 기본은 키 없이: kfes·팝업 → 규칙 정제 → events.json. "
            "키가 있으면 TourAPI·서울시·Claude·Supabase 를 자동 사용."
        ),
    )
    parser.add_argument(
        "--sources",
        default=None,
        help="Comma-separated: kfes,culture,popup,tour,seoul,web (default: 키 없이 되는 소스 + 키가 있는 소스)",
    )
    parser.add_argument(
        "--store",
        choices=["auto", "json", "supabase"],
        default=None,
        help="저장소 (default: auto — Supabase 키가 있으면 supabase, 없으면 json)",
    )
    parser.add_argument(
        "--parser",
        choices=["auto", "rules", "claude"],
        default=None,
        help="정제기 (default: auto — ANTHROPIC_API_KEY 가 있으면 claude, 없으면 rules)",
    )
    parser.add_argument(
        "--area-code",
        default=None,
        help="TourAPI areaCode (e.g. 1=서울)",
    )
    parser.add_argument(
        "--event-start",
        default=None,
        help="TourAPI eventStartDate YYYY-MM-DD (default: today KST - 90 days)",
    )
    parser.add_argument(
        "--skip-upsert",
        action="store_true",
        help="Parse only; do not write",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Same as skip-upsert; also forces dry mode",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sources_arg = args.sources or default_sources()
    sources = {s.strip().lower() for s in sources_arg.split(",") if s.strip()}
    unknown = sources - ALLOWED_SOURCES
    if unknown:
        logger.error("Unknown sources: %s (allowed: %s)", unknown, ALLOWED_SOURCES)
        return 2

    event_start = None
    if args.event_start:
        event_start = date.fromisoformat(args.event_start)

    result = run_pipeline(
        sources=sources,
        area_code=args.area_code,
        event_start=event_start,
        skip_upsert=args.skip_upsert or args.dry_run,
        dry_run=args.dry_run,
        store=args.store,
        parser=args.parser,
    )
    logger.info("Pipeline done: %s", result)
    return 1 if result["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())