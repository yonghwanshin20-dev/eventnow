-- place_types for venue filters + status maintenance helper

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS place_types TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_events_place_types ON events USING GIN (place_types);

-- Keep status in sync with dates (callable from pipeline or SQL)
CREATE OR REPLACE FUNCTION refresh_event_statuses()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE events
  SET
    status = CASE
      WHEN end_date < CURRENT_DATE THEN 'ended'
      WHEN start_date > CURRENT_DATE THEN 'upcoming'
      ELSE 'ongoing'
    END,
    updated_at = CURRENT_TIMESTAMP
  WHERE status IS DISTINCT FROM CASE
    WHEN end_date < CURRENT_DATE THEN 'ended'
    WHEN start_date > CURRENT_DATE THEN 'upcoming'
    ELSE 'ongoing'
  END;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
