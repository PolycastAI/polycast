-- PART 1: Clean slate. Run this in Supabase → SQL Editor → New query → paste → Run.
-- CASCADE truncates tables that reference markets (predictions, market_prices, etc.).

TRUNCATE TABLE markets CASCADE;
TRUNCATE TABLE held_markets;
TRUNCATE TABLE rejected_markets;
