"""git 저장소의 JSON 파일을 DB처럼 쓰는 저장소 — Supabase 없이 무료로 운영.

GitHub Actions가 매일 이 파일을 갱신·커밋하면 Vercel이 push를 받아 자동 재배포한다.

병합 규칙
- (source, source_id) 또는 dedupe_key 가 같은 행은 같은 행사로 보고 id·created_at 유지
- 내용이 바뀐 경우에만 updated_at 갱신 (불필요한 diff 방지)
- 이번 수집에 안 보인 행은 지우지 않는다 → 수집기가 고장 나도 데이터가 사라지지 않음
- 종료 후 retention_days 가 지난 행만 정리
- 결과가 이전의 절반 미만이면 쓰지 않고 실패 (버그로 데이터 날리는 것 방지)
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from models import NormalizedEvent, dedupe_key
from regions import detect_district
from timeutil import now_utc, status_for, today_kst

logger = logging.getLogger(__name__)

# 내용 비교에서 빼는 필드 (매일 바뀌거나 메타)
_VOLATILE = {"status", "updated_at", "created_at", "last_seen_at", "content_hash"}

# 공식 출처 — 같은 행사가 큐레이션 데이터와 겹치면 이쪽을 남긴다.
# 공식 출처끼리 겹치면 숫자가 작은 쪽을 남긴다 (축제는 축제 달력 정보가 가장 풍부).
# 같은 행사가 여러 출처에 있으면 앞 순서(정보가 자세한 쪽)를 남긴다
OFFICIAL_PRIORITY = {
    "kfes": 0,
    "tour_api": 1,
    "seoul_api": 2,
    "culture_portal": 3,
    "seoul_portal": 4,
    "mcst_festival": 5,
    "city_calendar": 6,
    "public_data": 7,
    "venue_fair": 8,
    "attraction": 9,
}
OFFICIAL_SOURCES = set(OFFICIAL_PRIORITY)
# 같은 행사로 볼 시작일 차이 (회차가 다른 작년 행사와는 구분)
SAME_EVENT_DAYS = 60
# 전체 목록 수집에서 이 비율 미만만 다시 보이면 사라진 행을 빼지 않는다 (수집 고장 방지)
WITHDRAW_MIN_RATIO = 0.8

# 앞쪽 연도·회차, 그리고 '[서대문구]', '[마포문화재단]' 같은 올린 곳 꼬리표는 같은 행사 판단에서 뺀다
_EDITION_PREFIX = re.compile(r"^\s*(?:20\d\d\s*년?|제\s*\d+\s*회|\d+\s*회|[\[【][^\]】]{1,20}[\]】])\s*")
_NON_WORD = re.compile(r"[^0-9a-z가-힣]")


def loose_title(title: str) -> str:
    """'2026 제5회 황매산 억새축제' → '황매산억새축제' (연도·회차·공백·기호 무시)."""
    t = title.strip().lower()
    while True:
        stripped = _EDITION_PREFIX.sub("", t, count=1)
        if stripped == t:
            break
        t = stripped
    return _NON_WORD.sub("", t)


# 같은 행사의 회차·시즌·방 표시 — '(1회)', '(2회차)', '(3월~10월)'
_SHOWING = re.compile(r"\(\s*(?:\d+\s*회차?|\d{1,2}\s*월\s*[~\-]\s*\d{1,2}\s*월)\s*\)")
_PAREN = re.compile(r"\([^)]*\)")


def twin_title(row: dict[str, Any]) -> str:
    """겹침 판단용 제목. 장소(관광지)는 괄호 속 별칭·관 이름까지 뺀다 — '서울 한양도성(서울성곽)' → '서울한양도성'."""
    title = str(row.get("title") or "")
    title = _PAREN.sub("", title) if row.get("category") == "attraction" else _SHOWING.sub("", title)
    return loose_title(title)


def _km(a: dict[str, Any], b: dict[str, Any]) -> float | None:
    try:
        la, lo, lb, lob = (float(a["latitude"]), float(a["longitude"]), float(b["latitude"]), float(b["longitude"]))
    except (KeyError, TypeError, ValueError):
        return None
    p = math.pi / 180
    h = math.sin((lb - la) * p / 2) ** 2 + math.cos(la * p) * math.cos(lb * p) * math.sin((lob - lo) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def _same_spot(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """같은 곳인지 — 좌표가 둘 다 있으면 300m(장소는 500m) 안, 없으면 장소 이름이나 주소가 같을 때."""
    km = _km(a, b)
    if km is not None:
        return km <= (0.5 if a.get("category") == "attraction" else 0.3)
    loc = lambda r: _NON_WORD.sub("", str(r.get("location_name") or "").lower())  # noqa: E731
    return bool(loc(a)) and loc(a) == loc(b) or bool(a.get("address")) and a.get("address") == b.get("address")


def _keeper_rank(row: dict[str, Any]) -> tuple:
    return (
        OFFICIAL_PRIORITY.get(str(row.get("source")), len(OFFICIAL_PRIORITY)),
        0 if row.get("thumbnail_url") else 1,
        "(" in str(row.get("title") or ""),
        -len(str(row.get("description") or "")),
        str(row.get("id")),
    )


def merge_twins(rows: list[dict[str, Any]]) -> int:
    """같은 행사·장소가 두 번 이상 들어온 것을 하나로 (제자리에서 고친다, 지운 개수를 돌려준다).

    - 회차·방이 나뉘어 올라온 행사 ('충북예술제' 대공연장·소공연장, '서커스 (1회)·(2회)')
    - 같은 출처가 다른 분류로 두 번 올린 것 ('종로 가족공연축제' 축제·키즈 체험)
    - 관광지의 시즌·별칭 ('서대문형무소역사관(3월~10월)'·'(11월~2월)')
    제목이 같아도 다른 곳(성수·롯데월드몰 팝업)이나 날짜가 겹치지 않는 회차는 그대로 둔다.
    """
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        key = twin_title(r)
        if len(key) >= 2:
            groups.setdefault((str(r.get("region") or ""), key), []).append(r)
    drop: set[int] = set()
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=_keeper_rank)
        for i, keep in enumerate(members):
            if id(keep) in drop:
                continue
            for other in members[i + 1 :]:
                if id(other) in drop:
                    continue
                if not _overlap(keep.get("start_date"), keep.get("end_date"), other.get("start_date"), other.get("end_date")):
                    continue
                if not _same_spot(keep, other):
                    continue
                if keep.get("category") != "attraction":
                    # 회차를 합치면 기간은 처음~끝으로
                    keep["start_date"] = min(str(keep["start_date"]), str(other["start_date"]))
                    keep["end_date"] = max(str(keep["end_date"]), str(other["end_date"]))
                for k in ("thumbnail_url", "description", "latitude", "longitude", "official_link"):
                    if not keep.get(k) and other.get(k):
                        keep[k] = other[k]
                drop.add(id(other))
    if drop:
        rows[:] = [r for r in rows if id(r) not in drop]
    return len(drop)


@dataclass
class MergeStats:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    corrected: int = 0
    deduplicated: int = 0
    withdrawn: int = 0
    pruned: int = 0
    total: int = 0
    by_source: dict[str, int] = field(default_factory=dict)


class UnsafeWriteError(RuntimeError):
    pass


def make_id(source: str | None, source_id: str | None, key: str) -> str:
    basis = f"{source}:{source_id}" if source and source_id else key
    return "evt-" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]


def ensure_unique_ids(rows: list[dict[str, Any]]) -> int:
    """행 id가 겹치면(서로 다른 행사인데 같은 주소) 고친다. 고친 수를 돌려준다.

    예전에 '같은 제목' 행사(《…Ⅳ》·《…Ⅴ》)가 한 행으로 합쳐지며 출처 번호가 바뀐 뒤, 원래 행사가
    다시 들어오면 그 출처 번호로 만든 id가 이미 다른 행에 쓰이고 있어 겹쳤다. 링크·찜이 엉키므로
    id의 원래 주인(출처 번호로 만든 id가 같은 행)이 id를 갖고, 나머지는 자기 출처 번호로 새 id를 받는다.
    """
    by_id: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_id.setdefault(str(row.get("id")), []).append(row)
    taken = set(by_id)
    fixed = 0
    for rid, group in by_id.items():
        if len(group) < 2:
            continue
        owner = next(
            (r for r in group if make_id(r.get("source"), r.get("source_id"), "") == rid),
            group[0],
        )
        for row in group:
            if row is owner:
                continue
            basis_id = make_id(row.get("source"), row.get("source_id"), f"{rid}:{row.get('title')}")
            new_id, n = basis_id, 1
            while new_id in taken:
                n += 1
                new_id = make_id(None, None, f"{basis_id}#{n}")
            row["id"] = new_id
            taken.add(new_id)
            fixed += 1
            logger.warning("duplicate id %s → %s (%s)", rid, new_id, row.get("title"))
    return fixed


def event_to_row(ev: NormalizedEvent) -> dict[str, Any]:
    """프론트 Event 타입과 같은 모양."""
    return {
        "title": ev.title,
        "category": ev.category.value,
        "description": ev.description,
        "start_date": ev.start_date.isoformat(),
        "end_date": ev.end_date.isoformat(),
        "location_name": ev.location_name,
        "address": ev.address,
        "latitude": ev.latitude,
        "longitude": ev.longitude,
        "region": ev.region,
        "district": ev.district,
        "is_family_friendly": ev.is_family_friendly,
        "target_age_group": ev.target_age_group.value if ev.target_age_group else None,
        "age_min": ev.age_min,
        "age_max": ev.age_max,
        "amenities": ev.amenities.model_dump(),
        "booking_required": ev.booking_required,
        "price_info": ev.price_info,
        "thumbnail_url": ev.thumbnail_url,
        "official_link": ev.official_link,
        "tags": ev.tags,
        "place_types": ev.place_types,
        "status": ev.status.value,
        "source": ev.source,
        "source_id": ev.source_id,
        "content_hash": ev.content_hash,
    }


def _row_key(row: dict[str, Any]) -> str:
    try:
        start = date.fromisoformat(str(row["start_date"])[:10])
    except (KeyError, ValueError):
        return ""
    return dedupe_key(str(row.get("title") or ""), start)


def _near(a: Any, b: date | str | None, days: int = SAME_EVENT_DAYS) -> bool:
    try:
        da = date.fromisoformat(str(a)[:10])
        db = b if isinstance(b, date) else date.fromisoformat(str(b)[:10])
    except (TypeError, ValueError):
        return False
    return abs((da - db).days) <= days


def _overlap(a_start: Any, a_end: Any, b_start: Any, b_end: Any) -> bool:
    try:
        return str(a_start)[:10] <= str(b_end)[:10] and str(b_start)[:10] <= str(a_end)[:10]
    except TypeError:
        return False


# 긴 제목에 이런 말이 붙어 있으면 '같은 행사'가 아니라 딸린 행사(연계·부대 프로그램 등)로 본다
_SUB_EVENT = re.compile(r"연계|부대|파빌리온|프로그램|체험|교육|강좌|워크숍|특강|투어")
# 포함 관계로 같다고 볼 때 시작·종료일 허용 차이
CONTAIN_DAYS = 7


def _long_running(row: dict[str, Any]) -> bool:
    """큐레이션한 상설 장소(반년 이상·장소 유형 있음) — 단기 행사가 덮어쓰면 안 된다."""
    try:
        days = (date.fromisoformat(str(row["end_date"])[:10]) - date.fromisoformat(str(row["start_date"])[:10])).days
    except (KeyError, ValueError):
        return False
    return days >= 180 or bool(row.get("place_types"))


def same_event(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """제목(연도·회차·기호 무시)과 날짜로 같은 행사인지.

    - 제목이 같으면 시작일 60일 이내 (작년 회차와 구분)
    - 한쪽 제목이 다른 쪽에 포함되면(6자 이상) 시작·종료일이 모두 7일 이내이고,
      긴 쪽에 '연계·파빌리온·프로그램' 같은 딸린 행사 표시가 없을 때만
      예: '유영국: 산은 내 안에 있다' ⊂ '2026년 한국 근대 거장전 《유영국: 산은 내 안에 있다》'
      아님: '광주비엔날레' ⊂ '광주비엔날레 캐나다 파빌리온'
    """
    la, lb = loose_title(str(a.get("title") or "")), loose_title(str(b.get("title") or ""))
    if not la or not lb:
        return False
    if la == lb:
        return _near(a.get("start_date"), b.get("start_date"))
    (short, short_row), (long_, long_row) = sorted(((la, a), (lb, b)), key=lambda x: len(x[0]))
    if len(short) < 6 or short not in long_:
        return False
    extra = long_.replace(short, "", 1)
    if _SUB_EVENT.search(extra):
        return False
    return _near(a.get("start_date"), b.get("start_date"), CONTAIN_DAYS) and _near(
        a.get("end_date"), b.get("end_date"), CONTAIN_DAYS
    )


def _comparable(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in _VOLATILE}


class JsonEventStore:
    def __init__(
        self,
        path: Path,
        meta_path: Path,
        *,
        retention_days: int = 60,
        min_keep_ratio: float = 0.5,
    ) -> None:
        self.path = path
        self.meta_path = meta_path
        self.retention_days = retention_days
        self.min_keep_ratio = min_keep_ratio

    def load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return json.loads(self.path.read_text(encoding="utf-8"))

    def existing_hashes(self, source: str, source_ids: list[str]) -> dict[str, str]:
        wanted = set(source_ids)
        return {
            str(r["source_id"]): str(r.get("content_hash") or "")
            for r in self.load()
            if r.get("source") == source and r.get("source_id") in wanted
        }

    def merge(
        self,
        events: list[NormalizedEvent],
        *,
        corrections: list[NormalizedEvent] | None = None,
        seen: dict[str, set[str]] | None = None,
        today: date | None = None,
    ) -> tuple[list[dict[str, Any]], MergeStats]:
        """events는 추가·갱신, corrections(이미 끝난 공식 행사)는 기존 행 갱신만.

        seen: 이번에 '전체 목록'을 끝까지 받은 출처 → 받은 source_id 들.
        그 출처의 진행·예정 행 중 목록에서 사라진 것(취소·필터 제외)은 뺀다.
        단, 받은 수가 기존의 80% 미만이면(수집 고장 의심) 아무것도 빼지 않는다.
        """
        ref = today or today_kst()
        now = now_utc().isoformat()
        rows = self.load()
        stats = MergeStats()

        def find(ev: NormalizedEvent) -> int | None:
            # 1) 같은 출처 ID  2) 정확한 제목+시작일  3) 연도·회차 뗀 제목 + 시작일 60일 이내
            for i, r in enumerate(rows):
                if ev.source and ev.source_id and (r.get("source"), r.get("source_id")) == (
                    ev.source,
                    ev.source_id,
                ):
                    return i
            key = ev.dedupe_key
            for i, r in enumerate(rows):
                if _row_key(r) != key:
                    continue
                # 출처 ID가 다른 행은 다른 행사 (같은 제목·시작일의 두 장소 등)
                if r.get("source_id") and ev.source_id and (r.get("source"), r.get("source_id")) != (
                    ev.source,
                    ev.source_id,
                ):
                    continue
                return i
            probe = {
                "title": ev.title,
                "start_date": ev.start_date.isoformat(),
                "end_date": ev.end_date.isoformat(),
            }
            for i, r in enumerate(rows):
                # 다른 공식 출처의 행과는 합치지 않는다 (각자 출처 ID로 관리)
                if r.get("source") in OFFICIAL_SOURCES and r.get("source") != ev.source:
                    continue
                if r.get("source_id") and ev.source_id and r.get("source_id") != ev.source_id:
                    continue
                if _long_running(r) and loose_title(str(r.get("title") or "")) != loose_title(ev.title):
                    continue
                if same_event(r, probe):
                    return i
            return None

        originals = {id(r): dict(r) for r in rows}

        def apply(idx: int, ev: NormalizedEvent) -> bool:
            old = rows[idx]
            new = event_to_row(ev)
            merged = {**old, **{k: v for k, v in new.items() if v is not None or k not in old}}
            # 사람이 큐레이션한 썸네일·좌표는 수집값이 비어 있으면 유지
            for keep in ("thumbnail_url", "latitude", "longitude", "official_link"):
                if new.get(keep) in (None, "") and old.get(keep) not in (None, ""):
                    merged[keep] = old[keep]
            # 빈 목록·False 가 기존 태그·장소 유형·아이 동반 정보를 지우지 않게
            for keep in ("tags", "place_types"):
                if not new.get(keep) and old.get(keep):
                    merged[keep] = old[keep]
            for flag in ("is_family_friendly", "booking_required"):
                merged[flag] = bool(old.get(flag)) or bool(new.get(flag))
            # 같은 출처·같은 ID가 다시 보내 준 값은 그 출처의 최신 상태다 — 원문에서 요금·예약 안내가
            # 사라졌으면 여기서도 지운다 (다른 출처·큐레이션 행을 덮을 때는 위 규칙대로 유지)
            if ev.source_id and (old.get("source"), old.get("source_id")) == (ev.source, ev.source_id):
                merged["price_info"] = new.get("price_info")
                merged["booking_required"] = bool(new.get("booking_required"))
            # 지역이 바뀌면 옛 지역의 구·군은 버린다
            if new.get("region") and new.get("region") != old.get("region"):
                merged["district"] = new.get("district")
            # 구·시가 바뀌면 예전 동도 맞지 않으므로 지운다 (다음 실행에서 다시 채운다)
            if merged.get("district") != old.get("district"):
                merged.pop("dong", None)
            # 이번 실행 시작 때와 비교해 정말 바뀐 경우에만 갱신 시각을 바꾼다
            base = originals.get(id(old), old)
            changed = _comparable(merged) != _comparable(base)
            merged["updated_at"] = now if changed else base.get("updated_at", now)
            originals[id(merged)] = base
            rows[idx] = merged
            return changed

        for ev in events:
            idx = find(ev)
            if idx is None:
                new = event_to_row(ev)
                new["id"] = make_id(ev.source, ev.source_id, ev.dedupe_key)
                new["created_at"] = now
                new["updated_at"] = now
                rows.append(new)
                stats.inserted += 1
            elif apply(idx, ev):
                stats.updated += 1
            else:
                stats.unchanged += 1

        for ev in corrections or []:
            idx = find(ev)
            if idx is not None and apply(idx, ev):
                stats.corrected += 1

        # 공식 출처 행과 겹치는 큐레이션 행은 정리 (같은 축제가 두 번 보이지 않게)
        # 공식 출처끼리 겹치면(축제 달력 ↔ 문화포털) 먼저 들어온 출처 순서(OFFICIAL_PRIORITY)를 남긴다
        official = [r for r in rows if r.get("source") in OFFICIAL_SOURCES]
        deduped: list[dict[str, Any]] = []
        for r in rows:
            src = r.get("source")
            rank = OFFICIAL_PRIORITY.get(src, len(OFFICIAL_PRIORITY))
            if any(
                o is not r
                and OFFICIAL_PRIORITY[o["source"]] < rank
                and same_event(r, o)
                and not (
                    src not in OFFICIAL_SOURCES
                    and _long_running(r)
                    and loose_title(str(r.get("title") or "")) != loose_title(str(o.get("title") or ""))
                )
                for o in official
            ):
                stats.deduplicated += 1
                continue
            deduped.append(r)

        for source, ids in (seen or {}).items():
            active = [
                r
                for r in deduped
                if r.get("source") == source and str(r.get("end_date") or "")[:10] >= ref.isoformat()
            ]
            still = [r for r in active if str(r.get("source_id")) in ids]
            if active and len(still) < len(active) * WITHDRAW_MIN_RATIO:
                logger.warning(
                    "%s: only %s/%s rows still listed — skip removing (collector may be broken)",
                    source,
                    len(still),
                    len(active),
                )
                continue
            gone = {id(r) for r in active if str(r.get("source_id")) not in ids}
            if gone:
                stats.withdrawn += len(gone)
                deduped = [r for r in deduped if id(r) not in gone]

        cutoff = (ref - timedelta(days=self.retention_days)).isoformat()
        kept: list[dict[str, Any]] = []
        for row in deduped:
            if str(row.get("end_date") or "9999")[:10] < cutoff:
                stats.pruned += 1
                continue
            row["status"] = status_for(
                date.fromisoformat(str(row["start_date"])[:10]),
                date.fromisoformat(str(row["end_date"])[:10]),
                ref,
            )
            # 구·시·군이 비어 있으면 주소로 채운다 (직접 넣은 행은 정제를 다시 거치지 않아 비어 있는 경우가 많다)
            if not row.get("district") and row.get("region"):
                row["district"] = detect_district(str(row["region"]), str(row.get("address") or ""))
            kept.append(row)

        stats.deduplicated += merge_twins(kept)
        ensure_unique_ids(kept)
        kept.sort(key=lambda r: (str(r.get("start_date")), str(r.get("id"))))
        stats.total = len(kept)
        for row in kept:
            src = str(row.get("source") or "curated")
            stats.by_source[src] = stats.by_source.get(src, 0) + 1
        return kept, stats

    def save(
        self,
        events: list[NormalizedEvent],
        *,
        summary: dict[str, Any],
        corrections: list[NormalizedEvent] | None = None,
        seen: dict[str, set[str]] | None = None,
        today: date | None = None,
    ) -> MergeStats:
        before = len(self.load())
        rows, stats = self.merge(events, corrections=corrections, seen=seen, today=today)
        if before and len(rows) < before * self.min_keep_ratio:
            raise UnsafeWriteError(
                f"refusing to shrink {self.path.name} from {before} to {len(rows)} rows"
            )
        _atomic_write(self.path, rows)
        _atomic_write(
            self.meta_path,
            {
                "generated_at": now_utc().isoformat(),
                "total": stats.total,
                "by_source": dict(sorted(stats.by_source.items())),
                "run": {
                    "status": summary.get("status"),
                    "sources": summary.get("sources"),
                    "inserted": stats.inserted,
                    "updated": stats.updated,
                    "corrected": stats.corrected,
                    "deduplicated": stats.deduplicated,
                    "withdrawn": stats.withdrawn,
                    "pruned": stats.pruned,
                    "rejected": summary.get("rejected"),
                    "source_errors": summary.get("details", {}).get("source_errors"),
                },
            },
        )
        logger.info(
            "JSON store: +%s ~%s =%s fixed=%s dedup=%s -%s → %s rows",
            stats.inserted,
            stats.updated,
            stats.unchanged,
            stats.corrected,
            stats.deduplicated,
            stats.pruned,
            stats.total,
        )
        return stats


def fill_coordinates(store: JsonEventStore, geocoder: Any, *, today: date | None = None) -> dict[str, int]:
    """저장된 행 중 좌표 없는 진행·예정 행을 지오코더로 채워 다시 쓴다."""
    from geocode_osm import backfill_coordinates

    rows = store.load()
    stats = backfill_coordinates(rows, geocoder, today=(today or today_kst()).isoformat())
    if stats["filled"]:
        _atomic_write(store.path, rows)
    return stats


def fill_dong(store: JsonEventStore, reverser: Any, *, today: date | None = None) -> dict[str, int]:
    """진행·예정 행의 동(dong)을 채운다 (주소 글자 → 좌표 역지오코딩)."""
    from geocode_osm import backfill_dong

    rows = store.load()
    stats = backfill_dong(rows, reverser, today=(today or today_kst()).isoformat())
    if stats["from_address"] or stats["from_osm"]:
        _atomic_write(store.path, rows)
    return stats


def _atomic_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
