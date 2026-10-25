"""정제 결과 검증: 날짜 환각·과거 행사·지역 미상을 걸러낸다."""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from models import NormalizedEvent
from regions import detect_district, detect_region
from timeutil import today_kst

logger = logging.getLogger(__name__)

LONG_DURATION_DAYS = 400


@dataclass
class ValidationResult:
    kept: list[NormalizedEvent] = field(default_factory=list)
    rejected: Counter = field(default_factory=Counter)
    flagged_long: int = 0
    # 이미 끝났지만 그 외엔 유효한 행사 — 새로 추가하지 않고 기존 행 날짜 교정에만 쓴다
    ended: list[NormalizedEvent] = field(default_factory=list)

    @property
    def rejected_count(self) -> int:
        return sum(self.rejected.values())


def assign_region(event: NormalizedEvent) -> bool:
    """region/district를 주소로 채운다. 판정 불가면 False."""
    region = detect_region(event.address) or detect_region(event.location_name)
    if not region:
        return False
    event.region = region
    event.district = detect_district(region, event.address) or detect_district(
        region, event.location_name
    )
    return True


def validate_events(
    events: list[NormalizedEvent], *, today: date | None = None
) -> ValidationResult:
    ref = today or today_kst()
    result = ValidationResult()
    for ev in events:
        reason = _reject_reason(ev, ref)
        if reason == "already_ended" and ev.region:
            result.ended.append(ev)
            continue
        if reason:
            result.rejected[reason] += 1
            logger.info("Reject %s: %s", reason, ev.title)
            continue
        if (ev.end_date - ev.start_date).days > LONG_DURATION_DAYS:
            result.flagged_long += 1
            logger.warning(
                "Long duration (%s days) — check: %s",
                (ev.end_date - ev.start_date).days,
                ev.title,
            )
        result.kept.append(ev)
    if result.rejected:
        logger.info("Validation rejected %s: %s", result.rejected_count, dict(result.rejected))
    return result


def _reject_reason(ev: NormalizedEvent, today: date) -> str | None:
    if not ev.dates_found_in_text and not ev.dates_from_facts:
        return "dates_not_in_source"
    # 연도 범위 검사는 LLM이 지어낸 연도를 잡기 위한 것 — 공식 출처의 장기 상설 프로그램
    # (예: 2024년 시작 상설 체험)은 대상이 아니다
    if not ev.dates_from_facts and not (today.year - 1 <= ev.start_date.year <= today.year + 1):
        return "start_year_out_of_range"
    if not assign_region(ev):
        return "region_unknown"
    if ev.end_date < today:
        return "already_ended"
    return None
