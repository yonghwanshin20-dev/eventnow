"""서대문구 독립문·안산둘레길·홍제폭포·사찰·문화센터 등 지역 명소 추가."""

from __future__ import annotations

import hashlib
import json
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = ROOT / "src" / "data" / "events.json"
THUMB_MAP_PATH = ROOT / "src" / "data" / "place-thumbnails.json"
# 실행 시점의 KST 날짜 (고정 날짜를 쓰면 상태가 생성일 기준으로 굳어 버림)
TODAY = datetime.now(timezone(timedelta(hours=9))).date()
UA = "EventNowCrawler/1.0 (local educational; seodaemun places)"

EXPLICIT = {
    "독립문": "Independence_Gate.jpg",
    "서대문독립공원": "Seodaemun_Independence_Park.jpg",
    "독립공원": "Seodaemun_Independence_Park.jpg",
    "서대문형무소역사관": "Seodaemun_Prison_History_Hall_01.jpg",
    "안산자락길": "Ansan_Jarakgil.jpg",
    "홍제폭포": "Hongje_Waterfall.jpg",
    "봉원사": "Bongwonsa.jpg",
    "대한민국임시정부기념관": "Provisional_Government_of_the_Republic_of_Korea_Memorial_Hall.jpg",
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


def file_url(name: str) -> str:
    return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + urllib.parse.quote(name.replace(" ", "_"))
        + "?width=900"
    )


def wiki_image(client: httpx.Client, title: str, lang: str = "ko") -> str | None:
    try:
        r = client.get(
            f"https://{lang}.wikipedia.org/w/api.php",
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
        for page in r.json().get("query", {}).get("pages", {}).values():
            return (page.get("original") or {}).get("source") or (
                page.get("thumbnail") or {}
            ).get("source")
    except Exception:
        return None
    return None


def commons_search(client: httpx.Client, query: str) -> str | None:
    try:
        r = client.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srnamespace": 6,
                "srlimit": 8,
                "format": "json",
            },
            headers={"User-Agent": UA},
            timeout=20,
        )
        if r.status_code != 200:
            return None
        for hit in r.json().get("query", {}).get("search", []):
            title = hit.get("title") or ""
            low = title.lower()
            if any(x in low for x in (".svg", "logo", "map", "icon", ".pdf")):
                continue
            name = title[5:] if title.startswith("File:") else title
            return file_url(name)
    except Exception:
        return None
    return None


def resolve_thumb(
    client: httpx.Client, loc: str, wiki: str | None, cache: dict[str, str | None]
) -> str | None:
    if loc in cache and cache[loc]:
        return cache[loc]
    for hint, filename in EXPLICIT.items():
        if hint in loc:
            url = file_url(filename)
            cache[loc] = url
            return url
    for key in (wiki, loc):
        if not key:
            continue
        url = wiki_image(client, key, "ko") or wiki_image(client, key, "en")
        if url:
            cache[loc] = url
            return url
        url = commons_search(client, key)
        if url:
            cache[loc] = url
            return url
    cache[loc] = None
    return None


def place(
    *,
    title: str,
    description: str,
    loc: str,
    addr: str,
    place_types: list[str],
    tags: list[str],
    price: str = "무료",
    link: str | None = None,
    age: str = "all",
    booking: bool = False,
    parking: bool = True,
    stroller: bool = True,
    nursing: bool = False,
    wiki: str | None = None,
    category: str = "kids_experience",
) -> dict:
    return {
        "title": title,
        "category": category,
        "description": description,
        "start": "2026-01-01",
        "end": "2026-12-31",
        "loc": loc,
        "addr": addr,
        "region": "서울특별시",
        "district": "서대문구",
        "family": True,
        "age": age,
        "tags": tags,
        "place_types": place_types,
        "booking": booking,
        "price": price,
        "link": link,
        "parking": parking,
        "stroller": stroller,
        "nursing": nursing,
        "wiki": wiki or loc,
    }


