-- Fix Schema for Modern Accident Records
-- This adjusts field sizes to accommodate 2020-2025 data

-- Drop the view temporarily so we can alter the table
DROP VIEW IF EXISTS accidents_summary;

-- Increase precision for latitude/longitude (some modern records have high precision)
ALTER TABLE accidents 
  ALTER COLUMN latitude TYPE DECIMAL(12, 9),
  ALTER COLUMN longitude TYPE DECIMAL(12, 9);

-- Increase airport_id length (some newer airports have longer codes)
ALTER TABLE accidents 
  ALTER COLUMN airport_id TYPE VARCHAR(20);

-- Increase registration_number length (some international aircraft have longer numbers)
ALTER TABLE accidents 
  ALTER COLUMN registration_number TYPE VARCHAR(30);

-- Recreate the view with the updated schema
CREATE OR REPLACE VIEW accidents_summary AS
SELECT 
  id,
  ntsb_number,
  event_date,
  event_type,
  highest_injury,
  latitude,
  longitude,
  city,
  state,
  country,
  fatal_count,
  aircraft_make,
  aircraft_model,
  CASE 
    WHEN fatal_count > 0 THEN 'fatal'
    WHEN event_type = 'ACC' THEN 'accident'
    ELSE 'incident'
  END as severity_category
FROM accidents
WHERE latitude IS NOT NULL 
  AND longitude IS NOT NULL;

-- Add comment
COMMENT ON TABLE accidents IS 'Updated schema to support modern accident records with higher precision coordinates';