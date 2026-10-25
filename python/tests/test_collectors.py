from datetime import timedelta
from urllib.parse import urlparse

import httpx

from collectors.seoul_culture import row_to_raw
from collectors.tour_api import TourApiCollector, extract_homepage
from timeutil import today_kst

TODAY = today_kst()


def _ymd(days: int) -> str:
    return (TODAY + timedelta(days=days)).strftime("%Y%m%d")


def _wrap(items):
    return {"response": {"body": {"items": {"item": items} if items else ""}}}


def _handler(request: httpx.Request) -> httpx.Response:
    endpoint = urlparse(str(request.url)).path.rsplit("/", 1)[-1]
    params = request.url.params
    if endpoint == "searchFestival2":
        return httpx.Response(200, json=_wrap([
            {"contentid": "100", "title": "가을 축제", "addr1": "서울특별시 중구 세종대로 110",
             "eventstartdate": _ymd(-2), "eventenddate": _ymd(5), "mapx": "126.97", "mapy": "37.56",
             "contenttypeid": "15"},
            {"contentid": "101", "title": "끝난 축제", "addr1": "서울특별시 중구",
             "eventstartdate": _ymd(-30), "eventenddate": _ymd(-1)},
        ]))
    if endpoint == "areaBasedList2":
        return httpx.Response(200, json=_wrap([
            {"contentid": "100", "title": "가을 축제"},
            {"contentid": "200", "title": "날짜없는 목록", "addr1": "부산광역시 강서구"},
        ]))
    if endpoint == "detailCommon2":
        cid = params["contentId"]
        if cid == "200":
            return httpx.Response(500)
        return httpx.Response(200, json=_wrap([{
            "contentid": cid,
            "overview": "가족과 함께<br>즐기는 축제",
            "homepage": '<a href="https://festival.example.com" target="_blank">홈페이지</a>',
            "firstimage": "https://tong.visitkorea.or.kr/img.jpg",
        }]))
    if endpoint == "detailIntro2":
        cid = params["contentId"]
        if cid == "200":
            return httpx.Response(200, json=_wrap([{"eventstartdate": _ymd(1), "eventenddate": _ymd(9),
                                                     "eventplace": "강서 체육공원"}]))
        return httpx.Response(200, json=_wrap([{"eventplace": "서울광장", "usetimefestival": "무료"}]))
    return httpx.Response(404)


def test_tour_collect_merges_details_and_skips_ended(monkeypatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda *_: None)
    client = httpx.Client(transport=httpx.MockTransport(_handler))
    collector = TourApiCollector(service_key="k", client=client, max_detail_calls=50)
    records = collector.collect()
    by_id = {r.source_id: r for r in records}

    assert set(by_id) == {"100", "200"}  # 101 already ended → skipped before LLM
    fest = by_id["100"].facts
    assert fest["start_date"] == f"{_ymd(-2)[:4]}-{_ymd(-2)[4:6]}-{_ymd(-2)[6:]}"
    assert fest["official_link"] == "https://festival.example.com"
    assert fest["thumbnail_url"].startswith("https://tong.visitkorea.or.kr")
    assert fest["location_name"] == "서울광장"
    assert fest["latitude"] == 37.56 and fest["longitude"] == 126.97
    assert "즐기는 축제" in by_id["100"].raw_text

    # detailCommon 실패해도 detailIntro 날짜로 facts 확보
    area = by_id["200"].facts
    assert area["end_date"].replace("-", "") == _ymd(9)
    assert area["location_name"] == "강서 체육공원"


def test_tour_detail_call_cap():
    client = httpx.Client(transport=httpx.MockTransport(_handler))
    collector = TourApiCollector(service_key="k", client=client, max_detail_calls=0)
    records = collector.collect()
    # 상세 호출이 없으면 areaBasedList 항목은 날짜 facts가 없다
    assert "start_date" not in {r.source_id: r for r in records}["200"].facts


def test_extract_homepage_variants():
    assert extract_homepage('<a href="http://a.kr/x">a</a>') == "http://a.kr/x"
    assert extract_homepage("www.example.com") == "https://www.example.com"
    assert extract_homepage("홈페이지 없음") is None


def test_seoul_row_mapping_swapped_coords():
    row = {
        "TITLE": "어린이 미술 체험",
        "STRTDATE": f"{TODAY.isoformat()} 00:00:00.0",
        "END_DATE": f"{(TODAY + timedelta(days=7)).isoformat()} 00:00:00.0",
        "PLACE": "서울시립미술관",
        "GUNAME": "중구",
        "LOT": "37.5640",  # 뒤바뀐 값
        "LAT": "126.9738",
        "MAIN_IMG": "https://culture.seoul.go.kr/img.jpg",
        "ORG_LINK": "https://sema.seoul.go.kr",
        "IS_FREE": "무료",
    }
    record = row_to_raw(row)
    assert record.source == "seoul_api"
    assert record.facts["address"] == "서울특별시 중구 서울시립미술관"
    assert record.facts["latitude"] == 37.564 and record.facts["longitude"] == 126.9738
    assert record.facts["start_date"] == TODAY.isoformat()
    assert record.facts["price_info"] == "무료"
