"""한국관광공사 TourAPI 4.0 (KorService2/1) 수집기.

목록(searchFestival, areaBasedList)에는 설명·홈페이지가 없고 areaBasedList는 날짜도 없다.
그래서 항목마다 detailCommon(개요·홈페이지·이미지)과 detailIntro(행사기간·장소)를 추가 호출해
API가 확정한 값을 RawRecord.facts 에 담는다.
"""

from __future__ import annotations

import html
import logging
import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import unquote

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config import settings
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

# contentTypeId 15 = 행사/공연/축제
CONTENT_TYPE_EVENT = "15"
# searchFestival 조회 시작일을 앞당겨 이미 시작한(진행 중) 행사도 받는다
FESTIVAL_LOOKBACK_DAYS = 90

_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
_URL = re.compile(r"https?://[^\s<>\"']+")
_TAG = re.compile(r"<[^>]+>")


class TourApiCollector:
    """searchFestival + areaBasedList → detailCommon/detailIntro 보강."""

    def __init__(
        self,
        service_key: str | None = None,
        base_url: str | None = None,
        client: httpx.Client | None = None,
        *,
        max_detail_calls: int | None = None,
    ) -> None:
        self.service_key = service_key or settings.tour_api_service_key
        self.base_url = (base_url or settings.tour_api_base_url).rstrip("/")
        self._suffix = "1" if self.base_url.endswith("KorService1") else "2"
        self._owns_client = client is None
        self.client = client or httpx.Client(timeout=30.0, follow_redirects=True)
        self.max_detail_calls = (
            settings.tour_api_max_detail_calls if max_detail_calls is None else max_detail_calls
        )
        self._detail_calls = 0

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> TourApiCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def collect(
        self,
        *,
        event_start_date: date | None = None,
        area_code: str | None = None,
    ) -> list[RawRecord]:
        if not self.service_key:
            raise ValueError("TOUR_API_SERVICE_KEY is required")

        today = today_kst()
        start = event_start_date or (today - timedelta(days=FESTIVAL_LOOKBACK_DAYS))
        items: list[tuple[str, dict[str, Any]]] = []
        seen: set[str] = set()

        fest_params: dict[str, Any] = {"eventStartDate": start.strftime("%Y%m%d"), "arrange": "C"}
        if area_code:
            fest_params["areaCode"] = area_code
        for item in self._paginate(f"searchFestival{self._suffix}", fest_params):
            cid = _content_id(item)
            if cid and cid not in seen:
                seen.add(cid)
                items.append((f"searchFestival{self._suffix}", item))

        area_params: dict[str, Any] = {"contentTypeId": CONTENT_TYPE_EVENT, "arrange": "C"}
        if area_code:
            area_params["areaCode"] = area_code
        for item in self._paginate(f"areaBasedList{self._suffix}", area_params):
            cid = _content_id(item)
            if cid and cid in seen:
                continue
            if cid:
                seen.add(cid)
            items.append((f"areaBasedList{self._suffix}", item))

        records: list[RawRecord] = []
        skipped_ended = 0
        for endpoint, item in items:
            # 목록에 종료일이 있고 이미 끝났으면 상세 호출·LLM 비용을 쓰지 않는다
            list_end = _iso_ymd(item.get("eventenddate"))
            if list_end and list_end < today.isoformat():
                skipped_ended += 1
                continue
            detail = self._fetch_details(item)
            end = detail.get("eventenddate") or list_end
            if end and _iso_ymd(end) and _iso_ymd(end) < today.isoformat():
                skipped_ended += 1
                continue
            records.append(self._item_to_raw(item, detail, endpoint=endpoint))

        logger.info(
            "TourAPI collected %s raw records (skipped ended=%s, detail calls=%s)",
            len(records),
            skipped_ended,
            self._detail_calls,
        )
        return records

    def _paginate(self, endpoint: str, extra_params: dict[str, Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for page in range(1, settings.tour_api_max_pages + 1):
            payload = self._request(
                endpoint,
                {**extra_params, "pageNo": page, "numOfRows": settings.tour_api_num_rows, "listYN": "Y"},
            )
            page_items = self._extract_items(payload)
            if not page_items:
                break
            items.extend(page_items)
            if len(page_items) < settings.tour_api_num_rows:
                break
        return items

    def _fetch_details(self, item: dict[str, Any]) -> dict[str, Any]:
        """detailCommon + detailIntro 결과를 합친 dict. 실패·상한 초과 시 빈 dict."""
        cid = _content_id(item)
        if not cid or self._detail_calls + 2 > self.max_detail_calls:
            return {}
        merged: dict[str, Any] = {}
        common_params: dict[str, Any] = {"contentId": cid}
        if self._suffix == "1":
            common_params.update(
                defaultYN="Y", firstImageYN="Y", addrinfoYN="Y", mapinfoYN="Y", overviewYN="Y"
            )
        intro_params = {
            "contentId": cid,
            "contentTypeId": str(item.get("contenttypeid") or CONTENT_TYPE_EVENT),
        }
        for endpoint, params in (
            (f"detailCommon{self._suffix}", common_params),
            (f"detailIntro{self._suffix}", intro_params),
        ):
            self._detail_calls += 1
            try:
                found = self._extract_items(self._request(endpoint, params))
            except Exception as exc:
                logger.warning("TourAPI %s failed for %s: %s", endpoint, cid, exc)
                continue
            if found:
                merged.update({k: v for k, v in found[0].items() if v not in (None, "")})
        return merged

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    def _request(self, endpoint: str, extra_params: dict[str, Any]) -> dict[str, Any]:
        # data.go.kr 키는 이미 URL-encoded 형태로 발급되는 경우가 많아 이중 인코딩 방지
        key = unquote(self.service_key)
        params = {
            "serviceKey": key,
            "MobileOS": "ETC",
            "MobileApp": settings.tour_api_mobile_app,
            "_type": "json",
            **extra_params,
        }
        url = f"{self.base_url}/{endpoint}"
        logger.debug("TourAPI GET %s page=%s", endpoint, extra_params.get("pageNo"))
        response = self.client.get(url, params=params)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _extract_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            body = payload["response"]["body"]
        except (KeyError, TypeError):
            logger.warning("Unexpected TourAPI payload shape: %s", list(payload.keys()))
            return []

        items = body.get("items")
        if not items or not isinstance(items, dict):
            return []
        item = items.get("item", [])
        if isinstance(item, dict):
            return [item]
        if isinstance(item, list):
            return item
        return []

    def _item_to_raw(
        self, item: dict[str, Any], detail: dict[str, Any], *, endpoint: str
    ) -> RawRecord:
        full = {**item, **detail}
        content_id = _content_id(item)
        title = str(full.get("title") or "").strip() or None
        addr1 = str(full.get("addr1") or "").strip()
        addr2 = str(full.get("addr2") or "").strip()
        address = " ".join(p for p in (addr1, addr2) if p)
        start = _iso_ymd(full.get("eventstartdate"))
        end = _iso_ymd(full.get("eventenddate"))
        place = _clean_text(full.get("eventplace"))
        overview = _clean_text(full.get("overview"))
        homepage = extract_homepage(full.get("homepage"))
        image = full.get("firstimage") or full.get("firstimage2") or None
        lat = _to_float(full.get("mapy"))
        lng = _to_float(full.get("mapx"))
        fee = _clean_text(full.get("usetimefestival"))

        lines = [
            f"[출처] 한국관광공사 TourAPI ({endpoint})",
            f"[제목] {title or '(제목 없음)'}",
            f"[주소] {address or '정보 없음'}",
            f"[행사장소] {place or '정보 없음'}",
            f"[시작일] {start or '정보 없음'}",
            f"[종료일] {end or '정보 없음'}",
            f"[이용요금] {fee or '정보 없음'}",
            f"[공연시간] {_clean_text(full.get('playtime')) or '정보 없음'}",
            f"[주최] {_clean_text(full.get('sponsor1')) or '정보 없음'}",
            f"[전화] {str(full.get('tel') or '').strip() or '정보 없음'}",
            "",
            "[본문]",
            overview or title or "상세 설명 없음",
        ]

        facts: dict[str, Any] = {
            "title": title,
            "start_date": start,
            "end_date": end,
            "address": address or None,
            "location_name": place or None,
            "latitude": lat,
            "longitude": lng,
            "thumbnail_url": image,
            "official_link": homepage,
        }
        return RawRecord(
            source="tour_api",
            source_id=content_id or None,
            collected_at=now_utc(),
            title_hint=title,
            url=homepage
            or (
                f"https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid={content_id}"
                if content_id
                else None
            ),
            raw_text="\n".join(lines),
            meta={
                "endpoint": endpoint,
                "content_type_id": str(item.get("contenttypeid") or CONTENT_TYPE_EVENT),
                "area_code": item.get("areacode"),
                "has_detail": bool(detail),
            },
            facts={k: v for k, v in facts.items() if v not in (None, "")},
        )


def _content_id(item: dict[str, Any]) -> str:
    return str(item.get("contentid") or item.get("contentId") or "")


def _iso_ymd(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def _to_float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f or None


def _clean_text(value: Any) -> str:
    if not value:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", str(value), flags=re.I)
    return html.unescape(_TAG.sub("", text)).strip()


def extract_homepage(value: Any) -> str | None:
    """TourAPI homepage 필드는 '<a href="...">...</a>' HTML인 경우가 많다."""
    if not value:
        return None
    text = html.unescape(str(value))
    match = _HREF.search(text) or _URL.search(text)
    if match:
        url = match.group(1) if match.re is _HREF else match.group(0)
        return url.strip()
    plain = _TAG.sub("", text).strip()
    if re.match(r"^(www\.)?[\w-]+(\.[\w-]+)+(/\S*)?$", plain):
        return f"https://{plain}"
    return None
