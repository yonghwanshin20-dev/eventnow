from datetime import date

from collectors.attractions import library_row_to_raw
from models import RawRecord
from parsers.rule_parser import classify_place_types, is_program_notice, place_types_for


def test_program_notices_but_not_special_events():
    for title in ("[마포구립서강도서관] 10월 문화프로그램 안내", "[곰달래도서관] 2026년 4분기 정규강좌 안내",
                  "[성북문화예술교육센터] 2026 [오늘도 예술로] 가을 시즌 프로그램 안내", "수원시미디어센터 10월 상영 프로그램"):
        assert is_program_notice(title), title
    for title in ("[서울도서관] 2026 서울 독서축제 프로그램 안내", "OO도서관 가을 북 페스티벌",
                  "[구산동도서관마을] 북토크", "어린이 과학교실 이벤트", "제3회 양천가족 거리축제"):
        assert not is_program_notice(title), title


def test_new_place_types():
    assert classify_place_types("국립중앙박물관") == ["museum"]
    assert classify_place_types("서울숲") == ["nature"]
    assert classify_place_types("어린이대공원 놀이터") == ["park_playground"]
    assert classify_place_types("명동성당") == ["religious"]
    assert classify_place_types("은평구립도서관") == ["library"]
    assert classify_place_types("문화비축기지 복합문화공간") == ["cultural_space"]
    assert classify_place_types("수원 화성 성곽") == ["historical"]


def test_attraction_types_use_name_and_hints():
    rec = lambda hints: RawRecord(source="attraction", raw_text="x", meta={"place_types": hints})  # noqa: E731
    assert place_types_for(rec(["historical"]), "경주 불국사", "경주 불국사", "attraction") == ["historical", "religious"]
    assert place_types_for(rec([]), "조계사", "조계사 서울 종로구", "attraction") == ["religious"]
    assert place_types_for(rec(["museum"]), "떡박물관", "떡박물관", "attraction") == ["museum"]


def test_only_notable_libraries():
    base = {"LBRRY_SE": "공공도서관", "RDNMADR": "서울특별시 강동구 1"}
    today = date(2026, 10, 26)
    assert library_row_to_raw({**base, "LBRRY_NM": "강동숲속도서관"}, today=today) is not None
    assert library_row_to_raw({**base, "LBRRY_NM": "글마루한옥어린이도서관"}, today=today) is not None
    assert library_row_to_raw({**base, "LBRRY_NM": "관악중앙도서관", "BULD_AR": "14279"}, today=today) is not None
    # 그냥 동네 도서관은 뺀다
    assert library_row_to_raw({**base, "LBRRY_NM": "하남시덕풍도서관", "BULD_AR": "2500"}, today=today) is None
    assert library_row_to_raw({**base, "LBRRY_NM": "그림책마을 작은도서관"}, today=today) is None


def test_library_rows():
    row = {"LBRRY_NM": "은평구립숲속도서관", "LBRRY_SE": "공공도서관", "RDNMADR": "서울특별시 은평구 진관3로 1",
           "WEEKDAY_OPER_OPEN_HHMM": "0900", "WEEKDAY_OPER_COLSE_HHMM": "2200", "HOMEPAGE_URL": "lib.ep.go.kr",
           "LATITUDE": "37.6", "LONGITUDE": "126.9"}
    rec = library_row_to_raw(row, today=date(2026, 10, 26))
    assert rec.meta["place_types"] == ["library"]
    assert rec.facts["official_link"] == "https://lib.ep.go.kr"
    assert "문화 프로그램" in rec.facts["description"]
    assert library_row_to_raw({**row, "LBRRY_SE": "작은도서관"}, today=date(2026, 10, 26)) is None
