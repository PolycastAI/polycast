-- Polycast Supabase schema
-- Safe to run in a fresh Supabase project.
-- Enable pgcrypto for gen_random_uuid if not already enabled.
create extension if not exists "pgcrypto";

-- 1. markets
CREATE TABLE if not exists markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polymarket_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  social_title TEXT,
  category TEXT,
  market_geography TEXT,
  resolution_date TIMESTAMPTZ,
  resolution_criteria TEXT,
  resolution_criteria_original TEXT,
  resolution_criteria_updated_at TIMESTAMPTZ,
  market_url TEXT,
  status TEXT DEFAULT 'pending',
  current_price NUMERIC,
  volume NUMERIC,
  post_id_bluesky TEXT,
  post_id_x TEXT,
  estimate_std_dev NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. predictions
CREATE TABLE if not exists predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id),
  model TEXT NOT NULL,
  model_version TEXT,
  predicted_at TIMESTAMPTZ DEFAULT NOW(),
  resolution_date TIMESTAMPTZ,
  days_to_resolution INTEGER,
  time_bucket TEXT,
  blind_estimate INTEGER,
  anchored_estimate INTEGER,
  anchoring_delta INTEGER,
  crowd_price_at_time NUMERIC,
  edge INTEGER,
  signal TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  outcome BOOLEAN,
  stake NUMERIC DEFAULT 100,
  pnl NUMERIC,
  prompt_version INTEGER DEFAULT 1,
  news_sources_provided TEXT[],
  criteria_amended BOOLEAN DEFAULT FALSE,
  reasoning_text TEXT,
  stated_uncertainty TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  response_time_ms INTEGER,
  market_price_24h_before_resolution NUMERIC,
  re_run_eligible BOOLEAN DEFAULT FALSE,
  parent_prediction_id UUID REFERENCES predictions(id),
  alt_prompt_used BOOLEAN DEFAULT FALSE,
  alt_blind_estimate INTEGER,
  notes TEXT
);

-- 3. model_performance
CREATE TABLE if not exists model_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  category TEXT,
  time_bucket TEXT,
  total_bets INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  brier_score NUMERIC,
  total_pnl NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. model_pnl_history
CREATE TABLE if not exists model_pnl_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_market_id UUID REFERENCES markets(id),
  bet_pnl NUMERIC,
  cumulative_pnl NUMERIC
);

-- 5. prompt_versions
CREATE TABLE if not exists prompt_versions (
  version INTEGER PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  description_of_change TEXT,
  full_prompt_text TEXT NOT NULL
);

-- 6. market_prices
CREATE TABLE if not exists market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  current_price NUMERIC,
  volume NUMERIC,
  momentum_score NUMERIC
);

-- 7. rejected_markets
CREATE TABLE if not exists rejected_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  rejected_at TIMESTAMPTZ DEFAULT NOW(),
  resurface_at TIMESTAMPTZ,
  rejection_reason TEXT
);

-- 8. held_markets
CREATE TABLE if not exists held_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  held_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. error_log
CREATE TABLE if not exists error_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  job TEXT,
  market_id UUID,
  model TEXT,
  error_type TEXT,
  error_message TEXT,
  severity TEXT DEFAULT 'error',
  resolved BOOLEAN DEFAULT FALSE
);

-- 10. re_run_schedule
CREATE TABLE if not exists re_run_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id),
  next_run_date DATE,
  run_count INTEGER DEFAULT 0
);

-- 11. sensitivity_tests
CREATE TABLE if not exists sensitivity_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id),
  model TEXT,
  model_version TEXT,
  prompt_version INTEGER,
  alt_prompt_text TEXT,
  blind_estimate INTEGER,
  reasoning_text TEXT,
  predicted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. daily_backup
CREATE TABLE if not exists daily_backup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backed_up_at TIMESTAMPTZ DEFAULT NOW(),
  s3_path TEXT,
  tables_included TEXT[]
);

-- Helper function: atomically reset pending/held markets and insert new shortlist.
create or replace function reset_and_insert_shortlist(new_markets jsonb)
returns void
language plpgsql
as $$
begin
  -- Delete all held markers (text market_id, decoupled from markets FK)
  delete from held_markets;

  -- Delete all pending/held markets so we only have the new shortlist
  delete from markets where status in ('pending', 'held');

  -- Insert new pending markets from JSON payload
  insert into markets (
    polymarket_id,
    title,
    category,
    resolution_date,
    resolution_criteria,
    market_url,
    status,
    current_price,
    volume
  )
  select
    (m->>'polymarket_id')::text,
    m->>'title',
    nullif(m->>'category', '')::text,
    case
      when m ? 'resolution_date' and m->>'resolution_date' is not null and m->>'resolution_date' <> ''
      then (m->>'resolution_date')::timestamptz
      else null
    end,
    nullif(m->>'resolution_criteria', '')::text,
    nullif(m->>'market_url', '')::text,
    'pending',
    case
      when m ? 'current_price' and m->>'current_price' <> '' then (m->>'current_price')::numeric
      else null
    end,
    case
      when m ? 'volume' and m->>'volume' <> '' then (m->>'volume')::numeric
      else null
    end
  from jsonb_array_elements(new_markets) as m;
end;
$$;

