"""시·군청 '연간 행사·축제 일정' 표 — API 키 불필요.

전국 목록(축제 달력·문화체육관광부)에 오르지 않는 동네 행사(구청·동 주민센터 축제, 어린이날 행사 등)는
시·군청 누리집의 연간 일정표에만 있는 경우가 많다. 표 모양이 '월 | 일자 | 행사명 | 장소 | 주요내용 |
문의' 인 곳을 같은 방식으로 읽는다. 날짜가 '미정'인 행사는 그달 전체(날짜 미정)로 넣는다.

새 시·군을 넣으려면 CITY_CALENDARS 에 주소와 시·군 이름만 추가하면 된다 (표 모양이 같을 때).
"""

from __future__ import annotations

import calendar
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx
from bs4 import BeautifulSoup

from collectors.polite import USER_AGENT, Throttle, robots_allowed, tls_verify
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CityCalendar:
    key: str  # 출처 ID 앞머리 (예: uijeongbu)
    name: str  # '의정부시'
    region: str  # '경기도'
    url: str


CITY_CALENDARS: list[CityCalendar] = [
    CityCalendar(
        key="uijeongbu",
        name="의정부시",
        region="경기도",
        url="https://www.ui4u.go.kr/portal/contents.do?mId=0301170000",
    ),
]

# 가족 나들이가 될 만한 행사만 (기념식·교육·종교 집회·보건 캠페인 등은 뺀다)
_KEEP = re.compile(
    r"축제|페스타|페스티벌|마켓|장터|공연|체험|음악|콘서트|영화|어린이|가족|문화|걷기|워킹|불꽃|박람회|"
    r"전시|놀이|야시장|버스킹|빛|트리|크리스마스|썰매|눈|벚꽃|단풍|꽃"
)
_DROP = re.compile(
    r"기념식|기념행사|표창|설명회|전도|예배|미사|법회|봉안|고유제|제례|추모|위령|자살|치매|보건|"
    r"검진|교육(?!.*축제)|세미나|포럼|회의|총회|시상식|선거|모집|공고|캠페인|주간\s*행사|추방"
)
_DAY_RANGE = re.compile(r"^(\d{1,2})(?:\s*[~\-–]\s*(?:(\d{1,2})\s*\.\s*)?(\d{1,2}))?$")


def _year_of(soup: BeautifulSoup, fallback: int) -> int:
    cap = soup.find("caption")
    m = re.search(r"(20\d\d)\s*년", cap.get_text(" ", strip=True) if cap else "")
    return int(m.group(1)) if m else fallback


def parse_day(month: int, cell: str, year: int) -> tuple[str, str, bool] | None:
    """('26' | '1~30' | '30~11.2' | '미정') → (시작, 끝, 날짜미정여부)."""
    text = cell.replace(" ", "").replace("일", "")
    if not text or "미정" in text or "중" in text:
        last = calendar.monthrange(year, month)[1]
        return date(year, month, 1).isoformat(), date(year, month, last).isoformat(), True
    m = _DAY_RANGE.match(text)
    if not m:
        return None
    d1, m2, d2 = m.groups()
    try:
        start = date(year, month, int(d1))
        if d2:
            end_month = int(m2) if m2 else month
            end_year = year + 1 if end_month < month else year
            end = date(end_year, end_month, int(d2))
        else:
            end = start
    except ValueError:
        return None
    return (start.isoformat(), end.isoformat(), False) if end >= start else None


def parse_calendar(html: str, city: CityCalendar, today: date) -> list[RawRecord]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []
    year = _year_of(soup, today.year)
    records: list[RawRecord] = []
    month = 0
    for n, tr in enumerate(table.find_all("tr")):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        if not cells or cells[0] in ("월",):
            continue
        # 월 칸은 여러 줄을 묶어(rowspan) 첫 줄에만 있다
        mm = re.fullmatch(r"(\d{1,2})\s*월", cells[0])
        if mm:
            month = int(mm.group(1))
            cells = cells[1:]
        if not month or len(cells) < 4:
            continue
        day_cell, title, place, content = cells[0], cells[1], cells[2], cells[3]
        contact = cells[4] if len(cells) > 4 else ""
        if not title or _DROP.search(title) or not _KEEP.search(f"{title} {content}"):
            continue
        parsed = parse_day(month, day_cell, year)
        if not parsed:
            continue
        start, end, approx = parsed
        if end < today.isoformat():
            continue
        address = f"{city.region} {city.name} {place}".strip()
        description = f"{content}. {city.name} 연간 행사 일정표에 실린 행사예요." + (
            " 날짜가 아직 정해지지 않았어요." if approx else ""
        )
        raw = "\n".join(
            [
                f"[출처] {city.name} 연간 행사·축제 일정",
                f"[제목] {title}",
                f"[기간] {start} ~ {end}",
                f"[장소] {place}",
                f"[주요내용] {content}",
                f"[문의] {contact}",
                "",
                "[본문]",
                content,
            ]
        )
        facts: dict[str, Any] = {
            "title": title,
            "start_date": start,
            "end_date": end,
            "address": address,
            "location_name": place or city.name,
            "official_link": city.url,
            "description": description,
        }
        records.append(
            RawRecord(
                source="city_calendar",
                # 같은 표 안에서 행사명+시작일로 구분 (표에는 고유 번호가 없다)
                source_id=f"{city.key}:{start}:{re.sub(r'[^0-9a-z가-힣]', '', title.lower())[:40]}",
                collected_at=now_utc(),
                title_hint=title,
                url=city.url,
                raw_text=raw,
                meta={"category_hint": "festival", "contact": contact, "city": city.name},
                facts=facts,
            )
        )
    return records


class CityCalendarCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        cities: list[CityCalendar] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self.client = client
        self.cities = cities or CITY_CALENDARS
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots

    def __enter__(self) -> CityCalendarCollector:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def _get(self, url: str) -> str:
        self.throttle.wait()
        if self.client is not None:
            resp = self.client.get(url)
        else:
            resp = httpx.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=40.0,
                follow_redirects=True,
                verify=tls_verify(url),
            )
        resp.raise_for_status()
        return resp.text

    def collect(self, *, today: date | None = None, past_days: int = 0) -> list[RawRecord]:
        ref = today or today_kst()
        records: list[RawRecord] = []
        failed = 0
        for city in self.cities:
            try:
                if self.check_robots and not robots_allowed(city.url):
                    logger.warning("robots.txt disallows %s; skipping", city.url)
                    continue
                got = parse_calendar(self._get(city.url), city, ref)
            except httpx.HTTPError as exc:
                failed += 1
                logger.warning("city calendar failed %s: %s", city.name, exc)
                continue
            logger.info("city calendar %s: %s events", city.name, len(got))
            records.extend(got)
        if failed == len(self.cities):
            raise RuntimeError("all city calendars failed")
        return records
