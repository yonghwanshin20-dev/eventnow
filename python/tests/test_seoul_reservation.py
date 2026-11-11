"""서울시 공공서비스예약 API — 실제 응답(2026-11 확인) 모양으로 검사 (네트워크 없음)."""

from datetime import date

from collectors.seoul_culture import is_family_row
from collectors.seoul_reservation import row_to_raw
from parsers.rule_parser import RuleEventParser
from validation import validate_events

TODAY = date(2026, 11, 11)


def _row(**kw):
    row = {
        "SVCID": "S261103", "SVCNM": "[서대문구]백련산유아숲체험원 주말(토) 가족 숲체험 프로그램",
        "SVCSTATNM": "접수중", "MAXCLASSNM": "문화체험", "MINCLASSNM": "교육체험", "PAYATNM": "무료",
        "PLACENM": "백련산유아숲체험원", "USETGTINFO": " 가족(유아 1명, 보호자 1명)",
        "SVCURL": "https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=S261103",
        "X": "126.9361", "Y": "37.5891", "SVCOPNBGNDT": "2026-11-14 00:00:00.0", "SVCOPNENDDT": "2026-11-28 00:00:00.0",
        "RCPTBGNDT": "2026-11-01 09:00:00.0", "RCPTENDDT": "2026-11-12 18:00:00.0", "AREANM": "서대문구",
        "IMGURL": "", "DTLCONT": "&lt;p&gt;숲에서 놀아요&lt;/p&gt;",
    }
    row.update(kw)
    return row


def test_family_program_with_apply_window_and_district():
    rec = row_to_raw(_row(), today=TODAY)
    assert rec.source == "seoul_reservation" and rec.facts["latitude"] == 37.5891
    assert rec.facts["address"] == "서울특별시 서대문구 백련산유아숲체험원"
    ev = RuleEventParser().parse_one(rec)
    assert ev.category.value == "kids_experience"
    assert validate_events([ev], today=TODAY).kept[0].district == "서대문구"
    assert (ev.apply_start, ev.apply_end) == (date(2026, 11, 1), date(2026, 11, 12))
    assert ev.place_types  # 숲체험 → 자연


def test_closed_adult_and_youth_programs_are_dropped():
    assert row_to_raw(_row(SVCSTATNM="예약마감"), today=TODAY) is None
    assert row_to_raw(_row(USETGTINFO="성인, 청소년(중고등학생)"), today=TODAY) is None
    assert row_to_raw(_row(MINCLASSNM="청년정보", USETGTINFO="청년(19~39세)"), today=TODAY) is None
    # 부모가 체험하고 아이가 함께 오는 목공 체험은 남긴다
    assert row_to_raw(_row(USETGTINFO="성인(체험자가 부모일 경우 유아동반 가능)"), today=TODAY)


def test_kids_cafe_is_a_place():
    rec = row_to_raw(
        _row(SVCNM="서울형 키즈카페 은평구 역촌동점(은평아이맘놀이터) 3~6세", MINCLASSNM="서울형키즈카페", USETGTINFO="유아",
             PLACENM="서울특별시 은평구 갈현로7가길 10", AREANM="은평구"),
        today=TODAY,
    )
    assert rec.facts["title"] == "서울형 키즈카페 은평구 역촌동점(은평아이맘놀이터)"
    assert rec.meta["category_hint"] == "attraction" and rec.facts["start_date"] == "2026-11-11"
    assert "[신청]" not in rec.raw_text


def test_seoul_culture_api_keeps_family_rows_only():
    assert is_family_row({"TITLE": "서대문 가을축제", "CODENAME": "축제-시민화합"})
    assert is_family_row({"TITLE": "아이와 함께 듣는 클래식 동화", "CODENAME": "클래식"})
    assert not is_family_row({"TITLE": "재즈 나이트", "CODENAME": "콘서트", "USE_TRGT": "만 19세 이상"})
