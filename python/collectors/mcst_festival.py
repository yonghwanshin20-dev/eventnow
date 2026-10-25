"""문화체육관광부 '지역축제' (www.mcst.go.kr) — 전국 시·군·구가 신고한 축제 목록, API 키 불필요.

축제 달력(kfes)에 없는 시·군 단위 축제(동두천 책문화축제, 양주 드론봇 페스티벌 등)를 채운다.
목록 화면에 제목·소개·기간(시간 포함)·장소(시·군)·문의·사진이 있어 상세 화면은 읽지 않는다.
robots.txt 는 /site/search/ 만 막는다. 1초 간격. 출처 표기: 문화체육관광부 지역축제.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any

import httpx
from bs4 import BeautifulSoup, Tag

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

SITE = "https://www.mcst.go.kr"
LIST_URL = f"{SITE}/site/s_culture/festival/festivalList.jsp"
VIEW_URL = f"{SITE}/site/s_culture/festival/festivalView.jsp"
MAX_PAGES = 60
WINDOW_DAYS = 150

# "2026. 10. 17. ~ 10. 21. | 10:00~22:00", "2026. 10. 31. | 15:30~19:00", "2026. 10. 30. ~ 2026. 11. 1."
_PERIOD = re.compile(
    r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?"
    r"(?:\s*~\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.?)?"
)
_TIME = re.compile(r"\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}")


def parse_period(text: str) -> tuple[str, str, str | None] | None:
    m = _PERIOD.search(text)
    if not m:
        return None
    y1, m1, d1, y2, m2, d2 = m.groups()
    try:
        start = date(int(y1), int(m1), int(d1))
        if m2:
            end = date(int(y2 or y1), int(m2), int(d2))
            if end < start and not y2:
                end = date(end.year + 1, end.month, end.day)
        else:
            end = start
    except ValueError:
        return None
    if end < start:
        return None
    rest = text[m.end():]
    hours = _TIME.search(rest)
    return start.isoformat(), end.isoformat(), hours.group(0) if hours else None


def _fields(anchor: Tag) -> dict[str, str]:
    out: dict[str, str] = {}
    for li in anchor.select("ul.list li"):
        strong = li.find("strong")
        if not strong:
            continue
        key = strong.get_text(strip=True)
        out[key] = li.get_text(" ", strip=True)[len(key):].lstrip(" :").strip()
    return out


def item_to_raw(anchor: Tag) -> RawRecord | None:
    m = re.search(r"pSeq=(\d+)", str(anchor.get("href") or ""))
    title_tag = anchor.select_one(".sub-tit")
    if not m or not title_tag:
        return None
    seq = m.group(1)
    title = title_tag.get_text(" ", strip=True)
    f = _fields(anchor)
    period = parse_period(f.get("기간", ""))
    place = f.get("장소", "").strip()
    if not title or not period or not place:
        return None
    start, end, hours = period
    desc_tag = anchor.select_one(".sub-text")
    intro = re.sub(r"\s+", " ", desc_tag.get_text(" ", strip=True)) if desc_tag else ""
    img = anchor.find("img")
    src = str(img.get("src") or "") if img else ""
    thumb = f"{SITE}{src}" if src.startswith("/") else None
    contact = f.get("문의") or None
    description = intro[:280]
    if hours:
        description = f"{description}\n운영 시간 {hours}".strip()
    raw = "\n".join(
        [
            "[출처] 문화체육관광부 지역축제",
            f"[제목] {title}",
            f"[기간] {start} ~ {end}",
            f"[장소] {place}",
            f"[문의] {contact or '정보 없음'}",
            "",
            "[본문]",
            intro[:800],
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start,
        "end_date": end,
        # 목록에는 '경기도 연천군'처럼 시·군까지만 있다 — 지역·구 판정과 지도 검색에 쓴다
        "address": place,
        "location_name": place,
        "thumbnail_url": thumb,
        "official_link": f"{VIEW_URL}?pSeq={seq}",
        "description": description or None,
    }
    return RawRecord(
        source="mcst_festival",
        source_id=seq,
        collected_at=now_utc(),
        title_hint=title,
        url=f"{VIEW_URL}?pSeq={seq}",
        raw_text=raw,
        meta={"category_hint": "festival", "hours": hours, "contact": contact},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


class McstFestivalCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=40.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> McstFestivalCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def collect(self, *, today: date | None = None, past_days: int = 0) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(LIST_URL):
            raise PermissionError(f"robots.txt disallows {LIST_URL}")
        ref = today or today_kst()
        records: list[RawRecord] = []
        seen: set[str] = set()
        for page in range(1, MAX_PAGES + 1):
            self.throttle.wait()
            resp = self.client.get(
                LIST_URL,
                params={
                    "pSido": "",
                    "pCurrentPage": str(page),
                    "fromDt": (ref - timedelta(days=past_days)).isoformat(),
                    "toDt": (ref + timedelta(days=WINDOW_DAYS)).isoformat(),
                },
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            anchors = soup.select("a.go[href*='festivalView']")
            if not anchors:
                break
            new = 0
            for anchor in anchors:
                record = item_to_raw(anchor)
                if record is None or record.source_id in seen:
                    continue
                seen.add(record.source_id or "")
                new += 1
                if (record.facts.get("end_date") or "") >= ref.isoformat():
                    records.append(record)
            if new == 0:
                break  # 같은 페이지가 반복되면 끝
        if not seen:
            raise RuntimeError("mcst festival list had no items — page format may have changed")
        logger.info("mcst festivals collected %s (listed %s)", len(records), len(seen))
        return records
