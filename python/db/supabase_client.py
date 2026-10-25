"""Supabase events upsert (dedupe_key) + 변경 감지 + 실행 기록."""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client, create_client

from config import settings
from models import NormalizedEvent
from timeutil import now_utc

logger = logging.getLogger(__name__)

_CHUNK = 200


class EventRepository:
    def __init__(
        self,
        url: str | None = None,
        service_role_key: str | None = None,
        client: Client | None = None,
    ) -> None:
        if client is not None:
            self.client = client
            return

        supabase_url = url or settings.supabase_url
        key = service_role_key or settings.supabase_service_role_key
        if not supabase_url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self.client = create_client(supabase_url, key)

    def existing_hashes(self, source: str, source_ids: list[str]) -> dict[str, str]:
        """{source_id: content_hash} for rows already stored from this source."""
        found: dict[str, str] = {}
        ids = sorted({s for s in source_ids if s})
        for i in range(0, len(ids), _CHUNK):
            chunk = ids[i : i + _CHUNK]
            resp = (
                self.client.table("events")
                .select("source_id,content_hash")
                .eq("source", source)
                .in_("source_id", chunk)
                .execute()
            )
            for row in resp.data or []:
                if row.get("source_id") and row.get("content_hash"):
                    found[row["source_id"]] = row["content_hash"]
        return found

    def touch_last_seen(self, source: str, source_ids: list[str]) -> None:
        ids = sorted({s for s in source_ids if s})
        stamp = now_utc().isoformat()
        for i in range(0, len(ids), _CHUNK):
            (
                self.client.table("events")
                .update({"last_seen_at": stamp})
                .eq("source", source)
                .in_("source_id", ids[i : i + _CHUNK])
                .execute()
            )

    def upsert_events(self, events: list[NormalizedEvent]) -> list[dict[str, Any]]:
        if not events:
            return []

        # 같은 요청 안에 충돌 키가 두 번 나오면 PostgREST가 오류를 내므로 먼저 합친다 (뒤의 값 우선)
        rows_by_key: dict[str, dict[str, Any]] = {}
        for event in events:
            if not event.region:
                logger.warning("Skip event without region: %s", event.title)
                continue
            row = event.to_supabase_row()
            rows_by_key[row["dedupe_key"]] = row
        # PostgREST 벌크 요청은 모든 객체의 키가 같아야 한다 (legacy_id 유무로 나눔)
        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows_by_key.values():
            groups.setdefault(tuple(sorted(row)), []).append(row)

        data: list[dict[str, Any]] = []
        for rows in groups.values():
            for i in range(0, len(rows), _CHUNK):
                response = (
                    self.client.table("events")
                    .upsert(rows[i : i + _CHUNK], on_conflict="dedupe_key")
                    .execute()
                )
                data.extend(response.data or [])
        logger.info("Upserted %s events into Supabase", len(data))
        return data

    def record_run(self, run: dict[str, Any]) -> None:
        try:
            self.client.table("pipeline_runs").insert(run).execute()
        except Exception:
            logger.exception("Failed to write pipeline_runs row")
