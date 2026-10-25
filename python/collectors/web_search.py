"""DuckDuckGo HTML 검색으로 이벤트 Raw 텍스트 수집 (네이버 API 키가 없을 때의 대체 경로)."""

from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup

from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

_SEASONS = {12: "겨울", 1: "겨울", 2: "겨울", 3: "봄", 4: "봄", 5: "봄",
            6: "여름", 7: "여름", 8: "여름", 9: "가을", 10: "가을", 11: "가을"}


def default_queries(today: date | None = None) -> list[str]:
    """실행 시점 기준 연도·계절·월로 검색어를 만든다 (하드코딩된 연도 제거)."""
    ref = today or today_kst()
    return [
        "주말 아이와 가볼만한 곳 서울",
        "이번주 팝업스토어 서울",
        f"{ref.year} {_SEASONS[ref.month]} 축제 전시 일정",
        f"{ref.year}년 {ref.month}월 어린이 체험 행사",
        "키즈 체험 전시 서울",
    ]


class WebSearchCollector:
    """API 키 없이 DuckDuckGo HTML 결과에서 이벤트 후보 텍스트를 모은다."""

    def __init__(
        self,
        queries: list[str] | None = None,
        *,
        max_results_per_query: int = 8,
        client: httpx.Client | None = None,
    ) -> None:
        self.queries = queries or default_queries()
        self.max_results_per_query = max_results_per_query
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                )
            },
        )

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> WebSearchCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def collect(self) -> list[RawRecord]:
        records: list[RawRecord] = []
        seen_urls: set[str] = set()

        for query in self.queries:
            try:
                hits = self._search(query)
            except Exception:
                logger.exception("Web search failed for query=%s", query)
                continue

            for hit in hits[: self.max_results_per_query]:
                url = hit.get("url") or ""
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                body = hit.get("snippet") or ""
                try:
                    page_text = self._fetch_page_text(url)
                    if page_text:
                        body = f"{body}\n\n{page_text[:5000]}"
                except Exception:
                    logger.debug("Skip page fetch: %s", url)

                title = hit.get("title") or query
                raw_text = "\n".join(
                    [
                        "[출처] 웹 검색 크롤러 (DuckDuckGo)",
                        f"[검색어] {query}",
                        f"[제목힌트] {title}",
                        f"[URL] {url}",
                        "",
                        "[본문]",
                        body or title,
                    ]
                )
                source_id = re.sub(r"\W+", "_", url)[:120]
                records.append(
                    RawRecord(
                        source="web_search",
                        source_id=source_id,
                        collected_at=now_utc(),
                        title_hint=title,
                        url=url,
                        raw_text=raw_text,
                        meta={"query": query, "collector": "web_search"},
                    )
                )

        logger.info("WebSearchCollector gathered %s records", len(records))
        return records

    def _search(self, query: str) -> list[dict[str, Any]]:
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        response = self.client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        hits: list[dict[str, Any]] = []

        for result in soup.select(".result"):
            a = result.select_one("a.result__a")
            snippet_el = result.select_one(".result__snippet")
            if not a or not a.get("href"):
                continue
            hits.append(
                {
                    "title": a.get_text(" ", strip=True),
                    "url": a["href"],
                    "snippet": snippet_el.get_text(" ", strip=True) if snippet_el else "",
                }
            )
        return hits

    def _fetch_page_text(self, url: str) -> str:
        if not url.startswith("http"):
            return ""
        response = self.client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "noscript"]):
            tag.decompose()
        main = soup.find("main") or soup.find("article") or soup.body or soup
        lines = [ln.strip() for ln in main.get_text("\n", strip=True).splitlines() if ln.strip()]
        return "\n".join(lines)
