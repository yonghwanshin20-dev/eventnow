from store.json_store import merge_twins, twin_title


def row(title, **kw):
    base = {
        "id": title,
        "title": title,
        "region": "서울특별시",
        "category": "festival",
        "start_date": "2026-10-30",
        "end_date": "2026-11-01",
        "source": "public_data",
        "location_name": "",
        "latitude": 37.5,
        "longitude": 127.0,
    }
    base.update(kw)
    return base


def test_rooms_and_showings_merge():
    rows = [
        row("제 68회 충북예술제", location_name="대공연장", start_date="2026-10-30", end_date="2026-11-05"),
        row("제 68회 충북예술제", location_name="소공연장", start_date="2026-10-29", end_date="2026-11-03"),
        row("11월 공연 <더 매직 서커스>(1회)"),
        row("11월 공연 <더 매직 서커스>(2회)"),
    ]
    assert merge_twins(rows) == 2
    fest = next(r for r in rows if "충북" in r["title"])
    assert (fest["start_date"], fest["end_date"]) == ("2026-10-29", "2026-11-05")


def test_same_title_elsewhere_or_later_stays():
    rows = [
        row("던스트 팝업", source="popply", latitude=37.544, longitude=127.056),
        row("던스트 팝업", source="popply", latitude=37.513, longitude=127.104),  # 다른 매장
        row("서리풀 재즈페스타", start_date="2026-10-28", end_date="2026-10-28"),
        row("서리풀 재즈페스타", start_date="2026-11-11", end_date="2026-11-11"),  # 다른 회차
    ]
    assert merge_twins(rows) == 0


def test_same_event_two_categories_and_sources():
    rows = [
        row("[종로문화재단] 2026 종로 가족공연축제", category="kids_experience", source="seoul_portal"),
        row("[종로문화재단] 2026 종로 가족공연축제", category="festival", source="seoul_portal"),
    ]
    assert merge_twins(rows) == 1


def test_attraction_aliases_merge_but_branches_stay():
    a = lambda t, lat, lng: row(t, category="attraction", source="attraction", latitude=lat, longitude=lng)  # noqa: E731
    rows = [
        a("서대문형무소역사관(3월~10월)", 37.5741, 126.9561),
        a("서대문형무소역사관(11월~2월)", 37.5741, 126.9561),
        a("국립현대미술관(서울관)", 37.5787, 126.9800),
        a("국립현대미술관(과천관)", 37.4303, 127.0060),
    ]
    assert twin_title(rows[0]) == "서대문형무소역사관"
    assert merge_twins(rows) == 1
    assert len([r for r in rows if "국립현대" in r["title"]]) == 2


def test_wider_radius_for_sure_twins():
    a = lambda t, lat, lng: row(t, category="attraction", source="attraction", latitude=lat, longitude=lng)  # noqa: E731
    rows = [
        a("서울 한양도성", 37.580, 126.970),
        a("서울 한양도성(서울성곽)", 37.590, 126.980),  # 1.4km — 별칭
        a("중앙도서관", 37.500, 127.000),
        a("중앙도서관(열람실)", 37.510, 127.000),  # 1.1km — 흔한 이름이라 그대로
        row("팔공산 단풍축제", latitude=35.98, longitude=128.72),
        row("2026년 제25회 팔공산 단풍축제", latitude=35.99, longitude=128.73),  # 같은 출처·같은 날짜
    ]
    assert merge_twins(rows) == 2
    assert [r["title"] for r in rows if "도서관" in r["title"]] == ["중앙도서관", "중앙도서관(열람실)"]
