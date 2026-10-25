from datetime import date

from collectors.public_data import category_for, merge_runs, row_to_raw

TODAY = date(2026, 10, 25)


def _event(**kw):
    row = {
        "EVENT_NM": "키즈 콘서트 <그림책 콘서트>",
        "OPAR": "강동아트센터 소극장 드림",
        "EVENT_CO": "클래식",
        "EVENT_START_DATE": "2026-11-21",
        "EVENT_END_DATE": "2026-11-21",
        "EVENT_START_TIME": "11:00",
        "EVENT_END_TIME": "12:00",
        "CHRGE_INFO": "무료",
        "MNNST_NM": "강동문화재단",
        "ENTNC_AGE": "48개월 이상",
        "HOMEPAGE_URL": "",
        "RDNMADR": "서울특별시 강동구 동남로 870",
        "LATITUDE": "37.5503",
        "LONGITUDE": "127.1480",
        "INSTT_NM": "서울특별시 강동구",
    }
    row.update(kw)
    return row


def test_event_row_to_raw_keeps_family_show_with_coords():
    rec = row_to_raw("event", _event(), today=TODAY)
    assert rec is not None
    assert rec.source == "public_data"
    assert rec.meta["category_hint"] == "kids_experience"
    assert rec.facts["latitude"] == 37.5503
    assert rec.facts["price_info"] == "무료"
    assert rec.facts["age_info"] == "48개월 이상"
    assert "운영 시간 11:00~12:00" in rec.facts["description"]


def test_general_and_adult_shows_are_dropped():
    assert row_to_raw("event", _event(EVENT_NM="피아노 리사이틀", ENTNC_AGE="8세이상"), today=TODAY) is None
    assert row_to_raw("event", _event(EVENT_NM="가족 뮤지컬", ENTNC_AGE="중학생 이상"), today=TODAY) is None
    assert category_for("event", "7080 밴드 초청 공연 <불꽃 밴드>", "", "8세") is None
    assert category_for("event", "2026 영등포선유도원축제", "", "연령제한 없음") == "festival"
    assert category_for("event", "길 위의 인문학", "", "0세 이상") is None


def test_festival_rows_past_or_vague_are_dropped():
    fest = {
        "FSTVL_NM": "제3회 양천가족 거리축제",
        "OPAR": "신정네거리역",
        "FSTVL_START_DATE": "2026-10-25",
        "FSTVL_END_DATE": "2026-10-25",
        "FSTVL_CO": "가족 체험 부스와 공연",
        "RDNMADR": "서울특별시 양천구 신월로 지하 300",
    }
    assert row_to_raw("festival", fest, today=TODAY).meta["category_hint"] == "festival"
    assert row_to_raw("festival", {**fest, "FSTVL_END_DATE": "2026-10-24", "FSTVL_START_DATE": "2026-10-24"}, today=TODAY) is None
    year_long = {**fest, "FSTVL_START_DATE": "2026-01-01", "FSTVL_END_DATE": "2026-12-31"}
    assert row_to_raw("festival", year_long, today=TODAY) is None
    assert row_to_raw("festival", {**fest, "RDNMADR": ""}, today=TODAY) is None


def test_merge_runs_joins_consecutive_dates():
    rows = [
        row_to_raw("event", _event(EVENT_START_DATE=d, EVENT_END_DATE=d), today=TODAY)
        for d in ("2026-12-11", "2026-12-12", "2026-12-13", "2027-02-01")
    ]
    merged = merge_runs([r for r in rows if r])
    spans = sorted((r.facts["start_date"], r.facts["end_date"]) for r in merged)
    assert spans[0] == ("2026-12-11", "2026-12-13")
    assert spans[1] == ("2027-02-01", "2027-02-01")  # 한참 뒤 회차는 따로
