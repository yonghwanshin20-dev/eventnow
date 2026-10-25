import json
from datetime import date, timedelta
from types import SimpleNamespace

from models import NormalizedEvent, RawRecord
from parsers.claude_parser import ClaudeEventParser, apply_facts
from timeutil import today_kst
from validation import validate_events

TODAY = today_kst()


def _iso(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


def _llm_event(**overrides):
    base = {
        "source_id": "tour-1",
        "title": "LLM 제목",
        "category": "festival",
        "description": "가족과 함께하는 축제",
        "start_date": _iso(1),
        "end_date": _iso(3),
        "dates_found_in_text": True,
        "location_name": "어딘가",
        "address": "서울특별시 중구 세종대로 110",
        "latitude": None,
        "longitude": None,
        "is_family_friendly": True,
        "target_age_group": "all",
        "amenities": {"parking": False, "stroller": True, "nursing_room": False},
        "booking_required": False,
        "price_info": None,
        "thumbnail_url": None,
        "official_link": None,
        "tags": ["#가족"],
        "place_types": ["park_playground", "not_a_type"],
    }
    base.update(overrides)
    return base


class FakeMessages:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        payload = self.payloads.pop(0)
        if isinstance(payload, Exception):
            raise payload
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=json.dumps(payload, ensure_ascii=False))],
        )


def _fake_client(*payloads):
    messages = FakeMessages(payloads)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def _record(source_id="tour-1", facts=None):
    return RawRecord(
        source="tour_api",
        source_id=source_id,
        raw_text=f"[제목] 원문 {source_id}",
        facts=facts or {},
    )


def test_parser_maps_by_source_id_and_applies_facts():
    facts = {
        "title": "API 제목",
        "start_date": _iso(2),
        "end_date": _iso(10),
        "address": "경기도 광주시 퇴촌면 정영로 1",
        "latitude": 37.4,
        "longitude": 127.3,
        "thumbnail_url": "https://tong.visitkorea.or.kr/a.jpg",
    }
    client, messages = _fake_client(
        {"events": [_llm_event(source_id="tour-2"), _llm_event(source_id="tour-1", dates_found_in_text=False)]}
    )
    parser = ClaudeEventParser(client=client, model="test-model")
    result = parser.parse_records([_record("tour-1", facts), _record("tour-2")], batch_size=5)

    assert result.failed_batches == 0
    by_id = {e.source_id: e for e in result.events}
    first = by_id["tour-1"]
    assert first.title == "API 제목"  # facts override LLM
    assert first.start_date.isoformat() == _iso(2)
    assert first.address.startswith("경기도 광주시")
    assert first.dates_from_facts is True
    assert first.dates_found_in_text is True
    assert first.content_hash and first.source == "tour_api"
    assert first.place_types == ["park_playground"]  # unknown enum dropped
    assert by_id["tour-2"].title == "LLM 제목"

    sent = messages.calls[0]
    assert sent["model"] == "test-model"
    assert sent["output_config"]["format"]["type"] == "json_schema"


def test_failed_batch_is_isolated():
    client, _ = _fake_client(RuntimeError("boom"), {"events": [_llm_event(source_id="b")]})
    parser = ClaudeEventParser(client=client, model="m")
    result = parser.parse_records([_record("a"), _record("b")], batch_size=1)
    assert result.failed_batches == 1
    assert [r.source_id for r in result.failed_records] == ["a"]
    assert [e.source_id for e in result.events] == ["b"]


def test_apply_facts_keeps_llm_description():
    merged = apply_facts(
        {"description": "LLM 요약", "title": "x"},
        _record(facts={"description": "원문 개요"}),
    )
    assert merged["description"] == "LLM 요약"
    assert merged["dates_from_facts"] is False


def _event(**kw):
    data = _llm_event(**kw)
    data.pop("source_id")
    return NormalizedEvent.model_validate(data)


def test_validation_rules():
    events = [
        _event(title="ok"),
        _event(title="guessed", dates_found_in_text=False),
        _event(title="ended", start_date=_iso(-10), end_date=_iso(-1)),
        _event(title="far", start_date=f"{TODAY.year + 3}-01-01", end_date=f"{TODAY.year + 3}-01-02"),
        _event(title="noregion", address="주소 미상"),
        _event(title="long", start_date=_iso(-500), end_date=_iso(10)),
    ]
    result = validate_events(events, today=TODAY)
    assert [e.title for e in result.kept] == ["ok", "long"]
    assert result.rejected == {
        "dates_not_in_source": 1,
        "start_year_out_of_range": 1,
        "region_unknown": 1,
    }
    # 끝난 행사는 버리지 않고 기존 행 교정용으로 따로 모은다
    assert [e.title for e in result.ended] == ["ended"]
    assert result.flagged_long == 1
    assert result.kept[0].region == "서울특별시"
    assert result.kept[0].district == "중구"


def test_status_and_row_payload():
    ev = _event(start_date=_iso(-1), end_date=_iso(1), price_info="가" * 150)
    ev.region = "서울특별시"
    row = ev.to_supabase_row()
    assert row["status"] == "ongoing"
    assert len(row["price_info"]) <= 100
    assert row["dedupe_key"].endswith(_iso(-1))
    assert "legacy_id" not in row
    ev.legacy_id = "evt-123"
    assert ev.to_supabase_row()["legacy_id"] == "evt-123"
    assert date.fromisoformat(row["start_date"]) < TODAY
