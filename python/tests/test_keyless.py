"""키 없는 기본 경로: kfes 수집 · 규칙 정제 · JSON 저장."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from collectors.kfes import KfesCollector, item_to_raw
from models import RawRecord
from parsers.rule_parser import (
    RuleEventParser,
    classify_place_types,
    classify_tags,
    extract_address,
    extract_dates,
    is_family_friendly,
)
from regions import detect_district, detect_region
from store.json_store import JsonEventStore, UnsafeWriteError
from validation import validate_events

TODAY = date(2026, 10, 19)


def _kfes_item(cid: str = "abc", start: str = "2026.10.17", end: str = "2026.11.01", **kw):
    item = {
        "fstvlCntntsId": cid,
        "cntntsNm": "문경사과축제",
        "fstvlBgngDe": start,
        "fstvlEndDe": end,
        "adres": "경상북도 문경시 문경읍 새재로 932",
        "dtadr": "",
        "areaNm": "경상북도 문경시",
        "ycrdVal": "36.7616",
        "xcrdVal": "128.0769",
        "fstvlOutlCn": "가족 모두 즐기는 사과 축제",
        "fstvlCrmnCn": "1. 체험행사<br>\n- 사과따기 농장체험",
        "fstvlUtztFareInfo": "무료",
        "fstvlHmpgUrl": '<a href="https://www.mgapple.or.kr/" target="_blank">https://www.mgapple.or.kr/</a> ',
        "dispFstvlCntntsImgRout": "https://kfescdn.visitkorea.or.kr/x.jpg",
        "rsvtGdnYn": "N",
        "vwngPsblAgeInfo": "",
    }
    item.update(kw)
    return item


def test_kfes_item_to_raw_facts():
    record = item_to_raw(_kfes_item())
    assert record is not None
    assert record.source == "kfes"
    f = record.facts
    assert f["start_date"] == "2026-10-17" and f["end_date"] == "2026-11-01"
    assert f["latitude"] == pytest.approx(36.7616) and f["longitude"] == pytest.approx(128.0769)
    assert f["official_link"] == "https://www.mgapple.or.kr/"
    assert "<br>" not in record.raw_text


def test_kfes_collector_paginates_and_drops_ended():
    pages = {
        "0": {"totalCnt": 3, "resultList": [_kfes_item("a"), _kfes_item("b", end="2026.10.01")]},
        "2": {"totalCnt": 3, "resultList": [_kfes_item("c")]},
    }
    seen_forms = []

    def handler(request: httpx.Request) -> httpx.Response:
        form = dict(httpx.QueryParams(request.content.decode()))
        seen_forms.append(form)
        return httpx.Response(200, json=pages[form["startIdx"]])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with KfesCollector(client, min_interval=0, check_robots=False) as c:
        records = c.collect(today=TODAY, past_days=0)
    assert [r.source_id for r in records] == ["a", "c"]  # b는 이미 종료
    seen_forms.clear()
    with KfesCollector(client, min_interval=0, check_robots=False) as c:
        recent = c.collect(today=TODAY, past_days=30)
    assert [r.source_id for r in recent] == ["a", "b", "c"]  # 최근 종료분은 교정용으로 포함
    assert [f["startIdx"] for f in seen_forms] == ["0", "2"]


def test_rule_parser_structured_record():
    record = item_to_raw(_kfes_item())
    ev = RuleEventParser().parse_one(record)
    assert ev is not None
    assert ev.category.value == "festival"
    assert ev.is_family_friendly is True
    assert "#무료" in ev.tags
    assert "temple" not in ev.place_types  # '행사'에 걸리지 않음
    kept = validate_events([ev], today=TODAY).kept
    assert kept and kept[0].region == "경상북도" and kept[0].district == "문경시"


def test_free_tag_only_from_price():
    assert "#무료" not in classify_tags("무료 시식 코너", price="유료 5,000원")
    assert "#무료" in classify_tags("축제", price="무료(일부 유료)")


def test_place_types_do_not_match_haengsa():
    assert classify_place_types("가을 행사 안내") == []
    assert classify_place_types("○○사 템플스테이") == ["religious"]


def test_family_rules():
    assert is_family_friendly("festival", "사과따기 체험") is True
    assert is_family_friendly("festival", "와인 체험 (19세 이상)") is False
    assert is_family_friendly("festival", "아이디어 공모전") is False


def test_extract_dates_and_address_from_unstructured_text():
    text = "운영기간: 2026.11.20 ~ 01.10\n주소: 서울특별시 성동구 연무장길 10\n입장 무료"
    assert extract_dates(text) == (date(2026, 11, 20), date(2027, 1, 10))
    assert extract_address(text) == "서울특별시 성동구 연무장길 10"


def test_rule_parser_drops_popup_without_dates():
    record = RawRecord(
        source="popply",
        source_id="p1",
        title_hint="어느 팝업",
        raw_text="[본문]\n서울특별시 성동구 연무장길 10 에서 열려요",
    )
    assert RuleEventParser().parse_one(record) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("대상: 만 4~7세 유아", (4, 7)),
        ("5-7세 어린이 대상 체험", (5, 7)),
        ("관람연령: 6세 이상", (6, None)),
        ("36개월 이상 관람 가능", (3, None)),
        ("24~48개월 영유아 놀이", (2, 4)),
        ("초등 1~3학년 대상 과학교실", (7, 9)),
        ("초등학생 4학년 이상", (10, 12)),
        ("초등 저학년 가족", (7, 9)),
        ("7세 이하 무료입니다", (None, None)),  # 요금 규칙은 대상 나이가 아님
        ("36개월 미만 입장료 할인", (None, None)),
        ("19세 이상 관람가", (None, None)),  # 어른 대상은 세부 나이로 쓰지 않음
        ("누구나 즐기는 축제", (None, None)),
        ("13-19세 청소년", (13, None)),
    ],
)
def test_extract_age_range(text, expected):
    from parsers.rule_parser import extract_age_range

    lo, hi = extract_age_range(text)
    assert (lo, hi) == expected


def test_age_range_ignores_program_lists_in_festival_body():
    item = _kfes_item(fstvlCrmnCn="1. 키즈존 (5~7세)<br>2. 가족 체험", vwngPsblAgeInfo="")
    ev = RuleEventParser().parse_one(item_to_raw(item))
    assert (ev.age_min, ev.age_max) == (None, None)
    aged = RuleEventParser().parse_one(item_to_raw(_kfes_item(vwngPsblAgeInfo="만 3세 이상")))
    assert (aged.age_min, aged.age_max) == (3, None)


def test_duplicate_ids_are_repaired_owner_keeps_id():
    from store.json_store import ensure_unique_ids, make_id

    owner_id = make_id("culture_portal", "398833", "")
    rows = [
        # 예전에 합쳐지며 출처 번호가 398834로 바뀐 행 — id는 398833 것
        {"id": owner_id, "title": "고귀하고 고귀한 Ⅴ", "source": "culture_portal", "source_id": "398834"},
        # 원래 주인(398833)이 다시 들어온 행
        {"id": owner_id, "title": "고귀하고 고귀한 Ⅳ", "source": "culture_portal", "source_id": "398833"},
        {"id": "evt-other", "title": "다른 행사", "source": None},
    ]
    assert ensure_unique_ids(rows) == 1
    ids = [r["id"] for r in rows]
    assert len(set(ids)) == 3
    assert rows[1]["id"] == owner_id  # 출처 번호가 맞는 행이 id를 가진다
    assert rows[0]["id"] == make_id("culture_portal", "398834", "")


CULTURE_DETAIL_HTML = """
<html><body>
<ul class="thumb-tag size02"><li class="tag"><span class="txt">아동/가족</span></li>
<li class="tag"><span class="txt">만 4세 이상</span></li></ul>
<dl><dt>기간</dt><dd>2026-10-01~2026-10-31 (진행중)</dd></dl>
<dl><dt>공연시간</dt><dd>주말 및 공휴일 13:30, 15:30</dd></dl>
<dl><dt>가격</dt><dd>전석 5,000원</dd></dl>
<dl><dt>주소</dt><dd>충청남도 아산시 도고면 아산만로 171 도고아트홀</dd></dl>
<dl><dt>홈페이지</dt><dd>https://blog.naver.com/comedy2428</dd></dl>
</body></html>
"""


def test_culture_detail_fills_age_address_hours():
    from collectors.culture_portal import apply_detail, parse_detail

    detail = parse_detail(CULTURE_DETAIL_HTML)
    assert detail["age"] == "만 4세 이상"
    assert detail["address"].startswith("충청남도 아산시")
    record = RawRecord(
        source="culture_portal",
        source_id="399822",
        title_hint="가족 인형극",
        raw_text="[제목] 가족 인형극",
        meta={"category_hint": "kids_experience", "genre": "아동/가족", "venue": "도고아트홀"},
        facts={
            "title": "가족 인형극",
            "start_date": "2026-10-01",
            "end_date": "2026-10-31",
            "address": "충남 도고아트홀",
            "location_name": "도고아트홀",
        },
    )
    apply_detail(record, detail)
    assert record.facts["address"] == "충청남도 아산시 도고면 아산만로 171 도고아트홀"
    assert record.facts["official_link"] == "https://blog.naver.com/comedy2428"
    assert record.facts["price_info"] == "전석 5,000원"
    ev = RuleEventParser().parse_one(record)
    assert (ev.age_min, ev.age_max) == (4, None)
    assert "운영 시간 주말 및 공휴일 13:30, 15:30" in ev.description
    kept = validate_events([ev], today=TODAY).kept
    assert kept[0].district == "아산시"


def test_culture_detail_without_homepage_links_to_portal_page():
    from collectors.culture_portal import apply_detail

    record = RawRecord(source="culture_portal", source_id="402758", raw_text="x", facts={"title": "t"})
    apply_detail(record, {})
    assert record.facts["official_link"].endswith("oneCltInfoView.do?pblprfrSn=402758&menuNo=200010")


def test_culture_notice_titles_are_not_events():
    from collectors.culture_portal import _NOTICE

    for t in [
        "서울영화센터 단체관람 할인 안내",
        "[도고아트홀] 2026년 10월 기획 공연 안내",
        "[아트센터 화이트블럭] 2027년 대관 공고",
        "[초등 학급단체] 코드명 괴도: 사라진 책을 찾아라!",
        "2026년 어린이 단체 교육 프로그램 '학교 밖 아시아 여행'",
        "가족 체험 참가자 모집",
    ]:
        assert _NOTICE.search(t), t
    for t in [
        "민들레의 영토에서 해인의 바다로 상설전 안내",
        "서울로봇인공지능과학관 상설전시",
        "모집된 기억들 특별전",
    ]:
        assert not _NOTICE.search(t), t


def test_region_from_city_name_without_province():
    assert detect_region("전주 경기전") == "전북특별자치도"
    assert detect_region("순천부 읍성 남문터 야외광장") == "전라남도"
    assert detect_region("여수 돌산 진모지구, 개도") == "전라남도"
    assert detect_region("영암군청년센터 달빛청춘마루 일원") == "전라남도"
    assert detect_district("전라남도", "여수 돌산 진모지구") == "여수시"
    # 두 광역에 같은 이름(고성군)·광역시와 겹치는 이름(광주)은 짐작하지 않는다
    assert detect_region("고성 공룡엑스포") is None
    assert detect_region("광주 어딘가") == "광주광역시"  # '광주'는 원래대로 광역시 별칭
    assert detect_region("서울특별시 중구") == "서울특별시"


def test_jeonnam_gwangju_merged_name():
    assert detect_region("전남광주통합특별시 화순군 도곡면") == "전라남도"
    assert detect_region("전남광주통합특별시 북구 첨단과기로") == "광주광역시"
    assert detect_district("인천광역시", "인천광역시 검단구 드림로") == "검단구"


def _store(tmp_path, rows):
    path = tmp_path / "events.json"
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return JsonEventStore(path, tmp_path / "events-meta.json", retention_days=60)


def _parsed(cid="abc", **kw):
    ev = RuleEventParser().parse_one(item_to_raw(_kfes_item(cid, **kw)))
    return validate_events([ev], today=TODAY).kept


def test_json_store_keeps_existing_id_and_is_idempotent(tmp_path):
    legacy = {
        "id": "evt-legacy0001",
        "title": "문경사과축제",
        "start_date": "2026-10-17",
        "end_date": "2026-11-01",
        "thumbnail_url": "https://curated/img.jpg",
        "created_at": "2026-07-28T00:00:00Z",
        "updated_at": "2026-07-28T00:00:00Z",
    }
    store = _store(tmp_path, [legacy])
    first = store.save(_parsed(), summary={"status": "ok"}, today=TODAY)
    rows = store.load()
    assert first.updated == 1 and first.inserted == 0
    assert rows[0]["id"] == "evt-legacy0001"  # 옛 링크 유지
    assert rows[0]["source"] == "kfes"
    second = store.save(_parsed(), summary={"status": "ok"}, today=TODAY)
    assert second.unchanged == 1 and second.updated == 0
    meta = json.loads((tmp_path / "events-meta.json").read_text(encoding="utf-8"))
    assert meta["total"] == 1


def test_same_source_update_clears_dropped_price_and_booking(tmp_path):
    store = _store(tmp_path, [])
    store.save(_parsed(rsvtGdnYn="Y"), summary={"status": "ok"}, today=TODAY)
    row = store.load()[0]
    assert row["price_info"] == "무료" and row["booking_required"] is True
    # 원문에서 요금·예약 안내가 빠짐 → 같은 출처라 지운다
    stats = store.save(
        _parsed(fstvlUtztFareInfo="", rsvtGdnYn="N"), summary={"status": "ok"}, today=TODAY
    )
    row = store.load()[0]
    assert stats.updated == 1
    assert row["price_info"] is None and row["booking_required"] is False


def test_other_source_update_keeps_curated_price(tmp_path):
    curated = {"id": "evt-c", "title": "문경사과축제", "start_date": "2026-10-17",
               "end_date": "2026-11-01", "price_info": "입장 무료"}
    store = _store(tmp_path, [curated])
    store.save(_parsed(fstvlUtztFareInfo=""), summary={"status": "ok"}, today=TODAY)
    assert store.load()[0]["price_info"] == "입장 무료"


def test_json_store_never_deletes_unseen_rows_but_prunes_old(tmp_path):
    rows = [
        {"id": "evt-curated", "title": "상설 공원", "start_date": "2026-01-01", "end_date": "2027-12-31"},
        {"id": "evt-old", "title": "옛 행사", "start_date": "2026-01-01", "end_date": "2026-03-01"},
    ]
    store = _store(tmp_path, rows)
    stats = store.save([], summary={"status": "ok"}, today=TODAY)
    ids = [r["id"] for r in store.load()]
    assert ids == ["evt-curated"]
    assert stats.pruned == 1


def test_json_store_refuses_large_shrink(tmp_path):
    rows = [
        {"id": f"evt-{i}", "title": f"t{i}", "start_date": "2026-01-01", "end_date": "2026-02-01"}
        for i in range(10)
    ] + [{"id": "evt-live", "title": "live", "start_date": "2026-10-01", "end_date": "2026-12-01"}]
    store = _store(tmp_path, rows)
    with pytest.raises(UnsafeWriteError):
        store.save([], summary={"status": "ok"}, today=TODAY)
    assert len(store.load()) == 11  # 파일은 그대로


def test_loose_title_ignores_year_and_edition():
    from store.json_store import loose_title

    assert loose_title("2026 제5회 황매산 억새축제") == loose_title("황매산억새축제")
    assert loose_title("2026경남고성공룡세계엑스포") == "경남고성공룡세계엑스포"


def test_validation_routes_recently_ended_to_corrections():
    ev = RuleEventParser().parse_one(item_to_raw(_kfes_item("x", start="2026.10.15", end="2026.10.18")))
    result = validate_events([ev], today=TODAY)
    assert result.kept == [] and len(result.ended) == 1
    assert result.rejected_count == 0


def test_json_store_corrects_and_deduplicates_curated_rows(tmp_path):
    rows = [
        # 7월 데이터: 한 달 통째 임시 일정 → 실제로는 10.15~10.18에 끝남
        {"id": "evt-guess", "title": "2026 문경사과축제", "start_date": "2026-10-01", "end_date": "2026-10-31"},
        # 공식 출처 행과 겹치는 큐레이션 중복
        {"id": "evt-dup", "title": "제3회 고창모양성제", "start_date": "2026-10-14", "end_date": "2026-10-20"},
        {"id": "evt-kfes", "title": "고창모양성제", "start_date": "2026-10-15", "end_date": "2026-10-19",
         "source": "kfes", "source_id": "gc"},
        # 작년 회차는 다른 행사로 본다
        {"id": "evt-old-edition", "title": "2025 문경사과축제", "start_date": "2025-10-01", "end_date": "2027-01-01"},
    ]
    store = _store(tmp_path, rows)
    ended = validate_events(
        [RuleEventParser().parse_one(item_to_raw(_kfes_item("mg", start="2026.10.15", end="2026.10.18")))],
        today=TODAY,
    ).ended
    stats = store.save([], summary={"status": "ok"}, corrections=ended, today=TODAY)
    by_id = {r["id"]: r for r in store.load()}
    assert stats.corrected == 1 and stats.inserted == 0
    assert by_id["evt-guess"]["end_date"] == "2026-10-18"  # 링크(id)는 유지, 날짜만 교정
    assert by_id["evt-guess"]["status"] == "ended"
    assert "evt-dup" not in by_id and stats.deduplicated == 1
    assert "evt-old-edition" in by_id


def test_corrections_never_insert(tmp_path):
    store = _store(tmp_path, [{"id": "evt-a", "title": "다른 행사", "start_date": "2026-10-01", "end_date": "2026-12-01"}])
    ended = validate_events(
        [RuleEventParser().parse_one(item_to_raw(_kfes_item("zz", start="2026.10.15", end="2026.10.18")))],
        today=TODAY,
    ).ended
    stats = store.save([], summary={"status": "ok"}, corrections=ended, today=TODAY)
    assert stats.inserted == 0 and len(store.load()) == 1

def _culture_item_html(seq="1", title="서울시립미술관 기획전 《빛》", genre="전시", region="서울",
                       venue="서울시립미술관", period="2026-10-01 ~ 2026-12-31", fee="무료"):
    return f"""
    <li class="list"><div class="box-thumb">
      <input type="hidden" name="subSeq" value="{seq}"/>
      <div class="thumb-img"><a href="https://sema.seoul.go.kr/" class="btn-link"><img src="/upload/x.png"/></a></div>
      <ul class="thumb-tag size01">
        <li class="tag"><span class="txt">{genre}</span></li>
        <li class="tag reverse"><span class="txt">{fee}</span></li>
        <li class="tag"><span class="txt">{region}</span></li>
      </ul>
      <div class="thumb-txt"><span class="tit">{title}</span>
        <dl class="txt-list"><dt class="term">장소</dt><dd class="desc">{venue}</dd></dl>
        <dl class="txt-list"><dt class="term">기간</dt><dd class="desc">{period}</dd></dl>
      </div></div></li>"""


def _culture_page(*items):
    return '<div id="search_result_oneEyeTab"><ul>' + "".join(items) + "</ul></div>"


def test_culture_portal_parse_and_rule_parse():
    from collectors.culture_portal import parse_list

    records = parse_list(_culture_page(_culture_item_html()), genre_hint="exhibition")
    assert len(records) == 1
    r = records[0]
    assert r.source == "culture_portal" and r.source_id == "1"
    assert r.facts["start_date"] == "2026-10-01" and r.facts["end_date"] == "2026-12-31"
    assert r.facts["address"] == "서울 서울시립미술관"
    assert r.facts["thumbnail_url"] == "https://www.culture.go.kr/upload/x.png"
    ev = RuleEventParser().parse_one(r)
    kept = validate_events([ev], today=TODAY).kept
    assert kept[0].category.value == "exhibition" and kept[0].region == "서울특별시"


def test_culture_portal_filters_gallery_solo_shows_and_adult_classes():
    from collectors.culture_portal import CulturePortalCollector

    pages = {
        ("06", "1"): _culture_page(
            _culture_item_html("a"),
            _culture_item_html("b", title="홍길동 개인전 《선》", venue="갤러리 소소"),
            _culture_item_html("c", title="어린이 그림책 원화전", venue="갤러리 소소"),
        ),
        ("12", "1"): _culture_page(
            _culture_item_html("d", title="직장인 드로잉 클래스", genre="교육/체험", venue="문화센터"),
            _culture_item_html("e", title="가족 과학 실험교실", genre="교육/체험", venue="시립과학관"),
        ),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.url.params["genreCds"], request.url.params["pageIndex"])
        return httpx.Response(200, text=pages.get(key, _culture_page()))

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with CulturePortalCollector(
        client, genres={"06": "exhibition", "12": "kids_experience"}, min_interval=0, check_robots=False
    ) as c:
        ids = [r.source_id for r in c.collect(today=TODAY)]
    assert ids == ["a", "c", "e"]


def test_same_event_title_containment():
    from store.json_store import same_event

    curated = {"title": "유영국: 산은 내 안에 있다", "start_date": "2026-05-19", "end_date": "2026-10-25"}
    portal = {"title": "2026년 한국 근대 거장전 《유영국: 산은 내 안에 있다》",
              "start_date": "2026-05-19", "end_date": "2026-10-25"}
    other = {"title": "산은", "start_date": "2026-05-19", "end_date": "2026-10-25"}
    assert same_event(curated, portal)
    assert not same_event(other, portal)  # 너무 짧은 제목은 포함 비교 안 함


def test_json_store_prefers_kfes_over_culture_portal(tmp_path):
    from store.json_store import JsonEventStore

    rows = [
        {"id": "evt-k", "title": "고창모양성제", "start_date": "2026-10-15", "end_date": "2026-10-19",
         "source": "kfes", "source_id": "gc"},
        {"id": "evt-c", "title": "2026 고창모양성제", "start_date": "2026-10-15", "end_date": "2026-10-19",
         "source": "culture_portal", "source_id": "99"},
    ]
    store = _store(tmp_path, rows)
    stats = store.save([], summary={"status": "ok"}, today=TODAY)
    assert [r["id"] for r in store.load()] == ["evt-k"] and stats.deduplicated == 1

def _osm_handler(results_by_query):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params["q"]
        calls.append(q)
        return httpx.Response(200, json=results_by_query.get(q, []))

    return handler, calls


def test_osm_geocoder_fills_rejects_other_region_and_caches(tmp_path):
    from geocode_osm import OsmGeocoder, backfill_coordinates

    results = {
        "서울 인사아트센터": [
            # 같은 이름의 다른 지역 장소는 버린다
            {"lat": "35.1", "lon": "129.0", "display_name": "인사아트센터, 해운대구, 부산광역시, 대한민국"},
            {"lat": "37.5740567", "lon": "126.9846597", "display_name": "인사아트센터, 인사동길, 종로구, 서울특별시, 대한민국"},
        ],
    }
    handler, calls = _osm_handler(results)
    rows = [
        {"id": "a", "address": "서울 인사아트센터", "location_name": "인사아트센터", "region": "서울특별시",
         "latitude": None, "longitude": None, "end_date": "2026-12-01"},
        {"id": "old", "address": "서울 어딘가", "location_name": "어딘가", "region": "서울특별시",
         "latitude": None, "longitude": None, "end_date": "2026-01-01"},  # 끝난 행사는 건너뜀
    ]
    cache = tmp_path / "cache.json"
    client = httpx.Client(transport=httpx.MockTransport(handler))
    with OsmGeocoder(cache, client, min_interval=0) as geo:
        stats = backfill_coordinates(rows, geo, today="2026-10-19")
    assert stats["filled"] == 1
    assert rows[0]["latitude"] == 37.574057 and rows[0]["longitude"] == 126.98466
    assert rows[1]["latitude"] is None
    # 다음 실행은 캐시로 — 네트워크 호출 없음
    calls.clear()
    rows[0]["latitude"] = rows[0]["longitude"] = None
    with OsmGeocoder(cache, client, min_interval=0) as geo:
        backfill_coordinates(rows, geo, today="2026-10-19")
    assert calls == [] and rows[0]["latitude"] == 37.574057


def test_osm_geocoder_respects_lookup_budget(tmp_path):
    from geocode_osm import OsmGeocoder, backfill_coordinates

    handler, calls = _osm_handler({})
    rows = [
        {"id": str(i), "address": f"서울 장소{i}", "location_name": f"장소{i}", "region": "서울특별시",
         "latitude": None, "longitude": None, "end_date": "2026-12-01"}
        for i in range(5)
    ]
    client = httpx.Client(transport=httpx.MockTransport(handler))
    with OsmGeocoder(tmp_path / "c.json", client, min_interval=0, max_lookups=3) as geo:
        stats = backfill_coordinates(rows, geo, today="2026-10-19")
    assert len(calls) == 3
    assert stats["skipped_budget"] > 0

def test_osm_skips_region_only_queries():
    from geocode_osm import is_specific, queries_for

    assert not is_specific("서울")
    assert not is_specific("경기 수원시")
    assert is_specific("서울 인사아트센터")
    assert is_specific("서울특별시 중구 덕수궁길 61")
    # 장소명 없이 지역만 있는 행은 조회하지 않는다
    assert queries_for({"address": "서울", "location_name": "서울"}) == []
    assert queries_for({"address": "서울 노원문화원", "location_name": "노원문화원"}) == [
        "서울 노원문화원",
        "노원문화원",
    ]

def test_culture_portal_description_and_filters():
    from collectors.culture_portal import _ONLINE, _FAMILY, parse_list

    assert _ONLINE.search("[온라인 특별전] 막걸리")
    assert not _FAMILY.search("공성훈 개인전 《숭고의 아이러니》")
    assert _FAMILY.search("아이와 함께하는 그림책")
    rec = parse_list(
        _culture_page(_culture_item_html(fee="유료 , 할인", venue="부산현대미술관")), genre_hint="exhibition"
    )[0]
    assert rec.facts["price_info"] == "유료 · 할인"
    ev = RuleEventParser().parse_one(rec)
    assert ev.description == "부산현대미술관에서 열리는 전시예요."
    assert "[출처]" not in (ev.description or "")

def test_json_store_withdraws_rows_missing_from_complete_listing(tmp_path):
    rows = [
        {"id": f"evt-{i}", "title": f"전시{i}", "start_date": "2026-10-01", "end_date": "2026-12-01",
         "source": "culture_portal", "source_id": str(i)}
        for i in range(10)
    ] + [{"id": "evt-cur", "title": "공원", "start_date": "2026-01-01", "end_date": "2026-12-31"}]
    store = _store(tmp_path, rows)
    # 10개 중 9개가 다시 보임 → 사라진 1개(취소·제외)만 뺀다, 큐레이션 행은 그대로
    stats = store.save([], summary={"status": "ok"}, seen={"culture_portal": {str(i) for i in range(9)}}, today=TODAY)
    ids = {r["id"] for r in store.load()}
    assert stats.withdrawn == 1 and "evt-9" not in ids and "evt-cur" in ids


def test_json_store_keeps_rows_when_listing_looks_broken(tmp_path):
    rows = [
        {"id": f"evt-{i}", "title": f"전시{i}", "start_date": "2026-10-01", "end_date": "2026-12-01",
         "source": "culture_portal", "source_id": str(i)}
        for i in range(10)
    ]
    store = _store(tmp_path, rows)
    # 3개만 보임 → 수집 고장 의심, 아무것도 안 뺀다
    stats = store.save([], summary={"status": "ok"}, seen={"culture_portal": {"0", "1", "2"}}, today=TODAY)
    assert stats.withdrawn == 0 and len(store.load()) == 10

def _culture_event(seq, title, start, end, venue="서울시립미술관"):
    from collectors.culture_portal import parse_list

    rec = parse_list(
        _culture_page(_culture_item_html(seq, title=title, venue=venue, period=f"{start} ~ {end}")),
        genre_hint="exhibition",
    )[0]
    return validate_events([RuleEventParser().parse_one(rec)], today=TODAY).kept[0]


def test_same_event_rejects_sub_events_and_date_mismatch():
    from store.json_store import same_event

    biennale = {"title": "광주비엔날레", "start_date": "2026-09-05", "end_date": "2026-11-15"}
    pavilion = {"title": "제16회 광주비엔날레 캐나다 파빌리온", "start_date": "2026-09-05", "end_date": "2026-11-15"}
    assert not same_event(biennale, pavilion)
    short = {"title": "유영국: 산은 내 안에 있다", "start_date": "2026-05-19", "end_date": "2026-10-25"}
    other_dates = {"title": "2026 《유영국: 산은 내 안에 있다》", "start_date": "2026-09-01", "end_date": "2026-10-25"}
    assert not same_event(short, other_dates)


def test_short_event_never_takes_over_curated_permanent_place(tmp_path):
    curated = {
        "id": "evt-mmca", "title": "MMCA 서울 상설전 «한국현대미술 하이라이트»",
        "start_date": "2025-05-01", "end_date": "2026-12-31", "place_types": ["historical"],
        "tags": ["#상설전시"], "is_family_friendly": True,
    }
    store = _store(tmp_path, [curated])
    ev = _culture_event("77", "MMCA 서울 상설전 «한국현대미술 하이라이트» 가을 특별전", "2026-10-01", "2026-10-25")
    stats = store.save([ev], summary={"status": "ok"}, today=TODAY)
    by_id = {r["id"]: r for r in store.load()}
    assert by_id["evt-mmca"]["end_date"] == "2026-12-31"  # 상설 장소 그대로
    assert stats.inserted == 1 and len(by_id) == 2


def test_rows_with_different_source_ids_are_not_collapsed_and_updated_at_is_stable(tmp_path):
    store = _store(tmp_path, [])
    a = _culture_event("1", "가을 음악회", "2026-10-24", "2026-10-24", venue="A홀")
    b = _culture_event("2", "가을 음악회", "2026-10-24", "2026-10-24", venue="B홀")
    store.save([a, b], summary={"status": "ok"}, today=TODAY)
    first = {r["source_id"]: r["updated_at"] for r in store.load()}
    assert set(first) == {"1", "2"}
    stats = store.save([a, b], summary={"status": "ok"}, today=TODAY)
    again = {r["source_id"]: r["updated_at"] for r in store.load()}
    assert again == first and stats.updated == 0


def test_empty_values_do_not_wipe_curated_info(tmp_path):
    curated = {
        "id": "evt-k", "title": "고창모양성제", "start_date": "2026-10-15", "end_date": "2026-10-19",
        "tags": ["#전통"], "place_types": ["historical"], "is_family_friendly": True,
        "region": "전북특별자치도", "district": "고창군",
    }
    store = _store(tmp_path, [curated])
    ev = RuleEventParser().parse_one(item_to_raw(_kfes_item("gc", start="2026.10.15", end="2026.10.19",
                                                            cntntsNm="고창모양성제", fstvlOutlCn="성곽 축제",
                                                            fstvlCrmnCn="")))
    ev.tags, ev.place_types, ev.is_family_friendly = [], [], False
    ev = validate_events([ev], today=TODAY).kept[0]
    store.save([ev], summary={"status": "ok"}, today=TODAY)
    row = store.load()[0]
    assert row["tags"] == ["#전통"] and row["place_types"] == ["historical"] and row["is_family_friendly"] is True


def test_kfes_drops_half_coordinates():
    rec = item_to_raw(_kfes_item(xcrdVal=""))
    assert "latitude" not in rec.facts and "longitude" not in rec.facts