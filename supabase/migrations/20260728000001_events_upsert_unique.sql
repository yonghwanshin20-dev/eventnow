-- Upsert key: PRD §3.2 — unique on (title, start_date)
-- Supabase service_role key bypasses RLS for pipeline writes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_title_start_date
  ON events (title, start_date);
