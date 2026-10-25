"""정제기 공통 결과 타입 (규칙 기반 · Claude 공용)."""

from __future__ import annotations

from dataclasses import dataclass, field

from models import NormalizedEvent, RawRecord


@dataclass
class ParseResult:
    events: list[NormalizedEvent] = field(default_factory=list)
    failed_records: list[RawRecord] = field(default_factory=list)
    failed_batches: int = 0
    invalid_items: int = 0
