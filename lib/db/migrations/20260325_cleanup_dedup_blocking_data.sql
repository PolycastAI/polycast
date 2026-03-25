-- One-time / as-needed cleanup: unblock shortlist dedup without touching active bets or resolved history.
-- Run in Supabase SQL Editor (or psql) against the Polycast database.
--
-- Clears:
--   - rejected_markets / held_markets exclusion lists
--   - markets with status pending or held (and their dependent rows only)
--
-- Does NOT delete:
--   - markets that are active, approved, or rejected (row kept; cooldown rows are truncated)
--   - predictions for those markets (including resolved predictions)
--   - predictions for any market not in the pending/held delete set

TRUNCATE rejected_markets;
TRUNCATE held_markets;

DELETE FROM predictions
WHERE market_id IN (
  SELECT id FROM markets WHERE status IN ('pending', 'held')
);

DELETE FROM market_prices
WHERE market_id IN (
  SELECT id FROM markets WHERE status IN ('pending', 'held')
);

DELETE FROM social_posts
WHERE market_id IN (
  SELECT id FROM markets WHERE status IN ('pending', 'held')
);

DELETE FROM re_run_schedule
WHERE market_id IN (
  SELECT id FROM markets WHERE status IN ('pending', 'held')
);

DELETE FROM sensitivity_tests
WHERE market_id IN (
  SELECT id FROM markets WHERE status IN ('pending', 'held')
);

DELETE FROM markets WHERE status IN ('pending', 'held');
