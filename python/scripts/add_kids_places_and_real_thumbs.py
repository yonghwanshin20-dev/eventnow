"""
아이 동반 실내외·역사·자연과학 장소를 추가하고,
장소별 Wikimedia/공식 관련 이미지로 썸네일을 매핑한다.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = ROOT / "src" / "data" / "events.json"
THUMB_MAP_PATH = ROOT / "src" / "data" / "place-thumbnails.json"
# 실행 시점의 KST 날짜 (고정 날짜를 쓰면 상태가 생성일 기준으로 굳어 버림)
TODAY = datetime.now(timezone(timedelta(hours=9))).date()

UA = "EventNowCrawler/1.0 (local educational project; contact: local)"


def eid(title: str, start: str) -> str:
    return f"evt-{hashlib.md5(f'{title}|{start}'.encode()).hexdigest()[:10]}"


def status_for(start: str, end: str) -> str:
    s = date.fromisoformat(start[:10])
    e = date.fromisoformat(end[:10])
    if e < TODAY:
        return "ended"
    if s > TODAY:
        return "upcoming"
    return "ongoing"


def commons_file_url(filename: str, width: int = 900) -> str:
    # Special:FilePath redirect works; prefer thumb.php style via Special:Redirect
    name = filename.replace(" ", "_")
    if name.startswith("File:"):
        name = name[5:]
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}?width={width}"


def wiki_thumb(client: httpx.Client, title: str) -> str | None:
    try:
        r = client.get(
            "https://ko.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "prop": "pageimages",
                "piprop": "thumbnail|original",
                "pithumbsize": 900,
                "titles": title,
            },
            headers={"User-Agent": UA},
            timeout=20,
        )
        if r.status_code != 200:
            return None
        pages = r.json().get("query", {}).get("pages", {})
        for page in pages.values():
            orig = (page.get("original") or {}).get("source")
            thumb = (page.get("thumbnail") or {}).get("source")
            if orig or thumb:
                return orig or thumb
    except Exception:
        return None
    return None


def commons_search_image(client: httpx.Client, query: str) -> str | None:
    try:
        r = client.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srnamespace": 6,
                "srlimit": 5,
                "format": "json",
            },
            headers={"User-Agent": UA},
            timeout=20,
        )
        if r.status_code != 200:
            return None
        hits = r.json().get("query", {}).get("search", [])
        for hit in hits:
            title = hit.get("title") or ""
            # Prefer building/exterior over specimen close-ups
            low = title.lower()
            if any(x in low for x in (".svg", "logo", "map", "icon")):
                continue
            return commons_file_url(title)
    except Exception:
        return None
    return None


# Explicit place → Wikimedia file (장소/행사 관련 실제 공개 이미지)
EXPLICIT_FILES: dict[str, str] = {
    "서대문자연사박물관": "서대문자연사박물관 중앙홀.jpg",
    "국립중앙박물관": "National Museum of Korea 01.jpg",
    "경복궁": "Gyeongbokgung-v1-korean.jpg",
    "창덕궁": "Changdeokgung-Injeongjeon.JPG",
    "덕수궁": "Deoksugung-Seokjojeon.JPG",
    "창경궁": "Changgyeonggung-2.jpg",
    "남산서울타워": "N Seoul Tower 01.jpg",
    "전쟁기념관": "War Memorial of Korea 01.jpg",
    "서대문형무소역사관": "Seodaemun Prison History Hall 01.jpg",
    "국립민속박물관": "National Folk Museum of Korea 01.jpg",
    "한성백제박물관": "Hanseong Baekje Museum 01.jpg",
    "서울식물원": "Seoul Botanic Park 01.jpg",
    "어린이대공원": "Seoul Children's Grand Park 01.jpg",
    "서울숲": "Seoul Forest 01.jpg",
    "북촌한옥마을": "Bukchon Hanok Village 01.jpg",
    "남산골한옥마을": "Namsangol Hanok Village.jpg",
    "국립과천과학관": "Gwacheon National Science Museum 01.jpg",
    "리움미술관": "Leeum Museum of Art 01.jpg",
    "DDP": "Dongdaemun Design Plaza 01.jpg",
    "동대문디자인플라자": "Dongdaemun Design Plaza 01.jpg",
    "청계천": "Cheonggyecheon 01.jpg",
    "광화문광장": "Gwanghwamun Plaza 01.jpg",
    "서울시청": "Seoul City Hall 01.jpg",
}

# 신규 장소/상설 프로그램 (아이 실내외·역사·자연과학)
NEW_PLACES = [
    dict(
        title="서대문자연사박물관 상설전시",
        category="exhibition",
        description=(
            "서대문구가 설립·운영하는 자연사박물관. 지구의 탄생·생명진화·인간과 자연을 "
            "디오라마와 화석·골격으로 어린이 눈높이에 맞춰 전시합니다. 공룡 골격과 체험 프로그램이 인기입니다."
        ),
        start="2026-01-01",
        end="2026-12-31",
        loc="서대문자연사박물관",
        addr="서울특별시 서대문구 연희로32길 51",
        region="서울특별시",
        district="서대문구",
        family=True,
        age="kids",
        tags=["#실내나들이", "#박물관", "#자연과학", "#상설전시", "#주말가족", "#전시", "#역사"],
        place_types=["kids_indoor", "nature_science", "historical"],
        booking=False,
        price="어린이 3,000원 / 어른 7,000원 (서대문구민·영유아·노인 등 감면)",
        link="https://namu.sdm.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서대문자연사박물관",
    ),
    dict(
        title="국립어린이과학관 상설전시",
        category="kids_experience",
        description=(
            "종로 창경궁로 국립어린이과학관. 생각놀이터 등 어린이 맞춤 과학 전시·천체투영관·관측 프로그램을 운영합니다."
        ),
        start="2026-01-01",
        end="2026-12-31",
        loc="국립어린이과학관",
        addr="서울특별시 종로구 창경궁로 215",
        region="서울특별시",
        district="종로구",
        family=True,
        age="kids",
        tags=["#실내나들이", "#체험학습", "#자연과학", "#주말가족"],
        place_types=["kids_indoor", "nature_science"],
        booking=True,
        price="유료(사전확인)",
        link="https://www.sciencecenter.go.kr/csc/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="국립어린이과학관",
    ),
    dict(
        title="서울시립과학관 상설전시",
        category="kids_experience",
        description="노원 서울시립과학관 상설전시와 천체 관측 프로그램. 가족 단위 과학 체험에 적합합니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울시립과학관",
        addr="서울특별시 노원구 한글비석로 160",
        region="서울특별시",
        district="노원구",
        family=True,
        age="elementary",
        tags=["#실내나들이", "#체험학습", "#자연과학", "#주말가족"],
        place_types=["kids_indoor", "nature_science"],
        booking=False,
        price="기관 안내",
        link="https://science.seoul.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서울시립과학관",
    ),
    dict(
        title="서울로봇인공지능과학관 상설전시",
        category="kids_experience",
        description="강서 서울로봇인공지능과학관(라임). 로봇·AI 상설전시와 가족 체험 프로그램을 운영합니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울로봇인공지능과학관",
        addr="서울특별시 강서구 마곡중앙5로22",
        region="서울특별시",
        district="강서구",
        family=True,
        age="elementary",
        tags=["#실내나들이", "#체험학습", "#자연과학", "#주말가족"],
        place_types=["kids_indoor", "nature_science"],
        booking=True,
        price="예약제",
        link="https://science.seoul.go.kr/RAIM/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서울로봇인공지능과학관",
    ),
    dict(
        title="국립과천과학관 상설전시",
        category="kids_experience",
        description="국내 대표 종합과학관. 상설전시·천체투영·야외 과학놀이터 등 아이와 하루를 보내기 좋은 실내외 복합 공간입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="국립과천과학관",
        addr="경기도 과천시 대공원광장로 110",
        region="경기도",
        district=None,
        family=True,
        age="kids",
        tags=["#실내나들이", "#야외", "#체험학습", "#자연과학", "#주말가족"],
        place_types=["kids_indoor", "kids_outdoor", "nature_science"],
        booking=False,
        price="유료",
        link="https://www.sciencecenter.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="국립과천과학관",
    ),
    dict(
        title="경복궁 상시 관람",
        category="exhibition",
        description="조선의 법궁 경복궁. 근정전·경회루 등 역사 유적과 수문장 교대식을 볼 수 있는 대표 역사 장소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="경복궁",
        addr="서울특별시 종로구 사직로 161",
        region="서울특별시",
        district="종로구",
        family=True,
        age="all",
        tags=["#야외", "#역사", "#주말가족", "#실내나들이"],
        place_types=["kids_outdoor", "historical"],
        booking=False,
        price="유료(한복 착용 시 무료 등 혜택)",
        link="https://royalpalace.go.kr/",
        parking=False,
        stroller=True,
        nursing=True,
        wiki="경복궁",
    ),
    dict(
        title="창덕궁·후원 상시 관람",
        category="exhibition",
        description="유네스코 세계유산 창덕궁. 인정전과 후원(비원) 관람으로 역사·자연을 함께 즐길 수 있습니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="창덕궁",
        addr="서울특별시 종로구 율곡로 99",
        region="서울특별시",
        district="종로구",
        family=True,
        age="elementary",
        tags=["#야외", "#역사", "#주말가족"],
        place_types=["kids_outdoor", "historical"],
        booking=True,
        price="유료(후원 별도 예약)",
        link="https://www.cdg.go.kr/",
        parking=False,
        stroller=True,
        nursing=False,
        wiki="창덕궁",
    ),
    dict(
        title="창경궁 상시 관람",
        category="exhibition",
        description="창경궁과 대온실. 아이와 함께 궁궐·온실을 둘러보기 좋은 역사·자연 공간입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="창경궁",
        addr="서울특별시 종로구 창경궁로 185",
        region="서울특별시",
        district="종로구",
        family=True,
        age="kids",
        tags=["#야외", "#역사", "#주말가족", "#실내나들이"],
        place_types=["kids_outdoor", "kids_indoor", "historical"],
        booking=False,
        price="유료",
        link="https://cgg.cha.go.kr/",
        parking=False,
        stroller=True,
        nursing=True,
        wiki="창경궁",
    ),
    dict(
        title="덕수궁 상시 관람",
        category="exhibition",
        description="도심 속 덕수궁. 석조전과 정관정 등에서 근현대 역사와 산책을 함께할 수 있습니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="덕수궁",
        addr="서울특별시 중구 세종대로 99",
        region="서울특별시",
        district="중구",
        family=True,
        age="all",
        tags=["#야외", "#역사", "#주말가족"],
        place_types=["kids_outdoor", "historical"],
        booking=False,
        price="유료",
        link="https://www.deoksugung.go.kr/",
        parking=False,
        stroller=True,
        nursing=True,
        wiki="덕수궁",
    ),
    dict(
        title="서대문형무소역사관 상설전시",
        category="exhibition",
        description="독립운동의 역사를 되새기는 서대문형무소역사관. 초등 이상 아이와 역사 교육 장소로 많이 찾습니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서대문형무소역사관",
        addr="서울특별시 서대문구 통일로 251",
        region="서울특별시",
        district="서대문구",
        family=True,
        age="elementary",
        tags=["#실내나들이", "#역사", "#박물관", "#상설전시", "#전시"],
        place_types=["kids_indoor", "historical"],
        booking=False,
        price="유료",
        link="https://www.sscmc.or.kr/culture2/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서대문형무소역사관",
    ),
    dict(
        title="서울어린이대공원 상시 개방",
        category="kids_experience",
        description="광진구 어린이대공원. 동물원·놀이시설·넓은 야외 잔디밭으로 아이와 하루 나들이하기 좋은 대표 야외 장소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울어린이대공원",
        addr="서울특별시 광진구 능동로 216",
        region="서울특별시",
        district="광진구",
        family=True,
        age="kids",
        tags=["#야외", "#주말가족", "#체험학습"],
        place_types=["kids_outdoor"],
        booking=False,
        price="공원 무료 / 일부 시설 유료",
        link="https://www.sisul.or.kr/open_content/childrenpark/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="어린이대공원",
    ),
    dict(
        title="서울숲 가족 나들이",
        category="kids_experience",
        description="성수동 서울숲. 자전거·피크닉·곤충식물원 등 아이와 야외 활동을 즐기기 좋은 도시공원입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울숲",
        addr="서울특별시 성동구 뚝섬로 273",
        region="서울특별시",
        district="성동구",
        family=True,
        age="all",
        tags=["#야외", "#주말가족"],
        place_types=["kids_outdoor"],
        booking=False,
        price="무료",
        link="https://seoulforest.or.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서울숲",
    ),
    dict(
        title="서울동물원(서울대공원) 상시 관람",
        category="kids_experience",
        description="과천 서울대공원 동물원. 다양한 동물 관찰과 테마가든으로 아이 야외 나들이 명소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울동물원",
        addr="경기도 과천시 대공원광장로 102",
        region="경기도",
        district=None,
        family=True,
        age="kids",
        tags=["#야외", "#주말가족", "#체험학습"],
        place_types=["kids_outdoor"],
        booking=False,
        price="유료",
        link="https://grandpark.seoul.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서울동물원",
    ),
    dict(
        title="북촌한옥마을 산책",
        category="exhibition",
        description="가회동 북촌한옥마을. 전통 한옥 골목을 걸으며 역사·문화를 체험할 수 있는 야외 역사 장소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="북촌한옥마을",
        addr="서울특별시 종로구 계동길",
        region="서울특별시",
        district="종로구",
        family=True,
        age="all",
        tags=["#야외", "#역사", "#주말가족"],
        place_types=["kids_outdoor", "historical"],
        booking=False,
        price="무료(일부 가옥 유료)",
        link=None,
        parking=False,
        stroller=False,
        nursing=False,
        wiki="북촌한옥마을",
    ),
    dict(
        title="남산골한옥마을 상시 관람",
        category="exhibition",
        description="중구 남산골한옥마을. 전통가옥과 공연·체험으로 아이와 역사 문화를 가까이에서 만납니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="남산골한옥마을",
        addr="서울특별시 중구 퇴계로34길 28",
        region="서울특별시",
        district="중구",
        family=True,
        age="kids",
        tags=["#야외", "#역사", "#체험학습", "#주말가족"],
        place_types=["kids_outdoor", "historical"],
        booking=False,
        price="무료",
        link="https://www.hanokvillage.or.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="남산골한옥마을",
    ),
    dict(
        title="국립중앙박물관 어린이박물관",
        category="kids_experience",
        description="국립중앙박물관 어린이박물관. 어린이 눈높이 전시·체험으로 비 오는 날 실내 나들이에 적합합니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="국립중앙박물관 어린이박물관",
        addr="서울특별시 용산구 서빙고로 137",
        region="서울특별시",
        district="용산구",
        family=True,
        age="kids",
        tags=["#실내나들이", "#체험학습", "#박물관", "#주말가족"],
        place_types=["kids_indoor", "historical"],
        booking=True,
        price="무료(예약)",
        link="https://www.museum.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="국립중앙박물관",
    ),
    dict(
        title="국립민속박물관 어린이박물관",
        category="kids_experience",
        description="경복궁 내 국립민속박물관 어린이박물관. 전통 생활문화를 놀이와 체험으로 배웁니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="국립민속박물관 어린이박물관",
        addr="서울특별시 종로구 삼청로 37",
        region="서울특별시",
        district="종로구",
        family=True,
        age="kids",
        tags=["#실내나들이", "#체험학습", "#역사", "#주말가족"],
        place_types=["kids_indoor", "historical"],
        booking=True,
        price="무료(예약)",
        link="https://www.nfm.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="국립민속박물관",
    ),
    dict(
        title="서울식물원 온실·주제정원",
        category="kids_experience",
        description="강서 서울식물원. 실내 온실과 야외 주제정원을 함께 즐길 수 있는 가족 나들이 명소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="서울식물원",
        addr="서울특별시 강서구 마곡동로 161",
        region="서울특별시",
        district="강서구",
        family=True,
        age="all",
        tags=["#실내나들이", "#야외", "#주말가족", "#자연과학"],
        place_types=["kids_indoor", "kids_outdoor", "nature_science"],
        booking=False,
        price="온실 유료 / 야외 일부 무료",
        link="https://botanicpark.seoul.go.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="서울식물원",
    ),
    dict(
        title="남산서울타워·남산공원",
        category="kids_experience",
        description="남산공원과 N서울타워. 케이블카·산책로와 전망으로 아이와 야외 나들이하기 좋은 장소입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="남산서울타워",
        addr="서울특별시 용산구 남산공원길 105",
        region="서울특별시",
        district="용산구",
        family=True,
        age="all",
        tags=["#야외", "#주말가족"],
        place_types=["kids_outdoor"],
        booking=False,
        price="공원 무료 / 타워 유료",
        link="https://www.nseoultower.com/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="남산서울타워",
    ),
    dict(
        title="전쟁기념관 어린이박물관",
        category="kids_experience",
        description="용산 전쟁기념관 어린이박물관과 야외 장비전시장. 초등 아이와 역사·안보를 배우는 실내외 공간입니다.",
        start="2026-01-01",
        end="2026-12-31",
        loc="전쟁기념관",
        addr="서울특별시 용산구 이태원로 29",
        region="서울특별시",
        district="용산구",
        family=True,
        age="elementary",
        tags=["#실내나들이", "#야외", "#역사", "#주말가족"],
        place_types=["kids_indoor", "kids_outdoor", "historical"],
        booking=False,
        price="무료",
        link="https://www.warmemo.or.kr/",
        parking=True,
        stroller=True,
        nursing=True,
        wiki="전쟁기념관",
    ),
]


def infer_place_types(event: dict) -> list[str]:
    """장소 성격 태그. 축제를 전부 야외로 넣지 않고 장소 중심으로 분류."""
    existing = event.get("place_types")
    if isinstance(existing, list) and existing:
        return existing

    title = event.get("title") or ""
    loc = event.get("location_name") or ""
    tags = " ".join(event.get("tags") or [])
    blob = f"{title} {loc} {tags}"

    indoor_kw = (
        "박물관",
        "미술관",
        "과학관",
        "전시관",
        "실내놀이",
        "키즈카페",
        "도서관",
        "온실",
        "아쿠아리움",
        "수족관",
        "체험관",
        "어린이박물관",
        "자연사",
        "플라네타리움",
        "천문",
    )
    outdoor_loc = (
        "공원",
        "어린이대공원",
        "서울숲",
        "한강공원",
        "동물원",
        "식물원",
        "한옥마을",
        "광장",
        "남산",
        "북악",
        "성곽",
        "놀이터",
        "캠핑장",
        "물놀이",
        "야외수영",
    )
    palace = ("경복궁", "창덕궁", "창경궁", "덕수궁", "운현궁", "경희궁", "고궁")
    hist_kw = (
        "역사관",
        "역사박물관",
        "형무소",
        "유적",
        "한양",
        "독립",
        "고궁",
        "민속",
        "백제",
        "전쟁",
        "기념관",
        "한옥",
        "성곽",
        "고분",
        "문화재",
        "왕릉",
        "유적지",
        "궁궐",
        "경복궁",
        "창덕궁",
        "창경궁",
        "덕수궁",
    )
    sci_kw = (
        "자연사",
        "과학관",
        "과학",
        "식물원",
        "공룡",
        "로봇",
        "천체",
        "생태",
        "우주",
        "수족관",
        "아쿠아리움",
        "식물",
        "플라네타리움",
    )

    types: list[str] = []
    if any(k in blob for k in indoor_kw) or "#실내" in tags:
        types.append("kids_indoor")
    if (
        any(k in loc for k in outdoor_loc)
        or any(k in loc for k in palace)
        or any(k in title for k in ("한강", "대공원", "동물원", "식물원", "한옥마을"))
        or any(k in title for k in palace)
    ):
        types.append("kids_outdoor")
    if any(k in blob for k in hist_kw) or any(k in loc for k in palace):
        types.append("historical")
    else:
        # '역사' 단독 — '자연사' 내부 부분문자열은 제외
        i = 0
        while True:
            j = blob.find("역사", i)
            if j < 0:
                break
            if j >= 2 and blob[j - 2 : j] == "자연":
                i = j + 2
                continue
            types.append("historical")
            break
    if any(k in blob for k in sci_kw):
        types.append("nature_science")
    if (
        event.get("category") == "kids_experience"
        and "kids_outdoor" not in types
        and "kids_indoor" not in types
    ):
        types.append("kids_indoor")
    return list(dict.fromkeys(types))


def resolve_thumb(
    client: httpx.Client,
    *,
    location: str,
    title: str,
    wiki: str | None,
    cache: dict[str, str | None],
) -> str | None:
    keys = [wiki, location, title]
    for key in keys:
        if not key:
            continue
        if key in cache:
            if cache[key]:
                return cache[key]
            continue
        # explicit commons file
        for hint, filename in EXPLICIT_FILES.items():
            if hint in key:
                url = commons_file_url(filename)
                cache[key] = url
                return url
        # wikipedia
        url = wiki_thumb(client, key)
        if url:
            cache[key] = url
            return url
        # commons search
        url = commons_search_image(client, key)
        cache[key] = url
        if url:
            return url
    return None


def make_event(raw: dict, thumb: str | None) -> dict:
    return {
        "id": eid(raw["title"], raw["start"]),
        "title": raw["title"],
        "category": raw["category"],
        "description": raw["description"],
        "start_date": raw["start"],
        "end_date": raw["end"],
        "location_name": raw["loc"],
        "address": raw["addr"],
        "latitude": None,
        "longitude": None,
        "region": raw["region"],
        "district": raw.get("district"),
        "is_family_friendly": raw.get("family", True),
        "target_age_group": raw.get("age"),
        "amenities": {
            "parking": raw.get("parking", False),
            "stroller": raw.get("stroller", False),
            "nursing_room": raw.get("nursing", False),
        },
        "booking_required": raw.get("booking", False),
        "price_info": raw.get("price"),
        "thumbnail_url": thumb,
        "official_link": raw.get("link"),
        "tags": raw.get("tags") or [],
        "place_types": raw.get("place_types") or [],
        "status": status_for(raw["start"], raw["end"]),
        "created_at": "2026-07-29T00:00:00Z",
        "updated_at": "2026-07-29T00:00:00Z",
    }


def main() -> None:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    by_key = {(e["title"], e["start_date"]): e for e in events}
    cache: dict[str, str | None] = {}
    place_thumbs: dict[str, str] = {}

    with httpx.Client(follow_redirects=True, timeout=25.0) as client:
        # add new places
        added = 0
        for raw in NEW_PLACES:
            thumb = resolve_thumb(
                client,
                location=raw["loc"],
                title=raw["title"],
                wiki=raw.get("wiki"),
                cache=cache,
            )
            event = make_event(raw, thumb)
            key = (event["title"], event["start_date"])
            if key not in by_key:
                added += 1
            by_key[key] = event
            if thumb:
                place_thumbs[raw["loc"]] = thumb

        # rematch thumbnails for ALL events to place-related images (not concept pools)
        updated_thumbs = 0
        for event in by_key.values():
            event["place_types"] = infer_place_types(event)
            loc = event.get("location_name") or ""
            title = event.get("title") or ""
            thumb = resolve_thumb(
                client,
                location=loc,
                title=title,
                wiki=None,
                cache=cache,
            )
            # If still none, keep null (UI will show place-name card) — do NOT use random stock
            if thumb:
                if event.get("thumbnail_url") != thumb:
                    updated_thumbs += 1
                event["thumbnail_url"] = thumb
                place_thumbs[loc] = thumb
            else:
                # clear concept-pool unsplash leftovers
                url = event.get("thumbnail_url") or ""
                if "images.unsplash.com" in url:
                    event["thumbnail_url"] = None
                    updated_thumbs += 1

    final = list(by_key.values())
    rank = {"ongoing": 0, "upcoming": 1, "ended": 2}
    final.sort(key=lambda e: (rank.get(e["status"], 9), e["start_date"]))
    EVENTS_PATH.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    THUMB_MAP_PATH.write_text(
        json.dumps(place_thumbs, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"total={len(final)} added={added} thumb_updates={updated_thumbs}")
    print(
        "with_thumb=",
        sum(1 for e in final if e.get("thumbnail_url")),
        "kids_indoor=",
        sum(1 for e in final if "kids_indoor" in (e.get("place_types") or [])),
        "historical=",
        sum(1 for e in final if "historical" in (e.get("place_types") or [])),
    )
    # verify seodaemun
    hits = [e["title"] for e in final if "서대문자연사" in e["title"]]
    print("seodaemun_hits=", hits)


if __name__ == "__main__":
    main()
