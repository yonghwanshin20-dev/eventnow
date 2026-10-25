-- EventNow: events table (PRD §4)
-- Family & trend event curation platform

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('popup', 'exhibition', 'festival', 'kids_experience')),
  description TEXT,

  -- 일정 관련
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CONSTRAINT events_date_range_check CHECK (end_date >= start_date),

  -- 위치 관련
  location_name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  -- 아이/가족 동반 관련 특화 필드
  is_family_friendly BOOLEAN DEFAULT false,
  target_age_group VARCHAR(50)
    CHECK (target_age_group IS NULL OR target_age_group IN ('all', 'toddler', 'kids', 'elementary')),
  amenities JSONB DEFAULT '{"parking": false, "stroller": false, "nursing_room": false}'::jsonb,

  -- 예약 및 링크
  booking_required BOOLEAN DEFAULT false,
  price_info VARCHAR(100),
  thumbnail_url TEXT,
  official_link TEXT,

  -- 메타 태그 및 상태
  tags TEXT[],
  status VARCHAR(20) DEFAULT 'ongoing'
    CHECK (status IN ('upcoming', 'ongoing', 'ended')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_family ON events(is_family_friendly);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN (tags);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION set_events_updated_at();

-- Public read access for curated event listings (Phase 1)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on events"
  ON events
  FOR SELECT
  TO anon, authenticated
  USING (true);