NEW_PLACES: list[dict] = [
    place(
        title="독립문 역사 나들이",
        description=(
            "서대문 독립문. 대한제국기 독립협회가 세운 상징 문루로, 독립공원·형무소역사관과 "
            "함께 역사 산책 코스의 시작점입니다."
        ),
        loc="독립문",
        addr="서울특별시 서대문구 통일로 251",
        place_types=["historical", "kids_outdoor", "park_playground"],
        tags=["#역사", "#독립문", "#서대문", "#야외산책", "#초등추천"],
        age="elementary",
        category="exhibition",
        link="https://www.sdm.go.kr/",
        parking=True,
        stroller=True,
    ),
    place(
        title="서대문독립공원(독립문공원) 산책",
        description=(
            "독립문·서대문형무소역사관·순국선열추념탑이 있는 서대문독립공원. "
            "넓은 잔디와 산책로로 아이와 역사·피크닉을 함께하기 좋습니다."
        ),
        loc="서대문독립공원",
        addr="서울특별시 서대문구 통일로 251",
        place_types=["historical", "park_playground", "kids_outdoor"],
        tags=["#독립공원", "#독립문공원", "#공원", "#역사", "#피크닉"],
        age="kids",
        category="festival",
        wiki="서대문 독립공원",
        link="https://parks.seoul.go.kr/",
    ),
    place(
        title="안산자락길(안산둘레길) 가족 산책",
        description=(
            "서대문 안산 자락을 따라 이어지는 약 7km 무장애 데크 둘레길. "
            "황톳길·메타세쿼이아숲·봉수대 전망을 지나 홍제폭포까지 이어져 "
            "유모차·초등 아이와 걷기 좋은 도심 숲길입니다."
        ),
        loc="안산자락길",
        addr="서울특별시 서대문구 봉원사길 75-66",
        place_types=["forest_recreation", "kids_outdoor", "park_playground", "nature_science"],
        tags=["#안산둘레길", "#안산자락길", "#무장애숲길", "#황톳길", "#가족산책"],
        age="kids",
        price="무료",
        parking=True,
        stroller=True,
        wiki="안산 (서울)",
        link="https://www.sdm.go.kr/",
    ),
    place(
        title="홍제폭포·홍제천 수변 나들이",
        description=(
            "홍제천 인공폭포(높이 약 25m). 안산자락길·연희숲길과 이어지는 수변 명소로 "
            "물소리와 함께 산책·사진 찍기 좋습니다. 인근 카페폭포·복합문화센터와 함께 즐기기 좋아요."
        ),
        loc="홍제폭포",
        addr="서울특별시 서대문구 연희로 262 일대",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#홍제폭포", "#수변", "#산책", "#포토스팟", "#서대문"],
        age="all",
        category="festival",
        wiki="홍제천",
        link="https://www.sdm.go.kr/",
        nursing=True,
    ),
    place(
        title="봉원사 사찰 나들이",
        description=(
            "안산 자락 봉원사(태고종 총본산). 고즈넉한 사찰 경내와 주변 숲길로 "
            "아이와 조용한 문화·자연 나들이를 하기 좋습니다. 안산자락길과도 이어집니다."
        ),
        loc="봉원사",
        addr="서울특별시 서대문구 봉원동 산1",
        place_types=["temple", "historical", "kids_outdoor", "forest_recreation"],
        tags=["#사찰", "#절", "#봉원사", "#안산", "#문화유산"],
        age="all",
        category="exhibition",
        parking=True,
        stroller=False,
        link="https://www.bongwonsa.or.kr/",
    ),
    place(
        title="백련사 사찰 산책",
        description=(
            "서대문 홍은동 백련사. 백련사길·문화체육회관 인근 사찰로 "
            "가벼운 산책과 함께 들르기 좋은 동네 절입니다."
        ),
        loc="백련사",
        addr="서울특별시 서대문구 백련사길 139",
        place_types=["temple", "historical", "kids_outdoor"],
        tags=["#사찰", "#절", "#백련사", "#서대문"],
        age="all",
        category="exhibition",
        parking=True,
        stroller=True,
    ),
    place(
        title="대한민국임시정부기념관 관람",
        description=(
            "독립문역 인근 대한민국임시정부기념관. 임시정부 역사를 전시·교육하며 "
            "독립공원·안산자락길 나들이와 함께하기 좋은 역사 교육 공간입니다."
        ),
        loc="대한민국임시정부기념관",
        addr="서울특별시 서대문구 통일로29길 20",
        place_types=["historical", "kids_indoor", "kids_outdoor"],
        tags=["#역사", "#기념관", "#독립운동", "#초등추천", "#실내외"],
        age="elementary",
        category="exhibition",
        booking=False,
        price="무료(기획전·프로그램 별도 확인)",
        link="https://www.1940s.go.kr/",
        nursing=True,
        wiki="대한민국임시정부기념관",
    ),
    place(
        title="홍제폭포 복합문화센터 프로그램",
        description=(
            "홍제폭포 옆 복합문화센터. 미디어전시·관광안내·다목적 공간과 카페를 운영합니다. "
            "전시·체험·행사 일정은 시즌별로 달라지므로 방문 전 프로그램 확인이 필요합니다."
        ),
        loc="홍제폭포 복합문화센터",
        addr="서울특별시 서대문구 연희로 262-24",
        place_types=["cultural_center", "kids_indoor", "kids_outdoor"],
        tags=["#문화센터", "#프로그램확인", "#홍제폭포", "#미디어전시", "#가족나들이"],
        age="all",
        category="exhibition",
        booking=True,
        price="전시·프로그램별 상이 — 사전 확인",
        link="https://www.sdm.go.kr/",
        nursing=True,
        wiki="홍제천",
    ),
    place(
        title="서대문문화체육회관 강좌·프로그램",
        description=(
            "서대문문화체육회관. 수영·체육·어린이 강좌 등 구민 대상 프로그램을 운영합니다. "
            "월별 접수 일정이 있어 방문·신청 전 홈페이지에서 프로그램·정원 확인이 필요합니다."
        ),
        loc="서대문문화체육회관",
        addr="서울특별시 서대문구 백련사길 39",
        place_types=["cultural_center", "kids_indoor"],
        tags=["#문화센터", "#프로그램확인", "#체육강좌", "#어린이강좌", "#예약"],
        age="kids",
        category="kids_experience",
        booking=True,
        price="강좌별 수강료 — 사전 접수 확인",
        link="https://cs.sscmc.or.kr/sdmcs/1",
        nursing=True,
        parking=True,
    ),
    place(
        title="아름인도서관·홍제폭포 일대 문화나들이",
        description=(
            "홍제폭포·카페폭포 인근 아름인도서관 일대. 수변 산책 후 책·휴식 공간을 이용할 수 있습니다. "
            "도서관 행사·체험은 일정에 따라 다르니 프로그램 확인 후 방문하세요."
        ),
        loc="아름인도서관",
        addr="서울특별시 서대문구 연희로 262 일대",
        place_types=["cultural_center", "kids_indoor", "kids_outdoor", "park_playground"],
        tags=["#도서관", "#문화센터", "#프로그램확인", "#홍제폭포", "#아이동반"],
        age="toddler",
        category="kids_experience",
        booking=True,
        price="도서관 무료 / 프로그램별 확인",
        link="https://www.sdm.go.kr/",
        nursing=True,
        wiki="홍제천",
    ),
    place(
        title="서대문구 생활문화·평생학습 프로그램",
        description=(
            "서대문구 생활문화센터·평생학습 관련 강좌와 가족·아동 프로그램을 안내합니다. "
            "개설 강좌·접수 기간이 자주 바뀌므로 구청·관련 센터 홈페이지에서 최신 프로그램을 확인하세요."
        ),
        loc="서대문구 생활문화센터",
        addr="서울특별시 서대문구 연희로 248 (서대문구청 일대)",
        place_types=["cultural_center", "kids_indoor"],
        tags=["#문화센터", "#프로그램확인", "#평생학습", "#가족강좌", "#예약"],
        age="all",
        category="kids_experience",
        booking=True,
        price="프로그램별 수강료 — 사전 확인",
        link="https://www.sdm.go.kr/",
        parking=True,
        nursing=True,
        wiki="서대문구",
    ),
    place(
        title="연희숲속쉼터·연희동 숲길 나들이",
        description=(
            "안산자락길·홍제폭포로 이어지는 연희숲속쉼터 일대. "
            "허브원·숲속 휴게 공간으로 짧은 가족 산책 코스에 적합합니다."
        ),
        loc="연희숲속쉼터",
        addr="서울특별시 서대문구 연희동",
        place_types=["forest_recreation", "kids_outdoor", "park_playground"],
        tags=["#연희", "#숲길", "#쉼터", "#가족산책", "#안산"],
        age="toddler",
        price="무료",
        parking=False,
        stroller=True,
        wiki="안산 (서울)",
    ),
]


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
        "created_at": "2026-07-29T09:00:00Z",
        "updated_at": "2026-07-29T09:00:00Z",
    }


