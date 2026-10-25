"""놀이공원·야외 놀이터·주요 공원·숲체원 등 야외 나들이 장소 추가."""

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
UA = "EventNowCrawler/1.0 (local educational; outdoor places)"

EXPLICIT = {
    "롯데월드": "Lotte_World_Adventure.jpg",
    "서울랜드": "Seoul_Land.jpg",
    "에버랜드": "Everland_Theme_Park.jpg",
    "캐리비안 베이": "Caribbean_Bay.jpg",
    "레고랜드": "Legoland_Korea_Resort.jpg",
    "서울대공원": "Seoul_Zoo.jpg",
    "올림픽공원": "Olympic_Park,_Seoul.jpg",
    "월드컵공원": "World_Cup_Park.jpg",
    "북서울꿈의숲": "Bukseoul_Dream_Forest.jpg",
    "보라매공원": "Boramae_Park.jpg",
    "여의도한강공원": "Yeouido_Hangang_Park.jpg",
    "뚝섬한강공원": "Ttukseom_Hangang_Park.jpg",
    "반포한강공원": "Banpo_Hangang_Park.jpg",
    "잠원한강공원": "Jamwon_Hangang_Park.jpg",
    "선유도공원": "Seonyudo_Park.jpg",
    "경의선숲길": "Gyeongui_Line_Forest_Park.jpg",
    "남산공원": "Namsan_Park.jpg",
    "석촌호수": "Seokchon_Lake.jpg",
    "하늘공원": "Haneul_Park.jpg",
    "노을공원": "Noeul_Park.jpg",
    "서서울호수공원": "Seoul_West_Lake_Park.jpg",
    "국립수목원": "Korea_National_Arboretum.jpg",
    "한밭수목원": "Hanbat_Arboretum.jpg",
    "울산대공원": "Ulsan_Grand_Park.jpg",
    "인천대공원": "Incheon_Grand_Park.jpg",
    "한국민속촌": "Korean_Folk_Village.jpg",
    "서울숲": "Seoul_Forest_01.jpg",
    "서울어린이대공원": "Seoul_Children's_Grand_Park_01.jpg",
    "어린이대공원": "Seoul_Children's_Grand_Park_01.jpg",
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
    if loc in cache:
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
    region: str,
    district: str | None = None,
    place_types: list[str],
    tags: list[str],
    price: str = "현장 확인",
    link: str | None = None,
    age: str = "kids",
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
        "region": region,
        "district": district,
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
    # —— 놀이공원 ——
    place(
        title="롯데월드 어드벤처 가족 나들이",
        description="잠실 실내외 복합 테마파크. 날씨에 관계없이 아이와 하루를 보내기 좋은 대표 놀이공원입니다.",
        loc="롯데월드 어드벤처",
        addr="서울특별시 송파구 올림픽로 240",
        region="서울특별시",
        district="송파구",
        place_types=["amusement_park", "kids_indoor", "kids_outdoor"],
        tags=["#놀이공원", "#테마파크", "#주말가족", "#실내외"],
        price="자유이용권 등 유료",
        link="https://adventure.lotteworld.com/",
        nursing=True,
        booking=True,
        wiki="롯데월드",
    ),
    place(
        title="서울랜드 가족 나들이",
        description="과천 서울대공원 내 테마파크. 다양한 놀이기구와 공연으로 초등·미취학 아이와 가기 좋습니다.",
        loc="서울랜드",
        addr="경기도 과천시 광명로 181",
        region="경기도",
        place_types=["amusement_park", "kids_outdoor"],
        tags=["#놀이공원", "#테마파크", "#주말가족", "#야외"],
        price="자유이용권 등 유료",
        link="https://www.seoulland.co.kr/",
        nursing=True,
    ),
    place(
        title="에버랜드 가족 나들이",
        description="용인 에버랜드. 동물원·가든·롤러코스터까지 갖춘 국내 대표 테마파크입니다.",
        loc="에버랜드",
        addr="경기도 용인시 처인구 포곡읍 에버랜드로 199",
        region="경기도",
        place_types=["amusement_park", "kids_outdoor", "nature_science"],
        tags=["#놀이공원", "#테마파크", "#동물원", "#주말가족"],
        price="자유이용권 등 유료",
        link="https://www.everland.com/",
        nursing=True,
        booking=True,
    ),
    place(
        title="캐리비안 베이 물놀이",
        description="에버랜드 내 대형 워터파크. 여름철 아이와 시원한 물놀이를 즐기기 좋습니다.",
        loc="캐리비안 베이",
        addr="경기도 용인시 처인구 포곡읍 에버랜드로 199",
        region="경기도",
        place_types=["amusement_park", "kids_outdoor"],
        tags=["#워터파크", "#물놀이", "#여름나들이", "#주말가족"],
        price="유료(시즌·사전확인)",
        link="https://www.caribbeanbay.com/",
        nursing=True,
        booking=True,
    ),
    place(
        title="레고랜드 코리아 가족 나들이",
        description="춘천 레고랜드. 레고 테마의 놀이기구·미니랜드로 초등 저학년과 잘 맞습니다.",
        loc="레고랜드 코리아 리조트",
        addr="강원특별자치도 춘천시 남산면 남산리",
        region="강원특별자치도",
        place_types=["amusement_park", "kids_outdoor", "kids_indoor"],
        tags=["#놀이공원", "#레고", "#테마파크", "#주말가족"],
        price="유료(사전확인)",
        link="https://www.legolandkorea.com/",
        nursing=True,
        booking=True,
        wiki="레고랜드 코리아",
    ),
    place(
        title="경주월드 가족 나들이",
        description="경주보문단지 인근 테마파크. 놀이기구와 워터파크(캘리포니아비치)로 하루 나들이하기 좋습니다.",
        loc="경주월드",
        addr="경상북도 경주시 보문로 544",
        region="경상북도",
        place_types=["amusement_park", "kids_outdoor"],
        tags=["#놀이공원", "#테마파크", "#경주나들이"],
        price="유료(사전확인)",
        link="https://www.gjw.co.kr/",
    ),
    place(
        title="한국민속촌 가족 나들이",
        description="용인 한국민속촌. 전통 마을 체험·공연·계절 축제로 아이와 역사·문화를 가까이 접할 수 있습니다.",
        loc="한국민속촌",
        addr="경기도 용인시 기흥구 민속촌로 90",
        region="경기도",
        place_types=["amusement_park", "kids_outdoor", "historical"],
        tags=["#민속촌", "#야외체험", "#주말가족", "#역사"],
        price="유료(사전확인)",
        link="https://www.koreanfolk.co.kr/",
        nursing=True,
    ),
    place(
        title="광주패밀리랜드 가족 나들이",
        description="광주 우치공원 내 테마파크. 놀이기구와 동물원·놀이동산으로 호남권 대표 가족 나들이 명소입니다.",
        loc="광주패밀리랜드",
        addr="광주광역시 북구 우치로 677",
        region="광주광역시",
        place_types=["amusement_park", "kids_outdoor"],
        tags=["#놀이공원", "#테마파크", "#주말가족"],
        price="유료(사전확인)",
        link="https://www.familyland.co.kr/",
    ),
    place(
        title="서울대공원 동물원·테마가든",
        description="과천 서울대공원. 동물원·테마가든·산책로로 아이와 하루를 보내기 좋은 대규모 야외 공간입니다.",
        loc="서울대공원",
        addr="경기도 과천시 대공원광장로 102",
        region="경기도",
        place_types=["kids_outdoor", "park_playground", "nature_science", "amusement_park"],
        tags=["#동물원", "#공원", "#야외나들이", "#주말가족"],
        price="동물원 유료 / 공원 일부 무료",
        link="https://grandpark.seoul.go.kr/",
        nursing=True,
    ),
    # —— 서울 주요 공원·한강·놀이터 ——
    place(
        title="올림픽공원 가족 나들이",
        description="송파 올림픽공원. 넓은 잔디·호수·조각공원과 어린이 놀이공간으로 피크닉·자전거 나들이에 좋습니다.",
        loc="올림픽공원",
        addr="서울특별시 송파구 올림픽로 424",
        region="서울특별시",
        district="송파구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#피크닉", "#야외놀이", "#주말가족"],
        price="무료(일부 시설 유료)",
        link="https://olympicpark.kspo.or.kr/",
        category="festival",
    ),
    place(
        title="월드컵공원·하늘공원 나들이",
        description="상암 월드컵공원. 평화의공원 놀이터·하늘공원·노을공원까지 이어지는 대규모 가족 야외 공간입니다.",
        loc="월드컵공원",
        addr="서울특별시 마포구 월드컵로 243-55",
        region="서울특별시",
        district="마포구",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#공원", "#하늘공원", "#야외놀이", "#피크닉"],
        price="무료",
        link="https://worldcuppark.seoul.go.kr/",
    ),
    place(
        title="북서울꿈의숲·상상놀이터",
        description="강북 북서울꿈의숲. 전망대·호수·대규모 상상놀이터로 미취학·초등 아이와 가기 좋은 공원입니다.",
        loc="북서울꿈의숲",
        addr="서울특별시 강북구 월계로 173",
        region="서울특별시",
        district="강북구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#놀이터", "#야외놀이", "#주말가족"],
        price="무료(일부 시설 유료)",
        link="https://dreamforest.seoul.go.kr/",
        nursing=True,
    ),
    place(
        title="보라매공원 어린이 놀이터",
        description="동작·영등포 경계 보라매공원. 넓은 운동장·어린이 놀이터·도서관이 있어 동네 나들이로 인기입니다.",
        loc="보라매공원",
        addr="서울특별시 동작구 여의대방로20길 33",
        region="서울특별시",
        district="동작구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#놀이터", "#야외놀이"],
        price="무료",
    ),
    place(
        title="여의도한강공원 가족 피크닉",
        description="여의도한강공원. 자전거·피크닉·물빛무대 일대 놀이공간으로 서울 대표 한강 나들이 명소입니다.",
        loc="여의도한강공원",
        addr="서울특별시 영등포구 여의동로 330",
        region="서울특별시",
        district="영등포구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#공원", "#피크닉", "#자전거"],
        price="무료",
        link="https://hangang.seoul.go.kr/",
    ),
    place(
        title="뚝섬한강공원 가족 나들이",
        description="광진 뚝섬한강공원. 자벌레·수변 산책·야외 놀이공간으로 아이와 자전거·피크닉하기 좋습니다.",
        loc="뚝섬한강공원",
        addr="서울특별시 광진구 강변북로 139",
        region="서울특별시",
        district="광진구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#공원", "#피크닉", "#자전거"],
        price="무료",
        link="https://hangang.seoul.go.kr/",
    ),
    place(
        title="반포한강공원·달빛광장",
        description="반포한강공원. 달빛무지개분수·피크닉존으로 주말 가족 나들이에 인기 있는 한강공원입니다.",
        loc="반포한강공원",
        addr="서울특별시 서초구 신반포로11길 40",
        region="서울특별시",
        district="서초구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#공원", "#분수", "#피크닉"],
        price="무료",
    ),
    place(
        title="잠원한강공원 나들이",
        description="잠원한강공원. 넓은 잔디와 수변 산책로로 유모차 산책·피크닉에 적합합니다.",
        loc="잠원한강공원",
        addr="서울특별시 서초구 잠원로 221-124",
        region="서울특별시",
        district="서초구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#공원", "#피크닉", "#산책"],
        price="무료",
        age="toddler",
    ),
    place(
        title="광나루한강공원 나들이",
        description="강동 광나루한강공원. 자전거도로·생태공원·넓은 잔디로 동서울 가족 야외 활동에 좋습니다.",
        loc="광나루한강공원",
        addr="서울특별시 강동구 선사로83길",
        region="서울특별시",
        district="강동구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#공원", "#자전거", "#생태"],
        price="무료",
    ),
    place(
        title="난지한강공원 나들이",
        description="마포 난지한강공원. 캠핑장·잔디광장·수변으로 아이와 여유로운 한강 나들이를 즐기기 좋습니다.",
        loc="난지한강공원",
        addr="서울특별시 마포구 한강난지로 162",
        region="서울특별시",
        district="마포구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#한강", "#캠핑", "#공원", "#피크닉"],
        price="일부 캠핑 유료",
    ),
    place(
        title="선유도공원 가족 산책",
        description="영등포 선유도공원. 한강 위 섬공원으로 온실·정원·산책로가 있어 짧은 가족 나들이에 좋습니다.",
        loc="선유도공원",
        addr="서울특별시 영등포구 선유로 343",
        region="서울특별시",
        district="영등포구",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#공원", "#한강", "#산책", "#정원"],
        price="무료",
        age="all",
    ),
    place(
        title="서서울호수공원 물놀이·놀이터",
        description="양천 서서울호수공원. 호수·물놀이·어린이 놀이터로 서남권 대표 가족 공원입니다.",
        loc="서서울호수공원",
        addr="서울특별시 양천구 남부순환로64길 26",
        region="서울특별시",
        district="양천구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#물놀이", "#놀이터", "#주말가족"],
        price="무료(물놀이 시즌 확인)",
        nursing=True,
    ),
    place(
        title="석촌호수 산책·놀이",
        description="송파 석촌호수. 호수 산책과 주변 놀이공간·롯데월드 연계 나들이에 좋습니다.",
        loc="석촌호수",
        addr="서울특별시 송파구 잠실동",
        region="서울특별시",
        district="송파구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#호수", "#산책", "#공원", "#주말가족"],
        price="무료",
        age="all",
    ),
    place(
        title="용산가족공원 나들이",
        description="용산가족공원. 잔디밭·산책로·어린이 놀이터로 도심 속 짧은 가족 피크닉에 적합합니다.",
        loc="용산가족공원",
        addr="서울특별시 용산구 서빙고로 185",
        region="서울특별시",
        district="용산구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#놀이터", "#피크닉"],
        price="무료",
        age="toddler",
    ),
    place(
        title="남산공원·남산순환로 나들이",
        description="남산공원. 산책로·전망·케이블카 연계로 아이와 도심 야외 산책을 즐기기 좋습니다.",
        loc="남산공원",
        addr="서울특별시 중구 삼일대로 231",
        region="서울특별시",
        district="중구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#남산", "#공원", "#산책", "#야외"],
        price="공원 무료(일부 시설 유료)",
    ),
    place(
        title="경의선숲길·연트럴파크",
        description="마포 연남동 경의선숲길. 선형 공원과 놀이·휴식 공간으로 유모차 산책에 인기입니다.",
        loc="경의선숲길",
        addr="서울특별시 마포구 연남동",
        region="서울특별시",
        district="마포구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#숲길", "#산책", "#공원", "#연남동"],
        price="무료",
        age="toddler",
        parking=False,
    ),
    place(
        title="푸른수목원·항동철길",
        description="구로 푸른수목원과 항동철길. 식물원 산책과 기찻길 감성 산책로로 아이와 가기 좋습니다.",
        loc="푸른수목원",
        addr="서울특별시 구로구 연동로 240",
        region="서울특별시",
        district="구로구",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#수목원", "#공원", "#산책", "#식물"],
        price="무료",
        link="https://parks.seoul.go.kr/template/sub/bluegarden.do",
    ),
    place(
        title="서울창포원 나들이",
        description="도봉 서울창포원. 창포·습지 생태공원으로 자연 관찰과 산책에 좋은 가족 공원입니다.",
        loc="서울창포원",
        addr="서울특별시 도봉구 마들로 916",
        region="서울특별시",
        district="도봉구",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#생태공원", "#산책", "#자연관찰"],
        price="무료",
    ),
    place(
        title="서울로7017·만리동광장 나들이",
        description="중구 서울로7017. 고가도로를 공원으로 바꾼 산책로와 주변 광장에서 짧은 도심 나들이를 즐깁니다.",
        loc="서울로7017",
        addr="서울특별시 중구 청파로 432",
        region="서울특별시",
        district="중구",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#산책", "#도심공원", "#야외"],
        price="무료",
        parking=False,
        age="all",
        wiki="서울로 7017",
    ),
    # —— 수도권·광역 공원 ——
    place(
        title="인천대공원 가족 나들이",
        description="인천대공원. 호수·동물원·놀이터·수목원으로 인천 대표 가족 야외 나들이 명소입니다.",
        loc="인천대공원",
        addr="인천광역시 남동구 장수동",
        region="인천광역시",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#공원", "#동물원", "#놀이터", "#주말가족"],
        price="일부 시설 유료",
        link="https://www.incheon.go.kr/",
        nursing=True,
    ),
    place(
        title="울산대공원 가족 나들이",
        description="울산대공원. 넓은 잔디·놀이시설·계절 꽃축제까지 갖춘 동남권 대표 도시공원입니다.",
        loc="울산대공원",
        addr="울산광역시 남구 대공원로 94",
        region="울산광역시",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#공원", "#놀이터", "#피크닉", "#주말가족"],
        price="무료(일부 유료)",
        nursing=True,
    ),
    place(
        title="한밭수목원 가족 나들이",
        description="대전 한밭수목원. 도심 속 대형 수목원으로 산책·자연학습·가족 피크닉에 좋습니다.",
        loc="한밭수목원",
        addr="대전광역시 서구 둔산대로 169",
        region="대전광역시",
        place_types=["park_playground", "kids_outdoor", "nature_science"],
        tags=["#수목원", "#공원", "#자연학습", "#산책"],
        price="무료",
        link="https://www.daejeon.go.kr/hanbatarboretum/",
    ),
    place(
        title="부산 어린이대공원 나들이",
        description="부산 초읍 어린이대공원. 동물원·놀이시설·산책로로 부산 대표 아이 야외 나들이 장소입니다.",
        loc="부산어린이대공원",
        addr="부산광역시 부산진구 새싹로 295",
        region="부산광역시",
        place_types=["park_playground", "kids_outdoor", "amusement_park"],
        tags=["#공원", "#동물원", "#놀이터", "#주말가족"],
        price="일부 시설 유료",
        wiki="부산 어린이대공원",
    ),
    place(
        title="대구 수성못·수성유원지",
        description="대구 수성못. 호수 산책·유원지 놀이와 자전거로 아이와 여유로운 야외 나들이를 즐깁니다.",
        loc="수성못",
        addr="대구광역시 수성구 수성동무지개대로",
        region="대구광역시",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#호수", "#유원지", "#산책", "#피크닉"],
        price="무료(일부 유료)",
    ),
    place(
        title="국립수목원(광릉숲) 나들이",
        description="포천·남양주 국립수목원. 광릉숲 생태를 걸으며 아이와 숲 체험·자연학습하기 좋습니다.",
        loc="국립수목원",
        addr="경기도 포천시 소흘읍 광릉수목원로 415",
        region="경기도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#수목원", "#숲체험", "#자연학습", "#예약"],
        price="유료(사전예약)",
        booking=True,
        link="https://www.kna.go.kr/",
        nursing=True,
    ),
    place(
        title="서울식물원 열린숲·호수공원",
        description="마곡 서울식물원. 열린숲·호수공원과 주제원으로 실내외를 함께 즐기는 가족 나들이 명소입니다.",
        loc="서울식물원",
        addr="서울특별시 강서구 마곡동로 161",
        region="서울특별시",
        district="강서구",
        place_types=["park_playground", "kids_outdoor", "kids_indoor", "nature_science"],
        tags=["#식물원", "#공원", "#호수", "#주말가족"],
        price="주제원 유료 / 열린숲 무료",
        link="https://botanicpark.seoul.go.kr/",
        nursing=True,
    ),
    # —— 숲체원·자연휴양림 ——
    place(
        title="국립횡성숲체원 숲체험",
        description="한국산림복지진흥원 횡성숲체원. 숲해설·목공·캠프 등 아이·가족 숲체험 프로그램이 다양합니다.",
        loc="국립횡성숲체원",
        addr="강원특별자치도 횡성군 둔내면",
        region="강원특별자치도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#자연휴양", "#가족캠프"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
        nursing=True,
    ),
    place(
        title="국립칠곡숲체원 숲체험",
        description="칠곡숲체원. 영남권 대표 산림복지시설로 유아·아동 숲체험과 가족 숙박 프로그램이 있습니다.",
        loc="국립칠곡숲체원",
        addr="경상북도 칠곡군 기산면",
        region="경상북도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#자연휴양"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립대전숲체원 숲체험",
        description="대전숲체원. 도심 접근성이 좋은 산림복지시설로 주말 가족 숲체험에 적합합니다.",
        loc="국립대전숲체원",
        addr="대전광역시 서구",
        region="대전광역시",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#주말가족"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립나주숲체원 숲체험",
        description="나주숲체원. 호남권 숲체험·산림교육 거점으로 아이와 자연을 가까이하기 좋습니다.",
        loc="국립나주숲체원",
        addr="전라남도 나주시",
        region="전라남도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#자연휴양"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립울진숲체원 숲체험",
        description="울진숲체원. 금강소나무 숲에서 하는 산림치유·가족 숲체험 프로그램이 특징입니다.",
        loc="국립울진숲체원",
        addr="경상북도 울진군",
        region="경상북도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#산림치유"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립장성숲체원 숲체험",
        description="장성숲체원. 편백숲 기반 산림복지 프로그램으로 아이·부모 함께하는 숲나들이에 좋습니다.",
        loc="국립장성숲체원",
        addr="전라남도 장성군",
        region="전라남도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#편백숲", "#숲체험"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립청도숲체원 숲체험",
        description="청도숲체원. 영남권 가족·아동 대상 숲해설·체험·숙박형 산림복지 프로그램을 운영합니다.",
        loc="국립청도숲체원",
        addr="경상북도 청도군",
        region="경상북도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#숲체험", "#가족캠프"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="국립신안숲체원 숲체험",
        description="신안숲체원. 섬·바다와 가까운 산림복지시설로 이색적인 가족 숲체험이 가능합니다.",
        loc="국립신안숲체원",
        addr="전라남도 신안군",
        region="전라남도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#숲체원", "#섬나들이", "#숲체험"],
        price="프로그램별 유료",
        booking=True,
        link="https://www.fowi.or.kr/",
    ),
    place(
        title="유명산자연휴양림 숲나들이",
        description="가평 유명산자연휴양림. 산책로·숲속 놀이·캠핑으로 수도권에서 접근하기 좋은 휴양림입니다.",
        loc="유명산자연휴양림",
        addr="경기도 가평군 설악면",
        region="경기도",
        place_types=["forest_recreation", "kids_outdoor"],
        tags=["#자연휴양림", "#숲나들이", "#캠핑", "#주말가족"],
        price="입장·시설 요금 사전확인",
        booking=True,
        link="https://www.foresttrip.go.kr/",
    ),
    place(
        title="축령산자연휴양림 편백숲",
        description="남양주 축령산자연휴양림. 울창한 편백·잣나무 숲길로 아이와 가벼운 트레킹에 좋습니다.",
        loc="축령산자연휴양림",
        addr="경기도 남양주시 수동면",
        region="경기도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#자연휴양림", "#편백숲", "#트레킹"],
        price="입장·시설 요금 사전확인",
        booking=True,
        link="https://www.foresttrip.go.kr/",
    ),
    place(
        title="산음자연휴양림 숲체험",
        description="양평 산음자연휴양림. 산림욕장·탐방로로 서울 근교 숲체험·피크닉에 인기입니다.",
        loc="산음자연휴양림",
        addr="경기도 양평군 단월면",
        region="경기도",
        place_types=["forest_recreation", "kids_outdoor"],
        tags=["#자연휴양림", "#산림욕", "#주말가족"],
        price="입장·시설 요금 사전확인",
        booking=True,
        link="https://www.foresttrip.go.kr/",
    ),
    place(
        title="중미산자연휴양림 나들이",
        description="양평 중미산자연휴양림. 숲속 산책과 숙박·캠핑으로 가족 단위 자연 휴양에 적합합니다.",
        loc="중미산자연휴양림",
        addr="경기도 양평군 서종면",
        region="경기도",
        place_types=["forest_recreation", "kids_outdoor"],
        tags=["#자연휴양림", "#캠핑", "#숲나들이"],
        price="입장·시설 요금 사전확인",
        booking=True,
        link="https://www.foresttrip.go.kr/",
    ),
    place(
        title="절물자연휴양림 가족 나들이",
        description="제주 절물자연휴양림. 장생의숲길 등 평탄한 산책로로 아이·유모차 동반 숲나들이에 좋습니다.",
        loc="절물자연휴양림",
        addr="제주특별자치도 제주시 봉개동",
        region="제주특별자치도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#자연휴양림", "#제주", "#숲길", "#가족여행"],
        price="입장료 사전확인",
        link="https://jeolmul.jejusi.go.kr/",
        age="all",
    ),
    place(
        title="교래자연휴양림 숲나들이",
        description="제주 교래자연휴양림. 곶자왈 숲과 탐방로로 제주 동부 가족 자연 체험에 좋습니다.",
        loc="교래자연휴양림",
        addr="제주특별자치도 제주시 조천읍 교래리",
        region="제주특별자치도",
        place_types=["forest_recreation", "kids_outdoor", "nature_science"],
        tags=["#자연휴양림", "#곶자왈", "#제주", "#숲체험"],
        price="입장료 사전확인",
    ),
    place(
        title="속리산 숲체험·법주사 일대 나들이",
        description="보은 속리산 일대. 숲길 산책과 법주사 주변으로 아이와 가벼운 산악·문화 나들이를 즐길 수 있습니다.",
        loc="속리산국립공원",
        addr="충청북도 보은군 속리산면",
        region="충청북도",
        place_types=["forest_recreation", "kids_outdoor", "historical"],
        tags=["#국립공원", "#숲나들이", "#사찰", "#가족여행"],
        price="공원·사찰 요금 사전확인",
        wiki="속리산",
    ),
    place(
        title="남이섬 가족 나들이",
        description="가평 남이섬. 산책·자전거·놀이공간으로 수도권 대표 가족 야외 당일치기 명소입니다.",
        loc="남이섬",
        addr="강원특별자치도 춘천시 남산면 남이섬길 1",
        region="강원특별자치도",
        place_types=["park_playground", "kids_outdoor", "amusement_park"],
        tags=["#남이섬", "#피크닉", "#자전거", "#주말가족"],
        price="입장료 유료",
        link="https://www.namisum.com/",
        nursing=True,
    ),
    place(
        title="자라섬 가족 피크닉",
        description="가평 자라섬. 잔디광장·캠핑·계절 축제로 한강 수변 가족 야외 활동에 좋습니다.",
        loc="자라섬",
        addr="경기도 가평군 가평읍",
        region="경기도",
        place_types=["park_playground", "kids_outdoor"],
        tags=["#자라섬", "#피크닉", "#캠핑", "#수변"],
        price="일부 시설·행사 유료",
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
        "created_at": "2026-07-29T08:00:00Z",
        "updated_at": "2026-07-29T08:00:00Z",
    }


