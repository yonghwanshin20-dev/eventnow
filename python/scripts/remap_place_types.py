"""kids_indoor / kids_outdoor 태그를 다른 place_types로 재분류 후 제거."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = ROOT / "src" / "data" / "events.json"

VALID = {
    "historical",
    "nature_science",
    "amusement_park",
    "park_playground",
    "forest_recreation",
    "cultural_center",
    "temple",
}

LEGACY = {"kids_indoor", "kids_outdoor"}


def remap(event: dict) -> list[str]:
    raw = list(event.get("place_types") or [])
    had_indoor = "kids_indoor" in raw
    had_outdoor = "kids_outdoor" in raw
    types = [t for t in raw if t in VALID]

    title = event.get("title") or ""
    loc = event.get("location_name") or ""
    tags = " ".join(event.get("tags") or [])
    desc = (event.get("description") or "")[:240]
    blob = f"{title} {loc} {tags} {desc}"
    category = event.get("category") or ""

    def add(t: str) -> None:
        if t in VALID and t not in types:
            types.append(t)

    # 명시 키워드 우선
    if any(k in blob for k in ("놀이공원", "테마파크", "워터파크", "에버랜드", "롯데월드", "서울랜드", "레고랜드", "원마운트")):
        add("amusement_park")
    if any(k in blob for k in ("숲체원", "자연휴양림", "둘레길", "자락길", "수목원", "산림", "북한산", "인왕산", "안산")):
        add("forest_recreation")
    if any(k in blob for k in ("한강공원", "놀이터", "근린공원", "호수공원", "피크닉", "한강", "공원")):
        add("park_playground")
    if any(k in blob for k in ("문화센터", "문화회관", "아트센터", "아트홀", "평생학습", "강좌", "도서관", "프로그램확인")):
        add("cultural_center")
    if any(k in blob for k in ("사찰", "절", "조계사", "봉원사", "진관사", "백련사", "성당", "성지")):
        add("temple")
    if any(
        k in blob
        for k in (
            "역사",
            "궁",
            "종묘",
            "형무소",
            "독립문",
            "기념관",
            "왕릉",
            "유적",
            "한옥",
            "한양도성",
            "임시정부",
        )
    ):
        # 자연사 내부 '역사' 제외
        if "자연사" not in blob or any(
            k in blob for k in ("궁", "종묘", "형무소", "독립", "왕릉", "유적", "한옥", "한양")
        ):
            add("historical")
    if any(
        k in blob
        for k in ("자연사", "과학관", "과학", "식물원", "생태", "공룡", "천체", "수족관", "아쿠아리움")
    ):
        add("nature_science")

    # 레거시 실내만 있던 경우 → 다른 축으로 이동
    if had_indoor and not types:
        if category == "exhibition":
            add("nature_science" if any(k in blob for k in ("과학", "자연", "식물")) else "historical")
        elif category == "kids_experience":
            add("cultural_center")
        elif category == "popup":
            add("cultural_center")
        else:
            add("cultural_center")

    # 레거시 야외만 있던 경우
    if had_outdoor and not any(
        t in types for t in ("park_playground", "forest_recreation", "amusement_park", "historical")
    ):
        if category == "festival":
            add("park_playground")
        else:
            add("park_playground")

    # 키즈 체험인데 장소 유형이 비면 문화센터로
    if category == "kids_experience" and not types:
        add("cultural_center")

    return types


def main() -> None:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    before = Counter()
    after = Counter()
    for e in events:
        for t in e.get("place_types") or []:
            before[t] += 1
        e["place_types"] = remap(e)
        for t in e["place_types"]:
            after[t] += 1

    EVENTS_PATH.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    print("before=", dict(before))
    print("after=", dict(after))
    print(
        "legacy_remaining=",
        sum(
            1
            for e in events
            for t in (e.get("place_types") or [])
            if t in LEGACY
        ),
        "empty_place_types=",
        sum(1 for e in events if not (e.get("place_types") or [])),
    )


if __name__ == "__main__":
    main()
