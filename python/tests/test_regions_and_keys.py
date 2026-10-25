from datetime import date

import pytest

from models import dedupe_key
from regions import detect_district, detect_region
from timeutil import status_for


@pytest.mark.parametrize(
    ("address", "region"),
    [
        ("경기도 광주시 퇴촌면 정영로 1", "경기도"),
        ("경기 광주시 오포읍", "경기도"),
        ("광주광역시 북구 첨단과기로", "광주광역시"),
        ("서울특별시 종로구 사직로 161", "서울특별시"),
        ("서울 마포구 월드컵로", "서울특별시"),
        ("전라북도 전주시 완산구", "전북특별자치도"),
        ("강원도 춘천시", "강원특별자치도"),
        ("제주특별자치도 서귀포시", "제주특별자치도"),
        ("충청남도 공주시", "충청남도"),
    ],
)
def test_detect_region(address, region):
    assert detect_region(address) == region


def test_detect_region_ignores_place_names_mid_address():
    # 주소 앞이 광역명이 아니면 본문 속 '서울'로 판정하지 않는다
    assert detect_region("주소 미상 (서울숲 근처)") is None
    assert detect_region("") is None
    assert detect_region(None) is None


def test_district_token_exact_match():
    assert detect_district("부산광역시", "부산광역시 강서구 낙동북로 1") == "강서구"
    assert detect_district("부산광역시", "부산광역시 서구 구덕로 1") == "서구"
    assert detect_district("인천광역시", "인천광역시 서구 청라") == "서구"
    assert detect_district("경기도", "경기도 광주시 퇴촌면") == "광주시"
    assert detect_district("서울특별시", "서울특별시 중구 세종대로") == "중구"
    assert detect_district("세종특별자치시", "세종특별자치시 한누리대로") is None


def test_dedupe_key_matches_sql_rule():
    assert dedupe_key("Seoul Lantern Festival 2026!", date(2026, 11, 1)) == (
        "seoullanternfestival2026|2026-11-01"
    )
    assert dedupe_key("서울 빛초롱 축제 (청계천)", date(2026, 11, 1)) == "서울빛초롱축제청계천|2026-11-01"
    assert dedupe_key("서울빛초롱축제·청계천", date(2026, 11, 1)) == dedupe_key(
        "서울 빛초롱 축제 (청계천)", date(2026, 11, 1)
    )


def test_status_for_kst_reference():
    today = date(2026, 10, 19)
    assert status_for(date(2026, 10, 1), date(2026, 10, 18), today) == "ended"
    assert status_for(date(2026, 10, 1), date(2026, 10, 19), today) == "ongoing"
    assert status_for(date(2026, 10, 20), date(2026, 10, 30), today) == "upcoming"
