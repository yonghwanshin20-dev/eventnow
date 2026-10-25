"""Generate src/data/events.json from crawled festivals + curated web results."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# 실행 시점의 KST 날짜 (고정 날짜를 쓰면 상태가 생성일 기준으로 굳어 버림)
TODAY = datetime.now(timezone(timedelta(hours=9))).date()

REGION_RULES = [
    ("서울특별시", "서울특별시"),
    ("서울", "서울특별시"),
    ("부산광역시", "부산광역시"),
    ("부산", "부산광역시"),
    ("대구광역시", "대구광역시"),
    ("대구", "대구광역시"),
    ("인천광역시", "인천광역시"),
    ("인천", "인천광역시"),
    ("광주광역시", "광주광역시"),
    ("광주", "광주광역시"),
    ("대전광역시", "대전광역시"),
    ("대전", "대전광역시"),
    ("울산광역시", "울산광역시"),
    ("울산", "울산광역시"),
    ("세종특별자치시", "세종특별자치시"),
    ("세종", "세종특별자치시"),
    ("경기도", "경기도"),
    ("경기", "경기도"),
    ("강원특별자치도", "강원특별자치도"),
    ("강원", "강원특별자치도"),
    ("충청북도", "충청북도"),
    ("충북", "충청북도"),
    ("충청남도", "충청남도"),
    ("충남", "충청남도"),
    ("전북특별자치도", "전북특별자치도"),
    ("전라북도", "전북특별자치도"),
    ("전북", "전북특별자치도"),
    ("전라남도", "전라남도"),
    ("전남", "전라남도"),
    ("경상북도", "경상북도"),
    ("경북", "경상북도"),
    ("경상남도", "경상남도"),
    ("경남", "경상남도"),
    ("제주특별자치도", "제주특별자치도"),
    ("제주", "제주특별자치도"),
]

SEOUL_GUS = [
    "종로구",
    "중구",
    "용산구",
    "성동구",
    "광진구",
    "동대문구",
    "중랑구",
    "성북구",
    "강북구",
    "도봉구",
    "노원구",
    "은평구",
    "서대문구",
    "마포구",
    "양천구",
    "강서구",
    "구로구",
    "금천구",
    "영등포구",
    "동작구",
    "관악구",
    "서초구",
    "강남구",
    "송파구",
    "강동구",
]

FAMILY_KW = ["어린이", "키즈", "가족", "체험", "아이", "유아동", "패밀리", "놀이"]
OUTDOOR_KW = ["야외", "해수욕", "강", "공원", "해변", "광장", "축제"]
INDOOR_KW = ["박물관", "전시관", "실내", "미술관", "과학관"]

THUMBS = [
    "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80",
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80",
    "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80",
    "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80",
    "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&q=80",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",
    "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=800&q=80",
    "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&q=80",
]


def detect_region(text: str) -> str:
    for key, region in REGION_RULES:
        if key in text:
            return region
    return "서울특별시"


def detect_district(text: str, region: str) -> str | None:
    if region != "서울특별시":
        return None
    for g in SEOUL_GUS:
        if g in text:
            return g
    return None


def status_for(start: str, end: str) -> str:
    s = date.fromisoformat(start[:10])
    e = date.fromisoformat(end[:10])
    if e < TODAY:
        return "ended"
    if s > TODAY:
        return "upcoming"
    return "ongoing"


def eid(title: str, start: str) -> str:
    h = hashlib.md5(f"{title}|{start}".encode()).hexdigest()[:10]
    return f"evt-{h}"


def main() -> None:
    festival_path = ROOT / "data" / "raw" / "festivals_crawl.json"
    festivals = json.loads(festival_path.read_text(encoding="utf-8"))
    events: list[dict] = []

    for i, f in enumerate(festivals):
        blob = f"{f['title']} {f['loc']} {f['addr']} {f['desc']}"
        region = detect_region(blob)
        district = detect_district(blob, region)
        family = any(k in blob for k in FAMILY_KW)
        outdoor = any(k in blob for k in OUTDOOR_KW)
        indoor = any(k in blob for k in INDOOR_KW)
        tags = ["#축제"]
        if outdoor:
            tags.append("#야외축제")
        if indoor:
            tags.append("#실내나들이")
        if family:
            tags.append("#주말가족")
        if "체험" in blob:
            tags.append("#체험학습")

        events.append(
            {
                "id": eid(f["title"], f["start"]),
                "title": f["title"][:255],
                "category": "festival",
                "description": (f["desc"] or f"{f['title']} — {f['loc']}")[:800],
                "start_date": f["start"],
                "end_date": f["end"],
                "location_name": (f["loc"] or f["title"])[:255],
                "address": (f["addr"] or f["loc"] or region)[:500],
                "latitude": f.get("lat"),
                "longitude": f.get("lon"),
                "region": region,
                "district": district,
                "is_family_friendly": family or "체험" in blob,
                "target_age_group": "all" if family else None,
                "amenities": {
                    "parking": True,
                    "stroller": family,
                    "nursing_room": family and region == "서울특별시",
                },
                "booking_required": False,
                "price_info": "현장 확인",
                "thumbnail_url": THUMBS[i % len(THUMBS)],
                "official_link": f.get("link"),
                "tags": tags,
                "status": status_for(f["start"], f["end"]),
                "created_at": "2026-07-28T00:00:00Z",
                "updated_at": "2026-07-28T00:00:00Z",
                "source": "public_festival_data",
            }
        )

    curated = [
        {
            "title": "장면 너머의 세계",
            "category": "exhibition",
            "description": "서울책보고 SF 문학 기획전. 김보영 작가 작품 세계와 몰입형 독서 공간.",
            "start": "2026-06-09",
            "end": "2026-08-30",
            "loc": "서울책보고",
            "addr": "서울특별시 송파구",
            "district": "송파구",
            "family": True,
            "age": "elementary",
            "tags": ["#실내나들이", "#전시"],
            "booking": False,
            "price": "기관 안내",
            "link": "https://kokorang.com/2026-seoul-summer-exhibitions-schedule-location-admission/",
            "thumb": THUMBS[0],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "사랑의 덕통사고",
            "category": "exhibition",
            "description": "서울아트책보고 팬 문화 기획전.",
            "start": "2026-06-19",
            "end": "2026-09-06",
            "loc": "서울아트책보고",
            "addr": "서울특별시 종로구",
            "district": "종로구",
            "family": False,
            "age": None,
            "tags": ["#실내나들이", "#전시"],
            "booking": False,
            "price": "기관 안내",
            "link": None,
            "thumb": THUMBS[1],
            "parking": False,
            "stroller": False,
            "nursing": False,
        },
        {
            "title": "청계천의 별이 된 노무라 모토유키",
            "category": "exhibition",
            "description": "청계천박물관 추모 특별전. 무료 관람.",
            "start": "2026-06-13",
            "end": "2026-10-11",
            "loc": "청계천박물관",
            "addr": "서울특별시 성동구",
            "district": "성동구",
            "family": True,
            "age": "all",
            "tags": ["#실내나들이", "#전시"],
            "booking": False,
            "price": "무료",
            "link": None,
            "thumb": THUMBS[2],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "지구의 맥박",
            "category": "exhibition",
            "description": "서울시립과학관 몰입형 환경 전시.",
            "start": "2026-06-16",
            "end": "2026-09-06",
            "loc": "서울시립과학관",
            "addr": "서울특별시 노원구",
            "district": "노원구",
            "family": True,
            "age": "kids",
            "tags": ["#실내나들이", "#체험학습", "#교육"],
            "booking": False,
            "price": "기관 안내",
            "link": None,
            "thumb": THUMBS[3],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "다정한 균형: 서로를 비추는",
            "category": "exhibition",
            "description": "서울식물원 장기 기획전.",
            "start": "2026-06-23",
            "end": "2027-05-16",
            "loc": "서울식물원",
            "addr": "서울특별시 강서구 마곡동",
            "district": "강서구",
            "family": True,
            "age": "all",
            "tags": ["#실내나들이", "#야외", "#전시"],
            "booking": False,
            "price": "기관 안내",
            "link": None,
            "thumb": THUMBS[4],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "토이 스토리 THE FIRST FAN 팝업",
            "category": "popup",
            "description": "피스마이너스원×디즈니·픽사 성수 팝업.",
            "start": "2026-07-01",
            "end": "2026-08-31",
            "loc": "성수 연무장길",
            "addr": "서울특별시 성동구 연무장길 27",
            "district": "성동구",
            "family": True,
            "age": "kids",
            "tags": ["#팝업", "#실내나들이"],
            "booking": True,
            "price": "무료 관람 / 굿즈 유료",
            "link": "https://sisa-n.com/View.aspx?No=4151612",
            "thumb": THUMBS[5],
            "parking": False,
            "stroller": True,
            "nursing": False,
        },
        {
            "title": "니케 2026 여름 팝업스토어",
            "category": "popup",
            "description": "더현대 서울 여름 콘셉트 팝업.",
            "start": "2026-07-17",
            "end": "2026-07-30",
            "loc": "더현대 서울 아이코닉 B1",
            "addr": "서울특별시 영등포구 여의대로 108",
            "district": "영등포구",
            "family": False,
            "age": None,
            "tags": ["#팝업", "#실내나들이"],
            "booking": True,
            "price": "무료 입장",
            "link": "https://www.gamemeca.com/view.php?gid=1777704",
            "thumb": THUMBS[6],
            "parking": True,
            "stroller": False,
            "nursing": False,
        },
        {
            "title": "2026 서울썸머비치",
            "category": "festival",
            "description": "광화문광장 도심 물놀이 축제. 무료.",
            "start": "2026-07-20",
            "end": "2026-08-09",
            "loc": "광화문광장·세종로공원",
            "addr": "서울특별시 종로구 세종대로",
            "district": "종로구",
            "family": True,
            "age": "all",
            "tags": ["#야외축제", "#주말가족", "#물놀이"],
            "booking": False,
            "price": "무료",
            "link": "https://mediahub.seoul.go.kr/archives/2018810",
            "thumb": THUMBS[7],
            "parking": False,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "한여름의 과학관",
            "category": "kids_experience",
            "description": "서울시립과학관 여름축제 과학마트.",
            "start": "2026-07-29",
            "end": "2026-08-02",
            "loc": "서울시립과학관",
            "addr": "서울특별시 노원구",
            "district": "노원구",
            "family": True,
            "age": "elementary",
            "tags": ["#체험학습", "#실내나들이", "#교육"],
            "booking": True,
            "price": "프로그램별",
            "link": "https://news.seoul.go.kr/economy/archives/573690",
            "thumb": THUMBS[0],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "코 잃은 코끼리 코바",
            "category": "kids_experience",
            "description": "예술의전당 어린이 가족 페스티벌.",
            "start": "2026-07-30",
            "end": "2026-08-09",
            "loc": "예술의전당 자유소극장",
            "addr": "서울특별시 서초구 남부순환로 2406",
            "district": "서초구",
            "family": True,
            "age": "toddler",
            "tags": ["#체험학습", "#실내나들이"],
            "booking": True,
            "price": "40,000원",
            "link": "https://www.sac.or.kr/site/main/show/show_view?SN=81135",
            "thumb": THUMBS[1],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "월드컵공원 야간 생태탐험단",
            "category": "kids_experience",
            "description": "초등 가족 야간 생태 관찰 프로그램.",
            "start": "2026-08-05",
            "end": "2026-08-07",
            "loc": "월드컵공원",
            "addr": "서울특별시 마포구 월드컵로 243",
            "district": "마포구",
            "family": True,
            "age": "elementary",
            "tags": ["#체험학습", "#야외", "#주말가족"],
            "booking": True,
            "price": "팀당 15,000원",
            "link": None,
            "thumb": THUMBS[2],
            "parking": True,
            "stroller": False,
            "nursing": False,
        },
        {
            "title": "하이브 홀리데이 하우스 팝업",
            "category": "popup",
            "description": "하이브 아티스트 시즌그리팅 팝업.",
            "start": "2026-07-20",
            "end": "2026-08-10",
            "loc": "하이브 인사이트",
            "addr": "서울특별시 용산구",
            "district": "용산구",
            "family": False,
            "age": None,
            "tags": ["#팝업", "#트렌드"],
            "booking": True,
            "price": "예약제",
            "link": "https://sisa-n.com/View.aspx?No=4160380",
            "thumb": THUMBS[3],
            "parking": False,
            "stroller": False,
            "nursing": False,
        },
        {
            "title": "보령머드축제",
            "category": "festival",
            "description": "대천해수욕장 글로벌 머드 체험 축제.",
            "start": "2026-07-24",
            "end": "2026-08-09",
            "loc": "대천해수욕장",
            "addr": "충청남도 보령시 신흑동",
            "district": None,
            "family": True,
            "age": "all",
            "tags": ["#야외축제", "#주말가족", "#체험"],
            "booking": False,
            "price": "현장 확인",
            "link": "https://mudfestival.or.kr/festival/view",
            "thumb": THUMBS[5],
            "parking": True,
            "stroller": True,
            "nursing": True,
            "region": "충청남도",
        },
        {
            "title": "한강 어린이 물빛 축제",
            "category": "festival",
            "description": "여의도 한강공원 가족 물빛 축제.",
            "start": "2026-07-25",
            "end": "2026-08-10",
            "loc": "여의도 한강공원",
            "addr": "서울특별시 영등포구 여의동로 330",
            "district": "영등포구",
            "family": True,
            "age": "kids",
            "tags": ["#야외축제", "#주말가족", "#물놀이"],
            "booking": False,
            "price": "무료",
            "link": None,
            "thumb": THUMBS[7],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "키즈 코딩 메이커스 체험전",
            "category": "kids_experience",
            "description": "상암 DMC 코딩·로봇 체험.",
            "start": "2026-08-01",
            "end": "2026-08-31",
            "loc": "서울상암 DMC타워",
            "addr": "서울특별시 마포구 상암산로 76",
            "district": "마포구",
            "family": True,
            "age": "elementary",
            "tags": ["#체험학습", "#실내나들이", "#교육"],
            "booking": True,
            "price": "1인 12,000원",
            "link": None,
            "thumb": THUMBS[0],
            "parking": True,
            "stroller": False,
            "nursing": True,
        },
        {
            "title": "성수 감성 팝업 스토어 WEEK",
            "category": "popup",
            "description": "성수동 2030 트렌드 팝업 위크.",
            "start": "2026-07-20",
            "end": "2026-08-03",
            "loc": "성수연방",
            "addr": "서울특별시 성동구 연무장길 5",
            "district": "성동구",
            "family": False,
            "age": None,
            "tags": ["#팝업", "#성수", "#트렌드"],
            "booking": False,
            "price": "무료 관람 / 일부 유료",
            "link": None,
            "thumb": THUMBS[1],
            "parking": False,
            "stroller": False,
            "nursing": False,
        },
        {
            "title": "국립현대미술관 가족 드로잉 전시",
            "category": "exhibition",
            "description": "가족 인터랙티브 드로잉 전시.",
            "start": "2026-07-10",
            "end": "2026-09-15",
            "loc": "국립현대미술관 서울",
            "addr": "서울특별시 종로구 삼청로 30",
            "district": "종로구",
            "family": True,
            "age": "toddler",
            "tags": ["#실내나들이", "#전시", "#영유아"],
            "booking": True,
            "price": "성인 4,000원 / 어린이 무료",
            "link": None,
            "thumb": THUMBS[2],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
        {
            "title": "실내 공룡 탐험 키즈존",
            "category": "kids_experience",
            "description": "타임스퀘어 실내 공룡 테마 체험.",
            "start": "2026-07-01",
            "end": "2026-08-31",
            "loc": "타임스퀘어 전시홀",
            "addr": "서울특별시 영등포구 영중로 15",
            "district": "영등포구",
            "family": True,
            "age": "kids",
            "tags": ["#실내나들이", "#체험학습", "#공룡"],
            "booking": True,
            "price": "어린이 15,000원",
            "link": None,
            "thumb": THUMBS[3],
            "parking": True,
            "stroller": True,
            "nursing": True,
        },
    ]

    for c in curated:
        region = c.get("region") or detect_region(c["addr"])
        events.append(
            {
                "id": eid(c["title"], c["start"]),
                "title": c["title"],
                "category": c["category"],
                "description": c["description"],
                "start_date": c["start"],
                "end_date": c["end"],
                "location_name": c["loc"],
                "address": c["addr"],
                "latitude": None,
                "longitude": None,
                "region": region,
                "district": c.get("district"),
                "is_family_friendly": c["family"],
                "target_age_group": c.get("age"),
                "amenities": {
                    "parking": c["parking"],
                    "stroller": c["stroller"],
                    "nursing_room": c["nursing"],
                },
                "booking_required": c["booking"],
                "price_info": c["price"],
                "thumbnail_url": c["thumb"],
                "official_link": c.get("link"),
                "tags": c["tags"],
                "status": status_for(c["start"], c["end"]),
                "created_at": "2026-07-28T00:00:00Z",
                "updated_at": "2026-07-28T00:00:00Z",
                "source": "web_crawl",
            }
        )

    by_key: dict[tuple[str, str], dict] = {}
    for e in events:
        key = (e["title"], e["start_date"])
        existing = by_key.get(key)
        if existing and existing.get("source") == "web_crawl":
            continue
        by_key[key] = e

    final = list(by_key.values())
    status_rank = {"ongoing": 0, "upcoming": 1, "ended": 2}
    final.sort(key=lambda e: (status_rank.get(e["status"], 9), e["start_date"]))

    # Drop helper field before frontend consumption
    for e in final:
        e.pop("source", None)

    out = ROOT.parent / "src" / "data" / "events.json"
    out.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(final)} events -> {out}")
    print("regions", len({e["region"] for e in final}))
    print("seoul", sum(1 for e in final if e["region"] == "서울특별시"))


if __name__ == "__main__":
    import sys

    # src/data/events.json을 통째로 덮어쓰므로 명시적으로 --write를 줘야 실행
    if "--write" not in sys.argv[1:]:
        print("usage: python scripts/generate_events_json.py --write  (src/data/events.json 덮어씀)")
        sys.exit(2)
    main()
