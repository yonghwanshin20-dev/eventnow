"""
서울 소규모 박물관/미술관 + 서울 지자체(구) 행사를 병합하고
전체 이벤트의 썸네일·설명을 카테고리 적합하게 정리한다.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

EVENTS_PATH = Path(__file__).resolve().parents[2] / "src" / "data" / "events.json"
# 실행 시점의 KST 날짜 (고정 날짜를 쓰면 상태가 생성일 기준으로 굳어 버림)
TODAY = datetime.now(timezone(timedelta(hours=9))).date()

# 카테고리·테마별 실제 분위기와 맞는 이미지 풀 (Unsplash)
THUMB_POOLS: dict[str, list[str]] = {
    "museum": [
        "https://images.unsplash.com/photo-1566127444979-b3d2b654e3d7?w=900&q=80",
        "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=900&q=80",
        "https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?w=900&q=80",
        "https://images.unsplash.com/photo-1564399580075-5dfe19c205fa?w=900&q=80",
    ],
    "gallery": [
        "https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?w=900&q=80",
        "https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=900&q=80",
        "https://images.unsplash.com/photo-1499781350541-7783f73ce6a5?w=900&q=80",
        "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?w=900&q=80",
    ],
    "festival_outdoor": [
        "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=900&q=80",
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900&q=80",
        "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=900&q=80",
        "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=80",
    ],
    "water_play": [
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900&q=80",
        "https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=900&q=80",
        "https://images.unsplash.com/photo-1530541930197-ff16ac917b0e?w=900&q=80",
    ],
    "popup": [
        "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=900&q=80",
        "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=900&q=80",
        "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=900&q=80",
    ],
    "kids": [
        "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=900&q=80",
        "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=900&q=80",
        "https://images.unsplash.com/photo-1560850038-7d888c40b722?w=900&q=80",
    ],
    "science": [
        "https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=900&q=80",
        "https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=900&q=80",
    ],
    "history": [
        "https://images.unsplash.com/photo-1594737625785-a6cbdabd333c?w=900&q=80",
        "https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=900&q=80",
    ],
}


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


def pick_thumb(key: str, seed: str) -> str:
    pool = THUMB_POOLS[key]
    idx = int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(pool)
    return pool[idx]


def thumb_key_for(event: dict) -> str:
    blob = " ".join(
        [
            event.get("title") or "",
            event.get("description") or "",
            " ".join(event.get("tags") or []),
            event.get("location_name") or "",
            event.get("category") or "",
        ]
    )
    if any(k in blob for k in ("물놀이", "워터", "썸머비치", "머드", "수영", "바다", "해수욕")):
        return "water_play"
    if any(k in blob for k in ("과학", "사이언스", "코딩", "로봇")):
        return "science"
    if any(k in blob for k in ("역사", "독립", "형무소", "고궁", "민속", "전쟁", "한양")):
        return "history"
    if event.get("category") == "kids_experience" or "키즈" in blob or "어린이" in blob:
        return "kids"
    if event.get("category") == "popup" or "#팝업" in blob:
        return "popup"
    if any(k in blob for k in ("미술관", "갤러리", "아트", "#미술관")):
        return "gallery"
    if any(k in blob for k in ("박물관", "#박물관", "상설전시", "전시실")):
        return "museum"
    if event.get("category") == "exhibition":
        return "gallery"
    if event.get("category") == "festival":
        return "festival_outdoor"
    return "festival_outdoor"


def improve_description(event: dict) -> str:
    desc = (event.get("description") or "").strip()
    title = event.get("title") or ""
    loc = event.get("location_name") or ""
    region = event.get("region") or ""
    district = event.get("district")
    place = f"{region}" + (f" {district}" if district else "")
    price = event.get("price_info") or "요금 현장 확인"
    booking = "사전예약 권장" if event.get("booking_required") else "현장 방문·접수 가능"

    # 너무 짧거나 기계적인 설명이면 보강
    thin = (
        len(desc) < 40
        or desc.endswith(f"— {loc}")
        or "+" in desc[:80]
        and len(desc) < 120
    )

    if not thin:
        # 끝에 관람 팁이 없으면 가볍게 덧붙임
        if "관람" not in desc and "요금" not in desc:
            return f"{desc} 위치: {place} {loc}. {booking}. {price}."
        return desc

    category = event.get("category")
    if category == "exhibition":
        kind = "전시"
        if "박물관" in title + loc + desc:
            kind = "박물관 전시"
        elif "미술관" in title + loc + desc:
            kind = "미술관 전시"
        return (
            f"{title} — {loc}에서 열리는 {kind}입니다. "
            f"{place} 일대에서 관람할 수 있으며, {booking}. 요금: {price}."
        )
    if category == "festival":
        return (
            f"{title} — {loc}에서 진행되는 축제·행사입니다. "
            f"{place}. {booking}. 요금: {price}."
        )
    if category == "kids_experience":
        return (
            f"{title} — 아이·가족과 함께하기 좋은 체험 프로그램입니다. "
            f"장소: {loc} ({place}). {booking}. 요금: {price}."
        )
    if category == "popup":
        return (
            f"{title} — {loc} 팝업·기간한정 행사입니다. "
            f"{place}. {booking}. 요금: {price}."
        )
    return desc or f"{title} @ {loc}"


def make_event(raw: dict) -> dict:
    tags = raw.get("tags") or []
    return {
        "id": eid(raw["title"], raw["start"]),
        "title": raw["title"],
        "category": raw["category"],
        "description": raw["description"],
        "start_date": raw["start"],
        "end_date": raw["end"],
        "location_name": raw["loc"],
        "address": raw["addr"],
        "latitude": raw.get("lat"),
        "longitude": raw.get("lon"),
        "region": raw["region"],
        "district": raw.get("district"),
        "is_family_friendly": raw.get("family", False),
        "target_age_group": raw.get("age"),
        "amenities": {
            "parking": raw.get("parking", False),
            "stroller": raw.get("stroller", False),
            "nursing_room": raw.get("nursing", False),
        },
        "booking_required": raw.get("booking", False),
        "price_info": raw.get("price", "현장 확인"),
        "thumbnail_url": None,  # filled later
        "official_link": raw.get("link"),
        "tags": tags,
        "status": status_for(raw["start"], raw["end"]),
        "created_at": "2026-07-28T00:00:00Z",
        "updated_at": "2026-07-28T12:00:00Z",
    }


# 서울 소규모·구립·사립·테마 박물관/미술관/전시실
SEOUL_SMALL_VENUES = [
    dict(title="종로구립 고희동미술관 상설·기획전시", category="exhibition",
         description="한국 최초의 서양화가 고희동의 가옥을 활용한 종로구립 미술관. 근대회화와 기획전, 어린이 화실 프로그램을 운영합니다.",
         start="2026-01-01", end="2026-12-31", loc="고희동미술관",
         addr="서울특별시 종로구 창덕궁길 61-1", region="서울특별시", district="종로구",
         family=True, age="elementary", tags=["#미술관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료~기획전 별도", link="https://www.jfac.or.kr/",
         parking=False, stroller=True, nursing=False),
    dict(title="종로구립 박노수미술관 상설전시", category="exhibition",
         description="박노수 화백 기증작품과 고미술·수석·고가구 컬렉션을 선보이는 종로구립 미술관. 옥인동 한·양 절충식 가옥에서 관람합니다.",
         start="2026-01-01", end="2026-12-31", loc="박노수미술관",
         addr="서울특별시 종로구 옥인1길 34", region="서울특별시", district="종로구",
         family=True, age="all", tags=["#미술관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://www.jfac.or.kr/",
         parking=False, stroller=True, nursing=False),
    dict(title="서울공예박물관 상설전시", category="exhibition",
         description="안동별궁 터에 자리한 서울공예박물관. ‘장인, 세상을 이롭게 하다’, ‘자수, 염원을 그리다’ 등 상설전과 어린이박물관을 운영합니다.",
         start="2026-01-01", end="2026-12-31", loc="서울공예박물관",
         addr="서울특별시 종로구 율곡로 99", region="서울특별시", district="종로구",
         family=True, age="kids", tags=["#박물관", "#상설전시", "#실내나들이", "#체험학습", "#전시"],
         booking=False, price="무료", link="https://craftmuseum.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="색유만개: 권순형 기증특별전시", category="exhibition",
         description="서울공예박물관 권순형 기증 특별전. 도자·색유의 아름다움을 조명합니다.",
         start="2026-05-12", end="2026-08-02", loc="서울공예박물관",
         addr="서울특별시 종로구 율곡로 99", region="서울특별시", district="종로구",
         family=True, age="all", tags=["#박물관", "#전시", "#실내나들이"],
         booking=False, price="무료", link="https://craftmuseum.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="서울생활사박물관 상설전시", category="exhibition",
         description="근현대 서울 사람들의 일상·성장·가족 이야기를 전시한 생활사 박물관. 어린이체험실과 구치감 전시실을 함께 운영합니다.",
         start="2026-01-01", end="2026-12-31", loc="서울생활사박물관",
         addr="서울특별시 노원구 동일로 236", region="서울특별시", district="노원구",
         family=True, age="kids", tags=["#박물관", "#상설전시", "#주말가족", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://museum.seoul.go.kr/sulm",
         parking=True, stroller=True, nursing=True),
    dict(title="서울우리소리박물관 상설·기획전시", category="exhibition",
         description="서울의 소리·민요·음악 문화를 소개하는 시립 박물관. 기획전 ‘한강, 소리로 흐르다’ 등 연계 프로그램을 선보입니다.",
         start="2026-01-01", end="2026-12-31", loc="서울우리소리박물관",
         addr="서울특별시 종로구 율곡로 57", region="서울특별시", district="종로구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://museum.seoul.go.kr/",
         parking=False, stroller=True, nursing=True),
    dict(title="한양도성박물관 상설전시", category="exhibition",
         description="한양도성의 축조·훼철·복원 이야기를 다루는 서울역사박물관 분관.",
         start="2026-01-01", end="2026-12-31", loc="한양도성박물관",
         addr="서울특별시 종로구 율곡로 283", region="서울특별시", district="종로구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#역사", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://museum.seoul.go.kr/",
         parking=False, stroller=True, nursing=False),
    dict(title="청계천박물관 상설전시", category="exhibition",
         description="청계천의 역사와 도시 변화를 전시하는 서울역사박물관 분관. 성동구에서 관람할 수 있습니다.",
         start="2026-01-01", end="2026-12-31", loc="청계천박물관",
         addr="서울특별시 성동구 청계천로 530", region="서울특별시", district="성동구",
         family=True, age="all", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://museum.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="서울특별시수도박물관 상설전시", category="exhibition",
         description="서울의 상수도 역사와 물 문화를 소개하는 시립 박물관(성동구).",
         start="2026-01-01", end="2026-12-31", loc="서울특별시수도박물관",
         addr="서울특별시 성동구 왕십리로 21", region="서울특별시", district="성동구",
         family=True, age="kids", tags=["#박물관", "#상설전시", "#체험학습", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="한국색동박물관 상설전시 «색동 한복이야기»", category="exhibition",
         description="색동·한복·혼례복식과 전통인형을 전시하는 사립 테마박물관. 사전예약제로 운영됩니다.",
         start="2026-01-01", end="2026-12-31", loc="한국색동박물관",
         addr="서울특별시 종로구 율곡로10길 85-7", region="서울특별시", district="종로구",
         family=True, age="kids", tags=["#박물관", "#상설전시", "#실내나들이", "#주말가족", "#전시"],
         booking=True, price="성인 6,000원 / 학생 5,000원", link="https://www.saekdongmuseum.com/",
         parking=False, stroller=True, nursing=False),
    dict(title="한성백제박물관 상설전시", category="exhibition",
         description="한성백제 역사와 풍납토성·몽촌토성 유물을 전시하는 송파구 시립 박물관.",
         start="2026-01-01", end="2026-12-31", loc="한성백제박물관",
         addr="서울특별시 송파구 위례성대로 71", region="서울특별시", district="송파구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#역사", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://baekjemuseum.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="대한민국역사박물관 상설전시", category="exhibition",
         description="근현대 대한민국의 사회·문화·정치를 조망하는 국립 박물관(광화문).",
         start="2026-01-01", end="2026-12-31", loc="대한민국역사박물관",
         addr="서울특별시 종로구 세종대로 198", region="서울특별시", district="종로구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#역사", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://www.much.go.kr/",
         parking=False, stroller=True, nursing=True),
    dict(title="한국은행 화폐박물관 상설전시", category="exhibition",
         description="화폐·금융 역사와 근대 건축물을 함께 볼 수 있는 중구 박물관.",
         start="2026-01-01", end="2026-12-31", loc="한국은행 화폐박물관",
         addr="서울특별시 중구 남대문로 39", region="서울특별시", district="중구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#실내나들이", "#체험학습", "#전시"],
         booking=True, price="무료(예약)", link="https://www.bok.or.kr/museum",
         parking=False, stroller=True, nursing=False),
    dict(title="국악박물관 상설전시", category="exhibition",
         description="국립국악원 국악박물관. 국악기·음악사 상설 전시와 체험 프로그램을 제공합니다.",
         start="2026-01-01", end="2026-12-31", loc="국악박물관",
         addr="서울특별시 서초구 남부순환로 2406", region="서울특별시", district="서초구",
         family=True, age="kids", tags=["#박물관", "#상설전시", "#체험학습", "#실내나들이", "#전시"],
         booking=False, price="무료", link="https://www.gugak.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="대림미술관 기획전시", category="exhibition",
         description="통의동 대림미술관. 사진·디자인·라이프스타일을 아우르는 기획전을 상시 선보입니다.",
         start="2026-03-01", end="2026-12-31", loc="대림미술관",
         addr="서울특별시 종로구 자하문로4길 21", region="서울특별시", district="종로구",
         family=False, age=None, tags=["#미술관", "#전시", "#실내나들이"],
         booking=True, price="유료", link="https://www.daelimmuseum.org/",
         parking=False, stroller=False, nursing=False),
    dict(title="디뮤지엄 기획전시", category="exhibition",
         description="한남동 디뮤지엄. 사진·미디어·감각 전시를 중심으로 한 현대미술관.",
         start="2026-01-01", end="2026-12-31", loc="디뮤지엄",
         addr="서울특별시 용산구 독서당로29길 5-6", region="서울특별시", district="용산구",
         family=True, age="all", tags=["#미술관", "#전시", "#실내나들이"],
         booking=True, price="유료", link="https://www.daelimmuseum.org/dmuseum",
         parking=False, stroller=True, nursing=False),
    dict(title="아모레퍼시픽미술관 기획전시", category="exhibition",
         description="용산 아모레퍼시픽 본사 내 미술관. 동시대 미술·디자인 기획전.",
         start="2026-01-01", end="2026-12-31", loc="아모레퍼시픽미술관",
         addr="서울특별시 용산구 한강대로 100", region="서울특별시", district="용산구",
         family=False, age=None, tags=["#미술관", "#전시", "#실내나들이"],
         booking=True, price="유료", link="https://apma.amorepacific.com/",
         parking=True, stroller=False, nursing=False),
    dict(title="코리아나화장박물관 상설전시", category="exhibition",
         description="화장·미용 문화사를 다루는 강남 사립 박물관.",
         start="2026-01-01", end="2026-12-31", loc="코리아나화장박물관",
         addr="서울특별시 강남구 언주로 827", region="서울특별시", district="강남구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=True, price="유료", link=None,
         parking=True, stroller=False, nursing=False),
    dict(title="관세박물관 상설전시", category="exhibition",
         description="관세청 관세박물관. 무역·관세 역사와 위조상품 전시를 볼 수 있습니다.",
         start="2026-01-01", end="2026-12-31", loc="관세박물관",
         addr="서울특별시 강남구 언주로 721", region="서울특별시", district="강남구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=False),
    dict(title="창신동 봉제역사관 상설전시", category="exhibition",
         description="창신동 봉제 산업의 역사와 작업 공간을 재현한 지역 특화 전시관.",
         start="2026-01-01", end="2026-12-31", loc="창신동 봉제역사관",
         addr="서울특별시 종로구 종로51가길 28", region="서울특별시", district="종로구",
         family=True, age="all", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=False, stroller=True, nursing=False),
    dict(title="한양대학교박물관 상설전시", category="exhibition",
         description="대학박물관 상설전. 고고·미술·대학사 자료를 전시합니다.",
         start="2026-01-01", end="2026-12-31", loc="한양대학교박물관",
         addr="서울특별시 성동구 왕십리로 222", region="서울특별시", district="성동구",
         family=True, age="elementary", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=True, stroller=False, nursing=False),
    dict(title="홍익대학교박물관 상설전시", category="exhibition",
         description="홍대 인근 대학박물관. 미술·디자인·고고 유물 상설전.",
         start="2026-01-01", end="2026-12-31", loc="홍익대학교박물관",
         addr="서울특별시 마포구 와우산로 94", region="서울특별시", district="마포구",
         family=True, age="all", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=False, stroller=False, nursing=False),
    dict(title="서강대학교박물관 상설전시", category="exhibition",
         description="서강대 박물관 상설·기획전. 신학·역사·미술 자료를 선보입니다.",
         start="2026-01-01", end="2026-12-31", loc="서강대학교박물관",
         addr="서울특별시 마포구 백범로 35", region="서울특별시", district="마포구",
         family=True, age="all", tags=["#박물관", "#상설전시", "#실내나들이", "#전시"],
         booking=False, price="무료", link=None,
         parking=True, stroller=False, nursing=False),
    dict(title="덕수궁미술관 기획전시", category="exhibition",
         description="덕수궁 내 국립현대미술관 덕수궁관. 근대미술 기획전을 중심으로 운영합니다.",
         start="2026-01-01", end="2026-12-31", loc="덕수궁미술관",
         addr="서울특별시 중구 세종대로 99", region="서울특별시", district="중구",
         family=True, age="all", tags=["#미술관", "#전시", "#실내나들이"],
         booking=False, price="유료", link="https://www.mmca.go.kr/",
         parking=False, stroller=True, nursing=True),
    dict(title="서울시립 북서울미술관 상설·기획전시", category="exhibition",
         description="중계동 북서울미술관. 동시대 미술과 지역 연계 전시를 선보입니다.",
         start="2026-01-01", end="2026-12-31", loc="서울시립 북서울미술관",
         addr="서울특별시 노원구 동일로 1238", region="서울특별시", district="노원구",
         family=True, age="all", tags=["#미술관", "#전시", "#실내나들이"],
         booking=False, price="무료~기획전 별도", link="https://sema.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="서울시립 남서울미술관 기획전시", category="exhibition",
         description="남현동 남서울미술관. 근대 건축물에서 동시대 전시를 운영합니다.",
         start="2026-01-01", end="2026-12-31", loc="서울시립 남서울미술관",
         addr="서울특별시 관악구 남부순환로 2076", region="서울특별시", district="관악구",
         family=True, age="all", tags=["#미술관", "#전시", "#실내나들이"],
         booking=False, price="무료~기획전 별도", link="https://sema.seoul.go.kr/",
         parking=True, stroller=True, nursing=False),
]

# 서울 지자체(구·시) 소규모 축제/특별행사/구민 전시 — 서울만
SEOUL_LOCAL_EVENTS = [
    dict(title="2026 서대문독립민주축제", category="festival",
         description="광복 81주년 기념 서대문구 역사문화 축제. 서대문형무소역사관·독립공원에서 기념식, 공연, 야외 특별전시, 시민 참여 프로그램을 무료로 운영합니다.",
         start="2026-08-15", end="2026-08-16", loc="서대문형무소역사관·독립공원",
         addr="서울특별시 서대문구 통일로 251", region="서울특별시", district="서대문구",
         family=True, age="all", tags=["#야외축제", "#역사", "#주말가족", "#축제"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="제10회 성북문화바캉스", category="festival",
         description="성북구 대표 도심 물놀이 축제. 숭덕초·우이천·길음 유휴부지에서 슬라이드·맘앤베이비풀·공연·체험을 운영합니다. 구민 무료, 타구민 유료.",
         start="2026-07-25", end="2026-08-09", loc="숭덕초·우이천 다목적광장",
         addr="서울특별시 성북구 정릉로 279", region="서울특별시", district="성북구",
         family=True, age="kids", tags=["#야외축제", "#물놀이", "#주말가족", "#축제"],
         booking=False, price="구민 무료 / 타구민 2,000원", link=None,
         parking=False, stroller=True, nursing=True),
    dict(title="영등포 여름축제 대(大)피서", category="festival",
         description="영등포공원에서 열리는 구 단위 여름 축제. 물놀이 시설, 버블·마술쇼, 푸드트럭을 운영하며 회차별 사전·현장 접수합니다.",
         start="2026-08-08", end="2026-08-09", loc="영등포공원",
         addr="서울특별시 영등포구 신길동 200", region="서울특별시", district="영등포구",
         family=True, age="kids", tags=["#야외축제", "#물놀이", "#주말가족", "#축제"],
         booking=True, price="접수제", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="다른 빛, 같은 새벽 — 백범 김구 탄생 150주년 특별전", category="exhibition",
         description="노원구 경춘선숲길 갤러리 특별기획전. 김구·안중근·홍범도 등 독립운동가를 현대미술로 재해석한 무료 전시입니다.",
         start="2026-07-01", end="2026-08-19", loc="경춘선숲길 갤러리",
         addr="서울특별시 노원구 화랑로 576", region="서울특별시", district="노원구",
         family=True, age="elementary", tags=["#전시", "#미술관", "#역사", "#실내나들이"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=False),
    dict(title="2026 한강페스티벌-여름", category="festival",
         description="한강공원 전역에서 열리는 서울시 여름 축제. 물놀이·뮤직피크닉·시민 배 만들기 경주 등 도전·문화·휴식형 프로그램을 운영합니다.",
         start="2026-08-01", end="2026-08-16", loc="한강 수상 및 한강공원",
         addr="서울특별시 영등포구 여의동로 330", region="서울특별시", district="영등포구",
         family=True, age="all", tags=["#야외축제", "#주말가족", "#물놀이", "#축제"],
         booking=False, price="프로그램별", link="https://festival.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="강북Festa 2026 전시 프로그램", category="exhibition",
         description="강북문화예술회관에서 이어지는 구민 문화축제 연계 전시. 지역 예술인과 주민 참여 작품을 선보입니다.",
         start="2026-07-15", end="2026-08-08", loc="강북문화예술회관",
         addr="서울특별시 강북구 솔샘로 209", region="서울특별시", district="강북구",
         family=True, age="all", tags=["#전시", "#실내나들이", "#축제"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="마포구 문화비축기지 특별 프로그램", category="festival",
         description="문화비축기지에서 진행하는 마포구 연계 문화·생태 체험 행사. 야외 전시와 가족 체험 부스가 마련됩니다.",
         start="2026-08-01", end="2026-08-31", loc="문화비축기지",
         addr="서울특별시 마포구 증산로 87", region="서울특별시", district="마포구",
         family=True, age="all", tags=["#야외축제", "#체험학습", "#주말가족", "#축제"],
         booking=False, price="무료~일부 유료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="성동구 수제화거리 문화행사", category="festival",
         description="성수동·수제화 특화거리 일대에서 열리는 구 단위 문화·쇼핑 연계 이벤트. 팝업 부스와 주민 공연이 함께합니다.",
         start="2026-09-05", end="2026-09-07", loc="성수동 수제화거리",
         addr="서울특별시 성동구 연무장길", region="서울특별시", district="성동구",
         family=False, age=None, tags=["#야외축제", "#팝업", "#축제"],
         booking=False, price="무료", link=None,
         parking=False, stroller=False, nursing=False),
    dict(title="종로한복축제 연계 전시", category="exhibition",
         description="종로구 한복축제 기간 고희동미술관 등에서 열리는 연계 기획전시. 전통복식과 현대 패션을 함께 조명합니다.",
         start="2026-10-01", end="2026-10-12", loc="고희동미술관·종로 일대",
         addr="서울특별시 종로구 창덕궁길 61-1", region="서울특별시", district="종로구",
         family=True, age="all", tags=["#전시", "#미술관", "#축제", "#실내나들이"],
         booking=False, price="무료", link="https://www.jfac.or.kr/",
         parking=False, stroller=True, nursing=False),
    dict(title="송파구 한성백제문화제 특별전시", category="exhibition",
         description="한성백제박물관·몽촌토성 일대에서 진행되는 구 대표 역사문화제 연계 특별전.",
         start="2026-10-03", end="2026-10-12", loc="한성백제박물관",
         addr="서울특별시 송파구 위례성대로 71", region="서울특별시", district="송파구",
         family=True, age="elementary", tags=["#전시", "#박물관", "#역사", "#축제"],
         booking=False, price="무료", link="https://baekjemuseum.seoul.go.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="은평한옥마을 문화체험 행사", category="kids_experience",
         description="은평한옥마을에서 진행하는 구 연계 한옥·전통 체험. 가족 대상 공예·다도 체험이 포함됩니다.",
         start="2026-08-15", end="2026-08-17", loc="은평한옥마을",
         addr="서울특별시 은평구 연서로50길", region="서울특별시", district="은평구",
         family=True, age="kids", tags=["#체험학습", "#주말가족", "#실내나들이"],
         booking=True, price="프로그램별", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="양천구 신트리문화축제", category="festival",
         description="양천구민이 함께하는 지역 문화축제. 무대공연, 부스 체험, 먹거리 장터가 열립니다.",
         start="2026-09-19", end="2026-09-21", loc="양천공원 일대",
         addr="서울특별시 양천구 목동동로", region="서울특별시", district="양천구",
         family=True, age="all", tags=["#야외축제", "#주말가족", "#축제"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="동작구 노량진컵라면축제", category="festival",
         description="노량진 일대 동작구 특화 먹거리·문화 축제. 시식·체험·공연이 결합된 구민 축제입니다.",
         start="2026-10-16", end="2026-10-18", loc="노량진 일대",
         addr="서울특별시 동작구 노량진로", region="서울특별시", district="동작구",
         family=True, age="all", tags=["#야외축제", "#주말가족", "#축제"],
         booking=False, price="무료~시식 유료", link=None,
         parking=True, stroller=True, nursing=False),
    dict(title="서초구 예술의전당 가족 특별 프로그램", category="kids_experience",
         description="서초구·예술의전당 연계 가족 공연·전시 체험. 어린이·보호자 동반 프로그램을 중심으로 운영합니다.",
         start="2026-07-30", end="2026-08-31", loc="예술의전당",
         addr="서울특별시 서초구 남부순환로 2406", region="서울특별시", district="서초구",
         family=True, age="toddler", tags=["#체험학습", "#실내나들이", "#주말가족"],
         booking=True, price="프로그램별", link="https://www.sac.or.kr/",
         parking=True, stroller=True, nursing=True),
    dict(title="강동구 암사동 선사문화 특별체험", category="kids_experience",
         description="암사동 유적 일대에서 진행하는 강동구 선사 체험 행사. 가족 대상 유적 탐방과 만들기 체험을 제공합니다.",
         start="2026-10-16", end="2026-10-18", loc="암사동 유적",
         addr="서울특별시 강동구 올림픽로 875", region="서울특별시", district="강동구",
         family=True, age="kids", tags=["#체험학습", "#야외", "#주말가족", "#역사"],
         booking=False, price="무료~일부 체험 유료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="구로구 오류아트홀 구민 기획전시", category="exhibition",
         description="구로구민과 지역 작가가 참여하는 구로문화재단 기획전시.",
         start="2026-08-01", end="2026-08-31", loc="오류아트홀",
         addr="서울특별시 구로구 경인로20나길 30", region="서울특별시", district="구로구",
         family=True, age="all", tags=["#전시", "#미술관", "#실내나들이"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
    dict(title="금천구 금나래아트홀 특별전시", category="exhibition",
         description="금천구 금나래아트홀에서 열리는 구민·청년작가 특별전.",
         start="2026-09-01", end="2026-09-28", loc="금나래아트홀",
         addr="서울특별시 금천구 시흥대로73길 70", region="서울특별시", district="금천구",
         family=True, age="all", tags=["#전시", "#미술관", "#실내나들이"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=False),
    dict(title="중랑구 용마폭포공원 문화한마당", category="festival",
         description="중랑구 대표 야외 문화한마당. 공연, 푸드트럭, 어린이 체험존이 함께합니다.",
         start="2026-09-12", end="2026-09-13", loc="용마폭포공원",
         addr="서울특별시 중랑구 용마산로 541", region="서울특별시", district="중랑구",
         family=True, age="kids", tags=["#야외축제", "#주말가족", "#축제"],
         booking=False, price="무료", link=None,
         parking=True, stroller=True, nursing=True),
]


def main() -> None:
    existing = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    by_key: dict[tuple[str, str], dict] = {
        (e["title"], e["start_date"]): e for e in existing
    }

    added = 0
    for raw in SEOUL_SMALL_VENUES + SEOUL_LOCAL_EVENTS:
        event = make_event(raw)
        key = (event["title"], event["start_date"])
        if key not in by_key:
            added += 1
        by_key[key] = event

    final = []
    for event in by_key.values():
        event["description"] = improve_description(event)
        event["thumbnail_url"] = pick_thumb(
            thumb_key_for(event),
            f"{event['title']}|{event['category']}|{event.get('location_name')}",
        )
        # tags 정리
        tags = event.get("tags") or []
        cleaned = []
        for t in tags:
            t = t.strip()
            if not t:
                continue
            if not t.startswith("#"):
                t = f"#{t}"
            if t not in cleaned:
                cleaned.append(t)
        event["tags"] = cleaned
        final.append(event)

    rank = {"ongoing": 0, "upcoming": 1, "ended": 2}
    final.sort(key=lambda e: (rank.get(e["status"], 9), e["start_date"]))
    EVENTS_PATH.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"total={len(final)} newly_added={added}")
    print(
        "seoul=",
        sum(1 for e in final if e.get("region") == "서울특별시"),
        "exhibitions=",
        sum(1 for e in final if e.get("category") == "exhibition"),
    )


if __name__ == "__main__":
    main()
