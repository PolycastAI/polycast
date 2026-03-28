-- Polycast: wipe app data for a clean pipeline test (Supabase → SQL Editor).
-- DESTRUCTIVE. Removes markets, predictions, prices, social queue, P&L history, dedup lists, errors.
-- Does NOT drop schema, RPCs, or extensions.

-- All FK children of markets (predictions, market_prices, social_posts, re_run_schedule,
-- sensitivity_tests, model_pnl_history, etc.) are truncated automatically.
TRUNCATE TABLE markets CASCADE;

-- No FK to markets — clear separately.
TRUNCATE TABLE
  held_markets,
  rejected_markets,
  model_performance,
  error_log,
  daily_backup;

-- Optional: remove stored prompt text. The app will upsert the current PROMPT_VERSION row on next run.
-- TRUNCATE TABLE prompt_versions;
