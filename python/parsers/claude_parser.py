"""Claude API로 Raw 텍스트를 PRD events JSON 스키마로 정제.

Structured Outputs(output_config.format)로 스키마에 맞는 JSON만 받는다.
API가 확정한 값(RawRecord.facts)은 LLM 결과를 덮어쓴다 — 날짜·주소 환각 차단.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from anthropic import Anthropic

from config import settings
from models import PLACE_TYPES, NormalizedEvent, RawRecord
from parsers.base import ParseResult

logger = logging.getLogger(__name__)

_NULLABLE_STR = {"type": ["string", "null"]}
_NULLABLE_NUM = {"type": ["number", "null"]}

EVENT_PROPERTIES: dict[str, Any] = {
    "source_id": {
        "type": "string",
        "description": "입력 레코드의 source_id를 그대로 복사",
    },
    "title": {"type": "string"},
    "category": {
        "type": "string",
        "enum": ["popup", "exhibition", "festival", "kids_experience", "parents"],
    },
    "description": _NULLABLE_STR,
    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
    "end_date": {"type": "string", "description": "YYYY-MM-DD"},
    "dates_found_in_text": {
        "type": "boolean",
        "description": "시작일·종료일이 원문에 명시돼 있으면 true, 추정했으면 false",
    },
    "location_name": {"type": "string"},
    "address": {"type": "string"},
    "latitude": _NULLABLE_NUM,
    "longitude": _NULLABLE_NUM,
    "is_family_friendly": {"type": "boolean"},
    "target_age_group": {
        "anyOf": [
            {"type": "string", "enum": ["all", "toddler", "kids", "elementary"]},
            {"type": "null"},
        ]
    },
    "amenities": {
        "type": "object",
        "properties": {
            "parking": {"type": "boolean"},
            "stroller": {"type": "boolean"},
            "nursing_room": {"type": "boolean"},
        },
        "required": ["parking", "stroller", "nursing_room"],
        "additionalProperties": False,
    },
    "booking_required": {"type": "boolean"},
    "price_info": _NULLABLE_STR,
    "thumbnail_url": _NULLABLE_STR,
    "official_link": _NULLABLE_STR,
    "tags": {"type": "array", "items": {"type": "string"}},
    "place_types": {
        "type": "array",
        "items": {"type": "string", "enum": list(PLACE_TYPES)},
    },
}

EVENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": EVENT_PROPERTIES,
                "required": list(EVENT_PROPERTIES),
                "additionalProperties": False,
            },
        }
    },
    "required": ["events"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """당신은 한국 행사/팝업/전시 데이터를 표준 JSON으로 정제하는 파서입니다.
각 입력 레코드에서 실제 행사 정보를 추출하세요.

