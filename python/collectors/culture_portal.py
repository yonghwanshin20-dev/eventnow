"""문화포털 '한눈에 보는 문화정보' (www.culture.go.kr) — API 키 불필요.

전국 문화행사 목록 화면(HTML)을 장르별로 읽는다. 제목·장르·지역·장소·기간·유무료·이미지가
정해진 구조로 나와 LLM 없이 facts 로 확정된다. robots.txt 확인 후 1초 간격으로 요청한다.
출처 표기: 문화포털(한국문화정보원).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup, Tag

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

BASE = "https://www.culture.go.kr"
LIST_URL = f"{BASE}/portal/cltInfo/oneCltInfo/list.do"
DETAIL_URL = f"{BASE}/portal/cltInfo/oneCltInfo/oneCltInfoView.do"
MAX_PAGES_PER_GENRE = 120
# 상세 화면(관람 연령·도로명 주소·운영 시간·요금·홈페이지)은 한 번 읽으면 저장해 두고 이 기간 뒤에 다시 읽는다
DETAIL_TTL_DAYS = 14
# 하루에 새로 읽는 상세 화면 수 상한 (1초 간격 — 첫 실행만 길고 이후엔 새 행사만)
MAX_DETAILS_PER_RUN = 320


def detail_url(seq: str) -> str:
    return f"{DETAIL_URL}?pblprfrSn={seq}&menuNo=200010"

# 장르 코드 → 우리 카테고리 힌트
GENRES: dict[str, str] = {
    "06": "exhibition",  # 전시
    "09": "kids_experience",  # 아동/가족
    "12": "kids_experience",  # 교육/체험
    "11": "festival",  # 행사/축제
}

# 교육/체험은 성인 강좌가 많아 가족 대상만 받는다
# '아이'는 '아이러니'·'아이디어'에 걸리지 않게 뒤 글자까지 본다
_FAMILY = re.compile(
    r"어린이|아동|가족|키즈|유아|초등|아이(?:와|랑|들|가|를|의|\s|$)|부모|엄마|아빠|자녀|꿈나무|청소년"
)
# 직접 갈 수 없는 온라인 행사는 나들이 큐레이션에서 뺀다
_ONLINE = re.compile(r"온라인|비대면|랜선|유튜브|라이브\s?스트리밍")
# 전시는 소규모 갤러리 개인전이 대부분이라 공공·대형 기관 전시와 아이 대상 전시만 받는다
_INSTITUTION = re.compile(
    r"미술관|박물관|과학관|문화재단|아트센터|예술의전당|문화예술회관|문화의전당|기념관|도서관|"
    r"문화원|아시아문화전당|아트홀|문화센터|전시관|동대문디자인플라자|DDP|국립|시립|도립|군립|구립"
)
_SOLO_SHOW = re.compile(r"개인전|입주작가|릴레이|레지던시|초대전")
# 가족이 갈 수 있는 행사가 아닌 글: 공지("단체관람 할인 안내", "대관 공고", "참가자 모집", "휴관"),
# 공연 일정 묶음 안내("10월 기획 공연 안내"), 학교 단체 전용 프로그램("[초등 학급단체]").
# "상설전 안내"처럼 전시 자체를 소개하는 글은 남긴다.
_NOTICE = re.compile(
    r"(?:모집|공고|공지|휴관|채용)\s*[)\]>」』]*\s*$|할인\s?안내|공연\s?안내|단체\s?관람|대관|"
    r"학급\s?단체|단체\s?교육|휴관"
)
_RANGE = re.compile(r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})")
REGION_SHORT = {
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원",
    "충북", "충남", "전북", "전남", "경북", "경남", "제주",
}


def is_family_outing_exhibition(title: str, venue: str) -> bool:
    """가족 나들이 큐레이션에 맞는 전시인지 (공공 기관 전시 또는 아이 대상)."""
    if _FAMILY.search(title):
        return True
    if _SOLO_SHOW.search(title):
        return False
    return bool(_INSTITUTION.search(f"{title} {venue}"))


class CulturePortalCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        genres: dict[str, str] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
        details: bool = False,
        cache_path: Path | None = None,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=30.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.genres = genres or GENRES
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots
        # 상세 화면까지 읽을지 (파이프라인에서 켠다) · 읽은 결과 저장 파일
        self.details = details
        self.cache_path = cache_path

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> CulturePortalCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def collect(self, *, today: date | None = None, past_days: int = 0) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(LIST_URL):
            raise PermissionError(f"robots.txt disallows {LIST_URL}")
        ref = ((today or today_kst()) - timedelta(days=past_days)).isoformat()
        records: list[RawRecord] = []
        seen: set[str] = set()
        skipped_adult = 0
        skipped_gallery = 0
        skipped_online = 0
        for code, hint in self.genres.items():
            for page in range(1, MAX_PAGES_PER_GENRE + 1):
                items = parse_list(self._fetch(code, page), genre_hint=hint)
                if not items:
                    break
                for record in items:
                    if record.source_id in seen:
                        continue
                    seen.add(record.source_id or "")
                    if (record.facts.get("end_date") or "") < ref:
                        continue
                    if _ONLINE.search(record.title_hint or ""):
                        skipped_online += 1
                        continue
                    if _NOTICE.search(record.title_hint or ""):
                        skipped_online += 1  # 갈 수 있는 행사가 아님 (공지·모집)
                        continue
                    if code == "12" and not _FAMILY.search(record.raw_text):
                        skipped_adult += 1
                        continue
                    if code == "06" and not is_family_outing_exhibition(
                        record.title_hint or "", str(record.facts.get("location_name") or "")
                    ):
                        skipped_gallery += 1
                        continue
                    records.append(record)
        logger.info(
            "culture portal collected %s events (skipped %s adult classes, %s gallery shows, %s online)",
            len(records),
            skipped_adult,
            skipped_gallery,
            skipped_online,
        )
        if self.details:
            self._enrich(records, today or today_kst())
        return records

    def _enrich(self, records: list[RawRecord], today: date) -> None:
        """상세 화면으로 관람 연령·도로명 주소·운영 시간·요금·홈페이지를 채운다 (저장본 우선)."""
        cache = _load_cache(self.cache_path)
        fresh_after = (today - timedelta(days=DETAIL_TTL_DAYS)).isoformat()
        fetched = failed = 0
        for record in records:
            seq = record.source_id or ""
            hit = cache.get(seq)
            if not hit or str(hit.get("fetched", "")) < fresh_after:
                if fetched >= MAX_DETAILS_PER_RUN:
                    if not hit:
                        continue
                else:
                    try:
                        self.throttle.wait()
                        resp = self.client.get(
                            DETAIL_URL, params={"pblprfrSn": seq, "menuNo": "200010"}
                        )
                        resp.raise_for_status()
                        hit = {**parse_detail(resp.text), "fetched": today.isoformat()}
                        cache[seq] = hit
                        fetched += 1
                    except httpx.HTTPError as exc:
                        failed += 1
                        logger.warning("culture detail failed %s: %s", seq, exc)
                        if not hit:
                            continue
            apply_detail(record, hit)
        # 지난 행사 저장본은 정리 (목록에서 사라진 지 오래된 것)
        live = {r.source_id for r in records}
        cache = {k: v for k, v in cache.items() if k in live or str(v.get("fetched", "")) >= fresh_after}
        _save_cache(self.cache_path, cache)
        logger.info("culture portal details: fetched %s, failed %s, cached %s", fetched, failed, len(cache))

    def _fetch(self, genre: str, page: int) -> str:
        self.throttle.wait()
        resp = self.client.get(
            LIST_URL, params={"menuNo": "200010", "genreCds": genre, "pageIndex": str(page)}
        )
        resp.raise_for_status()
        return resp.text


_AGE_TAG = re.compile(r"연령|세\s*이상|세\s*이하|개월|\d+\s*세")


def parse_detail(html: str) -> dict[str, str]:
    """상세 화면 → {age, address, hours, price, homepage} (없는 칸은 빠진다).

    관람 연령은 제목 위 꼬리표('전체연령가', '만 7세 이상'), 나머지는 dt/dd 칸('주소', '공연시간', '가격',
    '홈페이지'). 교육/체험 일부는 칸이 없어 빈 결과가 된다.
    """
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for ul in soup.select("ul.thumb-tag"):
        for li in ul.select("li.tag"):
            t = _text(li)
            if _AGE_TAG.search(t) and len(t) <= 20:
                out["age"] = t
                break
        if "age" in out:
            break
    labels = {"주소": "address", "공연시간": "hours", "가격": "price", "홈페이지": "homepage"}
    for dl in soup.select("dl"):
        key = labels.get(_text(dl.select_one("dt")))
        value = _text(dl.select_one("dd"))
        if key and value and key not in out:
            out[key] = value[:160]
    return out


def apply_detail(record: RawRecord, detail: dict[str, str]) -> None:
    """상세 화면 값으로 행사 사실 정보를 채운다. 목록 값보다 정확한 것만 덮는다."""
    facts = record.facts
    address = detail.get("address")
    # 목록의 주소는 '서울 + 장소명' 뿐이라 도로명 주소가 있으면 바꾼다 (지역·구 판정, 지도 검색이 정확해짐)
    if address and re.search(r"(?:로|길)\s*\d", address):
        facts["address"] = address
    if detail.get("age"):
        facts["age_info"] = detail["age"]
    price = detail.get("price")
    if price and len(price) <= 60:
        facts["price_info"] = price
    homepage = detail.get("homepage") or ""
    if not facts.get("official_link"):
        # 공식 홈페이지가 없으면 문화포털 상세 화면으로 (네이버 검색보다 정확)
        facts["official_link"] = homepage if homepage.startswith("http") else detail_url(record.source_id or "")
    if detail.get("hours"):
        record.meta["hours"] = detail["hours"]
    extra = [
        f"[관람연령] {detail['age']}" if detail.get("age") else "",
        f"[운영시간] {detail['hours']}" if detail.get("hours") else "",
        f"[주소] {address}" if address else "",
    ]
    record.raw_text = "\n".join([record.raw_text, *[x for x in extra if x]])


def _load_cache(path: Path | None) -> dict[str, dict[str, str]]:
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_cache(path: Path | None, cache: dict[str, dict[str, str]]) -> None:
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def _text(node: Tag | None) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def _field(item: Tag, label: str) -> str:
    for dl in item.select("dl.txt-list"):
        if _text(dl.select_one("dt")) == label:
            return _text(dl.select_one("dd"))
    return ""


def parse_list(html: str, *, genre_hint: str) -> list[RawRecord]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[RawRecord] = []
    for item in soup.select("#search_result_oneEyeTab li.list"):
        record = _item_to_raw(item, genre_hint)
        if record is not None:
            out.append(record)
    return out


def _item_to_raw(item: Tag, genre_hint: str) -> RawRecord | None:
    seq_input = item.select_one('input[name="subSeq"]')
    seq = str(seq_input.get("value") or "").strip() if seq_input else ""
    title = _text(item.select_one(".thumb-txt .tit"))
    period = _RANGE.search(_field(item, "기간"))
    if not seq or not title or not period:
        return None
    start, end = period.groups()

    tags = [_text(t) for t in item.select("ul.thumb-tag li.tag")]
    genre_name = tags[0] if tags else ""
    fee = next((t for t in tags if "무료" in t or "유료" in t), "")
    # '유료 , 할인' → '유료 · 할인'
    fee = re.sub(r"\s*,\s*", " · ", fee).strip(" ·")
    region_short = next((t for t in tags if t.removesuffix("시") in REGION_SHORT), "")
    region_short = region_short.removesuffix("시")
    venue = _field(item, "장소")
    organizer = _field(item, "주관") or _field(item, "주최")
    contact = _field(item, "문의")

    link_tag = item.select_one("a.btn-link") or item.select_one("a.btn-lik--homepage")
    href = str(link_tag.get("href") or "") if link_tag else ""
    official = href if href.startswith(("http://", "https://")) else None
    img_tag = item.select_one(".thumb-img img")
    img_src = str(img_tag.get("src") or "") if img_tag else ""
    thumbnail = urljoin(BASE, img_src) if img_src and "noimg" not in img_src else None

    # 목록에는 도로명 주소가 없어 '지역 + 장소명'을 주소로 쓴다 (지역 판정·지도 검색용)
    place = venue or organizer
    address = " ".join(p for p in (region_short, place) if p) or None

    lines = [
        "[출처] 문화포털 한눈에 보는 문화정보",
        f"[제목] {title}",
        f"[장르] {genre_name}",
        f"[기간] {start} ~ {end}",
        f"[지역] {region_short or '정보 없음'}",
        f"[장소] {venue or '정보 없음'}",
        f"[주관] {organizer or '정보 없음'}",
        f"[요금] {fee or '정보 없음'}",
        f"[문의] {contact or '정보 없음'}",
    ]
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start,
        "end_date": end,
        "address": address,
        "location_name": place or None,
        "thumbnail_url": thumbnail,
        "official_link": official,
        "price_info": fee or None,
    }
    return RawRecord(
        source="culture_portal",
        source_id=seq,
        collected_at=now_utc(),
        title_hint=title,
        url=official,
        raw_text="\n".join(lines),
        meta={
            "category_hint": genre_hint,
            "genre": genre_name,
            "venue": place,
            "contact": contact,
            "organizer": organizer,
        },
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )
