"""서울시 공공서비스예약 (yeyak.seoul.go.kr) — 서울 열린데이터광장 API (SEOUL_API_KEY 필요, 무료).

자치구·시 시설이 올리는 체험·교육 예약이 한곳에 모인다: 유아숲체험원 숲체험, 목공 체험, 서울형 키즈카페,
서울기록원 가족 프로그램, 공원 탐방, 도시농업 체험 등. 자치구(AREANM)·좌표·접수 기간이 들어 있어
'우리 동네' 행사를 채운다. 문화체험(ListPublicReservationCulture)·교육(ListPublicReservationEducation)만 읽는다.

아이·가족이 함께할 수 있는 것만(성인·청년·청소년 전용은 뺀다), 지금 접수 중이거나 안내 중인 것만 남긴다
(예약 마감·접수 종료는 갈 수 없으니 뺀다). 출처 표기: 서울시 공공서비스예약.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import date, timedelta
from typing import Any

import httpx

from collectors.local_culture import _ADULT_TARGET, _CHILD_WORD, _KIDS_TARGET
from config import settings
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

BASE_URL = "http://openapi.seoul.go.kr:8088"
SERVICES = ("ListPublicReservationCulture", "ListPublicReservationEducation")
PAGE_SIZE = 1000
WINDOW_DAYS = 120
MAX_SPAN_DAYS = 120
KIDS_CAFE_DAYS = 60

_OPEN = {"접수중", "안내중"}
# 아이와 상관없는 분류
_SKIP_CLASS = {"청년정보", "전문/자격증", "단체봉사", "정보통신", "교양/어학"}
_SKIP_TITLE = re.compile(r"대관|청년|취업|창업|자격증|시니어|어르신|중장년|직장인|치매|은퇴|강사\s*양성|자원봉사")
_CATEGORY = {"전시/관람": "exhibition", "문화행사": "festival"}
# '0~2세', '3~6세'처럼 나이대별로 나뉜 같은 키즈카페는 하나로 본다
_AGE_SLOT = re.compile(r"\s*\(?\d{1,2}\s*~\s*\d{1,2}\s*세\)?\s*$")


def _date(value: Any) -> date | None:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(value or ""))
    if not m:
        return None
    try:
        return date(*map(int, m.groups()))
    except ValueError:
        return None


def _float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _text(raw: Any, limit: int = 400) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(str(raw or ""))))
    return re.sub(r"\s+", " ", s).strip()[:limit]


def is_family_target(target: str, title: str) -> bool:
    t = target.strip()
    if _SKIP_TITLE.search(title):
        return False
    if t and _ADULT_TARGET.search(t) and not _CHILD_WORD.search(t):
        return False
    if re.search(r"청소년|중학생|고등학생|중고등", t) and not _CHILD_WORD.search(t) and "제한없음" not in t:
        return False
    return bool(not t or _KIDS_TARGET.search(t) or "제한없음" in t or _CHILD_WORD.search(title))


def row_to_raw(row: dict[str, Any], *, today: date) -> RawRecord | None:
    title = html.unescape(str(row.get("SVCNM") or "")).strip()
    sid = str(row.get("SVCID") or "").strip()
    if not title or not sid:
        return None
    if str(row.get("SVCSTATNM") or "").strip() not in _OPEN:
        return None
    klass = str(row.get("MINCLASSNM") or "").strip()
    if klass in _SKIP_CLASS:
        return None
    start, end = _date(row.get("SVCOPNBGNDT")), _date(row.get("SVCOPNENDDT"))
    if not start or not end or end < today or start > today + timedelta(days=WINDOW_DAYS):
        return None
    target = html.unescape(str(row.get("USETGTINFO") or "")).strip()
    if not is_family_target(target, title):
        return None
    kids_cafe = klass == "서울형키즈카페"
    # 한 해 내내 여는 프로그램은 상시 운영 — 아이 대상(유아숲·키즈카페)만 남긴다
    if (end - start).days > MAX_SPAN_DAYS and not (kids_cafe or _CHILD_WORD.search(target)):
        return None
    area = str(row.get("AREANM") or "").strip()
    place = html.unescape(str(row.get("PLACENM") or "")).strip()
    region = "경기도" if area.endswith("시") else "서울특별시"
    address = place if place.startswith(("서울", "경기")) else " ".join(x for x in (region, area, place) if x)
    lng, lat = _float(row.get("X")), _float(row.get("Y"))
    if lat is not None and lng is not None and not (33 <= lat <= 39 and 124 <= lng <= 132):
        lat, lng = (lng, lat) if 33 <= (lng or 0) <= 39 else (None, None)
    rcpt_start, rcpt_end = _date(row.get("RCPTBGNDT")), _date(row.get("RCPTENDDT"))
    pay = str(row.get("PAYATNM") or "").strip()
    price = "무료" if pay == "무료" else ("유료" if pay else None)
    detail = _text(row.get("DTLCONT"))
    if kids_cafe:
        # 키즈카페는 2주씩 이어서 예약을 여는 '장소' — 관광명소처럼 상시 장소로 넣는다 (매일 다시 확인)
        title = _AGE_SLOT.sub("", title)
        start, end = today, today + timedelta(days=KIDS_CAFE_DAYS)
    desc_parts = [
        f"서울시 공공서비스예약 {klass} 프로그램이에요." if klass else "서울시 공공서비스예약 프로그램이에요.",
        f"대상: {target}" if target else "",
        f"장소: {place}" if place else "",
        "예약해야 갈 수 있어요.",
    ]
    description = " ".join(p for p in desc_parts if p)
    raw = "\n".join(
        [
            "[출처] 서울시 공공서비스예약",
            f"[제목] {title}",
            f"[분야] {row.get('MAXCLASSNM') or ''} > {klass}",
            f"[기간] {start.isoformat()} ~ {end.isoformat()}",
            f"[장소] {place}",
            f"[주소] {address}",
            f"[대상] {target}",
            f"[요금] {price or ''}",
            # 접수 기간 = 사전 신청 기간 (키즈카페는 2주 단위로 계속 열려 따로 표시하지 않는다)
            f"[신청] 접수기간 {rcpt_start:%Y.%m.%d} ~ {rcpt_end:%Y.%m.%d}"
            if rcpt_start and rcpt_end and not kids_cafe
            else "",
            "",
            "[본문]",
            description,
            detail,
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "address": address,
        "location_name": place or None,
        "latitude": lat,
        "longitude": lng,
        "official_link": str(row.get("SVCURL") or "").strip() or None,
        "thumbnail_url": str(row.get("IMGURL") or "").strip() or None,
        "description": description
        + (" 서울시가 운영하는 키즈카페로, 공공서비스예약에서 회차를 예약하고 가요." if kids_cafe else ""),
        "age_info": target or None,
        "price_info": price,
    }
    hint = "attraction" if kids_cafe else _CATEGORY.get(klass, "kids_experience")
    place_types = ["park_playground"] if kids_cafe or re.search(r"숲|공원|산림|농장|농업", f"{klass} {place}") else []
    return RawRecord(
        source="seoul_reservation",
        source_id=sid,
        collected_at=now_utc(),
        title_hint=title,
        url=facts["official_link"],
        raw_text=raw,
        meta={"category_hint": hint, "venue": place, "genre": klass, "place_types": place_types},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


class SeoulReservationCollector:
    def __init__(self, api_key: str | None = None, client: httpx.Client | None = None) -> None:
        self.api_key = api_key or settings.seoul_api_key
        if not self.api_key:
            raise ValueError("SEOUL_API_KEY is required")
        self._owns_client = client is None
        self.client = client or httpx.Client(timeout=60.0)

    def __enter__(self) -> SeoulReservationCollector:
        return self

    def __exit__(self, *args: object) -> None:
        if self._owns_client:
            self.client.close()

    def _rows(self, service: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start, total = 1, None
        while total is None or start <= total:
            resp = self.client.get(f"{BASE_URL}/{self.api_key}/json/{service}/{start}/{start + PAGE_SIZE - 1}/")
            resp.raise_for_status()
            body = resp.json().get(service) or {}
            if total is None:
                total = int(body.get("list_total_count") or 0)
            batch = body.get("row") or []
            if not batch:
                break
            rows.extend(batch)
            start += PAGE_SIZE
        return rows

    def collect(self, *, today: date | None = None) -> list[RawRecord]:
        ref = today or today_kst()
        out: list[RawRecord] = []
        seen_titles: set[tuple[str, str]] = set()
        listed = 0
        for service in SERVICES:
            rows = self._rows(service)
            listed += len(rows)
            for row in rows:
                rec = row_to_raw(row, today=ref)
                if not rec:
                    continue
                key = (rec.facts["title"], "" if rec.meta["category_hint"] == "attraction" else rec.facts.get("location_name", ""))
                if key in seen_titles:
                    continue
                seen_titles.add(key)
                out.append(rec)
        if not listed:
            raise RuntimeError("seoul reservation API returned nothing")
        logger.info("seoul reservation: listed %s, kept %s", listed, len(out))
        return out