def enrich_types(event: dict) -> list[str]:
    types = list(event.get("place_types") or [])
    blob = " ".join(
        [
            event.get("title") or "",
            event.get("location_name") or "",
            " ".join(event.get("tags") or []),
            event.get("description") or "",
        ]
    )
    if any(k in blob for k in ("문화센터", "문화회관", "문화체육회관", "평생학습", "생활문화")):
        types.append("cultural_center")
    if any(k in blob for k in ("사찰", "절", "봉원사", "백련사", "암자")):
        types.append("temple")
    if any(k in blob for k in ("독립문", "독립공원", "형무소", "임시정부")):
        types.append("historical")
    if any(k in blob for k in ("안산자락", "안산둘레", "홍제폭포", "연희숲")):
        types.append("kids_outdoor")
        if "안산" in blob or "숲" in blob:
            types.append("forest_recreation")
        if "폭포" in blob or "공원" in blob:
            types.append("park_playground")
    return list(dict.fromkeys(types))


def main() -> None:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    by_key = {(e["title"], e["start_date"]): e for e in events}
    cache: dict[str, str | None] = {}
    if THUMB_MAP_PATH.exists():
        cache = {
            k: v
            for k, v in json.loads(THUMB_MAP_PATH.read_text(encoding="utf-8")).items()
        }

    added = 0
    with httpx.Client(follow_redirects=True, timeout=25.0) as client:
        for raw in NEW_PLACES:
            thumb = resolve_thumb(client, raw["loc"], raw.get("wiki"), cache)
            event = make_event(raw, thumb)
            key = (event["title"], event["start_date"])
            if key not in by_key:
                added += 1
            by_key[key] = event

        for event in by_key.values():
            if event.get("district") == "서대문구":
                event["place_types"] = enrich_types(event)
            loc = event.get("location_name") or ""
            if loc and not event.get("thumbnail_url"):
                thumb = resolve_thumb(client, loc, None, cache)
                if thumb:
                    event["thumbnail_url"] = thumb

    final = list(by_key.values())
    rank = {"ongoing": 0, "upcoming": 1, "ended": 2}
    final.sort(key=lambda e: (rank.get(e["status"], 9), e["start_date"]))
    EVENTS_PATH.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    THUMB_MAP_PATH.write_text(
        json.dumps({k: v for k, v in cache.items() if v}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    sdm = [e for e in final if e.get("district") == "서대문구"]
    print("total=", len(final), "added=", added, "seodaemun=", len(sdm))
    print("sdm_titles=", [e["title"] for e in sdm])


if __name__ == "__main__":
    main()
