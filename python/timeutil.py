"""KST 기준 날짜 헬퍼. 파이프라인의 모든 '오늘' 판단은 여기를 거친다."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

# 한국은 서머타임이 없어 고정 오프셋이 정확하다 (Windows에서 tzdata 없이도 동작).
KST = timezone(timedelta(hours=9), name="KST")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_kst() -> datetime:
    return datetime.now(KST)


def today_kst() -> date:
    return now_kst().date()


def status_for(start: date, end: date, today: date | None = None) -> str:
    """start/end 날짜로 upcoming | ongoing | ended 계산 (KST)."""
    ref = today or today_kst()
    if end < ref:
        return "ended"
    if start > ref:
        return "upcoming"
    return "ongoing"
