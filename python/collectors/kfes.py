"""대한민국 구석구석 축제 달력 (korean.visitkorea.or.kr/kfes) — API 키 불필요.

축제 달력 화면이 쓰는 목록 JSON을 그대로 읽는다. 제목·기간·주소·좌표·이미지·요금·홈페이지가
이미 구조화돼 있어 LLM 없이 facts 로 확정된다. robots.txt 확인 후 1초 간격으로 요청한다.
출처 표기: 한국관광공사 대한민국 구석구석.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import date, timedelta
from typing import Any

import httpx

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

BASE = "https://korean.visitkorea.or.kr"
LIST_PAGE = f"{BASE}/kfes/list/wntyFstvlList.do"
LIST_API = f"{BASE}/kfes/list/selectWntyFstvlList.do"
DETAIL_URL = f"{BASE}/kfes/detail/fstvlDetail.do?fstvlCntntsId={{id}}"
MAX_PAGES = 100
# 이 기간 안에 끝난 축제도 받아 기존 행의 날짜 교정에 쓴다
RECENT_PAST_DAYS = 120

_TAG_RE = re.compile(r"<[^>]+>")
_HREF_RE = re.compile(r"""href=["']([^"']+)["']""")


class KfesCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Referer": LIST_PAGE},
        )
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> KfesCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def collect(
        self, *, today: date | None = None, past_days: int = RECENT_PAST_DAYS
    ) -> list[RawRecord]:
        """진행·예정 축제 + 최근 past_days 안에 끝난 축제.

        끝난 축제는 새로 추가되지 않고, 기존 데이터의 날짜를 바로잡는 데만 쓰인다
        (예: 7월 데이터의 '10.1~10.31' 임시 일정 → 실제 '10.16~10.18', 이미 종료).
        """
        if self.check_robots and not robots_allowed(LIST_API):
            raise PermissionError(f"robots.txt disallows {LIST_API}")
        ref = ((today or today_kst()) - timedelta(days=past_days)).isoformat()
        records: list[RawRecord] = []
        seen: set[str] = set()
        start = 0
        for _ in range(MAX_PAGES):
            payload = self._fetch(start)
            items = payload.get("resultList") or []
            total = int(payload.get("totalCnt") or 0)
            if not items:
                break
            for item in items:
                record = item_to_raw(item)
                if record is None or record.source_id in seen:
                    continue
                seen.add(record.source_id or "")
                if (record.facts.get("end_date") or "") < ref:
                    continue
                records.append(record)
            start += len(items)
            if start >= total:
                break
        logger.info("kfes collected %s festivals (incl. recently ended)", len(records))
        return records

    def _fetch(self, start: int) -> dict[str, Any]:
        self.throttle.wait()
        form = {
            "startIdx": str(start),
            "searchType": "A",
            "searchDate": "",
            "searchArea": "",
            "searchCate": "",
            "locationx": "undefined",
            "locationy": "undefined",
            "filterExcluded": "true",
        }
        resp = self.client.post(LIST_API, data=form)
        resp.raise_for_status()
        return resp.json()


def _ymd(value: Any) -> str | None:
    m = re.match(r"^\s*(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})", str(value or ""))
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def _text(value: Any) -> str:
    raw = str(value or "")
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    return html.unescape(_TAG_RE.sub("", raw)).strip()


def _homepage(value: Any) -> str | None:
    raw = str(value or "")
    m = _HREF_RE.search(raw)
    url = (m.group(1) if m else _text(raw)).strip()
    return url if url.startswith(("http://", "https://")) else None


def _float(value: Any) -> float | None:
    try:
        f = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return f if f else None


def item_to_raw(item: dict[str, Any]) -> RawRecord | None:
    content_id = str(item.get("fstvlCntntsId") or "").strip()
    title = _text(item.get("cntntsNm"))
    start = _ymd(item.get("fstvlBgngDe"))
    end = _ymd(item.get("fstvlEndDe"))
    if not content_id or not title or not start or not end:
        return None

    address = " ".join(p for p in (_text(item.get("adres")), _text(item.get("dtadr"))) if p)
    area = _text(item.get("areaNm"))
    lat = _float(item.get("ycrdVal"))
    lng = _float(item.get("xcrdVal"))
    # 위도·경도 둘 다 한국 범위 안일 때만 쓴다 (한쪽만 있으면 지도에서 쓸 수 없다)
    if lat is None or lng is None or not (33 <= lat <= 39 and 124 <= lng <= 132):
        lat, lng = None, None
    outline = _text(item.get("fstvlOutlCn"))
    program = _text(item.get("fstvlCrmnCn")) or _text(item.get("fstvlProgrmCn"))
    fee = _text(item.get("fstvlUtztFareInfo"))
    age = _text(item.get("vwngPsblAgeInfo"))
    detail_url = DETAIL_URL.format(id=content_id)

    lines = [
        "[출처] 한국관광공사 대한민국 구석구석 축제 달력",
        f"[제목] {title}",
        f"[기간] {start} ~ {end}",
        f"[지역] {area or '정보 없음'}",
        f"[주소] {address or '정보 없음'}",
        f"[요금] {fee or '정보 없음'}",
        f"[관람연령] {age or '정보 없음'}",
        f"[주최] {_text(item.get('fstvlAspcsNm')) or '정보 없음'}",
        "",
        "[개요]",
        outline,
        "",
        "[프로그램]",
        program,
    ]
    facts = {
        "title": title,
        "start_date": start,
        "end_date": end,
        "address": address or area or None,
        "location_name": area or None,
        "latitude": lat,
        "longitude": lng,
        "thumbnail_url": _text(item.get("dispFstvlCntntsImgRout")) or None,
        "official_link": _homepage(item.get("fstvlHmpgUrl")) or detail_url,
        "price_info": fee or None,
        "description": outline[:1500] or None,
        "booking_required": str(item.get("rsvtGdnYn") or "").upper() == "Y",
        "age_info": age or None,
    }
    return RawRecord(
        source="kfes",
        source_id=content_id,
        collected_at=now_utc(),
        title_hint=title,
        url=detail_url,
        raw_text="\n".join(lines).strip(),
        meta={"category_hint": "festival", "fstvl_cl_cd": item.get("fstvlClCd")},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )
