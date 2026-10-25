"""카카오 로컬 API 지오코딩 (주소 → 좌표, 실패 시 장소명 키워드 검색). 결과는 파일 캐시."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from config import settings

logger = logging.getLogger(__name__)

ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"


class KakaoGeocoder:
    def __init__(
        self,
        api_key: str | None = None,
        cache_path: Path | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key or settings.kakao_rest_api_key
        if not self.api_key:
            raise ValueError("KAKAO_REST_API_KEY is required")
        self.cache_path = cache_path or settings.geocode_cache_path
        self.cache: dict[str, list[float] | None] = self._load_cache()
        self.disabled = False
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=10.0,
            headers={"Authorization": f"KakaoAK {self.api_key}"},
        )

    def __enter__(self) -> KakaoGeocoder:
        return self

    def __exit__(self, *args: object) -> None:
        self.save()
        if self._owns_client:
            self.client.close()

    def _load_cache(self) -> dict[str, list[float] | None]:
        try:
            return json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self.cache, ensure_ascii=False, indent=0), encoding="utf-8"
        )

    def geocode(self, address: str | None, place: str | None = None) -> tuple[float, float] | None:
        """(latitude, longitude) 또는 None."""
        key = f"{address or ''}|{place or ''}"
        if key in self.cache:
            hit = self.cache[key]
            return (hit[0], hit[1]) if hit else None

        if self.disabled:
            return None
        try:
            coords = None
            if address and "미상" not in address:
                coords = self._search(ADDRESS_URL, address)
            if coords is None and place:
                usable = address and "미상" not in address
                query = f"{address.split()[0]} {place}" if usable else place
                coords = self._search(KEYWORD_URL, query)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                # 키가 잘못됐거나 권한이 없으면 남은 수백 건도 똑같이 실패하므로 중단
                logger.error("Kakao geocoding disabled for this run: %s", exc.response.status_code)
                self.disabled = True
            else:
                logger.warning("Kakao geocode failed for %r: %s", key, exc)
            return None
        except Exception as exc:
            # 일시 오류는 캐시하지 않고 다음 실행에서 다시 시도
            logger.warning("Kakao geocode failed for %r: %s", key, exc)
            return None
        self.cache[key] = list(coords) if coords else None
        return coords

    def _search(self, url: str, query: str) -> tuple[float, float] | None:
        resp = self.client.get(url, params={"query": query, "size": 1})
        resp.raise_for_status()
        docs = resp.json().get("documents") or []
        if not docs:
            return None
        return float(docs[0]["y"]), float(docs[0]["x"])
