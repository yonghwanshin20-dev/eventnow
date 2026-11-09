"""동네 문화기관 일정 — 시·구립 도서관 강좌·행사, 고양문화재단 공연·전시 (API 키 불필요).

전국 목록(축제 달력·문화포털·서울문화포털)에는 동네 도서관의 그림책 놀이·작가와의 만남·가족 체험이 거의
오르지 않는다. 여러 시·구 도서관이 같은 도서관 홈페이지 시스템을 써서 목록 화면이
'대상 : … · 장소 : … · 접수기간 : … ~ … · 행사기간 : … ~ …' 모양으로 같다 — 그 글자만 읽는다.
아이·가족 대상만 남기고(성인·청소년 전용 강좌는 뺀다), 정원이 찬 것('접수마감')과 끝난 것은 뺀다.
도서관 위치는 목록의 줄임 이름('화정', '응암')을 공공데이터 전국도서관 목록과 맞춰 채운다.

고양문화재단(아람누리·어울림누리)은 공연·전시 목록 + 상세의 입장연령을 읽어 아이와 볼 수 있는 것만 남긴다.

robots.txt: 고양시도서관(없음=허용)·은평구립도서관(/libcms/ 등만 막음)·서대문구립도서관(검색 결과만 막음)·
고양문화재단(/OP/ 만 막음). 1초 간격. 출처 표기: 각 기관 누리집.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup, Tag

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

WINDOW_DAYS = 120
MAX_PAGES = 25


@dataclass(frozen=True)
class LibrarySite:
    key: str  # 출처 ID 앞머리
    name: str  # '고양시도서관'
    region: str  # '경기도'
    district: str  # '고양시'
    list_url: str
    detail_url: str  # {idx} 자리에 강좌 번호
    params: dict[str, str] = field(default_factory=dict)
    # 목록 쪽 번호 매개변수
    page_param: str = "currentPageNo"


LIBRARY_SITES: list[LibrarySite] = [
    LibrarySite(
        key="goyanglib",
        name="고양시도서관",
        region="경기도",
        district="고양시",
        list_url="https://www.goyanglib.or.kr/center/menu/10045/program/30013/lectureList.do",
        detail_url="https://www.goyanglib.or.kr/center/menu/10045/program/30013/lectureDetail.do?lectureIdx={idx}",
    ),
    LibrarySite(
        key="eplib",
        name="은평구립도서관",
        region="서울특별시",
        district="은평구",
        list_url="https://www.eplib.or.kr/intro/menu/10122/program/30028/eventLectureList.do",
        detail_url="https://www.eplib.or.kr/intro/menu/10122/program/30028/eventLectureDetail.do?searchStatus=OPEN&lectureIdx={idx}",
        params={"searchStatus": "OPEN"},
    ),
    LibrarySite(
        key="sdmlib-event",
        name="서대문구립도서관",
        region="서울특별시",
        district="서대문구",
        list_url="https://lib.sdm.or.kr/sdmlib/menu/10091/program/30025/eventList.do",
        detail_url="https://lib.sdm.or.kr/sdmlib/menu/10091/program/30025/eventDetail.do?eventIdx={idx}",
    ),
    LibrarySite(
        key="sdmlib",
        name="서대문구립도서관",
        region="서울특별시",
        district="서대문구",
        list_url="https://lib.sdm.or.kr/sdmlib/menu/10088/program/30024/lectureList.do",
        detail_url="https://lib.sdm.or.kr/sdmlib/menu/10088/program/30024/lectureDetail.do?lectureIdx={idx}",
    ),
    # 은평·서대문 옆 마포 (표 모양 목록 — 구 전체 도서관이 한 표에 나온다)
    LibrarySite(
        key="mplib",
        name="마포구립도서관",
        region="서울특별시",
        district="마포구",
        list_url="https://mplib.mapo.go.kr/purme/MENU1847/PGM3021/lectureList.do",
        detail_url="https://mplib.mapo.go.kr/purme/MENU1847/PGM3021/lectureDetail.do?lectureId={idx}",
    ),
    LibrarySite(
        key="gnlib",
        name="강남구립도서관",
        region="서울특별시",
        district="강남구",
        list_url="https://library.gangnam.go.kr/intro/menu/10045/program/30013/lectureList.do",
        detail_url="https://library.gangnam.go.kr/intro/menu/10045/program/30013/lectureDetail.do?lectureIdx={idx}",
    ),
    LibrarySite(
        key="splib",
        name="송파구립도서관",
        region="서울특별시",
        district="송파구",
        list_url="https://www.splib.or.kr/intro/menu/10052/program/30014/eventList.do",
        detail_url="https://www.splib.or.kr/intro/menu/10052/program/30014/eventDetail.do?eventIdx={idx}",
    ),
]

_DATE = r"(20\d\d)\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})"
_LABELS = r"강의기간|행사기간|교육기간|운영기간|접수기간|모집기간|신청기간|참여대상|대상|장소|수강료|참가비|키워드|행사시간|강의시간|신청|온라인|오프라인"
_FIELD = re.compile(rf"({_LABELS})\s*:\s*(.*?)(?=\s(?:{_LABELS})\s*:|$)")
_TIME = re.compile(r"(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})")
_DETAIL_ID = re.compile(r"fnDetail\(\s*'?([A-Za-z0-9]+)'?")

# 아이·가족이 함께할 수 있는 대상
_KIDS_TARGET = re.compile(
    r"유아|영유아|어린이|아동|초등|미취학|가족|부모와|보호자\s*1인|자녀와|전\s*연령|누구나|제한\s*없|이용자|"
    r"(?<!\d)(?:[1-9]|1[0-2])\s*세|개월|키즈"
)
# 대상 칸에 이게 있고 아이 쪽 말(유아·초등·가족…)이 없으면 어른 강좌
_ADULT_TARGET = re.compile(
    r"성인|시니어|어르신|중장년|청년|대학생|양육자|직장인|퇴근|자원\s*활동|자녀를\s*둔|학부모\s*대상|"
    r"(?<!\d)(?:[2-9]\d|1[3-9])\s*세\s*(?:이상|~)|만\s*1[89]\s*세"
)
_CHILD_WORD = re.compile(r"유아|어린이|아동|초등|미취학|가족|자녀와|보호자\s*1인|개월|(?<!\d)[1-9]\s*세")
_KIDS_TITLE = re.compile(r"그림책|어린이|유아|아이|가족|키즈|초등|동화|인형극|엄마|아빠|체험|만들기|놀이")
# 행사가 아니라 안내·상시 서비스인 글
_NOT_EVENT = re.compile(
    r"큐레이션|독서\s*퀴즈|이용\s*안내|대출|온라인|주제\s*도서전|견학|자원\s*활동가|독서\s*통장|챌린지|설문|"
    r"상시\s*전시|\[상시\]|동아리|도서전|북\s*인사이트|신간|잡지|이달의\s*직업|지은이를\s*찾아|빅데이터|독서\s*이벤트|"
    r"환경을\s*읽는|책\s*나눔"
)
_SKIP_STATUS = re.compile(r"접수마감|마감|종료|온라인마감")
# 이보다 길게 이어지는 건 행사가 아니라 상시 운영
MAX_SPAN_DAYS = 90


def _ymd(m: re.Match[str] | tuple[str, str, str]) -> date | None:
    y, mo, d = m.groups() if isinstance(m, re.Match) else m
    try:
        return date(int(y), int(mo), int(d))
    except ValueError:
        return None


def _range(text: str) -> tuple[date | None, date | None]:
    found = [d for d in (_ymd(m) for m in re.finditer(_DATE, text)) if d]
    if not found:
        return None, None
    return found[0], (found[1] if len(found) > 1 else found[0])


def _item_box(anchor: Tag) -> Tag | None:
    """제목 링크에서 위로 올라가며 이 강좌 하나만 담은 칸을 찾는다."""
    idx = _DETAIL_ID.search(str(anchor.get("onclick") or anchor.get("href") or ""))
    box = anchor
    for _ in range(8):
        parent = box.parent
        if not isinstance(parent, Tag):
            break
        ids = set(_DETAIL_ID.findall(str(parent)))
        if idx and len(ids) > 1:
            break
        box = parent
        if re.search(r"기간\s*:", box.get_text(" ", strip=True)):
            # 상태 칸(접수중·마감)까지 담도록 한 칸 더 본다
            up = box.parent
            if isinstance(up, Tag) and set(_DETAIL_ID.findall(str(up))) <= {idx.group(1) if idx else ""}:
                box = up
            return box
    return None


def parse_library_list(html: str) -> list[dict[str, Any]]:
    """도서관 강좌·행사 목록 → [{idx, title, lib, fields{}, status, paid, tags}]"""
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", onclick=_DETAIL_ID):
        title = a.get_text(" ", strip=True)
        m = _DETAIL_ID.search(str(a.get("onclick")))
        if not title or not m or m.group(1) in seen:
            continue
        box = _item_box(a)
        if box is None:
            continue
        seen.add(m.group(1))
        text = re.sub(r"\s+", " ", box.get_text(" ", strip=True))
        fields: dict[str, str] = {}
        for label, value in _FIELD.findall(text):
            fields.setdefault(label, value.strip())
        lib = box.find(class_=re.compile(r"\blib\b"))
        status = box.find(class_=re.compile(r"\bstatus\b"))
        targets = [t.get_text(" ", strip=True) for t in box.find_all(class_=re.compile(r"\btarget\b"))]
        pay = box.find(class_=re.compile(r"payment"))
        out.append(
            {
                "idx": m.group(1),
                "title": title,
                "lib": lib.get_text(" ", strip=True) if lib else "",
                "fields": fields,
                "status": status.get_text(" ", strip=True) if status else "",
                "targets": targets,
                "paid": pay.get_text(" ", strip=True) if pay else "",
                "text": text,
            }
        )
    return out


# 표 모양 목록의 머리글 → 카드 모양 목록의 항목 이름
_TABLE_HEADS = {"기관명": "lib", "도서관": "lib", "상태": "status", "프로그램명": "title", "강좌명": "title",
                "대상": "대상", "행사일": "행사기간", "교육기간": "교육기간", "강의기간": "강의기간",
                "접수기간": "접수기간", "참가료": "수강료", "수강료": "수강료", "장소": "장소"}


def parse_library_table(html: str) -> list[dict[str, Any]]:
    """'기관명 | 상태 | 프로그램명 | 대상 | 행사일 | 신청/대기 | 참가료' 표 (마포구립도서관)."""
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        heads = [_TABLE_HEADS.get(th.get_text(" ", strip=True), "") for th in table.select("thead th")]
        if "title" not in heads:
            continue
        for tr in table.select("tbody tr"):
            cells = tr.find_all("td")
            if len(cells) != len(heads):
                continue
            a = tr.find("a", href=_DETAIL_ID) or tr.find("a", onclick=_DETAIL_ID)
            m = _DETAIL_ID.search(str(a.get("href") or a.get("onclick"))) if a else None
            if not m:
                continue
            row = {h: re.sub(r"\s+", " ", c.get_text(" ", strip=True)) for h, c in zip(heads, cells) if h}
            fields = {k: v for k, v in row.items() if k not in ("lib", "status", "title")}
            out.append(
                {
                    "idx": m.group(1),
                    "title": row.get("title", ""),
                    "lib": row.get("lib", ""),
                    "fields": fields,
                    "status": row.get("status", ""),
                    "targets": [],
                    "paid": fields.get("수강료", ""),
                    "text": " ".join(row.values()),
                }
            )
    return out


def is_family_program(item: dict[str, Any]) -> bool:
    target = " ".join([item["fields"].get("참여대상") or item["fields"].get("대상") or "", *item.get("targets", [])])
    target = target.strip()
    if _NOT_EVENT.search(item["title"]):
        return False
    if target and _ADULT_TARGET.search(target) and not _CHILD_WORD.search(target):
        return False
    if target and _KIDS_TARGET.search(target):
        return True
    return bool(_KIDS_TITLE.search(item["title"]))


@dataclass
class LibraryIndex:
    """공공데이터 전국도서관 목록에서 시·구별 도서관 이름 → (정식 이름, 주소, 위도, 경도)."""

    rows: list[dict[str, Any]]

    def find(self, region: str, district: str, short: str, place: str) -> tuple[str, str, float, float] | None:
        def squash(s: str) -> str:
            return re.sub(r"[^0-9a-z가-힣]", "", s.lower())

        cands = [
            r
            for r in self.rows
            if district in f"{r.get('SIGNGU_NM', '')} {r.get('RDNMADR', '')}" and region[:2] in str(r.get("CTPRVN_NM", ""))
        ]
        keys = [k for k in (squash(place.split()[0]) if place else "", squash(short)) if len(k) >= 2]
        for key in keys:
            hits = [r for r in cands if key in squash(str(r.get("LBRRY_NM", "")))]
            if not hits and key.endswith("도서관"):
                continue
            hits.sort(key=lambda r: len(str(r.get("LBRRY_NM", ""))))
            for r in hits:
                try:
                    lat, lng = float(r["LATITUDE"]), float(r["LONGITUDE"])
                except (KeyError, TypeError, ValueError):
                    continue
                return str(r["LBRRY_NM"]), str(r.get("RDNMADR") or r.get("LNMADR") or ""), lat, lng
        return None


def library_item_to_raw(
    item: dict[str, Any], site: LibrarySite, *, today: date, index: LibraryIndex | None = None
) -> RawRecord | None:
    f = item["fields"]
    start, end = _range(f.get("강의기간") or f.get("행사기간") or f.get("교육기간") or f.get("운영기간") or "")
    if not start or not end or end < today or start > today + timedelta(days=WINDOW_DAYS):
        return None
    target_text = item["fields"].get("참여대상") or item["fields"].get("대상") or " ".join(item.get("targets", []))
    # 오래 이어지는 건 상시 운영 — 매주 여는 아이 대상 프로그램(그림책 놀이·현장참여)만 남긴다
    if (end - start).days > MAX_SPAN_DAYS and not _CHILD_WORD.search(target_text):
        return None
    if _SKIP_STATUS.search(item.get("status") or "") and "대기" not in (item.get("status") or ""):
        return None
    if not is_family_program(item):
        return None
    place = f.get("장소", "")
    short = item.get("lib") or ""
    found = index.find(site.region, site.district, short, place) if index else None
    if found:
        lib_name, address, lat, lng = found
    else:
        lib_name = f"{short}도서관" if short and "도서관" not in short else (short or site.name)
        address, lat, lng = f"{site.region} {site.district}", None, None
    apply = f.get("접수기간") or f.get("모집기간") or f.get("신청기간") or ""
    # '2026.11.09 10:00 ~ 2026.11.19 18:00' — 시각은 빼야 신청 기간으로 읽힌다
    apply = re.sub(r"\s*\d{1,2}:\d{2}", "", apply)
    target = f.get("참여대상") or f.get("대상") or " ".join(item.get("targets", []))
    times = _TIME.search(f.get("행사시간") or f.get("강의시간") or item["text"])
    price = "무료" if "무료" in f"{f.get('수강료', '')} {f.get('참가비', '')} {item.get('paid', '')}" else (
        f.get("수강료") or f.get("참가비") or None
    )
    if price and price != "무료" and "유료" in price:
        price = "유료"
    where = place if place and lib_name.replace(" ", "") in place.replace(" ", "") else f"{lib_name} {place}".strip()
    desc_parts = [
        f"{site.name} 프로그램이에요.",
        f"대상: {target}" if target else "",
        f"장소: {where}" if where else "",
        f"시간: {times.group(1)}~{times.group(2)}" if times else "",
        "도서관 홈페이지에서 신청해야 해요." if apply else "",
    ]
    description = " ".join(p for p in desc_parts if p)
    raw = "\n".join(
        [
            f"[출처] {site.name} 강좌·행사",
            f"[제목] {item['title']}",
            f"[기간] {start.isoformat()} ~ {end.isoformat()}",
            f"[장소] {lib_name} {place}".strip(),
            f"[주소] {address}",
            f"[대상] {target}",
            f"[신청] 접수기간 {apply}" if apply else "",
            f"[상태] {item.get('status', '')}",
            "",
            "[본문]",
            description,
        ]
    )
    facts: dict[str, Any] = {
        "title": item["title"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "address": address,
        "location_name": lib_name,
        "latitude": lat,
        "longitude": lng,
        "official_link": site.detail_url.format(idx=item["idx"]),
        "description": description,
        "age_info": target or None,
        "price_info": price,
    }
    return RawRecord(
        source="local_culture",
        source_id=f"{site.key}-{item['idx']}",
        collected_at=now_utc(),
        title_hint=item["title"],
        url=facts["official_link"],
        raw_text=raw,
        meta={"category_hint": "kids_experience", "venue": lib_name, "place_types": ["library"]},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


# ── 고양문화재단 (아람누리·어울림누리) ──────────────────────────────────────────────

ARTGY = "https://www.artgy.or.kr"
ARTGY_LISTS = {"PF": f"{ARTGY}/PF/PF0201L.aspx", "EH": f"{ARTGY}/EH/EH0201L.aspx"}
ARTGY_VENUES = {
    "아람": ("고양아람누리", "경기도 고양시 일산동구 중앙로 1286", 37.6577, 126.7710),
    "어울림": ("고양어울림누리", "경기도 고양시 덕양구 어울림로 33", 37.6315, 126.8321),
}
_ARTGY_DATES = re.compile(_DATE + r"\([^)]*\)(?:\s*~\s*" + _DATE + r")?")
# 동호회·학교의 정기연주회·발표회·졸업전처럼 가족 나들이로 보기 어려운 대관 행사
_ARTGY_SKIP = re.compile(r"정기\s*연주회|정기\s*공연|정기\s*연주|발표회|졸업|입시|콩쿠르|경연|동문|회원전|정기전|협회전|강연|특강|세미나")
_ARTGY_KIDS = re.compile(r"어린이|가족|아이|키즈|동화|인형극|그림책|유아|뮤지컬|마술|매직|호두까기|크리스마스|체험|놀이|만들기|공작소|탐구")
_AGE = re.compile(r"(\d{1,2})\s*(세|개월)")


def parse_artgy_list(html: str, kind: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    view = "PF0201V" if kind == "PF" else "EH0201V"
    for a in soup.find_all("a", href=re.compile(view + r"\.aspx\?showid=")):
        sid = re.search(r"showid=(\d+)", a["href"])
        if not sid:
            continue
        box = a.find_parent("li") or a.parent
        text = re.sub(r"\s+", " ", box.get_text(" ", strip=True)) if box else ""
        m = _ARTGY_DATES.search(text)
        if not m or sid.group(1) in seen:
            continue
        title = a.get_text(" ", strip=True)
        if not title or title in ("상세", "예매", "찜"):
            continue
        seen.add(sid.group(1))
        start = _ymd(m.groups()[:3])
        end = _ymd(m.groups()[3:]) if m.group(4) else start
        venue = next((v for v in ARTGY_VENUES if re.search(rf"\b{v}\b|{v}누리", text)), "")
        out.append({"id": sid.group(1), "kind": kind, "title": title, "start": start, "end": end, "venue": venue})
    return out


def parse_artgy_detail(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style"]):
        t.decompose()
    lines = [ln.strip() for ln in soup.get_text("\n").splitlines() if ln.strip()]
    out: dict[str, str] = {}
    labels = {
        "입장연령": "age", "관람연령": "age", "관람등급": "age",
        "입장료": "price", "관람료": "price",
        "공연장소": "place", "전시장소": "place", "장소": "place",
        "장르/테마": "genre", "공연시간": "hours", "관람시간": "duration",
    }
    for i, ln in enumerate(lines[:-1]):
        key = labels.get(ln)
        if key and key not in out:
            out[key] = lines[i + 1][:80]
    # 티켓 오픈 안내 (신청 기간으로 읽힌다)
    for ln in lines:
        if re.search(r"(?:일반\s*)?예매\s*:", ln) and re.search(r"\d{1,2}월\s*\d{1,2}일", ln):
            out["apply"] = f"티켓 오픈 {ln.split(':', 1)[1].strip()}"
            break
    img = soup.find("meta", property="og:image")
    if img and str(img.get("content", "")).startswith("http"):
        out["image"] = str(img["content"])
    return out


def artgy_min_age(age: str) -> int | None:
    if re.search(r"전체|누구나|제한\s*없", age):
        return 0
    m = _AGE.search(age)
    if not m:
        return None
    n = int(m.group(1))
    return n // 12 if m.group(2) == "개월" else n


def is_family_artgy(item: dict[str, Any], detail: dict[str, str]) -> bool:
    title = item["title"]
    if _ARTGY_SKIP.search(title) and not _ARTGY_KIDS.search(title):
        return False
    age = artgy_min_age(detail.get("age", ""))
    if age is not None and age >= 13:
        return False
    if item["kind"] == "EH":
        # 전시는 대개 나이 제한이 없다
        return True
    if _ARTGY_KIDS.search(f"{title} {detail.get('genre', '')}"):
        return True
    # 공연은 가족 공연(24·36개월 이상 입장)만 — 7·8세 이상 콘서트·연극은 어른 공연이 많다
    return age is not None and age <= 3


def artgy_to_raw(item: dict[str, Any], detail: dict[str, str], *, today: date) -> RawRecord | None:
    start, end = item["start"], item["end"]
    if not start or not end or end < today or start > today + timedelta(days=WINDOW_DAYS):
        return None
    if not is_family_artgy(item, detail):
        return None
    venue = ARTGY_VENUES.get(item["venue"]) or ARTGY_VENUES["아람"]
    name, address, lat, lng = venue
    place = detail.get("place") or name
    kind = "공연" if item["kind"] == "PF" else "전시"
    price = detail.get("price") or None
    if price and re.search(r"무료", price):
        price = "무료"
    lines = [
        f"고양문화재단 {kind}이에요.",
        f"장소: {place}",
        f"입장 연령: {detail['age']}" if detail.get("age") else "",
        f"시간: {detail['hours']}" if detail.get("hours") else "",
    ]
    description = " ".join(x for x in lines if x)
    link = f"{ARTGY}/{item['kind']}/{item['kind']}0201V.aspx?showid={item['id']}"
    raw = "\n".join(
        [
            "[출처] 고양문화재단",
            f"[제목] {item['title']}",
            f"[분야] {detail.get('genre') or kind}",
            f"[기간] {start.isoformat()} ~ {end.isoformat()}",
            f"[장소] {place}",
            f"[주소] {address}",
            f"[대상] {detail.get('age', '')}",
            f"[요금] {price or ''}",
            f"[신청] {detail['apply']}" if detail.get("apply") else "",
            "",
            "[본문]",
            description,
        ]
    )
    facts: dict[str, Any] = {
        "title": item["title"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "address": address,
        "location_name": name,
        "latitude": lat,
        "longitude": lng,
        "official_link": link,
        "thumbnail_url": detail.get("image"),
        "description": description,
        "age_info": detail.get("age"),
        "price_info": price if price and len(price) <= 60 else None,
    }
    return RawRecord(
        source="local_culture",
        source_id=f"artgy-{item['id']}",
        collected_at=now_utc(),
        title_hint=item["title"],
        url=link,
        raw_text=raw,
        meta={
            "category_hint": "exhibition" if item["kind"] == "EH" else "kids_experience",
            "venue": name,
            "genre": detail.get("genre"),
        },
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


class LocalCultureCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        sites: list[LibrarySite] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
        cache_path: Path | None = None,
        library_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(timeout=40.0, follow_redirects=True, headers={"User-Agent": USER_AGENT})
        self.sites = LIBRARY_SITES if sites is None else sites
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots
        self.cache_path = cache_path
        self.library_rows = library_rows

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> LocalCultureCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _get(self, url: str, params: dict[str, str] | None = None) -> str:
        self.throttle.wait()
        resp = self.client.get(url, params=params)
        resp.raise_for_status()
        return resp.text

    def _library_index(self) -> LibraryIndex | None:
        if self.library_rows is not None:
            return LibraryIndex(self.library_rows)
        try:
            from collectors.public_data import PublicDataCollector

            std = PublicDataCollector(self.client, check_robots=self.check_robots)
            std.throttle = self.throttle
            return LibraryIndex(std._rows("15013109"))
        except (httpx.HTTPError, KeyError, ValueError) as err:
            logger.warning("library index unavailable: %s", err)
            return None

    def _libraries(self, today: date) -> tuple[list[RawRecord], int]:
        index = self._library_index()
        out: list[RawRecord] = []
        failed = 0
        for site in self.sites:
            if self.check_robots and not robots_allowed(site.list_url):
                logger.warning("robots.txt disallows %s", site.list_url)
                failed += 1
                continue
            kept = listed = 0
            try:
                for page in range(1, MAX_PAGES + 1):
                    html = self._get(site.list_url, {**site.params, site.page_param: str(page)})
                    items = parse_library_list(html) or parse_library_table(html)
                    if not items:
                        break
                    listed += len(items)
                    fresh = 0
                    for item in items:
                        start, end = _range(
                            item["fields"].get("강의기간") or item["fields"].get("행사기간") or ""
                        )
                        if end and end >= today:
                            fresh += 1
                        rec = library_item_to_raw(item, site, today=today, index=index)
                        if rec:
                            out.append(rec)
                            kept += 1
                    # 최근 등록 순이라 한 쪽이 통째로 지난 강좌면 그 뒤도 지난 것
                    if fresh == 0:
                        break
            except httpx.HTTPError as err:
                logger.warning("library %s failed: %s", site.key, err)
                failed += 1
            logger.info("library %s: listed %s, kept %s", site.key, listed, kept)
        return out, failed

    def _artgy(self, today: date) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(ARTGY_LISTS["PF"]):
            logger.warning("robots.txt disallows %s", ARTGY)
            return []
        cache: dict[str, dict[str, str]] = {}
        if self.cache_path and self.cache_path.exists():
            try:
                cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cache = {}
        items: list[dict[str, Any]] = []
        for kind, url in ARTGY_LISTS.items():
            for page in range(1, 8):
                found = parse_artgy_list(self._get(url, {"page": str(page)}), kind)
                new = [i for i in found if i["id"] not in {x["id"] for x in items}]
                if not new:
                    break
                items.extend(new)
        out: list[RawRecord] = []
        stale = (today - timedelta(days=14)).isoformat()
        for item in items:
            if not item["end"] or item["end"] < today:
                continue
            key = f"{item['kind']}-{item['id']}"
            detail = cache.get(key)
            if not detail or str(detail.get("fetched", "")) < stale:
                try:
                    view = f"{ARTGY}/{item['kind']}/{item['kind']}0201V.aspx"
                    detail = {**parse_artgy_detail(self._get(view, {"showid": item["id"]})), "fetched": today.isoformat()}
                    cache[key] = detail
                except httpx.HTTPError as err:
                    logger.warning("artgy detail %s failed: %s", key, err)
                    detail = {}
            rec = artgy_to_raw(item, detail, today=today)
            if rec:
                out.append(rec)
        live = {f"{i['kind']}-{i['id']}" for i in items}
        if self.cache_path:
            cache = {k: v for k, v in cache.items() if k in live}
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        logger.info("artgy: listed %s, kept %s", len(items), len(out))
        return out

    def collect(self, *, today: date | None = None) -> list[RawRecord]:
        ref = today or today_kst()
        records, failed = self._libraries(ref)
        try:
            records.extend(self._artgy(ref))
        except httpx.HTTPError as err:
            logger.warning("artgy failed: %s", err)
            failed += 1
        if failed and not records:
            raise RuntimeError("local culture sites unreachable")
        return records
