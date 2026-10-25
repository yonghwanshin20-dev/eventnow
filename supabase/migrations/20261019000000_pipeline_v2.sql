-- Pipeline v2: 출처 추적·변경 감지·정규화 중복 키·KST 상태 갱신·실행 기록

-- 1) 출처/변경 감지 컬럼
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS legacy_id TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 2) 정규화 제목 + 시작일 중복 키 (python/models.py dedupe_key 와 동일 규칙)
UPDATE events
SET dedupe_key = regexp_replace(lower(title), '[^0-9a-z가-힣]', '', 'g') || '|' || start_date::text
WHERE dedupe_key IS NULL;

-- 같은 키가 여러 행이면 가장 최근에 갱신된 행만 남긴다
DELETE FROM events e
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY dedupe_key
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
         ) AS rn
  FROM events
) d
WHERE e.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_dedupe_key ON events (dedupe_key);
DROP INDEX IF EXISTS uq_events_title_start_date;
ALTER TABLE events ALTER COLUMN dedupe_key SET NOT NULL;

-- 옛 정적 JSON ID(evt-xxxx) → 새 UUID 매핑용 (NULL 허용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_legacy_id ON events (legacy_id);
CREATE INDEX IF NOT EXISTS idx_events_source ON events (source, source_id);

-- 3) 상태 갱신을 KST 날짜 기준으로 (Supabase CURRENT_DATE 는 UTC)
CREATE OR REPLACE FUNCTION refresh_event_statuses()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
  today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  UPDATE events
  SET
    status = CASE
      WHEN end_date < today_kst THEN 'ended'
      WHEN start_date > today_kst THEN 'upcoming'
      ELSE 'ongoing'
    END,
    updated_at = CURRENT_TIMESTAMP
  WHERE status IS DISTINCT FROM CASE
    WHEN end_date < today_kst THEN 'ended'
    WHEN start_date > today_kst THEN 'upcoming'
    ELSE 'ongoing'
  END;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- 공개 키로 호출하지 못하게 (service_role 전용)
REVOKE EXECUTE ON FUNCTION refresh_event_statuses() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_event_statuses() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_event_statuses() TO service_role;

-- 4) 파이프라인 실행 기록
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  sources TEXT[],
  raw_count INTEGER DEFAULT 0,
  skipped_unchanged INTEGER DEFAULT 0,
  parsed_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  failed_batches INTEGER DEFAULT 0,
  upserted INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  error TEXT,
  details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs (started_at DESC);

-- RLS 활성화 + 공개 정책 없음 → service_role 만 접근
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
