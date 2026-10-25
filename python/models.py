"""Pydantic models aligned with PRD §4 / Supabase `events` table."""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from timeutil import now_utc, status_for


class EventCategory(str, Enum):
    POPUP = "popup"
    EXHIBITION = "exhibition"
    FESTIVAL = "festival"
    KIDS_EXPERIENCE = "kids_experience"


class TargetAgeGroup(str, Enum):
    ALL = "all"
    TODDLER = "toddler"
    KIDS = "kids"
    ELEMENTARY = "elementary"


class EventStatus(str, Enum):
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    ENDED = "ended"


PLACE_TYPES = (
    "historical",
    "nature_science",
    "amusement_park",
    "park_playground",
    "forest_recreation",
    "cultural_center",
    "temple",
)

SourceName = Literal[
    "kfes",
    "culture_portal",
    "tour_api",
    "popply",
    "seoul_portal",
    "mcst_festival",
    "city_calendar",
    "public_data",
    "web_search",
    "naver",
    "seoul_api",
    "seed_json",
]

_DEDUPE_STRIP = re.compile(r"[^0-9a-z가-힣]")


def dedupe_key(title: str, start: date) -> str:
    """SQL 백필과 동일: lower(title)에서 [0-9a-z가-힣] 외 제거 + '|' + start_date."""
    return f"{_DEDUPE_STRIP.sub('', title.lower())}|{start.isoformat()}"


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class EventAmenities(BaseModel):
    parking: bool = False
    stroller: bool = False
    nursing_room: bool = False


class NormalizedEvent(BaseModel):
    """Claude 정제 결과 → Supabase upsert 페이로드."""

    title: str = Field(..., min_length=1, max_length=255)
    category: EventCategory
    description: str | None = None

    start_date: date
    end_date: date

    location_name: str = Field(..., min_length=1, max_length=255)
    address: str = Field(..., min_length=1)
    latitude: float | None = None
    longitude: float | None = None
    region: str | None = None
    district: str | None = None

    is_family_friendly: bool = False
    target_age_group: TargetAgeGroup | None = None
    # 본문에 적힌 세부 대상 나이 (만 나이, 년). 모르면 None — '5~7세'면 5·7, '36개월 이상'이면 3·None
    age_min: float | None = None
    age_max: float | None = None
    amenities: EventAmenities = Field(default_factory=EventAmenities)

    booking_required: bool = False
    price_info: str | None = None
    thumbnail_url: str | None = None
    official_link: str | None = None

    tags: list[str] = Field(default_factory=list)
    place_types: list[str] = Field(default_factory=list)
    status: EventStatus = EventStatus.ONGOING

    # 파이프라인 메타 (DB 컬럼)
    source: str | None = None
    source_id: str | None = None
    content_hash: str | None = None
    legacy_id: str | None = None

    # 검증용 (DB에 저장하지 않음)
    dates_found_in_text: bool = True
    dates_from_facts: bool = False

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        return [str(t).strip() for t in value if str(t).strip()]

    @field_validator("place_types", mode="before")
    @classmethod
    def normalize_place_types(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        return [str(t).strip() for t in value if str(t).strip() in PLACE_TYPES]

    @field_validator("price_info", mode="before")
    @classmethod
    def clip_price(cls, value: Any) -> Any:
        # 길이 초과로 배치 전체가 검증 실패하지 않도록 잘라서 보관
        if isinstance(value, str) and len(value) > 100:
            return value[:99] + "…"
        return value

    @model_validator(mode="after")
    def validate_date_range_and_status(self) -> NormalizedEvent:
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        self.status = EventStatus(status_for(self.start_date, self.end_date))
        return self

    @property
    def dedupe_key(self) -> str:
        return dedupe_key(self.title, self.start_date)

    def to_supabase_row(self) -> dict[str, Any]:
        row = {
            "title": self.title,
            "category": self.category.value,
            "description": self.description,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "location_name": self.location_name,
            "address": self.address,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "region": self.region,
            "district": self.district,
            "is_family_friendly": self.is_family_friendly,
            "target_age_group": (
                self.target_age_group.value if self.target_age_group else None
            ),
            "amenities": self.amenities.model_dump(),
            "booking_required": self.booking_required,
            "price_info": self.price_info,
            "thumbnail_url": self.thumbnail_url,
            "official_link": self.official_link,
            "tags": self.tags or None,
            "place_types": self.place_types,
            "status": self.status.value,
            "source": self.source,
            "source_id": self.source_id,
            "content_hash": self.content_hash,
            "dedupe_key": self.dedupe_key,
            "last_seen_at": now_utc().isoformat(),
        }
        # 시드에서 넣은 legacy_id(옛 URL용)를 크롤러 upsert가 null로 덮지 않도록 있을 때만 보낸다
        if self.legacy_id:
            row["legacy_id"] = self.legacy_id
        return row


class RawRecord(BaseModel):
    """수집 단계 스테이징 레코드."""

    source: SourceName
    source_id: str | None = None
    collected_at: datetime = Field(default_factory=now_utc)
    title_hint: str | None = None
    url: str | None = None
    raw_text: str
    meta: dict[str, Any] = Field(default_factory=dict)
    # API가 확정해 주는 값(제목·날짜·주소·좌표·썸네일·공식링크). LLM 결과보다 우선한다.
    facts: dict[str, Any] = Field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return content_hash(self.raw_text)
