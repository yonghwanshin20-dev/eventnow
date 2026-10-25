"""서울문화포털 수집기 — 실제 응답(2026-10 확인) 모양으로 검사 (네트워크 없음)."""

from __future__ import annotations

from datetime import date

import httpx

from collectors.seoul_portal import SeoulPortalCollector, apply_detail, item_to_raw, parse_detail
from parsers.rule_parser import RuleEventParser
from store.json_store import loose_title
from validation import validate_events

TODAY = date(2026, 10, 20)


def _item(code: int, title: str, start: str, end: str, **kw):
    item = {
        "cultcode": code,
        "title": title,
        "strtdate": start,
        "endDate": end,
        "mainImg": None,
        "thumbDesc": f"{title} 가족이 함께 즐기는 동네 축제 체험부스 푸드트럭",
        "subjcodeNm": "축제-시민화합",
        "xCoord": "37.5797",
        "yCoord": "126.9333",
        "facName": "홍제폭포광장",
        "addr": "서울특별시 서대문구 연희동 산1-20",
    }
    item.update(kw)
    return item


VIEW_HTML = """
<html><body><h3>[서대문구] 2026 서대문 봄빛축제</h3>
<ul><li><strong>장소</strong></li><li>안산벚꽃마당, 홍제폭포광장</li>
<li>기간</li><li>2026-04-03</li><li>~</li><li>2026-04-05</li>
<li>시간</li><li>14:00~18:00</li><li>대상</li><li>누구나</li>
<li>요금</li><li>무료</li><li>문의</li><li>02-330-1576</li></ul>
<a href="https://www.sdm.go.kr/news/1">홈페이지 바로가기</a>
</body></html>
"""


def test_item_to_raw_maps_coords_and_address():
    record = item_to_raw(_item(160001, "[서대문구] 다가가다! 가족축제", "2026-10-24", "2026-10-24"), "FESTIVAL")
    f = record.facts
    assert record.source == "seoul_portal" and record.source_id == "160001"
    assert (f["latitude"], f["longitude"]) == (37.5797, 126.9333)  # xCoord=위도, yCoord=경도
    assert f["location_name"] == "홍제폭포광장"
    assert f["official_link"].endswith("cultcode=160001&menuNo=200010")
    assert "가족이 함께" in f["description"] and not f["description"].startswith("[서대문구]")


def test_detail_fills_price_age_hours_homepage():
    detail = parse_detail(VIEW_HTML)
    assert detail == {
        "hours": "14:00~18:00",
        "age": "누구나",
        "price": "무료",
        "contact": "02-330-1576",
        "homepage": "https://www.sdm.go.kr/news/1",
    }
    record = item_to_raw(_item(160001, "[서대문구] 다가가다! 가족축제", "2026-10-24", "2026-10-24"), "FESTIVAL")
    apply_detail(record, detail)
    ev = RuleEventParser().parse_one(record)
    assert ev.category.value == "festival" and ev.is_family_friendly
    assert ev.price_info == "무료" and ev.target_age_group.value == "all"
    assert ev.official_link == "https://www.sdm.go.kr/news/1"
    assert "운영 시간 14:00~18:00" in ev.description
    kept = validate_events([ev], today=TODAY).kept
    assert kept[0].region == "서울특별시" and kept[0].district == "서대문구"


def test_collector_filters_and_pages():
    pages = {
        ("FESTIVAL", "1"): [_item(1, "[마포구] 동네 축제", "2026-10-24", "2026-10-25")],
        ("SHOW", "1"): [
            _item(2, "어른 재즈 콘서트", "2026-10-24", "2026-10-24", thumbDesc="재즈 공연"),
            _item(3, "아이와 함께 듣는 클래식 동화", "2026-10-24", "2026-10-24"),
        ],
        ("EDUEXP", "1"): [_item(4, "성인 와인 클래스", "2026-10-24", "2026-10-24", thumbDesc="와인")],
        ("EXHIBITION", "1"): [
            _item(5, "작가 개인전", "2026-10-24", "2026-11-24", facName="갤러리 A", thumbDesc="개인전"),
            _item(6, "시립미술관 기획전", "2026-10-24", "2026-11-24", facName="서울시립미술관"),
        ],
    }
    seen_dates = []

    def handler(request: httpx.Request) -> httpx.Response:
        form = dict(httpx.QueryParams(request.content.decode()))
        seen_dates.append((form["sdate"], form["edate"]))
        return httpx.Response(200, json={"resultList": pages.get((form["searchCate"], form["pageIndex"]), [])})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with SeoulPortalCollector(client, min_interval=0, check_robots=False) as c:
        records = c.collect(today=TODAY)
    assert sorted(r.source_id for r in records) == ["1", "3", "6"]
    assert seen_dates[0] == ("2026-10-20", "2027-02-17")


def test_robots_longest_match_like_the_standard():
    from collectors.polite import Robots

    seoul = Robots(
        "# 안내\nUser-agent:Google-Extended\nAllow:/\n\nUser-agent:*\nDisallow:/\n"
        "Allow:/culture/culture/\nAllow:/culture/event/\n"
    )
    assert seoul.allowed("/culture/culture/cultureEvent/jsonList.json")
    assert seoul.allowed("/culture/culture/cultureEvent/view.do?cultcode=1")
    assert not seoul.allowed("/culture/mypage/x")
    assert not seoul.allowed("/")
    # 팝플리: 일반 봇은 /api/ 만 금지, AI 학습 봇 묶음은 우리에게 해당 없음
    popply = Robots("User-agent: *\nDisallow: /api/\n\nUser-agent: GPTBot\nDisallow: /\n")
    assert popply.allowed("/popup/1") and not popply.allowed("/api/x")
    assert Robots("User-agent: *\nDisallow:\n").allowed("/anything")
    assert not Robots("User-agent: *\nDisallow: /*.json$\n").allowed("/a/b.json")


def test_pricey_services_are_not_outings():
    from collectors.seoul_portal import is_pricey

    assert is_pricey("1,534,500원 (부가세 포함) * 부가서비스 선택 시 추가 비용 발생")
    assert not is_pricey("전석 20,000원")
    assert not is_pricey("무료")
    assert not is_pricey("성인 120,000원 / 어린이 5,000원")  # 가장 싼 값 기준


def test_bracket_label_ignored_for_same_event():
    assert loose_title("[서대문구] 2026 서대문 봄빛축제") == loose_title("서대문 봄빛축제")
