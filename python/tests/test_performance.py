"""공연 분류 — 아이와 보러 가는 공연은 '공연', 직접 해 보는 프로그램은 '키즈 체험'."""

from __future__ import annotations

from datetime import datetime, timezone

from collectors.culture_portal import is_family_performance
from models import RawRecord
from parsers.rule_parser import classify_category, is_show


def _rec(hint: str = "", codename: str = "") -> RawRecord:
    return RawRecord(
        source="culture_portal",
        source_id="1",
        collected_at=datetime.now(timezone.utc),
        title_hint="t",
        raw_text="",
        meta={"category_hint": hint, "codename": codename},
    )


def test_kids_show_is_performance_but_workshop_is_experience() -> None:
    assert classify_category(_rec(), "어린이 뮤지컬 <호두까기 인형>", "") == "performance"
    assert classify_category(_rec(), "유아 인형극 [아기돼지 삼형제]", "") == "performance"
    assert classify_category(_rec(), "어린이 뮤지컬 배우기 교실", "") == "kids_experience"
    assert classify_category(_rec(), "어린이 그림책 만들기", "") == "kids_experience"


def test_performance_hints() -> None:
    assert classify_category(_rec("performance"), "유니버설발레단, 호두까기인형", "") == "performance"
    assert classify_category(_rec("kids_experience"), "가족뮤지컬 호두까기 인형", "") == "performance"
    assert classify_category(_rec(codename="뮤지컬/오페라"), "호두까기인형", "어린이와 가족") == "performance"
    assert classify_category(_rec(codename="연극"), "체홉 갈매기", "14세 이상") is None


def test_is_show() -> None:
    assert is_show("마술쇼 [신기한 마법학교]")
    assert not is_show("공연장 탐방 투어")


def test_family_performance_filter() -> None:
    assert is_family_performance("[서울 양천] 2026 라이브 가족뮤지컬 호두까기 인형")
    # 제목에는 없어도 48개월부터 보는 발레
    assert is_family_performance("[고양] 유니버설발레단, 호두까기인형", "48개월 이상")
    assert is_family_performance("연극 [오즈의 마법사]", "만 5세 이상")
    assert not is_family_performance("2026 M 초이스 연극 [투신]", "12세이상 관람가능")
    assert not is_family_performance("체홉 낭독극 [갈매기]", "14세 이상")
    assert not is_family_performance("트로트 콘서트", "전체관람가")
    # 음악·국악은 제목으로만
    assert not is_family_performance("피아노 독주회", "48개월 이상", stage=False)


def test_title_word_does_not_override_adult_age() -> None:
    assert not is_family_performance("[대학로] 잔혹동화 생존기", "만 16세 이상")
    assert not is_family_performance("동화와 전설", "만 13세(중학생) 이상 관람가")
    assert not classify_category(
        _rec(codename="클래식"), "MAC 모닝 콘서트", "8세이상 관람가능(미취학아동입장불가)"
    )
