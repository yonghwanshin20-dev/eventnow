"""서울 열린데이터광장 문화행사 정보 (culturalEventInfo) 수집기."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config import settings
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

BASE_URL = "http://openapi.seoul.go.kr:8088"
PAGE_SIZE = 1000  # API 1회 최대
MAX_ROWS = 10000


class SeoulCultureCollector:
    def __init__(
        self,
        api_key: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key or settings.seoul_api_key
        if not self.api_key:
            raise ValueError("SEOUL_API_KEY is required")
        self._owns_client = client is None
        self.client = client or httpx.Client(timeout=30.0)

    def __enter__(self) -> SeoulCultureCollector:
        return self

    def __exit__(self, *args: object) -> None:
        if self._owns_client:
            self.client.close()

    def collect(self) -> list[RawRecord]:
        today = today_kst().isoformat()
        records: list[RawRecord] = []
        start = 1
        total: int | None = None
        while start <= MAX_ROWS and (total is None or start <= total):
            end = start + PAGE_SIZE - 1
            payload = self._request(start, end)
            body = payload.get("culturalEventInfo") or {}
            if total is None:
                total = int(body.get("list_total_count") or 0)
            rows = body.get("row") or []
            if not rows:
                break
            for row in rows:
                record = row_to_raw(row)
                if record is None:
                    continue
                if (record.facts.get("end_date") or "") < today:
                    continue
                records.append(record)
            start = end + 1
        logger.info("Seoul culture collected %s ongoing/upcoming records (total=%s)", len(records), total)
        return records

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    def _request(self, start: int, end: int) -> dict[str, Any]:
        url = f"{BASE_URL}/{self.api_key}/json/culturalEventInfo/{start}/{end}/"
        resp = self.client.get(url)
        resp.raise_for_status()
        return resp.json()


def _date(value: Any) -> str | None:
    match = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", str(value or "").strip())
    if not match:
        return None
    return "-".join(match.groups())


def _coords(lot: Any, lat: Any) -> tuple[float | None, float | None]:
    """LOT/LAT 값이 뒤바뀐 데이터가 있어 33~39 범위 값을 위도로 본다."""
    nums: list[float] = []
    for v in (lot, lat):
        try:
            nums.append(float(v))
        except (TypeError, ValueError):
            pass
    if len(nums) != 2:
        return None, None
    a, b = nums
    if 33 <= a <= 39:
        return a, b
    if 33 <= b <= 39:
        return b, a
    return None, None


def row_to_raw(row: dict[str, Any]) -> RawRecord | None:
    title = str(row.get("TITLE") or "").strip()
    start = _date(row.get("STRTDATE"))
    end = _date(row.get("END_DATE"))
    if not title or not start or not end:
        return None
    gu = str(row.get("GUNAME") or "").strip()
    place = str(row.get("PLACE") or "").strip()
    address = " ".join(p for p in ("서울특별시", gu, place) if p)
    lat, lng = _coords(row.get("LOT"), row.get("LAT"))
    link = (row.get("ORG_LINK") or row.get("HMPG_ADDR") or "").strip() or None
    fee = str(row.get("USE_FEE") or "").strip()
    is_free = str(row.get("IS_FREE") or "").strip()

    lines = [
        "[출처] 서울시 문화행사 정보 (culturalEventInfo)",
        f"[제목] {title}",
        f"[분류] {row.get('CODENAME') or '정보 없음'}",
        f"[기간] {start} ~ {end}",
        f"[자치구] {gu or '정보 없음'}",
        f"[장소] {place or '정보 없음'}",
        f"[이용대상] {row.get('USE_TRGT') or '정보 없음'}",
        f"[요금] {fee or is_free or '정보 없음'}",
        f"[유무료] {is_free or '정보 없음'}",
        "",
        "[본문]",
        str(row.get("PROGRAM") or "").strip() or "프로그램 정보 없음",
        str(row.get("ETC_DESC") or "").strip(),
    ]
    source_id = str(row.get("HMPG_ADDR") or "").strip() or f"{title}|{start}"
    facts = {
        "title": title,
        "start_date": start,
        "end_date": end,
        "address": address,
        "location_name": place or None,
        "latitude": lat,
        "longitude": lng,
        "thumbnail_url": (row.get("MAIN_IMG") or "").strip() or None,
        "official_link": link,
        "price_info": (fee or is_free or None),
    }
    return RawRecord(
        source="seoul_api",
        source_id=source_id[:200],
        collected_at=now_utc(),
        title_hint=title,
        url=link,
        raw_text="\n".join(lines).strip(),
        meta={"codename": row.get("CODENAME"), "guname": gu},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )
