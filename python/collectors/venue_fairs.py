"""수도권 전시장 일정 — 코엑스·킨텍스·세텍·수원메쎄 (API 키 불필요).

베이비페어, 캣·펫쇼, 보드게임·일러스트·코믹 행사처럼 일반 관람객이 표를 끊고 가는 '소비자 박람회'와,
가구·리빙·재테크·유학·뷰티·커피처럼 엄마·아빠가 아이 없이 가 볼 박람회('parents' 분류)를 채운다.
전시장 공식 일정표 HTML(서버에서 그려 주는 목록)만 읽고,
업계 전용 전시(산업·기술·의료), 회의·세미나, 채용·분양 박람회는 거른다.
robots.txt: 코엑스(/wp-content/uploads 만 막음 — 사진은 쓰지 않음)·킨텍스·세텍·수원메쎄 모두 허용.
1초 간격. 출처 표기: 각 전시장 행사 일정.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

import httpx
from bs4 import BeautifulSoup

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

WINDOW_DAYS = 150
MAX_PAGES = 8

# 업계·업무용 행사 — 일반 관람객이 갈 일이 없다
_B2B = re.compile(
    r"컨퍼런스|콘퍼런스|세미나|설명회|포럼|심포지엄|학술|총회|워크숍|시상식|경연대회|"
    r"채용|취업|이민|웨딩|입주|분양|프랜차이즈|창업|소상공인|중소기업|우수상품|"
    r"산업|기술|자동화|공구|용접|금속|소부장|에너지|바이오|인터펙스|의료|헬스케어|병원|치과|"
    r"반도체|건설|보안|물류|로봇|팩토리|플랜트|테크쇼|미디어테크|선물\s?박람회|"
    r"\bAI\b|AIoT|수소|hydrogen|드론|모빌리티|승강기|소싱|발명|상표|특허|테크|tech|"
    r"Geo|국제전시회|"
    r"주짓수|복싱|격투|오토살롱|튜닝|조선|해양플랜트|농기계|수산|축산|"
    r"\bB2B\b|바이어|수출|상담회|정책|공공기관|교육청",
    re.I,
)
# 아이 없이 엄마·아빠가 관심 가질 박람회 (가구·리빙·집·돈·교육·뷰티·커피·술)
_PARENTS = re.compile(
    r"가구|인테리어|리빙|홈\s?테이블|홈\s?데코|데코|건축|집짓기|전원주택|재테크|부동산|"
    r"유학|입학|입시|진학|교육\s?박람회|뷰티|미용|화장품|코스메틱|"
    r"카페|커피|베이커리|주류|위스키|캐스크|와인|맥주|사케|칵테일|티\s?&|차\s?박람회|크래프트",
    re.I,
)
# 소비자 박람회 이름에 흔한 말 (이게 하나도 없으면 행사 성격을 알 수 없어 뺀다)
_CONSUMER = re.compile(
    r"페어|fair|박람회|엑스포|expo|페스타|festa|페스티벌|festival|쇼|show|마켓|market|전시|展|"
    r"코믹|일러스트|캐릭터|보드게임|플리|카니발|위크|week",
    re.I,
)
_KIDS = re.compile(r"베이비|baby|육아|유아|키즈|kids|어린이|맘|임신|출산|장난감|토이|교구|베페|코베")


def is_consumer_fair(title: str) -> bool:
    return bool(_CONSUMER.search(title)) and not _B2B.search(title)


def category_hint(title: str, kind: str = "") -> str:
    if _KIDS.search(title):
        return "kids_experience"
    if re.search(r"pop-?up|팝업", f"{kind} {title}", re.I):
        return "popup"
    if _PARENTS.search(title):
        return "parents"
    return "exhibition"


def _date(s: str) -> date | None:
    m = re.search(r"(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})", s)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def parse_range(text: str) -> tuple[date, date] | None:
    """'2026.10.29~2026.11.01', '2026-11-21 ~ 2026-11-22', '2026.10.28 - 2026.10.30'"""
    parts = re.split(r"\s*[~\-–]\s*(?=\d{4})", text.strip(), maxsplit=1)
    start = _date(parts[0])
    end = _date(parts[1]) if len(parts) > 1 else start
    if not start or not end or end < start:
        return None
    return start, end


@dataclass
class Venue:
    key: str
    name: str
    address: str
    list_url: str
    parse: Callable[[str], list[dict[str, Any]]]
    # 페이지 번호 → 요청 파라미터 (None 이면 한 페이지만)
    params: Callable[[int, date], dict[str, str]] | None = None


def parse_coex(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a.BlogEventItem-link"):
        inner = a.select_one(".BlogEventItemCont:not(.asp) .BlogEventItemCont-inner") or a
        title = inner.select_one(".BlogEventItemCont-tit")
        when = inner.select_one(".BlogEventItemCont-date")
        if not title or not when:
            continue
        kind = inner.select_one(".BlogEventItemCont-cate")
        hall = inner.select_one(".BlogEventItemCont-hall")
        link = str(a.get("href") or "").split("?")[0]
        out.append({
            "title": title.get_text(" ", strip=True),
            "when": when.get_text(" ", strip=True),
            "hall": hall.get_text(" ", strip=True) if hall else "",
            "kind": kind.get_text(strip=True) if kind else "",
            "link": link,
        })
    return out


def parse_kintex(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a.btn-square-item"):
        title = a.select_one(".item-subject")
        when = a.select_one(".item-date")
        if not title or not when:
            continue
        m = re.search(r"fnView\('[^']*',\s*(\d+)\)", str(a.get("href") or ""))
        label = a.select_one(".event-label-ko")
        hall = a.select_one(".item-client")
        out.append({
            "title": title.get_text(" ", strip=True),
            "when": when.get_text(" ", strip=True),
            "hall": re.sub(r"\s+", " ", hall.get_text(" ", strip=True)) if hall else "",
            "kind": label.get_text(strip=True) if label else "",
            "link": f"https://www.kintex.com/web/ko/event/view.do?seq={m.group(1)}" if m else "",
        })
    return out


def parse_setec(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a[onclick*='fn_view']"):
        title = a.select_one(".txt strong")
        if not title:
            continue
        lis = [li.get_text(" ", strip=True) for li in a.select(".txt li")]
        when = next((x for x in lis if x.startswith("기간")), "")
        hall = next((x for x in lis if x.startswith("장소")), "")
        out.append({
            "title": title.get_text(" ", strip=True),
            "when": when.split(":", 1)[-1],
            "hall": hall.split(":", 1)[-1].strip(),
            "kind": "",
            # 상세 화면은 POST 라 목록 화면으로 보낸다
            "link": "https://www.setec.or.kr/front/schedule/list.do",
        })
    return out


def parse_suwon(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    out = []
    seen: set[str] = set()
    for slide in soup.select(".swiper-slide"):
        title = slide.select_one(".fair-title strong")
        when = slide.select_one(".fair-date")
        a = slide.select_one("a[href*='event_document']")
        if not title or not when:
            continue
        name = title.get_text(" ", strip=True)
        if name in seen:
            continue  # 슬라이드는 반복 복제된다
        seen.add(name)
        out.append({
            "title": name,
            "when": when.get_text(" ", strip=True).replace("기간 :", ""),
            "hall": "",
            "kind": "",
            "link": str(a.get("href")) if a else "https://suwonmesse.com/",
        })
    return out


VENUES = [
    Venue(
        "coex", "코엑스", "서울특별시 강남구 영동대로 513",
        "https://www.coex.co.kr/event/full-schedules/", parse_coex,
        lambda page, today: {
            "var_page": str(page),
            "search_start_date": today.strftime("%Y.%m.%d"),
            "search_end_date": (today + timedelta(days=WINDOW_DAYS)).strftime("%Y.%m.%d"),
            "list_type": "LIST",
        },
    ),
    Venue(
        "kintex", "킨텍스", "경기도 고양시 일산서구 킨텍스로 217-60",
        "https://www.kintex.com/web/ko/event/list.do", parse_kintex,
        lambda page, today: {
            "pageIndex": str(page),
            "searchStartDt": today.isoformat(),
            "searchEndDt": (today + timedelta(days=WINDOW_DAYS)).isoformat(),
        },
    ),
    Venue(
        "setec", "세텍(SETEC)", "서울특별시 강남구 남부순환로 3104",
        "https://www.setec.or.kr/front/schedule/list.do", parse_setec,
        lambda page, today: {"pageIndex": str(page)},
    ),
    Venue(
        "suwonmesse", "수원메쎄", "경기도 수원시 권선구 세화로134번길 37",
        "https://www.suwonmesse.com/", parse_suwon,
    ),
]


def item_to_raw(venue: Venue, item: dict[str, Any], *, today: date) -> RawRecord | None:
    title = re.sub(r"\s+", " ", item["title"]).strip()
    rng = parse_range(item["when"])
    if not title or not rng:
        return None
    start, end = rng
    if end < today or start > today + timedelta(days=WINDOW_DAYS):
        return None
    if (
        not is_consumer_fair(title)
        and not _PARENTS.search(title)
        and "pop" not in item.get("kind", "").lower()
    ):
        return None
    if _B2B.search(title):
        return None
    hall = item.get("hall") or ""
    place = f"{venue.name} {hall}".strip()
    sid = f"{venue.key}-" + hashlib.sha1(f"{title}|{start}".encode()).hexdigest()[:12]
    raw = "\n".join(
        [
            f"[출처] {venue.name} 행사 일정",
            f"[제목] {title}",
            f"[기간] {start} ~ {end}",
            f"[장소] {place} ({venue.address})",
            "",
            "[본문]",
            f"{venue.name}에서 열리는 {title}",
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "address": venue.address,
        "location_name": place,
        "official_link": item.get("link") or venue.list_url,
        "description": f"{venue.name}{' ' + hall if hall else ''}에서 열리는 박람회예요. 입장료·사전등록은 공식 안내를 확인하세요.",
    }
    return RawRecord(
        source="venue_fair",
        source_id=sid,
        collected_at=now_utc(),
        title_hint=title,
        url=facts["official_link"],
        raw_text=raw,
        meta={"category_hint": category_hint(title, item.get("kind", "")), "venue": venue.key},
        facts=facts,
    )


class VenueFairCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        venues: list[Venue] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=40.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.venues = venues or VENUES
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> VenueFairCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _venue(self, venue: Venue, today: date) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(venue.list_url):
            logger.warning("robots.txt disallows %s — skipped", venue.list_url)
            return []
        records: list[RawRecord] = []
        seen: set[str] = set()
        for page in range(1, (MAX_PAGES if venue.params else 1) + 1):
            self.throttle.wait()
            params = venue.params(page, today) if venue.params else None
            resp = self.client.get(venue.list_url, params=params)
            resp.raise_for_status()
            items = venue.parse(resp.text)
            new = [i for i in items if f"{i['title']}|{i['when']}" not in seen]
            if not new:
                break
            for item in new:
                seen.add(f"{item['title']}|{item['when']}")
                rec = item_to_raw(venue, item, today=today)
                if rec:
                    records.append(rec)
        logger.info("venue %s: listed %s, kept %s", venue.key, len(seen), len(records))
        return records

    def collect(self, *, today: date | None = None) -> list[RawRecord]:
        ref = today or today_kst()
        records: list[RawRecord] = []
        for venue in self.venues:
            try:
                records.extend(self._venue(venue, ref))
            except (httpx.HTTPError, ValueError) as err:
                logger.warning("venue %s failed: %s", venue.key, err)
        if not records:
            raise RuntimeError("no venue fairs collected — page formats may have changed")
        return records
