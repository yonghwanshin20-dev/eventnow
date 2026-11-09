"""피드백(#3 사전신청, #4 운영 공지, #6·#7 상시 장소) 반영 테스트."""

from datetime import date

from collectors.attractions import famous_nature, park_row_to_raw, tour_row_to_raw
from parsers.rule_parser import extract_apply_window, is_program_notice
from store.json_store import extend_year_round

TODAY = date(2026, 11, 9)


def test_apply_window_range_and_open():
    start, end = date(2026, 11, 21), date(2026, 11, 21)
    assert extract_apply_window("모집 기간 11월 1일(일) ~ 11월 15일(일) 까지", start, end) == (
        date(2026, 11, 1),
        date(2026, 11, 15),
    )
    assert extract_apply_window("신청: 2026. 11. 10.(화) 오전 9시부터 홈페이지 신청", start, end) == (
        date(2026, 11, 10),
        None,
    )
    assert extract_apply_window("⭐️ 사전 예약 오픈: 11/12(목) 18시", start, end) == (date(2026, 11, 12), None)


def test_apply_window_ignores_event_period_and_nonsense():
    start, end = date(2026, 10, 29), date(2026, 11, 14)
    # '예약 안내 · 기간: (행사 기간)' — 행사 날짜를 신청 기간으로 읽지 않는다
    assert extract_apply_window("예약 안내 · 기간: 2026. 10. 29(목) - 11. 14(토)", start, end) == (None, None)
    # 행사가 끝난 뒤 날짜는 신청 기간일 수 없다
    assert extract_apply_window("접수 12월 1일부터", start, end) == (None, None)
    assert extract_apply_window("가족과 함께 즐기는 축제", start, end) == (None, None)


def test_operation_notices_are_dropped():
    assert is_program_notice("[서울로봇인공지능과학관] 연장 운영 안내")
    assert is_program_notice("○○박물관 휴관 안내")
    assert is_program_notice("동절기 운영시간 변경")
    assert not is_program_notice("[서울로봇인공지능과학관] 미디어파사드전시 [서울라임:로봇시티]")


def test_parks_only_big_or_themed():
    base = {"RDNMADR": "서울특별시 서대문구 홍은동 1", "LATITUDE": "37.59", "LONGITUDE": "126.94"}
    big = park_row_to_raw({**base, "PARK_NM": "백련", "PARK_SE": "근린공원", "PARK_AR": "993724"}, today=TODAY)
    assert big.facts["title"] == "백련공원"
    assert big.meta["place_types"] == ["park_playground"]
    themed = park_row_to_raw({**base, "PARK_NM": "독립공원", "PARK_SE": "역사공원", "PARK_AR": "113021"}, today=TODAY)
    assert "historical" in themed.meta["place_types"]
    assert park_row_to_raw({**base, "PARK_NM": "새싹", "PARK_SE": "어린이공원", "PARK_AR": "900000"}, today=TODAY) is None
    assert park_row_to_raw({**base, "PARK_NM": "동네", "PARK_SE": "근린공원", "PARK_AR": "30000"}, today=TODAY) is None
    assert park_row_to_raw({**base, "PARK_NM": "기 자 촌", "PARK_SE": "근린공원", "PARK_AR": "200000"}, today=TODAY).facts["title"] == "기자촌공원"


def test_famous_nature_and_season_titles():
    names = [r.facts["title"] for r in famous_nature(TODAY)]
    assert "금정산 국립공원" in names and "동래온천" in names and len(names) == 30
    rec = tour_row_to_raw({"TRRSRT_NM": "서대문형무소역사관(3월~10월)", "RDNMADR": "서울특별시 서대문구 통일로 251"}, today=TODAY)
    assert rec.facts["title"] == "서대문형무소역사관"


def test_curated_year_round_places_keep_rolling():
    place = {"source": None, "start_date": "2026-01-01", "end_date": "2026-12-31"}
    assert extend_year_round(place, TODAY)
    assert place["end_date"] == "2027-12-14"
    # 출처가 있는 행사·짧은 행사·아직 먼 것은 그대로
    assert not extend_year_round({"source": "kfes", "start_date": "2026-01-01", "end_date": "2026-12-31"}, TODAY)
    assert not extend_year_round({"source": None, "start_date": "2026-11-01", "end_date": "2026-11-30"}, TODAY)
    assert not extend_year_round({"source": None, "start_date": "2026-01-01", "end_date": "2027-06-30"}, TODAY)
