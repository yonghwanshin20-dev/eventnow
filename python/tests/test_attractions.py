from datetime import date

from collectors.attractions import (
    drop_known,
    heritage_to_raw,
    museum_price,
    museum_row_to_raw,
    parse_heritage_detail,
    parse_heritage_list,
    tour_row_to_raw,
)

TODAY = date(2026, 10, 25)


def test_museum_row_becomes_year_round_place():
    rec = museum_row_to_raw(
        {
            "FCLTY_NM": "국립중앙박물관",
            "FCLTY_TYPE": "박물관",
            "RDNMADR": "서울특별시 용산구 서빙고로 137",
            "LATITUDE": "37.5238",
            "LONGITUDE": "126.9804",
            "WEEKDAY_OPER_OPEN_HHMM": "1000",
            "WEEKDAY_OPER_COLSE_HHMM": "1800",
            "RSTDE_INFO": "1월 1일, 설날, 추석",
            "ADULT_CHRGE": "0",
            "CHILD_CHRGE": "0",
            "HOMEPAGE_URL": "www.museum.go.kr",
            "FCLTY_INTRCN": "우리 역사와 문화를 한눈에",
        },
        today=TODAY,
    )
    assert rec is not None
    assert rec.source == "attraction"
    assert rec.meta["category_hint"] == "attraction"
    assert rec.facts["end_date"] == "2027-11-29"  # 오늘 + 400일 — 매일 다시 늘어난다
    assert rec.facts["price_info"] == "무료"
    assert rec.facts["official_link"] == "https://www.museum.go.kr"
    assert "관람 시간 10:00~18:00" in rec.facts["description"]


def test_closed_museum_and_prices():
    row = {"FCLTY_NM": "어느 박물관 (폐관)", "RDNMADR": "서울특별시 중구 1"}
    assert museum_row_to_raw(row, today=TODAY) is None
    assert museum_price({"ADULT_CHRGE": "3,000", "CHILD_CHRGE": "0"}) == "어른 3,000원 · 어린이 무료"


def test_tour_row():
    rec = tour_row_to_raw(
        {"TRRSRT_NM": "임진각관광지", "TRRSRT_SE": "관광지", "RDNMADR": "경기도 파주시 문산읍 임진각로 148-40",
         "LATITUDE": "37.889", "LONGITUDE": "126.740", "TRRSRT_INTRCN": "평화누리공원과 임진각"},
        today=TODAY,
    )
    assert rec.facts["title"] == "임진각관광지"
    assert "#관광지" in rec.facts["tags"]


HERITAGE_LIST = """<?xml version="1.0" encoding="utf-8"?><result><totalCnt>2</totalCnt>
<item><ccmaName><![CDATA[사적]]></ccmaName><ccbaMnm1><![CDATA[수원 화성]]></ccbaMnm1>
<ccbaCtcdNm><![CDATA[경기]]></ccbaCtcdNm><ccsiName><![CDATA[수원시]]></ccsiName><ccbaKdcd>13</ccbaKdcd>
<ccbaCtcd>31</ccbaCtcd><ccbaAsno>0000030000000</ccbaAsno><ccbaCncl>N</ccbaCncl>
<longitude>127.013255</longitude><latitude>37.281792</latitude></item>
<item><ccmaName><![CDATA[사적]]></ccmaName><ccbaMnm1><![CDATA[해제된 유적]]></ccbaMnm1><ccbaCncl>Y</ccbaCncl></item>
</result>"""

HERITAGE_DETAIL = """<?xml version="1.0" encoding="utf-8"?><result><item>
<ccbaLcad><![CDATA[경기 수원시 팔달구 장안동 1-2번지]]></ccbaLcad><ccceName><![CDATA[조선 정조 20년(1796)]]></ccceName>
<imageUrl>http://www.khs.go.kr/unisearch/images/history_site/1625382.jpg</imageUrl>
<content><![CDATA[화성은 조선시대 성곽이다. <br/><b>※(화성 → 수원 화성)으로 명칭변경 되었습니다.</b>]]></content>
</item></result>"""


def test_heritage_list_and_detail():
    rows = parse_heritage_list(HERITAGE_LIST)
    assert [r["ccbaMnm1"] for r in rows] == ["수원 화성"]  # 지정 해제된 곳은 뺀다
    detail = parse_heritage_detail(HERITAGE_DETAIL)
    assert detail["image"].startswith("https://www.khs.go.kr/")
    assert detail["content"] == "화성은 조선시대 성곽이다."
    rec = heritage_to_raw(rows[0], detail, today=TODAY)
    assert rec.facts["address"] == "경기 수원시 팔달구 장안동 1-2번지"
    assert rec.facts["latitude"] == 37.281792
    assert "시대 조선" in rec.facts["description"]
    # 상세가 아직 없어도 시·도 + 시·군으로 넣는다
    assert heritage_to_raw(rows[0], {}, today=TODAY).facts["address"] == "경기 수원시"


def test_drop_known_titles():
    rec = tour_row_to_raw({"TRRSRT_NM": "국립전주박물관", "RDNMADR": "전북 전주시 완산구 쑥고개로 249"}, today=TODAY)
    assert drop_known([rec], ["국립전주박물관 상설전시"]) == []
    assert drop_known([rec], ["다른 곳"]) == [rec]
