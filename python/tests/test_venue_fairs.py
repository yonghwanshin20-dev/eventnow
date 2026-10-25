from datetime import date

from collectors.venue_fairs import (
    VENUES,
    category_hint,
    is_consumer_fair,
    item_to_raw,
    parse_kintex,
    parse_range,
    parse_setec,
)

TODAY = date(2026, 10, 25)


def test_consumer_fairs_kept_b2b_dropped():
    for title in ("2026 가을 고양가구박람회", "제2회 서울 가구·인테리어 박람회", "2026 코베 베이비페어",
                  "궁디팡팡 캣페스타", "2026 보드게임페스타", "서울일러스트레이션페어V.22"):
        assert is_consumer_fair(title), title
    for title in ("한국건축산업대전 2026", "제51회 호주유학박람회", "WORLD HYDROGEN EXPO 2026",
                  "2026 마이프차 프랜차이즈 박람회", "캐스크 카니발 2026", "AIoT 국제전시회",
                  "2027학년도 정시 대학입학정보박람회", "FSG Korea 기능안전 컨퍼런스 2026"):
        assert not is_consumer_fair(title), title


def test_category_and_range():
    assert category_hint("제55회 맘앤베이비엑스포") == "kids_experience"
    assert category_hint("속도의 시대", "Pop-up/Event") == "popup"
    assert category_hint("2026 가을 고양가구박람회") == "exhibition"
    assert parse_range("2026.10.29~2026.11.01") == (date(2026, 10, 29), date(2026, 11, 1))
    assert parse_range(" 2026-11-21 ~ 2026-11-22") == (date(2026, 11, 21), date(2026, 11, 22))
    assert parse_range("2026.10.28 - 2026.10.30") == (date(2026, 10, 28), date(2026, 10, 30))


def test_parse_kintex_and_setec_items():
    kintex = """
    <a class="btn-square-item red" href="javascript:fnView('./view.do', 26090201);">
      <span class="event-label-ko">전시회</span>
      <div class="item-subject">2026 가을 고양가구박람회</div>
      <div class="item-client"> 전시홀 9 </div>
      <div class="item-date">2026.10.29~2026.11.01</div>
    </a>"""
    items = parse_kintex(kintex)
    assert items[0]["link"].endswith("seq=26090201")
    rec = item_to_raw(VENUES[1], items[0], today=TODAY)
    assert rec is not None
    assert rec.source == "venue_fair"
    assert rec.facts["address"].startswith("경기도 고양시")
    assert rec.facts["location_name"] == "킨텍스 전시홀 9"

    setec = """
    <a href="#" onclick="fn_view('2311'); return false;">
      <div class="txt"><strong>2026 보드게임페스타</strong>
        <ul><li>기간 : 2026-11-21 ~ 2026-11-22</li><li>장소 : 제1전시실, 제2전시실</li></ul>
      </div>
    </a>"""
    s = parse_setec(setec)[0]
    assert s["hall"] == "제1전시실, 제2전시실"
    assert item_to_raw(VENUES[2], s, today=TODAY).facts["end_date"] == "2026-11-22"
    # 지난 행사는 뺀다
    assert item_to_raw(VENUES[2], {**s, "when": "2026-10-01 ~ 2026-10-02"}, today=TODAY) is None
