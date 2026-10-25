"""팝플리 수집기 — 실제 화면(2026-10 확인)과 같은 모양의 HTML 조각으로 검사 (네트워크 없음)."""

from __future__ import annotations

from datetime import date

import httpx
import pytest

from collectors.popply import PopplyCollector, detail_links, parse_detail, parse_range
from parsers.rule_parser import RuleEventParser
from validation import validate_events

TODAY = date(2026, 10, 20)

LIST_HTML = """
<html><body>
  <a href="/popup/6373"><img src="x.jpg"><p>알파루틴 팝업</p><p>26.10.15 - 26.10.21</p></a>
  <a href="/popup/6371">플레어업 팝업</a>
  <a href="https://www.popply.co.kr/popup/6371">중복 링크</a>
  <a href="/popup/6100">지난 팝업</a>
  <a href="/popup?page=2">다음</a>
  <a href="/exhibition/12">전시</a>
</body></html>
"""

AMENITIES = (
    "주차가능", "주차불가", "입장료 유료", "입장료 무료", "반려동물", "웰컴 키즈존", "노키즈존",
    "식음료 반입 금지", "19세 이상", "와이파이 가능", "사진촬영 가능", "사전예약",
)


def _detail(
    title: str,
    start: str,
    end: str,
    address: str = "서울 성동구 성수이로 74",
    venue: str = "대림창고",
    chosen: tuple[str, ...] = ("입장료 무료",),
    topics: tuple[str, ...] = ("패션", "패션팝업", "성수팝업"),
) -> str:
    lis = "".join(
        f'<li class="{"" if a in chosen else "false"}"><p>{a}</p></li>' for a in AMENITIES
    )
    tags = "".join(f"<span>{t}</span>" for t in topics)
    return f"""
<html><head><title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:image" content="https://d8nffddmkwqeq.cloudfront.net/store/abc"></head>
<body>
  <script>self.__next_f.push([1,"26.01.01 - 26.01.02"])</script>
  <h1>{title}</h1><span>0</span><button>공유하기</button><p>카테고리 없음</p>
  <h2>{title}</h2>
  <p><span>{start}</span><span>-</span><span>{end}</span></p>
  <p>{address}</p><p>{venue}</p><button>지도보기</button>
  <div>{tags}</div>
  <a>인스타그램</a><div>정보</div><div>후기(<span>0</span>)</div><div>주변</div>
  <ul>{lis}</ul>
  <div><h3>운영 시간</h3><p>월~목</p><p>:</p><p>11:00 - 20:00</p><p>금~일</p><p>:</p><p>11:00 - 21:00</p></div>
  <h3>팝업스토어 소개</h3>
  <p>저작권이 있는 소개글 — 옮기지 않아야 함</p>
  <p>※ 본 콘텐츠는 저작권법에 의해 보호받는 저작물로</p>
</body></html>
"""


def test_parse_range_two_digit_years():
    assert parse_range("26.10.16 - 26.11.05") == ("2026-10-16", "2026-11-05")
    assert parse_range("26.12.20 ~ 01.10") == ("2026-12-20", "2027-01-10")
    assert parse_range("2026.10.16 ~ 2026.11.05") == ("2026-10-16", "2026-11-05")
    assert parse_range("26.13.01 - 26.13.02") is None


def test_detail_links_dedupes_and_ignores_other_pages():
    assert detail_links(LIST_HTML) == [
        "https://popply.co.kr/popup/6373",
        "https://popply.co.kr/popup/6371",
        "https://popply.co.kr/popup/6100",
    ]


def test_parse_detail_reads_real_page_shape():
    record = parse_detail(
        _detail("플레어업 팝업 : IN A DAZE", "26.10.16", "26.11.05"),
        "https://www.popply.co.kr/popup/6371",
    )
    assert record is not None
    f = record.facts
    assert record.source == "popply" and record.source_id == "6371"
    assert f["title"] == "플레어업 팝업 : IN A DAZE"
    # 여러 줄로 나뉜 날짜, 스크립트 속 날짜는 무시
    assert (f["start_date"], f["end_date"]) == ("2026-10-16", "2026-11-05")
    assert f["address"] == "서울 성동구 성수이로 74"
    assert f["location_name"] == "대림창고"
    assert f["price_info"] == "무료"
    assert f["thumbnail_url"].startswith("https://d8nffddmkwqeq.cloudfront.net/store/")
    # 저작권 소개글은 옮기지 않고 사실 정보로 만든 안내만
    assert "저작권이 있는 소개글" not in f["description"]
    assert "대림창고에서 열리는 패션 팝업스토어예요." in f["description"]
    assert "운영 시간 월~목 11:00 - 20:00 · 금~일 11:00 - 21:00" in f["description"]
    assert record.meta["topics"] == ["패션"]

    ev = RuleEventParser().parse_one(record)
    assert ev is not None and ev.category.value == "popup"
    assert ev.price_info == "무료" and ev.is_family_friendly is False
    kept = validate_events([ev], today=TODAY).kept
    assert kept and kept[0].region == "서울특별시" and kept[0].district == "성동구"


def test_kids_welcome_popup_is_family_friendly():
    record = parse_detail(
        _detail("캐릭터 팝업", "26.10.16", "26.11.05", chosen=("웰컴 키즈존", "사전예약"),
                topics=("캐릭터", "캐릭터팝업")),
        "https://www.popply.co.kr/popup/9",
    )
    ev = RuleEventParser().parse_one(record)
    assert ev.is_family_friendly is True and ev.booking_required is True
    assert "아이와 함께 가기 좋아요." in ev.description


def test_no_kids_and_adult_popups_are_skipped():
    for chosen in (("노키즈존",), ("19세 이상", "입장료 유료")):
        html = _detail("어른 전용 팝업", "26.10.16", "26.11.05", chosen=chosen)
        assert parse_detail(html, "https://www.popply.co.kr/popup/1") is None


def test_parse_detail_without_address_is_dropped():
    html = _detail("주소 없는 팝업", "26.10.16", "26.11.05", address="장소 추후 공지")
    assert parse_detail(html, "https://www.popply.co.kr/popup/1") is None


def test_collector_skips_ended_and_survives_bad_detail():
    pages = {
        "/popup": LIST_HTML,
        "/popup/6373": _detail("알파루틴 팝업", "26.10.15", "26.10.21"),
        "/popup/6100": _detail("지난 팝업", "26.08.01", "26.08.15"),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        body = pages.get(request.url.path)
        return httpx.Response(200, text=body) if body else httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with PopplyCollector(client, min_interval=0, check_robots=False) as c:
        records = c.collect(today=TODAY)
    assert [r.source_id for r in records] == ["6373"]  # 6371은 500, 6100은 종료


def test_collector_fails_loudly_when_list_changes():
    client = httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html></html>"))
    )
    with PopplyCollector(client, min_interval=0, check_robots=False) as c:
        with pytest.raises(RuntimeError):
            c.collect(today=TODAY)
