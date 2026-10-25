"""문화체육관광부 지역축제 · 시·군청 연간 일정표 — 실제 화면(2026-10 확인) 모양으로 검사."""

from __future__ import annotations

from datetime import date

from bs4 import BeautifulSoup

from collectors.city_calendar import CityCalendar, parse_calendar, parse_day
from collectors.mcst_festival import item_to_raw, parse_period
from parsers.rule_parser import RuleEventParser
from validation import validate_events

TODAY = date(2026, 10, 20)

MCST_ITEM = """
<li><a class="go" href="festivalView.jsp?pSeq=11950&amp;pRo=1" onclick="fnView(11950, 1);return false;">
<div class="inside"><div class="img festival"><img alt="동두천시 책문화축제" src="/attachFiles/x/1.jpg"/></div>
<div class="text festival"><p class="sub-tit">동두천시 책문화축제</p>
<div class="sub-text">책과 함께하는 가족 축제로 체험 부스와 공연이 열린다.</div>
<ul class="list"><li><strong>기간</strong>: 2026. 10. 31. | 15:30~19:00</li>
<li><strong>장소</strong>: 경기도 동두천시</li><li><strong>문의</strong>: 031-860-2000</li></ul>
</div></div></a></li>
"""


def test_mcst_period_variants():
    assert parse_period("2026. 10. 17. ~ 10. 21. | 10:00~22:00") == ("2026-10-17", "2026-10-21", "10:00~22:00")
    assert parse_period("2026. 10. 31. | 15:30~19:00") == ("2026-10-31", "2026-10-31", "15:30~19:00")
    assert parse_period("2026. 12. 19. ~ 2027. 2. 14.") == ("2026-12-19", "2027-02-14", None)
    assert parse_period("2026. 10. 10. ~ 10. 31. 17:00~21:00") == ("2026-10-10", "2026-10-31", "17:00~21:00")
    assert parse_period("미정") is None


def test_mcst_item_to_event():
    anchor = BeautifulSoup(MCST_ITEM, "html.parser").find("a")
    record = item_to_raw(anchor)
    assert record.source == "mcst_festival" and record.source_id == "11950"
    assert record.facts["thumbnail_url"] == "https://www.mcst.go.kr/attachFiles/x/1.jpg"
    ev = RuleEventParser().parse_one(record)
    assert ev.category.value == "festival" and ev.is_family_friendly
    assert "운영 시간 15:30~19:00" in ev.description
    kept = validate_events([ev], today=TODAY).kept
    assert kept[0].region == "경기도" and kept[0].district == "동두천시"


CITY = CityCalendar(key="uijeongbu", name="의정부시", region="경기도", url="https://www.ui4u.go.kr/x")
CITY_HTML = """
<table><caption>2026년 연간 행사·축제 일정을 월, 일자 …</caption>
<tr><th>월</th><th>일자</th><th>행사·축제명</th><th>장소</th><th>주요내용</th><th>소관부서 (문의처)</th></tr>
<tr><td rowspan="2">10월</td><td>24</td><td>호원동 가을 가족축제</td><td>호원1동 중랑천변</td><td>공연, 체험부스, 먹거리</td><td>호원1동 (031-870-7341)</td></tr>
<tr><td>10</td><td>지난 축제</td><td>시청</td><td>공연</td><td>문화예술과</td></tr>
<tr><td rowspan="3">11월</td><td>미정</td><td>사계절 세대통합 페스티벌</td><td>시청 앞 평화의 광장</td><td>슬로우 조깅, 백일장</td><td>도시교육재단</td></tr>
<tr><td>2</td><td>치매극복 주간행사</td><td>복지관</td><td>치매선별검사</td><td>보건과</td></tr>
<tr><td>30~12.2</td><td>겨울 빛 축제</td><td>평화의 광장</td><td>빛 조형물</td><td>문화예술과</td></tr>
</table>
"""


def test_city_day_cells():
    assert parse_day(10, "24", 2026) == ("2026-10-24", "2026-10-24", False)
    assert parse_day(4, "1~30", 2026) == ("2026-04-01", "2026-04-30", False)
    assert parse_day(11, "30~12.2", 2026) == ("2026-11-30", "2026-12-02", False)
    assert parse_day(11, "미정", 2026) == ("2026-11-01", "2026-11-30", True)
    assert parse_day(11, "??", 2026) is None


def test_city_calendar_rows_rowspan_and_filters():
    records = parse_calendar(CITY_HTML, CITY, TODAY)
    titles = [r.title_hint for r in records]
    # 지난 행사·보건 캠페인은 빠지고, 월 칸이 없는 줄도 앞 월로 읽는다
    assert titles == ["호원동 가을 가족축제", "사계절 세대통합 페스티벌", "겨울 빛 축제"]
    first = RuleEventParser().parse_one(records[0])
    kept = validate_events([first], today=TODAY).kept
    assert kept[0].region == "경기도" and kept[0].district == "의정부시"
    assert kept[0].start_date.isoformat() == "2026-10-24"
    undecided = records[1]
    assert (undecided.facts["start_date"], undecided.facts["end_date"]) == ("2026-11-01", "2026-11-30")
    assert "날짜가 아직 정해지지 않았어요" in undecided.facts["description"]
