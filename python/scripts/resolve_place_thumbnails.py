"""장소명 기준으로 Wikipedia/Commons 실제 이미지를 대량 매칭한다."""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = ROOT / "src" / "data" / "events.json"
THUMB_MAP_PATH = ROOT / "src" / "data" / "place-thumbnails.json"
UA = "EventNowCrawler/1.0 (local educational; place thumbnails)"

EXPLICIT = {
    "서대문자연사박물관": "서대문자연사박물관_중앙홀.jpg",
    "국립중앙박물관": "National_Museum_of_Korea_01.jpg",
    "경복궁": "Korea-Seoul-Gyeongbokgung-06.jpg",
    "창덕궁": "Changdeokgung-Injeongjeon.JPG",
    "덕수궁": "Deoksugung-Seokjojeon.JPG",
    "창경궁": "Changgyeonggung_Palace-02.jpg",
    "남산서울타워": "N_Seoul_Tower_at_night.jpg",
    "전쟁기념관": "War_Memorial_of_Korea.jpg",
    "서대문형무소역사관": "Seodaemun_Prison_History_Hall.jpg",
    "국립민속박물관": "National_Folk_Museum_of_Korea.jpg",
    "한성백제박물관": "Hanseong_Baekje_Museum.jpg",
    "서울식물원": "Seoul_Botanic_Park.jpg",
    "서울어린이대공원": "Seoul_Children's_Grand_Park.jpg",
    "어린이대공원": "Seoul_Children's_Grand_Park.jpg",
    "서울숲": "Seoul_Forest.jpg",
    "북촌한옥마을": "Bukchon_Hanok_Village.jpg",
    "남산골한옥마을": "Namsangol_Hanok_Village.jpg",
    "국립과천과학관": "Gwacheon_National_Science_Museum.jpg",
    "리움미술관": "Leeum,_Samsung_Museum_of_Art.jpg",
    "동대문디자인플라자": "Dongdaemun_Design_Plaza_at_night.jpg",
    "DDP 뮤지엄": "Dongdaemun_Design_Plaza_at_night.jpg",
    "청계천박물관": "Cheonggyecheon.jpg",
    "광화문광장·세종로공원": "Gwanghwamun_Plaza.jpg",
    "광화문광장": "Gwanghwamun_Plaza.jpg",
    "서울동물원": "Seoul_Zoo.jpg",
    "국립어린이과학관": "National_Children's_Science_Center_(Korea).jpg",
}


def file_url(name: str) -> str:
    name = name.replace(" ", "_")
    return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + urllib.parse.quote(name)
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
                "srlimit": 10,
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
            if any(x in low for x in (".svg", "logo", "map", "icon", ".pdf", ".tif")):
                continue
            name = title[5:] if title.startswith("File:") else title
            return file_url(name)
    except Exception:
        return None
    return None


def resolve_for_location(client: httpx.Client, loc: str, cache: dict[str, str | None]) -> str | None:
    if loc in cache:
        return cache[loc]

    for hint, filename in EXPLICIT.items():
        if hint in loc:
            url = file_url(filename)
            cache[loc] = url
            return url

    candidates = [loc]
    # strip suffixes
    for sep in ("·", "(", " "):
        if sep in loc:
            candidates.append(loc.split(sep)[0].strip())

    for cand in candidates:
        if not cand:
            continue
        url = wiki_image(client, cand, "ko") or wiki_image(client, cand, "en")
        if url:
            cache[loc] = url
            return url
        url = commons_search(client, cand)
        if url:
            cache[loc] = url
            return url

    cache[loc] = None
    return None


def main() -> None:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    existing_map = {}
    if THUMB_MAP_PATH.exists():
        existing_map = json.loads(THUMB_MAP_PATH.read_text(encoding="utf-8"))

    locs = sorted({(e.get("location_name") or "").strip() for e in events if e.get("location_name")})
    cache: dict[str, str | None] = {k: v for k, v in existing_map.items()}

    keywords = (
        "박물관",
        "미술관",
        "과학관",
        "궁",
        "공원",
        "타워",
        "동물원",
        "한옥",
        "식물원",
        "형무소",
        "전쟁",
        "대공원",
        "숲",
        "광장",
        "축제",
        "페스티벌",
        "한강",
        "성",
        "유적",
        "타워",
        "아트",
        "전시",
    )
    priority = [l for l in locs if any(k in l for k in keywords)]
    rest = [l for l in locs if l not in priority]
    ordered = priority + rest

    with httpx.Client(follow_redirects=True, timeout=25.0) as client:
        for i, loc in enumerate(ordered):
            if loc in cache and cache[loc]:
                continue
            resolve_for_location(client, loc, cache)
            if i % 40 == 0:
                print(f"{i}/{len(ordered)} resolved={sum(1 for v in cache.values() if v)}")

    place_thumbs = {k: v for k, v in cache.items() if v}
    THUMB_MAP_PATH.write_text(
        json.dumps(place_thumbs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    updated = 0
    for e in events:
        loc = (e.get("location_name") or "").strip()
        if loc and loc in place_thumbs:
            e["thumbnail_url"] = place_thumbs[loc]
            updated += 1
        else:
            url = e.get("thumbnail_url") or ""
            if "unsplash.com" in url:
                e["thumbnail_url"] = None

    EVENTS_PATH.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        "places_with_images=",
        len(place_thumbs),
        "events_with_thumb=",
        sum(1 for e in events if e.get("thumbnail_url")),
        "updated=",
        updated,
    )


if __name__ == "__main__":
    main()
