"""OpenStreetMap Nominatim 지오코딩 — API 키 없이 좌표 채우기.

Nominatim 이용 정책을 지킨다: 초당 1회 이하, 연락처가 담긴 User-Agent, 결과 캐시(같은 장소는 다시
묻지 않음), 한 번 실행에 조회 상한. 캐시는 저장소에 커밋되어 다음 실행에서 재사용된다.

찾은 좌표가 행사의 시·도와 다르면(동명 장소) 버린다.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx

from collectors.polite import USER_AGENT
from regions import detect_region

logger = logging.getLogger(__name__)

SEARCH_URL = "https://nominatim.openstreetmap.org/search"
MIN_INTERVAL = 1.1  # 초당 1회 이하
_STREETISH = re.compile(r"(로|길)\s*\d")


def _region_of_display_name(display_name: str) -> str | None:
    """'인사아트센터, 41-1, 인사동길, …, 종로구, 서울특별시, 03163, 대한민국' → 서울특별시."""
    parts = [p.strip() for p in display_name.split(",")]
    for part in reversed(parts):
        region = detect_region(part)
        if region:
            return region
    return None


_REGION_WORDS = re.compile(
    r"^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)"
    r"(특별시|광역시|특별자치시|특별자치도|도|시)?$"
)
_DISTRICT_WORD = re.compile(r"^[가-힣]{1,4}(시|군|구|읍|면|동)$")


def is_specific(query: str) -> bool:
    """지역·구 이름뿐인 검색어('서울', '경기 수원시')는 도시 중심점이 나와 쓰지 않는다."""
    tokens = [t for t in query.split() if t]
    return any(not (_REGION_WORDS.match(t) or _DISTRICT_WORD.match(t)) for t in tokens)


def queries_for(row: dict[str, Any]) -> list[str]:
    """도로명 주소가 있으면 주소부터, 다음은 '지역 장소명', 마지막으로 장소명만.
    장소를 특정할 수 없는(지역 이름뿐인) 검색어는 뺀다."""
    address = str(row.get("address") or "").strip()
    place = str(row.get("location_name") or "").strip()
    region_short = address.split()[0] if address else ""
    out: list[str] = []
    if address and _STREETISH.search(address):
        out.append(address)
    if place and place != address:
        out.append(f"{region_short} {place}".strip() if region_short and not place.startswith(region_short) else place)
        out.append(place)
    elif address:
        out.append(address)
    seen: set[str] = set()
    return [q for q in out if q and is_specific(q) and not (q in seen or seen.add(q))]


class OsmGeocoder:
    def __init__(
        self,
        cache_path: Path,
        client: httpx.Client | None = None,
        *,
        min_interval: float = MIN_INTERVAL,
        max_lookups: int = 200,
    ) -> None:
        self.cache_path = cache_path
        self.cache: dict[str, list[float] | None] = self._load()
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=20.0, headers={"User-Agent": USER_AGENT, "Accept-Language": "ko"}
        )
        self.min_interval = min_interval
        self.max_lookups = max_lookups
        self.lookups = 0
        self._last = 0.0

    def __enter__(self) -> OsmGeocoder:
        return self

    def __exit__(self, *args: object) -> None:
        self.save()
        if self._owns_client:
            self.client.close()

    def _load(self) -> dict[str, list[float] | None]:
        try:
            return json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(dict(sorted(self.cache.items())), ensure_ascii=False, indent=0) + "\n",
            encoding="utf-8",
        )

    def _search(self, query: str, region: str | None) -> list[float] | None:
        """캐시 확인 → 없으면 조회. 시·도가 다르면 None. 일시 오류는 캐시하지 않는다."""
        key = f"{region or ''}|{query}"
        if key in self.cache:
            return self.cache[key]
        if self.lookups >= self.max_lookups:
            raise _Budget()
        wait = self._last + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        self.lookups += 1
        resp = self.client.get(
            SEARCH_URL,
            params={"q": query, "format": "jsonv2", "limit": 3, "countrycodes": "kr"},
        )
        resp.raise_for_status()
        hit: list[float] | None = None
        for doc in resp.json():
            doc_region = _region_of_display_name(str(doc.get("display_name") or ""))
            if region and doc_region and doc_region != region:
                continue
            hit = [round(float(doc["lat"]), 6), round(float(doc["lon"]), 6)]
            break
        self.cache[key] = hit
        return hit

    def locate(self, row: dict[str, Any]) -> list[float] | None:
        region = row.get("region")
        for query in queries_for(row):
            try:
                hit = self._search(query, region)
            except _Budget:
                raise
            except httpx.HTTPError as exc:
                logger.warning("Nominatim failed for %r: %s", query, exc)
                return None
            if hit:
                return hit
        return None


class _Budget(Exception):
    """이번 실행의 조회 상한 도달."""


def backfill_coordinates(
    rows: list[dict[str, Any]],
    geocoder: OsmGeocoder,
    *,
    today: str,
) -> dict[str, int]:
    """좌표가 없는(또는 반쪽인) 진행·예정 행 좌표를 채운다. 행을 직접 수정한다."""
    stats = {"filled": 0, "not_found": 0, "skipped_budget": 0}
    targets = [
        r
        for r in rows
        if (r.get("latitude") is None or r.get("longitude") is None)
        and str(r.get("end_date") or "")[:10] >= today
    ]
    for i, row in enumerate(targets):
        try:
            hit = geocoder.locate(row)
        except _Budget:
            stats["skipped_budget"] = len(targets) - i
            break
        if hit:
            row["latitude"], row["longitude"] = hit
            stats["filled"] += 1
        else:
            stats["not_found"] += 1
    logger.info(
        "OSM geocoding: filled=%s not_found=%s left_for_next_run=%s (lookups=%s)",
        stats["filled"],
        stats["not_found"],
        stats["skipped_budget"],
        geocoder.lookups,
    )
    return stats