규칙:
- source_id는 입력 레코드의 값을 그대로 복사합니다. 한 레코드에서 행사가 여러 개 나오면 모두 같은 source_id를 씁니다.
- 날짜는 YYYY-MM-DD. 원문에 날짜가 없으면 추측하지 말고 dates_found_in_text=false로 표시합니다.
- 행사가 아닌 글(광고, 목록 페이지, 날짜 없는 일반 소개)은 events에 넣지 않습니다.
- 주소·좌표·링크를 지어내지 않습니다. 모르면 null(주소는 "주소 미상").
- 아이 동반/체험/교육 언급이 있으면 is_family_friendly=true와 적절한 tags를 부여합니다.
- tags는 한국어 해시태그 형태(예: #실내나들이)로 3~6개.
- place_types는 장소 성격이 분명할 때만 고릅니다:
  historical(궁·유적·역사관), nature_science(자연사·과학관·식물원), amusement_park(테마파크·워터파크),
  park_playground(공원·놀이터), forest_recreation(숲체험·휴양림·수목원), cultural_center(문화센터·강좌), temple(사찰).
"""

INSTRUCTION = (
    "아래 records 각각에서 [제목, 카테고리, 시작일, 종료일, 장소, 주소, 아이동반적합여부, "
    "태그, 편의시설, 예약필요여부, 장소유형]을 추출하세요."
)


class ClaudeEventParser:
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        client: Anthropic | None = None,
    ) -> None:
        key = api_key or settings.anthropic_api_key
        if client is None and not key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        self.model = model or settings.claude_model
        # SDK가 429/5xx/연결 오류만 재시도한다 (400 등은 즉시 실패).
        self.client = client or Anthropic(api_key=key, max_retries=4)

    def parse_records(
        self,
        records: list[RawRecord],
        *,
        batch_size: int | None = None,
    ) -> ParseResult:
        size = batch_size or settings.claude_batch_size
        result = ParseResult()
        for i in range(0, len(records), size):
            batch = records[i : i + size]
            try:
                events, invalid = self.parse_batch(batch)
            except Exception:
                logger.exception(
                    "Claude batch %s–%s failed; continuing", i + 1, i + len(batch)
                )
                result.failed_batches += 1
                result.failed_records.extend(batch)
                continue
            result.events.extend(events)
            result.invalid_items += invalid
        logger.info(
            "Claude parsed %s events from %s raw (failed batches=%s, invalid items=%s)",
            len(result.events),
            len(records),
            result.failed_batches,
            result.invalid_items,
        )
        return result

    def parse_batch(self, records: list[RawRecord]) -> tuple[list[NormalizedEvent], int]:
        if not records:
            return [], 0
        by_id = {_record_key(r, idx): r for idx, r in enumerate(records)}
        user_payload = {
            "instruction": INSTRUCTION,
            "records": [
                {
                    "source": r.source,
                    "source_id": key,
                    "url": r.url,
                    "title_hint": r.title_hint,
                    "raw_text": r.raw_text,
                }
                for key, r in by_id.items()
            ],
        }
        data = self._call_claude(json.dumps(user_payload, ensure_ascii=False))
        return self._to_events(data, by_id)

    def _call_claude(self, user_content: str) -> dict[str, Any]:
        message = self.client.beta.messages.create(
            model=self.model,
            max_tokens=settings.claude_max_tokens,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": EVENT_JSON_SCHEMA},
            },
            # 정책 거절 시 서버가 대체 모델로 같은 요청을 재실행
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if message.stop_reason == "refusal":
            raise RuntimeError(f"Claude refused: {getattr(message, 'stop_details', None)}")
        if message.stop_reason == "max_tokens":
            raise RuntimeError("Claude output truncated (max_tokens)")
        text = next(
            (b.text for b in message.content if getattr(b, "type", None) == "text"),
            None,
        )
        if text is None:
            raise RuntimeError("Claude response had no text block")
        return json.loads(text)

    def _to_events(
        self, data: dict[str, Any], by_id: dict[str, RawRecord]
    ) -> tuple[list[NormalizedEvent], int]:
        events: list[NormalizedEvent] = []
        invalid = 0
        only = next(iter(by_id.values())) if len(by_id) == 1 else None
        for item in data.get("events", []):
            record = by_id.get(str(item.get("source_id"))) or only
            if record is None:
                logger.warning("Unmapped source_id %r; skipping", item.get("source_id"))
                invalid += 1
                continue
            merged = apply_facts(item, record)
            try:
                events.append(NormalizedEvent.model_validate(merged))
            except Exception as exc:
                logger.warning("Skipping invalid event %r: %s", item.get("title"), exc)
                invalid += 1
        return events, invalid


def _record_key(record: RawRecord, idx: int) -> str:
    return record.source_id or f"idx{idx}"


_FACT_FIELDS = (
    "title",
    "start_date",
    "end_date",
    "address",
    "location_name",
    "latitude",
    "longitude",
    "thumbnail_url",
    "official_link",
    "price_info",
    "description",
)


def apply_facts(item: dict[str, Any], record: RawRecord) -> dict[str, Any]:
    """API가 준 확정값으로 LLM 출력을 덮어쓰고 파이프라인 메타를 붙인다."""
    merged = dict(item)
    facts = record.facts or {}
    for key in _FACT_FIELDS:
        value = facts.get(key)
        if value not in (None, ""):
            # 설명은 LLM 요약이 있으면 유지
            if key == "description" and merged.get("description"):
                continue
            merged[key] = value
    merged["dates_from_facts"] = bool(facts.get("start_date") and facts.get("end_date"))
    if merged["dates_from_facts"]:
        merged["dates_found_in_text"] = True
    merged["source"] = record.source
    merged["source_id"] = record.source_id
    merged["content_hash"] = record.content_hash
    if not merged.get("address"):
        merged["address"] = "주소 미상"
    if not merged.get("location_name"):
        merged["location_name"] = merged.get("title") or "장소 미상"
    return merged
