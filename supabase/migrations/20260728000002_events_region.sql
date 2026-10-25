-- Add region (시·도) and Seoul district (구) for location filtering

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS region VARCHAR(50),
  ADD COLUMN IF NOT EXISTS district VARCHAR(50);

UPDATE events
SET region = CASE
  WHEN address LIKE '서울%' THEN '서울특별시'
  WHEN address LIKE '부산%' THEN '부산광역시'
  WHEN address LIKE '대구%' THEN '대구광역시'
  WHEN address LIKE '인천%' THEN '인천광역시'
  WHEN address LIKE '광주%' THEN '광주광역시'
  WHEN address LIKE '대전%' THEN '대전광역시'
  WHEN address LIKE '울산%' THEN '울산광역시'
  WHEN address LIKE '세종%' THEN '세종특별자치시'
  WHEN address LIKE '경기%' THEN '경기도'
  WHEN address LIKE '강원%' THEN '강원특별자치도'
  WHEN address LIKE '충북%' OR address LIKE '충청북%' THEN '충청북도'
  WHEN address LIKE '충남%' OR address LIKE '충청남%' THEN '충청남도'
  WHEN address LIKE '전북%' OR address LIKE '전라북%' THEN '전북특별자치도'
  WHEN address LIKE '전남%' OR address LIKE '전라남%' THEN '전라남도'
  WHEN address LIKE '경북%' OR address LIKE '경상북%' THEN '경상북도'
  WHEN address LIKE '경남%' OR address LIKE '경상남%' THEN '경상남도'
  WHEN address LIKE '제주%' THEN '제주특별자치도'
  ELSE '서울특별시'
END
WHERE region IS NULL;

ALTER TABLE events
  ALTER COLUMN region SET DEFAULT '서울특별시',
  ALTER COLUMN region SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_region ON events(region);
CREATE INDEX IF NOT EXISTS idx_events_district ON events(district);