def enrich_existing_place_types(event: dict) -> list[str]:
    types = list(event.get("place_types") or [])
    blob = " ".join(
        [
            event.get("title") or "",
            event.get("location_name") or "",
            " ".join(event.get("tags") or []),
            event.get("description") or "",
        ]
    )
    if any(
        k in blob
        for k in (
            "놀이공원",
            "테마파크",
            "에버랜드",
            "롯데월드",
            "서울랜드",
            "레고랜드",
            "워터파크",
            "캐리비안",
            "패밀리랜드",
            "경주월드",
        )
    ):
        types.append("amusement_park")
    if any(
        k in blob
        for k in (
            "한강공원",
            "어린이대공원",
            "놀이터",
            "유원지",
            "꿈의숲",
            "올림픽공원",
            "월드컵공원",
            "보라매공원",
            "호수공원",
            "가족공원",
        )
    ):
        types.append("park_playground")
    if any(
        k in blob
        for k in ("숲체원", "자연휴양림", "수목원", "산림욕", "숲체험", "치유의숲")
    ):
        types.append("forest_recreation")
    if any(k in blob for k in ("공원", "한강", "피크닉", "야외놀이")):
        types.append("kids_outdoor")
    return list(dict.fromkeys(types))


def main() -> None:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    by_key = {(e["title"], e["start_date"]): e for e in events}
    existing_thumbs = {}
    if THUMB_MAP_PATH.exists():
        existing_thumbs = json.loads(THUMB_MAP_PATH.read_text(encoding="utf-8"))
    cache: dict[str, str | None] = {k: v for k, v in existing_thumbs.items()}

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
            event["place_types"] = enrich_existing_place_types(event)
            loc = event.get("location_name") or ""
            if loc and not event.get("thumbnail_url"):
                thumb = resolve_thumb(client, loc, None, cache)
                if thumb:
                    event["thumbnail_url"] = thumb

    final = list(by_key.values())
    rank = {"ongoing": 0, "upcoming": 1, "ended": 2}
    final.sort(key=lambda e: (rank.get(e["status"], 9), e["start_date"]))
    EVENTS_PATH.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")

    place_thumbs = {k: v for k, v in cache.items() if v}
    THUMB_MAP_PATH.write_text(
        json.dumps(place_thumbs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    from collections import Counter

    c = Counter(t for e in final for t in (e.get("place_types") or []))
    print(
        "total=",
        len(final),
        "added=",
        added,
        "with_thumb=",
        sum(1 for e in final if e.get("thumbnail_url")),
    )
    print("place_type_counts=", dict(c))


if __name__ == "__main__":
    main()
