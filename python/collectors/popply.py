"""팝플리 (popply.co.kr) 팝업스토어 — API 키 없이, 브라우저 없이.

목록 화면(/popup)에서 상세 링크(/popup/{id})를 모으고, 상세 화면 HTML에서 제목·기간("26.10.16 -
26.11.05")·주소·운영 시간·소개·대표 사진을 읽는다. 화면 구조(태그·클래스)에 기대지 않고 글자 모양으로
찾아서 디자인이 조금 바뀌어도 버틴다. robots.txt(/api/ 만 금지)를 지키고 1초 간격으로 요청한다.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from regions import detect_region
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

# www. 주소는 매번 popply.co.kr 로 넘겨져(308) 요청이 두 배가 되므로 바로 쓴다
BASE = "https://popply.co.kr"
LIST_URL = f"{BASE}/popup"
# 목록에 150개 안팎 — 1초 간격이라 3분 정도
MAX_DETAILS = 160

_DETAIL_HREF = re.compile(r"^(?:https?://(?:www\.)?popply\.co\.kr)?/popup/(\d+)/?$")
# 26.10.16 - 26.11.05 / 2026.10.16 ~ 2026.11.05
_RANGE = re.compile(
    r"(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})\s*[-~–]\s*(?:(\d{2}|\d{4})\.)?(\d{1,2})\.(\d{1,2})"
)
_STREET = re.compile(r"[가-힣]+(?:구|시|군)\s+[가-힣0-9]+(?:로|길)\s*\d")
_VENUE_AFTER_NUMBER = re.compile(r"(?:로|길)\s*[\d-]+(?:\s*\S+층)?\s+(.+)$")
_SITE_SUFFIX = re.compile(r"\s*[|\-–]\s*(팝플리|popply).*$", re.I)


def _year(y: str) -> int:
    n = int(y)
    return 2000 + n if n < 100 else n


def parse_range(text: str) -> tuple[str, str] | None:
    m = _RANGE.search(text)
    if not m:
        return None
    y1, m1, d1, y2, m2, d2 = m.groups()
    try:
        start = date(_year(y1), int(m1), int(d1))
        end = date(_year(y2) if y2 else start.year, int(m2), int(d2))
    except ValueError:
        return None
    if end < start and not y2:
        end = date(end.year + 1, end.month, end.day)
    return (start.isoformat(), end.isoformat()) if end >= start else None


def _lines(soup: BeautifulSoup) -> list[str]:
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    return [ln.strip() for ln in soup.get_text("\n").splitlines() if ln.strip()]


def _block(lines: list[str], start_label: str, stop_labels: tuple[str, ...]) -> list[str]:
    """start_label 줄 다음부터 stop_labels 중 하나가 나오기 전까지."""
    norm = [ln.replace(" ", "") for ln in lines]
    try:
        i = norm.index(start_label.replace(" ", ""))
    except ValueError:
        return []
    out: list[str] = []
    for ln, n in zip(lines[i + 1 :], norm[i + 1 :]):
        if any(n.startswith(s.replace(" ", "")) for s in stop_labels):
            break
        out.append(ln)
    return out


def _hours(lines: list[str]) -> str:
    """'월~목', ':', '11:00 - 20:00', '금~일', ':', '11:00 - 21:00' → '월~목 11:00 - 20:00 · 금~일 11:00 - 21:00'"""
    parts = [ln for ln in _block(lines, "운영 시간", ("팝업스토어 소개", "정보", "주변")) if ln != ":"]
    pairs: list[str] = []
    i = 0
    while i < len(parts):
        if i + 1 < len(parts) and re.search(r"\d{1,2}:\d{2}", parts[i + 1]) and not re.search(r"\d:\d", parts[i]):
            pairs.append(f"{parts[i]} {parts[i + 1]}")
            i += 2
        else:
            pairs.append(parts[i])
            i += 1
    return " · ".join(pairs)[:120]


# 편의 정보 목록: 선택된 항목은 class가 비어 있고, 아닌 항목은 class="false"
_AMENITY_LABELS = (
    "주차가능", "주차불가", "입장료 유료", "입장료 무료", "반려동물", "웰컴 키즈존", "노키즈존",
    "식음료 반입 금지", "19세 이상", "와이파이 가능", "사진촬영 가능", "사전예약",
)


def selected_amenities(soup: BeautifulSoup) -> set[str]:
    chosen: set[str] = set()
    for li in soup.find_all("li"):
        text = li.get_text(" ", strip=True)
        if text in _AMENITY_LABELS and "false" not in (li.get("class") or []):
            chosen.add(text)
    return chosen


# 팝업 분야 (화면 태그) — 목록에서 '뷰티', '패션팝업' 같은 말로 나온다
_TOPICS = (
    "캐릭터", "키즈", "애니", "게임", "푸드", "디저트", "카페", "전시", "아트", "굿즈", "뷰티",
    "패션", "리빙", "라이프스타일", "스포츠", "음악", "도서", "반려",
)


def popup_topics(lines: list[str]) -> list[str]:
    zone = _block(lines, "지도보기", ("인스타그램", "정보", "후기"))
    found: list[str] = []
    for t in _TOPICS:
        if any(z == t or z == f"{t}팝업" for z in zone) and t not in found:
            found.append(t)
    return found[:3]


def parse_detail(html: str, url: str) -> RawRecord | None:
    """상세 화면 → 행사 한 건. 노키즈존·19세 이상 팝업은 가족 서비스에 맞지 않아 None.

    팝플리 소개글은 '무단 복제 금지' 저작물이라 옮기지 않는다 — 이름·기간·장소·운영 시간·분야 같은
    사실 정보로 짧은 안내만 만들고, 자세한 내용은 원문 링크(official_link)로 보낸다.
    """
    soup = BeautifulSoup(html, "html.parser")
    og_title = soup.find("meta", property="og:title")
    og_image = soup.find("meta", property="og:image")
    title = ""
    if og_title and og_title.get("content"):
        title = str(og_title["content"])
    elif soup.find("h1"):
        title = soup.find("h1").get_text(" ", strip=True)
    elif soup.title:
        title = soup.title.get_text(" ", strip=True)
    title = _SITE_SUFFIX.sub("", title).strip()

    # 링크 미리보기용으로 공개한 대표 이미지만 쓴다
    image = str(og_image["content"]) if og_image and og_image.get("content") else None

    amenities = selected_amenities(soup)
    if amenities & {"노키즈존", "19세 이상"}:
        return None

    lines = _lines(soup)
    # 날짜가 '26.10.15' / '-' / '26.10.21' 처럼 여러 줄로 나뉘어 있어 위쪽을 이어 붙여 찾는다
    head = " ".join(lines[:40])
    period = parse_range(head)
    addr_idx = next(
        (
            i
            for i, ln in enumerate(lines[:60])
            if 6 <= len(ln) <= 80 and detect_region(ln) and _STREET.search(ln)
        ),
        None,
    )
    if not title or not period or addr_idx is None:
        return None
    address = lines[addr_idx]
    # 주소 다음 줄이 장소 이름 ("더현대 서울 B2 비클린존") — '지도보기'면 없음
    nxt = lines[addr_idx + 1] if addr_idx + 1 < len(lines) else ""
    venue = nxt if nxt and nxt != "지도보기" and len(nxt) <= 40 else None
    if not venue:
        venue_match = _VENUE_AFTER_NUMBER.search(address)
        venue = venue_match.group(1).strip() if venue_match else None

    hours = _hours(lines)
    topics = popup_topics(lines)
    kid_welcome = "웰컴 키즈존" in amenities or any(t in ("캐릭터", "키즈", "애니") for t in topics)
    topic_text = "·".join(topics)
    description = " ".join(
        part
        for part in (
            f"{venue or '성수·여의도 등'}에서 열리는 {topic_text + ' ' if topic_text else ''}팝업스토어예요.",
            "아이와 함께 가기 좋아요." if "웰컴 키즈존" in amenities else "",
            "사전 예약이 필요해요." if "사전예약" in amenities else "",
            f"\n운영 시간 {hours}" if hours else "",
            "\n자세한 내용은 팝플리 원문에서 확인하세요.",
        )
        if part
    ).strip()
    popup_id = _DETAIL_HREF.match(url.replace(BASE, "")) or re.search(r"/popup/(\d+)", url)
    source_id = popup_id.group(1) if popup_id else url

    price = "무료" if "입장료 무료" in amenities else ("유료" if "입장료 유료" in amenities else None)
    raw = "\n".join(
        [
            "[출처] 팝플리 팝업스토어",
            f"[제목] {title}",
            f"[기간] {period[0]} ~ {period[1]}",
            f"[주소] {address}",
            f"[운영시간] {hours or '정보 없음'}",
            f"[분야] {topic_text or '없음'}",
            f"[편의] {', '.join(sorted(amenities)) or '없음'}",
            "",
            "[본문]",
            description,
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": period[0],
        "end_date": period[1],
        "address": address,
        "location_name": venue or address,
        "thumbnail_url": urljoin(BASE, image) if image else None,
        "official_link": url,
        "description": description,
        "price_info": price,
        "booking_required": "사전예약" in amenities,
        "age_info": "웰컴 키즈존" if kid_welcome else None,
    }
    return RawRecord(
        source="popply",
        source_id=source_id,
        collected_at=now_utc(),
        title_hint=title,
        url=url,
        raw_text=raw,
        meta={"category_hint": "popup", "hours": hours, "topics": topics, "amenities": sorted(amenities)},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


def detail_links(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    seen: list[str] = []
    for a in soup.find_all("a", href=True):
        m = _DETAIL_HREF.match(str(a["href"]).strip())
        if m:
            url = f"{BASE}/popup/{m.group(1)}"
            if url not in seen:
                seen.append(url)
    return seen


class PopplyCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        min_interval: float = 1.0,
        check_robots: bool = True,
        max_details: int = MAX_DETAILS,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=30.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots
        self.max_details = max_details

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> PopplyCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _get(self, url: str) -> str:
        self.throttle.wait()
        resp = self.client.get(url)
        resp.raise_for_status()
        return resp.text

    def collect(self, *, today: date | None = None, past_days: int = 0) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(LIST_URL):
            raise PermissionError(f"robots.txt disallows {LIST_URL}")
        links = detail_links(self._get(LIST_URL))
        if not links:
            # 화면 구조가 바뀌어 링크를 못 찾으면 조용히 0건이 아니라 실패로 알린다
            raise RuntimeError("popply list page had no /popup/{id} links")
        ref = ((today or today_kst()) - timedelta(days=past_days)).isoformat()
        records: list[RawRecord] = []
        failed = 0
        for url in links[: self.max_details]:
            try:
                record = parse_detail(self._get(url), url)
            except httpx.HTTPError as exc:
                logger.warning("popply detail failed %s: %s", url, exc)
                failed += 1
                continue
            if record is None:
                failed += 1
                continue
            if (record.facts.get("end_date") or "") >= ref:
                records.append(record)
        logger.info(
            "popply collected %s popups (links=%s, unparsed=%s)", len(records), len(links), failed
        )
        return records
