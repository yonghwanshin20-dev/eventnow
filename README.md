# EventNow

패밀리 & 핫플레이스 이벤트 큐레이션 플랫폼 보일러플레이트입니다.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (PostgreSQL)

## Getting started

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 설정

npm install
npm run dev
```

## Database

PRD §4 스키마 마이그레이션:

```text
supabase/migrations/20260728000000_create_events.sql
```

Supabase CLI 예시:

```bash
supabase db push
```

## Test

```bash
npm test               # vitest — src/lib/*.test.ts
cd python && python -m pytest -q
```

## Types

- `src/types/event.ts` — Event, EventInsert, EventUpdate, EventFilters
- `src/types/database.ts` — Supabase `Database` 타이핑
- `src/lib/supabase/` — browser / server 클라이언트

## Python pipeline

**API 키·비용 없이**: 대한민국 구석구석 축제 달력 + 문화포털 전시·아동·체험 + 팝플리 팝업스토어(브라우저 없이 HTML만 읽음) → 규칙 기반 정제 → `src/data/events.json`.
GitHub Actions가 매일 새벽 4시에 수집·커밋하고 Vercel이 자동 재배포합니다.
사이트의 **[최신 정보 가져오기]** 버튼으로 즉시 실행할 수도 있습니다 (GitHub 토큰 설정 시). 자세한 내용은 [`DEPLOY.md`](./DEPLOY.md).

```bash
cd python
python -m venv .venv
.\.venv\Scripts\activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# TOUR_API_SERVICE_KEY / ANTHROPIC_API_KEY / SUPABASE_* 설정

python run.py --sources tour,popup
python run.py --sources tour --area-code 1 --dry-run
python scripts/seed_events_json.py   # 기존 events.json 시드
```

마이그레이션 `20260728000001_events_upsert_unique.sql` 적용 후 `(title, start_date)` Upsert가 동작합니다.

## 배포 · 매일 자동 갱신

자세한 절차는 [`DEPLOY.md`](./DEPLOY.md) 참고.

- **프론트:** Vercel (Supabase 조회 + ISR `revalidate=3600` + `/api/revalidate`)
- **수집:** GitHub Actions `Daily Crawler` — **매일 KST 04:00**
- **저장:** Supabase `events` Upsert