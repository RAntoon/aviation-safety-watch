-- Aviation Safety Watch Database Schema
-- This creates the table structure for storing NTSB accident data

-- Main accidents table
CREATE TABLE IF NOT EXISTS accidents (
  -- Primary identification
  id SERIAL PRIMARY KEY,
  cm_mkey INTEGER UNIQUE,
  ntsb_number VARCHAR(50) UNIQUE,
  
  -- Event details
  event_date TIMESTAMP NOT NULL,
  event_type VARCHAR(10), -- 'ACC' = Accident, 'INC' = Incident
  highest_injury VARCHAR(20), -- 'Fatal', 'Serious', 'Minor', 'None'
  
  -- Location data
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  city VARCHAR(100),
  state VARCHAR(5),
  country VARCHAR(5),
  airport_id VARCHAR(10),
  airport_name VARCHAR(200),
  
  -- Injury counts
  fatal_count INTEGER DEFAULT 0,
  serious_injury_count INTEGER DEFAULT 0,
  minor_injury_count INTEGER DEFAULT 0,
  
  -- Narratives (shortened for database storage)
  prelim_narrative TEXT,
  factual_narrative TEXT,
  analysis_narrative TEXT,
  probable_cause TEXT,
  
  -- Status flags
  is_closed BOOLEAN DEFAULT false,
  completion_status VARCHAR(50),
  
  -- Aircraft information (from first vehicle)
  aircraft_make VARCHAR(100),
  aircraft_model VARCHAR(100),
  aircraft_category VARCHAR(20),
  registration_number VARCHAR(20),
  damage_level VARCHAR(50),
  
  -- Operator information
  operator_name VARCHAR(200),
  
  -- Metadata
  original_published_date TIMESTAMP,
  most_recent_report_type VARCHAR(50),
  
  -- Indexes for fast querying
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_event_date ON accidents(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_location ON accidents(latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_state ON accidents(state);
CREATE INDEX IF NOT EXISTS idx_highest_injury ON accidents(highest_injury);
CREATE INDEX IF NOT EXISTS idx_event_type ON accidents(event_type);
CREATE INDEX IF NOT EXISTS idx_fatal_count ON accidents(fatal_count);

-- Composite index for date range queries with location
CREATE INDEX IF NOT EXISTS idx_date_location ON accidents(event_date, latitude, longitude) 
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Full text search index for narratives (optional, for future search feature)
CREATE INDEX IF NOT EXISTS idx_narratives_search ON accidents 
  USING gin(to_tsvector('english', 
    COALESCE(prelim_narrative, '') || ' ' || 
    COALESCE(factual_narrative, '') || ' ' || 
    COALESCE(analysis_narrative, '') || ' ' || 
    COALESCE(probable_cause, '')
  ));

-- Create a view for easy querying with common filters
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

-- Table to track import progress (useful for debugging)
CREATE TABLE IF NOT EXISTS import_log (
  id SERIAL PRIMARY KEY,
  import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  file_name VARCHAR(200),
  records_processed INTEGER,
  records_imported INTEGER,
  records_failed INTEGER,
  error_message TEXT,
  duration_seconds INTEGER
);

COMMENT ON TABLE accidents IS 'Main table storing NTSB aviation accident and incident records';
COMMENT ON TABLE import_log IS 'Log of data import operations for debugging and monitoring';
