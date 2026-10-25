"""공공데이터포털 표준데이터 — 전국 지자체·문화재단이 직접 등록한 축제·행사, API 키 불필요.

- 전국문화축제표준데이터 (15013104): 시·군·구 축제 (양천가족 거리축제, 성남 가을걷이 한마당 …)
- 전국공연행사정보표준데이터 (15013106): 구민회관·문화재단 행사·전시·공연

포털의 '파일 내려받기' 버튼이 쓰는 공개 JSON(/download/…)을 그대로 읽는다 — 로그인·키가 없다.
좌표·도로명 주소가 있어 지도·동 표시에 좋다. 공연은 가족 나들이 범위만 남긴다
(제목에 어린이·가족·키즈, 또는 '36개월 이상'처럼 아이 관람을 전제로 한 것).
robots.txt 는 /download 를 막지 않는다. 출처 표기: 공공데이터포털(각 제공기관).
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, timedelta
from typing import Any

import httpx

from collectors.polite import USER_AGENT, Throttle, robots_allowed
from models import RawRecord
from timeutil import now_utc, today_kst

logger = logging.getLogger(__name__)

SITE = "https://www.data.go.kr"
HEADER_URL = f"{SITE}/download/columList.json"
DATA_URL = f"{SITE}/download/standard.json"
PER_PAGE = 10000
WINDOW_DAYS = 150
# 1년 내내 같은 이름으로 걸린 '문화가 있는 날' 같은 상시 프로그램은 날짜·장소가 막연하다
MAX_SPAN_DAYS = 120

DATASETS = {
    "festival": {"pk": "15013104", "title": "FSTVL_NM", "start": "FSTVL_START_DATE",
                 "end": "FSTVL_END_DATE", "content": "FSTVL_CO"},
    "event": {"pk": "15013106", "title": "EVENT_NM", "start": "EVENT_START_DATE",
              "end": "EVENT_END_DATE", "content": "EVENT_CO"},
}

_FESTIVAL = re.compile(r"축제|페스티벌|festival|문화제|한마당|축전|장터|마켓|플리마켓|불꽃|걷기대회|대제전|박람회|[가-힣]제$", re.I)
_EXHIBITION = re.compile(r"전시|특별전|기획전|展|사진전|미술관|박물관")
_KIDS = re.compile(r"어린이|키즈|kids|가족|그림책|유아|아이와|아이랑|꿈의\s?(?:극단|오케스트라|무용단|댄스)|소년소녀|인형극|동화")
# '0세 이상'은 '누구나'라는 뜻이라 아이 대상으로 보지 않는다
_KID_AGE = re.compile(r"(?<!\d)(?:12|18|24|36|48)\s?개월|(?<!\d)[2-4]\s?세\s?이상")
_ADULT = re.compile(r"^성인$|성인\s?(?:대상|only)|중학생|고등학생|(?<!\d)1[2-9]\s?세")
# 축제 같은 이름이지만 실은 일반 공연인 것 ('불꽃 밴드', '유재하 전야제')
_SHOW = re.compile(r"콘서트|연주회|밴드|리사이틀|공모사업|정기공연|전야제")


def _clean(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _date(v: Any) -> date | None:
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", _clean(v))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _float(v: Any) -> float | None:
    try:
        f = float(_clean(v))
    except ValueError:
        return None
    return f if f else None


def category_for(kind: str, title: str, content: str, age: str) -> str | None:
    """행사 종류. None 이면 가족 나들이 범위 밖(일반 공연 등)이라 버린다."""
    if kind == "festival":
        return "festival"
    if _ADULT.search(age):
        return None
    if _KIDS.search(title) or _KID_AGE.search(age):
        return "kids_experience"
    if _EXHIBITION.search(title) or "전시" in content:
        return "exhibition"
    if _FESTIVAL.search(title) and not (_SHOW.search(title) and not re.search(r"축제|페스티벌", title)):
        return "festival"
    return None


def row_to_raw(kind: str, row: dict[str, Any], *, today: date) -> RawRecord | None:
    spec = DATASETS[kind]
    title = _clean(row.get(spec["title"]))
    start, end = _date(row.get(spec["start"])), _date(row.get(spec["end"]))
    place = _clean(row.get("OPAR"))
    address = _clean(row.get("RDNMADR")) or _clean(row.get("LNMADR"))
    if not title or not start or not end or end < start or not address:
        return None
    if end < today or start > today + timedelta(days=WINDOW_DAYS):
        return None
    content = _clean(row.get(spec["content"]))
    age = _clean(row.get("ENTNC_AGE"))
    category = category_for(kind, title, content, age)
    if category is None:
        return None
    if (end - start).days > MAX_SPAN_DAYS and category != "exhibition":
        return None

    hours = None
    if row.get("EVENT_START_TIME"):
        hours = "~".join(t for t in (_clean(row.get("EVENT_START_TIME")), _clean(row.get("EVENT_END_TIME"))) if t)
    fee = _clean(row.get("ADMFEE")) or None
    if _clean(row.get("CHRGE_INFO")) == "무료":
        fee = "무료"
    host = _clean(row.get("MNNST_NM")) or _clean(row.get("AUSPC_INSTT_NM"))
    homepage = _clean(row.get("HOMEPAGE_URL"))
    homepage = homepage if re.match(r"https?://", homepage) else ""
    provider = _clean(row.get("INSTT_NM"))

    lines = [content if len(content) > 6 else ""]
    if hours:
        lines.append(f"운영 시간 {hours}")
    if host:
        lines.append(f"주관 {host}")
    description = "\n".join(x for x in lines if x)[:600] or None

    source_id = f"{kind[0]}-" + hashlib.sha1(f"{title}|{start}|{place}".encode()).hexdigest()[:12]
    raw = "\n".join(
        [
            f"[출처] 공공데이터포털 ({provider or '지자체'})",
            f"[제목] {title}",
            f"[기간] {start} ~ {end}",
            f"[장소] {place} ({address})",
            f"[대상] {age or '정보 없음'}",
            f"[요금] {fee or '정보 없음'}",
            "",
            "[본문]",
            content,
        ]
    )
    facts: dict[str, Any] = {
        "title": title,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "address": address,
        "location_name": place or address,
        "latitude": _float(row.get("LATITUDE")),
        "longitude": _float(row.get("LONGITUDE")),
        "official_link": homepage or None,
        "description": description,
        "price_info": fee,
        "age_info": age or None,
    }
    return RawRecord(
        source="public_data",
        source_id=source_id,
        collected_at=now_utc(),
        title_hint=title,
        url=homepage or None,
        raw_text=raw,
        meta={"category_hint": category, "provider": provider, "dataset": spec["pk"]},
        facts={k: v for k, v in facts.items() if v not in (None, "")},
    )


def merge_runs(records: list[RawRecord]) -> list[RawRecord]:
    """같은 공연이 날짜마다 따로 등록된 것(이은결 12/11·12/12·12/13)을 한 기간으로 합친다."""
    groups: dict[tuple[str, str], list[RawRecord]] = {}
    for r in records:
        groups.setdefault((r.facts["title"], r.facts.get("location_name", "")), []).append(r)
    out: list[RawRecord] = []
    for rows in groups.values():
        rows.sort(key=lambda r: r.facts["start_date"])
        current = rows[0]
        for nxt in rows[1:]:
            gap = date.fromisoformat(nxt.facts["start_date"]) - date.fromisoformat(current.facts["end_date"])
            if gap.days <= 7:
                if nxt.facts["end_date"] > current.facts["end_date"]:
                    current.facts["end_date"] = nxt.facts["end_date"]
                continue
            out.append(current)
            current = nxt
        out.append(current)
    return out


class PublicDataCollector:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        min_interval: float = 1.0,
        check_robots: bool = True,
    ) -> None:
        self._owns_client = client is None
        self.client = client or httpx.Client(
            timeout=90.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
        )
        self.throttle = Throttle(min_interval)
        self.check_robots = check_robots

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> PublicDataCollector:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _rows(self, pk: str) -> list[dict[str, Any]]:
        self.throttle.wait()
        header = self.client.get(HEADER_URL, params={"pk": pk, "ext": "JSON"})
        header.raise_for_status()
        h = header.json()
        table, total = h["tableVO"], int(h["totalCount"])
        rows: list[dict[str, Any]] = []
        page = 1
        while len(rows) < total and page <= 10:
            self.throttle.wait()
            resp = self.client.get(
                DATA_URL,
                params={
                    "publicDataPk": pk,
                    "colNmList": table["colNmList"],
                    "totalCount": total,
                    "svcTableNm": table["svcTableNm"],
                    "perPage": PER_PAGE,
                    "page": page,
                },
            )
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            rows.extend(batch)
            page += 1
        return rows

    def collect(self, *, today: date | None = None) -> list[RawRecord]:
        if self.check_robots and not robots_allowed(DATA_URL):
            raise PermissionError(f"robots.txt disallows {DATA_URL}")
        ref = today or today_kst()
        records: list[RawRecord] = []
        for kind, spec in DATASETS.items():
            try:
                rows = self._rows(spec["pk"])
            except (httpx.HTTPError, KeyError, ValueError) as err:
                logger.warning("public data %s failed: %s", spec["pk"], err)
                continue
            found = [r for r in (row_to_raw(kind, row, today=ref) for row in rows) if r]
            merged = merge_runs(found)
            logger.info("public data %s: rows %s → kept %s (merged %s)", kind, len(rows), len(found), len(merged))
            records.extend(merged)
        if not records:
            raise RuntimeError("public data returned nothing — download format may have changed")
        return records
