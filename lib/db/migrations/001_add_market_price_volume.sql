-- Run this in Supabase SQL Editor if your markets table was created before current_price/volume existed.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS current_price NUMERIC;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS volume NUMERIC;
