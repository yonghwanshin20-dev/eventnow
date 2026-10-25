"""규칙 기반 정제기 — API 키·LLM 비용 없이 RawRecord → NormalizedEvent.

구조화 소스(facts에 제목·날짜·주소가 있는 kfes·TourAPI·서울시)는 그대로 확정하고,
분류(카테고리·아이 동반·연령·태그·장소 유형·편의시설)만 키워드 규칙으로 채운다.
비정형 소스는 본문에서 날짜·주소를 정규식으로 찾고, 못 찾으면 버린다.
ClaudeEventParser와 같은 ParseResult를 돌려줘 파이프라인에서 바꿔 끼울 수 있다.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

from models import NormalizedEvent, RawRecord
from parsers.base import ParseResult
from regions import detect_region

logger = logging.getLogger(__name__)

# --- 카테고리 -------------------------------------------------------------

_POPUP = re.compile(r"팝업|pop[\s-]?up", re.I)
_EXHIBITION = re.compile(r"전시|특별전|기획전|展|비엔날레|아트페어|사진전|미술관|박물관")
_KIDS = re.compile(r"어린이|키즈|유아|아이와|아이랑|아동|꿈나무|동화|그림책|놀이터")
_PERFORMANCE_ONLY = re.compile(r"^(콘서트|클래식|국악|무용|뮤지컬/오페라|연극|독주/독창회)$")


# '10월 문화프로그램 안내', '4분기 정규강좌 안내', '가을 시즌 프로그램 안내', '10월 상영 프로그램' —
# 행사가 아니라 기관의 정기 프로그램 묶음 안내. 그 기관(도서관 등)은 관광명소로 따로 넣는다.
_PROGRAM_NOTICE = re.compile(
    r"(?:\d{1,2}\s*월|\d\s*분기|상반기|하반기|봄|여름|가을|겨울)\s*(?:시즌\s*)?"
    r"(?:문화|정규|교육|상영|평생학습)?\s*(?:프로그램|강좌|강의|교실)"
    r"|문화\s*프로그램\s*안내|프로그램\s*안내|정규\s*강좌|강좌\s*안내|수강생\s*모집"
)
# 이런 말이 있으면 안내가 아니라 특별한 행사다 ('도서관 독서축제', '북 페스티벌', 'OO 이벤트')
_SPECIAL_EVENT = re.compile(r"축제|페스티벌|페스타|festival|이벤트|박람회|마켓|북토크|공연|체험전|특별전|기념행사", re.I)


def is_program_notice(title: str) -> bool:
    return bool(_PROGRAM_NOTICE.search(title)) and not _SPECIAL_EVENT.search(title)


def classify_category(record: RawRecord, title: str, body: str) -> str | None:
    hint = str(record.meta.get("category_hint") or "")
    codename = str(record.meta.get("codename") or "")
    if hint == "popup" or _POPUP.search(title):
        return "popup"
    if hint == "attraction":
        # 관광지·박물관·유적지 목록에서 온 '장소' — 제목의 '어린이'·'전시' 등에 흔들리지 않게 먼저
        return "attraction"
    if _KIDS.search(title):
        return "kids_experience"
    if _EXHIBITION.search(title) or "전시" in codename:
        return "exhibition"
    if codename and _PERFORMANCE_ONLY.match(codename):
        # 일반 공연은 가족 나들이 큐레이션 범위 밖 — 어린이 대상만 받는다
        return "kids_experience" if _KIDS.search(body) else None
    if "교육" in codename or "체험" in codename:
        return "kids_experience" if _KIDS.search(body) else "festival"
    if hint in ("festival", "exhibition", "popup", "kids_experience"):
        return hint
    return "festival"


# --- 가족 · 연령 ----------------------------------------------------------

# "아이디어·아이돌"에 걸리지 않게 조사까지 본다
_FAMILY = re.compile(
    r"어린이|아이(?:와|랑|들|가|를|의|\s)|가족|키즈|유아|아동|초등|누구나|전\s?연령|남녀노소"
)
_AGE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("toddler", re.compile(r"영유아|유아|\d{2}개월|0\s?[~-]\s?\d세")),
    ("kids", re.compile(r"미취학|유치원|(?<!\d)[4-7]\s?세")),
    ("elementary", re.compile(r"초등")),
    ("all", re.compile(r"누구나|전\s?연령|전체\s?연령|모든\s?연령|제한\s?없음|전체\s?관람|남녀노소|가족")),
]


_ADULT_ONLY = re.compile(r"성인\s?전용|19세\s?이상|미성년자?\s?(입장|관람)\s?불가|청소년\s?관람\s?불가")


def is_family_friendly(category: str, text: str, age_info: str | None = None) -> bool:
    """명시적 가족 키워드, 또는 체험 프로그램이 있고 성인 전용이 아닌 행사."""
    blob = f"{age_info or ''}\n{text}"
    if _ADULT_ONLY.search(blob):
        return False
    if category in ("kids_experience", "attraction") or _FAMILY.search(blob):
        return True
    return "체험" in blob


def classify_age(text: str) -> str | None:
    for value, pattern in _AGE_RULES:
        if pattern.search(text):
            return value
    return None


# --- 세부 나이 범위 (만 나이, 년) ----------------------------------------------
# "만 4~7세", "5-7세", "6세 이상", "7세 이하", "36개월 이상", "24~48개월", "초등 1~3학년", "초등 저학년"
_N = r"(\d{1,2})"
_AGE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"(?:만\s*)?{_N}\s*(?:개월)?\s*[~\-–]\s*{_N}\s*개월"), "months_range"),
    (re.compile(rf"(?:만\s*)?{_N}\s*개월\s*(?:이상|부터|~(?!\s*\d))"), "months_min"),
    (re.compile(rf"(?:만\s*)?{_N}\s*세?\s*[~\-–]\s*(?:만\s*)?{_N}\s*세"), "years_range"),
    (re.compile(rf"(?:만\s*)?{_N}\s*세\s*(?:이상|부터|~(?!\s*\d))"), "years_min"),
    (re.compile(rf"(?:만\s*)?{_N}\s*세\s*(?:이하|미만|까지)"), "years_max"),
    (re.compile(r"초등\s*(?:학생)?\s*([1-6])\s*[~\-–]\s*([1-6])\s*학년"), "grades"),
    (re.compile(r"초등\s*(?:학생)?\s*([1-6])\s*학년\s*이상"), "grade_min"),
    (re.compile(r"초등\s*저학년"), "low_elem"),
    (re.compile(r"초등\s*고학년"), "high_elem"),
]


def extract_age_range(text: str) -> tuple[float | None, float | None]:
    """본문에서 대상 나이 범위(만 나이, 년)를 찾는다. 못 찾으면 (None, None).

    '19세 이상'처럼 어른 대상 표기는 무시한다(가족 행사 판단은 is_family_friendly가 따로 한다).
    초등 n학년은 만 n+6세로 본다 (1학년 = 만 7세).
    """
    for pattern, kind in _AGE_PATTERNS:
        for m in pattern.finditer(text):
            found = _age_from_match(m, kind, text)
            if found:
                return found
    return None, None


# "7세 이하 무료", "36개월 미만 입장료 할인", "만 65세 이상 경로"처럼 요금·동반 규칙은 대상 나이가 아니다
_PRICE_AFTER = re.compile(r"^[\s)]*(?:\S{0,4}\s*)?(?:무료|할인|요금|\d[\d,]*\s*원|동반|보호자|입장\s?가능\s?\(무료)")


def _age_from_match(m: re.Match[str], kind: str, text: str) -> tuple[float | None, float | None] | None:
    if _PRICE_AFTER.search(text[m.end() : m.end() + 14]):
        return None
    g = [int(x) for x in m.groups() if x is not None]
    lo: float | None
    hi: float | None
    if kind == "months_range":
        lo, hi = g[0] / 12, g[1] / 12
    elif kind == "months_min":
        lo, hi = g[0] / 12, None
    elif kind == "years_range":
        lo, hi = g[0], g[1]
    elif kind == "years_min":
        lo, hi = g[0], None
    elif kind == "years_max":
        lo, hi = None, g[0]
    elif kind == "grades":
        lo, hi = g[0] + 6, g[1] + 6
    elif kind == "grade_min":
        lo, hi = g[0] + 6, 12
    elif kind == "low_elem":
        lo, hi = 7, 9
    else:  # high_elem
        lo, hi = 10, 12
    if lo is not None and lo >= 14:
        return None  # 청소년·성인 대상 표기 ("19세 이상", "14세 이상")
    if hi is not None and hi > 18:
        hi = None
    if lo is not None and hi is not None and lo > hi:
        return None
    return (round(lo, 2) if lo is not None else None, round(hi, 2) if hi is not None else None)


# --- 태그 · 장소 유형 · 편의시설 -------------------------------------------

_TAG_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("#체험", re.compile(r"체험|만들기|클래스|워크숍")),
    ("#교육", re.compile(r"교육|강좌|배우기")),
    ("#야외", re.compile(r"야외|공원|광장|한강|해변|숲|들판")),
    ("#실내", re.compile(r"실내|전시관|미술관|박물관|센터|홀\b|도서관")),
    ("#야간", re.compile(r"야간|밤|달빛|야경|불빛|빛축제|미디어아트")),
    ("#꽃", re.compile(r"꽃|국화|벚꽃|장미|억새|코스모스|튤립|유채")),
    ("#불꽃", re.compile(r"불꽃")),
    ("#먹거리", re.compile(r"먹거리|푸드|음식|맛|시식|특산물")),
    ("#공연", re.compile(r"공연|콘서트|버스킹|퍼레이드")),
    ("#전통", re.compile(r"전통|민속|국악|한복|문화제")),
]
MAX_TAGS = 6

_PLACE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("park_playground", re.compile(r"공원(?!묘지)|놀이터|한강|랜드|테마파크|워터파크|놀이공원|유원지|동물원|아쿠아리움")),
    ("historical", re.compile(r"궁\b|궁궐|유적|왕릉|읍성|향교|서원|성곽|산성|고택|한옥마을|민속촌|[가-힣]릉\b|사적")),
    ("museum", re.compile(r"박물관|미술관|기념관|과학관|전시관|역사관|자연사|천문대|뮤지엄|museum", re.I)),
    ("cultural_space", re.compile(r"복합\s?문화|문화\s?공간|아트센터|문화센터|문화원|문화의\s?전당|문화예술회관|문화비축기지|문화역|DDP|동대문디자인플라자|생활문화")),
    ("nature", re.compile(r"숲|휴양림|수목원|숲체원|식물원|생태|계곡|폭포|해변|해수욕장|호수|습지|오름|국립공원|자연경관|명승")),
    # "행사"·"회사"에 걸리지 않도록 일반 '~사' 패턴은 쓰지 않는다
    ("religious", re.compile(r"사찰|템플스테이|산사|연등|봉축|불교|성당|교회|성지|순교")),
    ("library", re.compile(r"도서관|책마을|북카페")),
]
# 관광명소 이름에만 쓰는 더 넓은 규칙 — 행사 장소('○○광장에서 축제')에 쓰면 너무 많이 걸린다
_ATTRACTION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("historical", re.compile(r"생가|가옥|고가|종택|[가-힣]댁\b|사당|묘\b|[가-힣]관$|원림|진지|봉수대|옛터|유허")),
    ("museum", re.compile(r"문학관|전수관|체험관|문화관|홍보관|기록관")),
    ("nature", re.compile(r"온천|포구|해안|강변|섬\b|[가-힣]도$|출렁다리|누리길|둘레길|산림욕|약수|바다|해수|산$|[가-힣]산\s|계곡|천$|강$|호$|저수지|댐|전망대|관광지$")),
    ("park_playground", re.compile(r"리조트|파크|관광단지|테마|체험마을|농촌|어촌|휴양마을|월드|피아|스키|레저|캠핑|촬영장|세트장")),
    ("cultural_space", re.compile(r"문화의?\s?거리|광장|마켓|몰$|아트밸리|예술촌|문화마을|벽화마을")),
]
# 절 이름 '…사'·'…암' — 장소(관광명소) 이름에만 쓴다
_TEMPLE_NAME = re.compile(r"[가-힣]{1,4}(?:사|암)(?:\s|\(|$)")

_PARKING_NO = re.compile(r"주차\s?(불가|어려|없음|공간\s?없)")


def classify_tags(text: str, price: str | None = None) -> list[str]:
    tags = [tag for tag, pattern in _TAG_RULES if pattern.search(text)][:MAX_TAGS]
    # 무료 여부는 본문 언급이 아니라 요금 필드로만 판단
    if price and "무료" in price and not price.strip().startswith("유료"):
        tags.append("#무료")
    return tags


def classify_place_types(text: str) -> list[str]:
    return [value for value, pattern in _PLACE_RULES if pattern.search(text)]


def place_types_for(record: RawRecord, title: str, core: str, category: str) -> list[str]:
    """장소 유형. 관광명소는 이름으로 먼저 정하고(수집기가 준 유형 포함), 행사는 장소·설명에서 찾는다."""
    if category != "attraction":
        return classify_place_types(core)
    found = classify_place_types(title)
    for hint in record.meta.get("place_types") or []:
        if hint not in found:
            found.append(hint)
    if _TEMPLE_NAME.search(title) and "religious" not in found and "museum" not in found:
        found.append("religious")
    if not found:
        found = [v for v, p in _ATTRACTION_RULES if p.search(title)][:1]
    # 이름에서 못 찾으면 설명까지 본다
    return found or classify_place_types(core)[:1]


def classify_amenities(text: str) -> dict[str, bool]:
    return {
        "parking": "주차" in text and not _PARKING_NO.search(text),
        "stroller": "유모차" in text,
        "nursing_room": "수유실" in text,
    }


_BOOKING = re.compile(r"사전\s?예약|예약\s?필수|사전\s?신청|예약제|사전\s?접수")

# --- 비정형 본문에서 날짜 · 주소 --------------------------------------------

_FULL_DATE = r"(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"
_RANGE = re.compile(
    _FULL_DATE + r"[^\d~\-–]{0,12}[~\-–]\s*(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"
)
_SINGLE = re.compile(_FULL_DATE)


def _mk(y: str | int, m: str | int, d: str | int) -> date | None:
    try:
        return date(int(y), int(m), int(d))
    except ValueError:
        return None


def extract_dates(text: str) -> tuple[date, date] | None:
    m = _RANGE.search(text)
    if m:
        y1, m1, d1, y2, m2, d2 = m.groups()
        start = _mk(y1, m1, d1)
        end = _mk(y2 or y1, m2, d2)
        if start and end and end < start and not y2:
            end = _mk(int(y1) + 1, m2, d2)  # 12.20 ~ 1.10 처럼 해를 넘김
        if start and end and end >= start:
            return start, end
    m = _SINGLE.search(text)
    if m:
        single = _mk(*m.groups())
        if single:
            return single, single
    return None


_ADDRESS_LINE = re.compile(r"[가-힣]+(?:구|시|군)\s+[가-힣0-9]+(?:로|길|동|읍|면)")


def extract_address(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = raw_line.strip(" ·:-\t")
        line = re.sub(r"^(주소|장소|위치)\s*[:：]?\s*", "", line)
        if 6 <= len(line) <= 80 and detect_region(line) and _ADDRESS_LINE.search(line):
            return line
    return None


# --- 정제기 ----------------------------------------------------------------


class RuleEventParser:
    """키·비용 없는 기본 정제기."""

    def parse_records(self, records: list[RawRecord], **_: Any) -> ParseResult:
        result = ParseResult()
        for record in records:
            try:
                event = self.parse_one(record)
            except Exception as exc:  # 한 건 실패가 전체를 멈추지 않게
                logger.warning("Rule parse failed for %s: %s", record.source_id, exc)
                event = None
            if event is None:
                result.invalid_items += 1
                continue
            result.events.append(event)
        logger.info(
            "Rule parser kept %s / %s records (invalid=%s)",
            len(result.events),
            len(records),
            result.invalid_items,
        )
        return result

    def parse_one(self, record: RawRecord) -> NormalizedEvent | None:
        facts = record.facts or {}
        title = str(facts.get("title") or record.title_hint or "").strip()
        if not title:
            return None
        body = record.raw_text
        text = f"{title}\n{body}"

        dates_from_facts = bool(facts.get("start_date") and facts.get("end_date"))
        if dates_from_facts:
            start = date.fromisoformat(str(facts["start_date"])[:10])
            end = date.fromisoformat(str(facts["end_date"])[:10])
        else:
            found = extract_dates(body)
            if not found:
                return None
            start, end = found

        address = facts.get("address") or extract_address(body)
        if not address:
            return None

        category = classify_category(record, title, body)
        if category is None:
            return None
        if category != "attraction" and is_program_notice(title):
            return None

        description = facts.get("description") or (
            _portal_description(record) if record.source == "culture_portal" else _summary(body)
        )
        # 장소 유형·연령은 프로그램 목록의 지나가는 단어("나무놀이터 체험")에 흔들리지 않게
        # 제목·장소·주소·설명 앞부분만 본다
        core = "\n".join(
            str(v)
            for v in (title, facts.get("location_name"), address, (description or "")[:400])
            if v
        )
        age_text = f"{facts.get('age_info') or ''}\n{core}"
        # 세부 나이: 관람 연령 정보 → 제목 → 본문의 '대상: …' 줄 → 설명 앞부분 순으로 본다.
        # 축제 본문의 프로그램 목록("체험(5~7세)")에 흔들리지 않게 본문 전체는 보지 않는다
        target_lines = " ".join(re.findall(r"(?:대상|연령|관람\s?연령)\s*[:：]?\s*([^\n]{0,40})", body))
        age_min, age_max = extract_age_range(
            "\n".join(
                str(v)
                for v in (facts.get("age_info"), title, target_lines, (description or "")[:300])
                if v
            )
        )
        price = facts.get("price_info")
        if not price and re.search(r"무료\s?(입장|관람|참여)|입장료\s?무료", body):
            price = "무료"
        price = str(price).strip().splitlines()[0][:100] if price else None

        return NormalizedEvent(
            title=title[:255],
            category=category,
            description=description,
            start_date=start,
            end_date=end,
            # 장소명이 없으면 제목이 아니라 주소(최소 지역)를 쓴다 — 상세의 '장소' 칸에 제목이 나오지 않게
            location_name=str(facts.get("location_name") or address)[:255],
            address=str(address),
            latitude=facts.get("latitude"),
            longitude=facts.get("longitude"),
            # 가구·건축·커피 박람회처럼 어른 관심 행사는 수집기가 표시해 둔다 (아이 동반 추천에서 뺌)
            is_family_friendly=not record.meta.get("adult_interest")
            and is_family_friendly(category, text, facts.get("age_info")),
            target_age_group=classify_age(age_text),
            age_min=age_min,
            age_max=age_max,
            amenities=classify_amenities(text),
            booking_required=bool(facts.get("booking_required")) or bool(_BOOKING.search(body)),
            price_info=price,
            thumbnail_url=facts.get("thumbnail_url"),
            official_link=facts.get("official_link") or record.url,
            tags=classify_tags(text, price),
            place_types=place_types_for(record, title, core, category),
            source=record.source,
            source_id=record.source_id,
            content_hash=record.content_hash,
            dates_found_in_text=True,
            dates_from_facts=dates_from_facts,
        )


def _summary(body: str) -> str | None:
    """[본문] 이후 첫 몇 줄을 설명으로 쓴다. '[출처] …' 같은 수집용 라벨 줄은 쓰지 않는다."""
    _, found, after = body.partition("[본문]")
    source = after if found else body
    lines = [
        ln.strip()
        for ln in source.splitlines()
        if len(ln.strip()) > 15 and not ln.strip().startswith("[")
    ]
    text = " ".join(lines[:4])
    return text[:600] or None


_GENRE_PHRASE = {
    "전시": "전시",
    "아동/가족": "어린이·가족 공연",
    "교육/체험": "체험·교육 프로그램",
    "행사/축제": "행사",
}


def _portal_description(record: RawRecord) -> str | None:
    """문화포털 목록에는 소개글이 없어 장소·장르·문의처로 짧은 안내를 만든다."""
    venue = str(record.meta.get("venue") or "").strip()
    genre = _GENRE_PHRASE.get(str(record.meta.get("genre") or ""), "행사")
    contact = str(record.meta.get("contact") or "").strip()
    hours = str(record.meta.get("hours") or "").strip()
    parts = []
    if venue:
        parts.append(f"{venue}에서 열리는 {genre}예요.")
    if contact:
        parts.append(f"문의 {contact}")
    text = " ".join(parts)
    if hours:
        text = f"{text}\n운영 시간 {hours}".strip()
    return text or None
