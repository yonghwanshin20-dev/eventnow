"""동네 문화기관(도서관 강좌·행사, 고양문화재단) 수집기 — 실제 화면(2026-11 확인) 모양으로 검사."""

from datetime import date

from collectors.local_culture import (
    LIBRARY_SITES,
    LibraryIndex,
    artgy_to_raw,
    is_family_program,
    library_item_to_raw,
    parse_artgy_detail,
    parse_artgy_list,
    parse_library_list,
    parse_library_table,
)
from parsers.rule_parser import RuleEventParser

TODAY = date(2026, 11, 9)
GOYANG = next(s for s in LIBRARY_SITES if s.key == "goyanglib")

CARD = """
<div class="programList">
 <div class="program-item">
  <div class="thumb"><a href="#" onclick="javascript:fnDetail('523200'); return false;"><img src="x.jpg"></a></div>
  <div class="infoBox">
   <div class="location"><span class="lib">주엽어린이</span><span class="paymentN">무료</span><span class="target">어린이</span></div>
   <div class="title"><a href="#" onclick="javascript:fnDetail('523200'); return false;">그림책 작가와의 만남</a></div>
   <div class="info"><span><span class="tit">강의기간</span> : 2026.11.21 (1일)</span><span>토 14:00 ~ 15:30</span></div>
   <div class="info"><span><span class="tit">참여대상</span> : 초등 1~2학년</span><span><span class="tit">장소</span> : 주엽어린이도서관 2층</span></div>
   <div class="info"><span><span class="tit">접수기간</span> : 2026.11.09 10:00 ~ 2026.11.19 18:00</span></div>
  </div>
  <div class="statusBox"><span class="status sing">접수중</span></div>
 </div>
 <div class="program-item">
  <div class="infoBox">
   <div class="location"><span class="lib">화정</span><span class="target">성인</span></div>
   <div class="title"><a href="#" onclick="javascript:fnDetail('523102'); return false;">생성형 인공지능 플라워 디자인</a></div>
   <div class="info"><span><span class="tit">강의기간</span> : 2026.12.01 ~ 2026.12.15</span></div>
   <div class="info"><span><span class="tit">참여대상</span> : 성인 15명 </span></div>
  </div>
  <div class="statusBox"><span class="status sing">접수중</span></div>
 </div>
</div>
"""

INDEX = LibraryIndex(
    [
        {"LBRRY_NM": "고양시립주엽어린이도서관", "CTPRVN_NM": "경기도", "SIGNGU_NM": "고양시 일산서구",
         "RDNMADR": "경기도 고양시 일산서구 주엽로 1", "LATITUDE": "37.67", "LONGITUDE": "126.76"},
    ]
)


def test_library_cards_keep_kids_programs_with_place_and_apply_window():
    items = parse_library_list(CARD)
    assert [i["idx"] for i in items] == ["523200", "523102"]
    assert items[0]["fields"]["참여대상"] == "초등 1~2학년" and items[0]["lib"] == "주엽어린이"
    rec = library_item_to_raw(items[0], GOYANG, today=TODAY, index=INDEX)
    assert rec.facts["location_name"] == "고양시립주엽어린이도서관" and rec.facts["latitude"] == 37.67
    assert rec.facts["official_link"].endswith("lectureIdx=523200")
    ev = RuleEventParser().parse_one(rec)
    assert ev.category.value == "kids_experience" and ev.price_info == "무료"
    assert (ev.apply_start, ev.apply_end) == (date(2026, 11, 9), date(2026, 11, 19))
    # 성인 강좌는 뺀다
    assert library_item_to_raw(items[1], GOYANG, today=TODAY, index=INDEX) is None


def test_family_target_rules():
    def item(target, title="프로그램"):
        return {"title": title, "fields": {"대상": target}, "targets": []}

    assert is_family_program(item("6~7세 어린이와 보호자 1인"))
    assert is_family_program(item("전연령 지역주민"))
    assert not is_family_program(item("50세 이상 시니어 15명"))
    assert not is_family_program(item("양육자 및 그림책 교육에 관심있는 성인 15명"))
    assert not is_family_program(item("고양시민 30명", "열두달 인문학당"))
    assert not is_family_program(item("전연령", "11월 북큐레이션 <같이 만나자>"))


def test_mapo_style_table():
    html = """<table><thead><tr><th>번호</th><th>기관명</th><th>상태</th><th>프로그램명</th><th>대상</th>
    <th>행사일</th><th>신청/대기</th><th>참가료</th></tr></thead><tbody>
    <tr><td>1</td><td>푸르메</td><td>예정</td><td><a href="javascript:fnDetail('LEC0017790');">책이랑 놀자 12월</a></td>
    <td>6~7세 어린이</td><td>2026.12.08<br>~2026.12.08</td><td>0 / 10</td><td>무료</td></tr></tbody></table>"""
    items = parse_library_table(html)
    assert items[0]["idx"] == "LEC0017790" and items[0]["lib"] == "푸르메"
    assert items[0]["fields"]["행사기간"].startswith("2026.12.08")


def test_artgy_family_shows_only():
    lst = """<ul><li><a href="/PF/PF0201V.aspx?showid=0000008484">가족뮤지컬 [로보카폴리]</a> 2026-11-28(토) ~ 2026-11-29(일) 어울림 예정</li>
    <li><a href="/PF/PF0201V.aspx?showid=0000008490">김장훈 전국투어 콘서트</a> 2026-12-13(일) 어울림 예정</li></ul>"""
    items = parse_artgy_list(lst, "PF")
    assert [i["venue"] for i in items] == ["어울림", "어울림"]
    detail = parse_artgy_detail("<div><p>입장연령</p><p>24개월 이상 (24개월 미만 입장불가)</p><p>입장료</p><p>R석 : 50,000원</p>"
                                "<p>- 일반 예매 : 10월 1일(목) 오후 2시</p></div>")
    assert detail["age"].startswith("24개월") and detail["apply"].startswith("티켓 오픈")
    rec = artgy_to_raw(items[0], detail, today=TODAY)
    assert rec.facts["location_name"] == "고양어울림누리" and rec.meta["category_hint"] == "kids_experience"
    # 7세 이상 성인 콘서트는 뺀다
    assert artgy_to_raw(items[1], {"age": "7세 이상 (7세 미만 입장불가)"}, today=TODAY) is None
