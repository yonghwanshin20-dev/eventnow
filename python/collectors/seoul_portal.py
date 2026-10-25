"""서울문화포털 문화행사 (culture.seoul.go.kr) — API 키 불필요.

자치구·구 문화재단이 올린 축제·공연·체험이 많이 모이는 곳이라 '[서대문구] …', '[마포문화재단] …'
같은 동네 행사를 채운다. 목록 JSON(jsonList.json — 화면의 지도 보기가 쓰는 것)에 제목·기간·좌표·
주소·장소·분야가 있고, 상세 화면에서 대상(나이)·요금·시간·홈페이지를 읽는다(저장해 두고 새 행사만).
robots.txt 는 /culture/culture/ 를 허용한다. 1초 간격으로 요청한다. 출처 표기: 서울문화포털.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup

from collectors.culture_portal import _FAMILY, _NOTICE, _ONLINE, is_family_outing_exhibition
from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

SITE = "https://culture.seoul.go.kr"
LIST_URL = f"{SITE}/culture/culture/cultureEvent/jsonList.json"
VIEW_URL = f"{SITE}/culture/culture/cultureEvent/view.do"
PAGE_SIZE = 10
MAX_PAGES = 60
# 앞으로 이 기간 안에 열리는 행사만 받는다
WINDOW_DAYS = 120
DETAIL_TTL_DAYS = 14
MAX_DETAILS_PER_RUN = 320

# 분야 → 우리 카테고리 힌트
GROUPS: dict[str, str] = {
    "FESTIVAL": "festival",
    "EDUEXP": "kids_experience",
    "EXHIBITION": "exhibition",
    "SHOW": "kids_experience",
}


def view_url(cultcode: str) -> str:
    return f"{VIEW_URL}?cultcode={cultcode}&menuNo=200010"


def _coord(value: Any, lo: float, hi: float) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if lo <= v <= hi else None


def item_to_raw(item: dict[str, Any], group: str) -> RawRecord | None:
    code = str(item.get("cultcode") or "").strip()
    title = str(item.get("title") or "").strip()
    start = str(item.get("strtdate") or "")[:10]
    end = str(item.get("endDate") or "")[:10]
    if not code or not title or not re.match(r"\d{4}-\d{2}-\d{2}$", start) or not re.match(r"\d{4}-\d{2}-\d{2}$", end):
        return None
    address = str(item.get("addr") or "").strip()
    place = str(item.get("facName") or "").strip()
    # 좌표: xCoord 가 위도(37.x), yCoord 가 경도(126.x)
    lat = _coord(item.get("xCoord"), 33, 39)
    lng = _coord(item.get("yCoord"), 124, 132)
    if lat is None or lng is None:
        lat = lng = None
    img = str(item.get("mainImg") or "")
    thumb = f"{SITE}{img}" if img.startswith("/") else (img if img.startswith("http") else None)
    desc = re.sub(r"\s+", " ", str(item.get("thumbDesc") or "")).strip()
    if desc.startswith(title):
        desc = desc[len(title):].strip()
    raw = "\n".join(
        [
            "[출처] 서울문화포털 문화행사",
            f"[제목] {title}",
            f"[분야] {item.get('subjcodeNm') or group}",
            f"[기간] {start} ~ {end}",
            f"[장소] {place or '정보 없음'}",
            f"[주소] {address or '정보 없음'}",
            "",
            "[본문]",
            desc[:600],
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start,
        "end_date": end,
        "address": address or (f"서울 {place}" if place else None),
        "location_name": place or None,
        "latitude": lat,
        "longitude": lng,
        "thumbnail_url": thumb,
        "official_link": view_url(code),
        "description": desc[:300] or None,
    }
    return RawRecord(
        source="seoul_portal",
        source_id=code,
        collected_at=now_utc(),
        title_hint=title,
        url=view_url(code),
        raw_text=raw,
        meta={"category_hint": GROUPS.get(group, "festival"), "genre": item.get("subjcodeNm"), "group": group},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


_DETAIL_LABELS = {"대상": "age", "요금": "price", "시간": "hours", "문의": "contact"}
_WON = re.compile(r"(\d{1,3}(?:,\d{3})+|\d{4,})\s*원")


def is_pricey(price: str | None, limit: int = 100_000) -> bool:
    """요금 글자 속 가장 싼 금액이 limit 이상이면 True ('1,534,500원' → True, '전석 20,000원' → False)."""
    amounts = [int(m.replace(",", "")) for m in _WON.findall(price or "")]
    return bool(amounts) and min(amounts) >= limit


def parse_detail(html: str) -> dict[str, str]:
    """상세 화면: '장소 | … | 기간 | … | 시간 | … | 대상 | 누구나 | 요금 | 무료 | 문의 | …' + 홈페이지 링크."""
    soup = BeautifulSoup(html, "html.parser")
    homepage = None
    for a in soup.find_all("a"):
        if "홈페이지" in a.get_text(" ", strip=True) and str(a.get("href", "")).startswith("http"):
            homepage = str(a["href"])
            break
    for t in soup(["script", "style"]):
        t.decompose()
    lines = [ln.strip() for ln in soup.get_text("\n").splitlines() if ln.strip()]
    out: dict[str, str] = {}
    for i, ln in enumerate(lines[:-1]):
        key = _DETAIL_LABELS.get(ln)
        if key and key not in out:
            value = lines[i + 1]
            if value not in _DETAIL_LABELS and len(value) <= 80:
                out[key] = value
    if homepage:
        out["homepage"] = homepage
    return out


def apply_detail(record: RawRecord, detail: dict[str, str]) -> None:
    facts = record.facts
    if detail.get("age"):
        facts["age_info"] = detail["age"]
    if detail.get("price") and len(detail["price"]) <= 60:
        facts["price_info"] = detail["price"]
    if detail.get("homepage"):
        facts["official_link"] = detail["homepage"]
    hours = detail.get("hours")
    if hours and hours not in ("행사 별 상이", "-"):
        record.meta["hours"] = hours
        desc = facts.get("description") or ""
        facts["description"] = f"{desc}\n운영 시간 {hours}".strip()
    record.raw_text += "".join(
        f"\n[{label}] {detail[key]}" for key, label in (("age", "대상"), ("price", "요금"), ("hours", "시간")) if detail.get(key)
    )


class SeoulPortalCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        groups: dict[str, str] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
        details: bool = False,
        cache_path: Path | None = None,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=40.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.groups = groups or GROUPS
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots
        self.details = details
        self.cache_path = cache_path

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> SeoulPortalCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _page(self, group: str, page: int, today: date) -> list[dict[str, Any]]:
        self.throttle.wait()
        resp = self.client.post(
            LIST_URL,
            data={
                "menuNo": "200010",
                "pageIndex": str(page),
                "isSearched": "Y",
                "searchCate": group,
                "sdate": today.isoformat(),
                "edate": (today + timedelta(days=WINDOW_DAYS)).isoformat(),
            },
        )
        resp.raise_for_status()
        return list(resp.json().get("resultList") or [])

    def collect(self, *, today: date | None = None, past_days: int = 0) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(VIEW_URL):
            raise PermissionError(f"robots.txt disallows {VIEW_URL}")
        ref = today or today_kst()
        records: list[RawRecord] = []
        seen: set[str] = set()
        skipped = 0
        for group in self.groups:
            for page in range(1, MAX_PAGES + 1):
                items = self._page(group, page, ref)
                for item in items:
                    record = item_to_raw(item, group)
                    if record is None or record.source_id in seen:
                        continue
                    seen.add(record.source_id or "")
                    title = record.title_hint or ""
                    if (record.facts.get("end_date") or "") < ref.isoformat():
                        continue
                    if _ONLINE.search(title) or _NOTICE.search(title):
                        skipped += 1
                        continue
                    blob = f"{title}\n{record.raw_text}"
                    # 공연·교육은 성인 대상이 많아 가족 대상만, 전시는 공공 기관·아이 대상만
                    if group in ("SHOW", "EDUEXP") and not _FAMILY.search(blob):
                        skipped += 1
                        continue
                    if group == "EXHIBITION" and not is_family_outing_exhibition(
                        title, str(record.facts.get("location_name") or "")
                    ):
                        skipped += 1
                        continue
                    records.append(record)
                if len(items) < PAGE_SIZE:
                    break
        logger.info("seoul portal collected %s events (skipped %s not for families)", len(records), skipped)
        if not records and not seen:
            raise RuntimeError("seoul portal returned no events — list format may have changed")
        if self.details:
            self._enrich(records, ref)
            # 상세 요금이 10만 원 이상이면 나들이 행사가 아니라 예약 서비스(전통혼례 대관 등)다
            before = len(records)
            records = [r for r in records if not is_pricey(r.facts.get("price_info"))]
            if before != len(records):
                logger.info("seoul portal: dropped %s high-priced services", before - len(records))
        return records

    def _enrich(self, records: list[RawRecord], today: date) -> None:
        cache: dict[str, dict[str, str]] = {}
        if self.cache_path and self.cache_path.exists():
            try:
                cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cache = {}
        fresh_after = (today - timedelta(days=DETAIL_TTL_DAYS)).isoformat()
        fetched = 0
        for record in records:
            code = record.source_id or ""
            hit = cache.get(code)
            if (not hit or str(hit.get("fetched", "")) < fresh_after) and fetched < MAX_DETAILS_PER_RUN:
                try:
                    self.throttle.wait()
                    resp = self.client.get(VIEW_URL, params={"cultcode": code, "menuNo": "200010"})
                    resp.raise_for_status()
                    hit = {**parse_detail(resp.text), "fetched": today.isoformat()}
                    cache[code] = hit
                    fetched += 1
                except httpx.HTTPError as exc:
                    logger.warning("seoul portal detail failed %s: %s", code, exc)
            if hit:
                apply_detail(record, hit)
        live = {r.source_id for r in records}
        cache = {k: v for k, v in cache.items() if k in live or str(v.get("fetched", "")) >= fresh_after}
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
            )
        logger.info("seoul portal details: fetched %s, cached %s", fetched, len(cache))
