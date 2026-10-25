"""관광지 — 가 볼 만한 장소 (유적지·문화재·관광지·자연경관·박물관·미술관), API 키 불필요.

- 공공데이터포털 전국관광지정보표준데이터 (15021141): 지정 관광지·관광단지
- 공공데이터포털 전국박물관미술관정보표준데이터 (15017323): 박물관·미술관 (관람 시간·요금)
- 국가유산청 국가유산 공개 API: 사적(유적지)·명승(자연경관) — 소개 글·사진은 상세 API에서 (저장해 두고 새 곳만)

행사가 아니라 '언제든 가는 곳'이라 기간을 오늘부터 400일로 두고 '#상시' 태그를 단다.
매일 수집할 때마다 기간이 다시 늘어나므로 끝나 버리지 않는다.
robots.txt: data.go.kr /download, khs.go.kr /cha/ 모두 허용. 1초 간격. 출처 표기: 각 기관.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import httpx

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from collectors.public_data import PublicDataCollector
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

OPEN_DAYS = 400
KHS = "https://www.khs.go.kr/cha"
KHS_LIST = f"{KHS}/SearchKindOpenapiList.do"
KHS_DETAIL = f"{KHS}/SearchKindOpenapiDt.do"
KHS_VIEW = "https://www.heritage.go.kr/heri/cul/culSelectDetail.do"
# 국가유산 종목: 사적(유적지) · 명승(자연경관)
HERITAGE_KINDS = {"13": "사적", "15": "명승"}
MAX_DETAILS_PER_RUN = 250
DETAIL_TTL_DAYS = 120

_NOT_OPEN = re.compile(r"폐관|휴관\s?중|임시\s?휴관|리모델링|이전\s?준비")


def _clean(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _float(v: Any) -> float | None:
    try:
        f = float(_clean(v))
    except ValueError:
        return None
    return f if f else None


def _squash(s: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def _record(
    *,
    sid: str,
    title: str,
    address: str,
    today: date,
    kind: str,
    provider: str,
    description: str | None,
    lat: float | None,
    lng: float | None,
    link: str | None = None,
    thumb: str | None = None,
    price: str | None = None,
    place: str | None = None,
) -> RawRecord:
    end = today + timedelta(days=OPEN_DAYS)
    raw = "\n".join(
        [
            f"[출처] {provider}",
            f"[제목] {title}",
            f"[구분] {kind}",
            f"[장소] {place or title} ({address})",
            "",
            "[본문]",
            description or "",
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": today.isoformat(),
        "end_date": end.isoformat(),
        "address": address,
        "location_name": place or title,
        "latitude": lat,
        "longitude": lng,
        "official_link": link,
        "thumbnail_url": thumb,
        "description": description,
        "price_info": price,
        "tags": ["#상시", f"#{kind}"],
    }
    return RawRecord(
        source="attraction",
        source_id=sid,
        collected_at=now_utc(),
        title_hint=title,
        url=link,
        raw_text=raw,
        meta={"category_hint": "attraction", "kind": kind},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


def tour_row_to_raw(row: dict[str, Any], *, today: date) -> RawRecord | None:
    title = _clean(row.get("TRRSRT_NM"))
    address = _clean(row.get("RDNMADR")) or _clean(row.get("LNMADR"))
    if not title or not address:
        return None
    intro = _clean(row.get("TRRSRT_INTRCN"))
    return _record(
        sid="t-" + _squash(f"{title}{address}")[:40],
        title=title,
        address=address,
        today=today,
        kind=_clean(row.get("TRRSRT_SE")) or "관광지",
        provider=f"공공데이터포털 전국관광지정보 ({_clean(row.get('INSTT_NM')) or '지자체'})",
        description=intro[:600] or None,
        lat=_float(row.get("LATITUDE")),
        lng=_float(row.get("LONGITUDE")),
    )


def _hhmm(v: Any) -> str:
    s = _clean(v)
    return f"{s[:2]}:{s[2:]}" if re.fullmatch(r"\d{4}", s) else s


def _won(v: Any) -> int | None:
    s = re.sub(r"[^\d]", "", _clean(v))
    return int(s) if s else None


def museum_price(row: dict[str, Any]) -> str | None:
    adult, child = _won(row.get("ADULT_CHRGE")), _won(row.get("CHILD_CHRGE"))
    if adult == 0 and (child in (0, None)):
        return "무료"
    parts = []
    if adult:
        parts.append(f"어른 {adult:,}원")
    if child is not None:
        parts.append("어린이 무료" if child == 0 else f"어린이 {child:,}원")
    return " · ".join(parts) or (_clean(row.get("ETC_CHRGE_INFO"))[:80] or None)


def museum_row_to_raw(row: dict[str, Any], *, today: date) -> RawRecord | None:
    title = _clean(row.get("FCLTY_NM"))
    address = _clean(row.get("RDNMADR")) or _clean(row.get("LNMADR"))
    if not title or not address:
        return None
    intro = _clean(row.get("FCLTY_INTRCN"))
    closed = _clean(row.get("RSTDE_INFO"))
    if _NOT_OPEN.search(f"{title} {closed}"):
        return None
    lines = [intro[:500]] if intro else []
    open_, close = _hhmm(row.get("WEEKDAY_OPER_OPEN_HHMM")), _hhmm(row.get("WEEKDAY_OPER_COLSE_HHMM"))
    if open_ and close:
        lines.append(f"관람 시간 {open_}~{close}")
    if closed:
        lines.append(f"휴관 {closed[:60]}")
    homepage = _clean(row.get("HOMEPAGE_URL"))
    if homepage and not re.match(r"https?://", homepage):
        homepage = f"https://{homepage}" if re.match(r"[\w.-]+\.[a-z]{2,}", homepage) else ""
    kind = _clean(row.get("FCLTY_TYPE")) or "박물관"
    return _record(
        sid="m-" + _squash(f"{title}{address}")[:40],
        title=title,
        address=address,
        today=today,
        kind=kind,
        provider=f"공공데이터포털 전국박물관미술관정보 ({_clean(row.get('INSTT_NM')) or '지자체'})",
        description="\n".join(lines) or None,
        lat=_float(row.get("LATITUDE")),
        lng=_float(row.get("LONGITUDE")),
        link=homepage or None,
        price=museum_price(row),
    )


def parse_heritage_list(xml: str) -> list[dict[str, str]]:
    root = ElementTree.fromstring(xml)
    out = []
    for item in root.iter("item"):
        row = {child.tag: (child.text or "").strip() for child in item}
        if row.get("ccbaCncl") == "Y":  # 지정 해제
            continue
        out.append(row)
    return out


def parse_heritage_detail(xml: str) -> dict[str, str]:
    root = ElementTree.fromstring(xml)
    item = root.find("item")
    if item is None:
        return {}
    get = lambda tag: (item.findtext(tag) or "").strip()  # noqa: E731
    content = re.sub(r"<[^>]+>", " ", get("content"))
    content = re.sub(r"※\s*\(.*?\)\s*으로\s*명칭변경.*$", "", content).strip()
    img = (root.findtext("imageUrl") or item.findtext("imageUrl") or "").strip()
    return {
        "address": get("ccbaLcad"),
        "content": re.sub(r"\s+", " ", content)[:700],
        "image": img.replace("http://", "https://", 1),
        "era": get("ccceName"),
    }


def heritage_to_raw(row: dict[str, str], detail: dict[str, str], *, today: date) -> RawRecord | None:
    title = _clean(row.get("ccbaMnm1"))
    kind = _clean(row.get("ccmaName")) or "국가유산"
    address = _clean(detail.get("address")) or " ".join(
        x for x in (_clean(row.get("ccbaCtcdNm")), _clean(row.get("ccsiName"))) if x
    )
    if not title or not address:
        return None
    lat, lng = _float(row.get("latitude")), _float(row.get("longitude"))
    desc = detail.get("content") or None
    if desc and detail.get("era"):
        desc = f"{desc}\n시대 {detail['era']}"
    key = f"{row.get('ccbaKdcd')}-{row.get('ccbaAsno')}-{row.get('ccbaCtcd')}"
    return _record(
        sid=f"h-{key}",
        title=title,
        address=address,
        today=today,
        kind=kind,
        provider=f"국가유산청 국가유산 ({kind})",
        description=desc,
        lat=lat,
        lng=lng,
        link=(
            f"{KHS_VIEW}?ccbaKdcd={row.get('ccbaKdcd')}&ccbaAsno={row.get('ccbaAsno')}"
            f"&ccbaCtcd={row.get('ccbaCtcd')}"
        ),
        thumb=detail.get("image") or None,
    )


def drop_known(records: list[RawRecord], known_titles: list[str]) -> list[RawRecord]:
    """이미 다른 출처로 들어 있는 곳(예: '국립전주박물관 상설전시')은 빼서 같은 곳이 두 번 나오지 않게."""
    known = [_squash(t) for t in known_titles if t]
    out = []
    for r in records:
        name = _squash(r.facts["title"])
        if len(name) >= 4 and any(name in k for k in known):
            continue
        out.append(r)
    return out


class AttractionCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        cache_path: Path | None = None,
        known_titles: list[str] | None = None,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=60.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots
        self.cache_path = cache_path
        self.known_titles = known_titles or []

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> AttractionCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _standard(self, today: date) -> list[RawRecord]:
        std = PublicDataCollector(self.client, check_robots=self.check_robots)
        std.throttle = self.throttle
        out: list[RawRecord] = []
        for pk, convert in (("15021141", tour_row_to_raw), ("15017323", museum_row_to_raw)):
            try:
                rows = std._rows(pk)
            except (httpx.HTTPError, KeyError, ValueError) as err:
                logger.warning("attraction dataset %s failed: %s", pk, err)
                continue
            found = [r for r in (convert(row, today=today) for row in rows) if r]
            logger.info("attraction dataset %s: rows %s → %s", pk, len(rows), len(found))
            out.extend(found)
        return out

    def _heritage(self, today: date) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(KHS_LIST):
            logger.warning("robots.txt disallows %s", KHS_LIST)
            return []
        cache: dict[str, dict[str, str]] = {}
        if self.cache_path and self.cache_path.exists():
            try:
                cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                cache = {}
        rows: list[dict[str, str]] = []
        for kd in HERITAGE_KINDS:
            for page in range(1, 20):
                self.throttle.wait()
                resp = self.client.get(KHS_LIST, params={"ccbaKdcd": kd, "pageUnit": "100", "pageIndex": str(page)})
                resp.raise_for_status()
                batch = parse_heritage_list(resp.text)
                rows.extend(batch)
                if len(batch) < 100:
                    break
        fetched = 0
        out: list[RawRecord] = []
        stale = (today - timedelta(days=DETAIL_TTL_DAYS)).isoformat()
        for row in rows:
            key = f"{row.get('ccbaKdcd')}-{row.get('ccbaAsno')}-{row.get('ccbaCtcd')}"
            detail = cache.get(key)
            if (detail is None or detail.get("fetched", "") < stale) and fetched < MAX_DETAILS_PER_RUN:
                try:
                    self.throttle.wait()
                    resp = self.client.get(
                        KHS_DETAIL,
                        params={k: row.get(k, "") for k in ("ccbaKdcd", "ccbaAsno", "ccbaCtcd")},
                    )
                    resp.raise_for_status()
                    detail = {**parse_heritage_detail(resp.text), "fetched": today.isoformat()}
                    cache[key] = detail
                    fetched += 1
                except (httpx.HTTPError, ElementTree.ParseError) as err:
                    logger.debug("heritage detail %s failed: %s", key, err)
            rec = heritage_to_raw(row, detail or {}, today=today)
            if rec:
                out.append(rec)
        if self.cache_path and fetched:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
        logger.info("heritage: listed %s, details fetched %s (cached %s)", len(rows), fetched, len(cache))
        return out

    def collect(self, *, today: date | None = None) -> list[RawRecord]:
        ref = today or today_kst()
        records = self._standard(ref)
        try:
            records.extend(self._heritage(ref))
        except (httpx.HTTPError, ElementTree.ParseError) as err:
            logger.warning("heritage list failed: %s", err)
        # 같은 곳이 관광지·박물관 목록에 함께 있으면 하나만
        seen: set[str] = set()
        unique = []
        for r in records:
            key = _squash(r.facts["title"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
        result = drop_known(unique, self.known_titles)
        if not result:
            raise RuntimeError("no attractions collected — data formats may have changed")
        logger.info("attractions: %s (dropped %s already listed)", len(result), len(unique) - len(result))
        return result
