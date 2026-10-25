"""events.json 의 세부 대상 나이(age_min·age_max)를 비어 있는 행에 채운다.

수집기로 들어오는 행사는 정제 때 채워지지만, 직접 넣어 둔 행사(curated)는 다시 정제되지 않아
제목·설명에서 같은 규칙(extract_age_range)으로 한 번 채운다. 이미 값이 있는 행은 건드리지 않는다.

    python scripts/backfill_age.py            # 미리보기
    python scripts/backfill_age.py --apply    # 저장
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings  # noqa: E402
from parsers.rule_parser import extract_age_range  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    path = Path(settings.events_json_path)
    rows = json.loads(path.read_text(encoding="utf-8"))
    filled = 0
    for row in rows:
        if row.get("age_min") is not None or row.get("age_max") is not None:
            continue
        text = "\n".join(str(v) for v in (row.get("title"), (row.get("description") or "")[:300]) if v)
        lo, hi = extract_age_range(text)
        if lo is None and hi is None:
            continue
        filled += 1
        print(f"{row['id']} {row['title'][:36]} → {lo}~{hi}")
        row["age_min"], row["age_max"] = lo, hi
    print(f"filled {filled} / {len(rows)}")
    if args.apply and filled:
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("saved", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
