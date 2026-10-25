"""네이버 검색 API(블로그·뉴스)로 이벤트 후보 텍스트 수집."""

from __future__ import annotations

import html
import logging
import re
from typing import Any

import httpx

from config import settings
from models import RawRecord
from timeutil import now_utc

logger = logging.getLogger(__name__)

API_URL = "https://openapi.naver.com/v1/search/{kind}.json"
_TAG = re.compile(r"<[^>]+>")


def _clean(text: Any) -> str:
    return html.unescape(_TAG.sub("", str(text or ""))).strip()


class NaverSearchCollector:
    def __init__(
        self,
        queries: list[str],
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        display: int = 10,
        client: httpx.Client | None = None,
    ) -> None:
        cid = client_id or settings.naver_client_id
        secret = client_secret or settings.naver_client_secret
        if not cid or not secret:
            raise ValueError("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET are required")
        self.queries = queries
        self.display = display
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=15.0,
            headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret},
        )

    def __enter__(self) -> NaverSearchCollector:
        return self

    def __exit__(self, *args: object) -> None:
        if self._owns_client:
            self.client.close()

    def collect(self) -> list[RawRecord]:
        records: list[RawRecord] = []
        seen: set[str] = set()
        for query in self.queries:
            for kind in ("blog", "news"):
                try:
                    items = self._search(kind, query)
                except Exception:
                    logger.exception("Naver %s search failed: %s", kind, query)
                    continue
                for item in items:
                    url = item.get("originallink") or item.get("link") or ""
                    if not url or url in seen:
                        continue
                    seen.add(url)
                    title = _clean(item.get("title"))
                    body = _clean(item.get("description"))
                    raw_text = "\n".join(
                        [
                            f"[출처] 네이버 {kind} 검색",
                            f"[검색어] {query}",
                            f"[제목힌트] {title}",
                            f"[게시일] {item.get('postdate') or item.get('pubDate') or '정보 없음'}",
                            f"[URL] {url}",
                            "",
                            "[본문]",
                            body or title,
                        ]
                    )
                    records.append(
                        RawRecord(
                            source="naver",
                            source_id=re.sub(r"\W+", "_", url)[:200],
                            collected_at=now_utc(),
                            title_hint=title,
                            url=url,
                            raw_text=raw_text,
                            meta={"query": query, "kind": kind},
                        )
                    )
        logger.info("Naver search gathered %s records", len(records))
        return records

    def _search(self, kind: str, query: str) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"query": query, "display": self.display}
        if kind == "news":
            params["sort"] = "date"
        resp = self.client.get(API_URL.format(kind=kind), params=params)
        resp.raise_for_status()
        return resp.json().get("items") or []
