import type { GammaMarket } from "@/lib/polymarket/types";
import { fetchGammaMarketById, fetchMarketById } from "@/lib/polymarket/gamma";

/**
 * `predictions.crowd_price_at_time` is stored as the YES probability **decimal** in \([0.07, 0.93]\)
 * (same convention as `computePnl`). Never store raw outcomePrices without validating range.
 */

const MIN_YES = 0.07;
const MAX_YES = 0.93;

/**
 * Normalize mistaken percent integers (e.g. 62 for 62%) and enforce Polycast’s traded band
 * before inserting/updating `crowd_price_at_time`.
 */
export function normalizeAndValidateCrowdPriceForStorage(
  raw: unknown,
  context: string
): number {
  let x = Number(raw);
  if (!Number.isFinite(x)) {
    throw new Error(
      `${context}: crowd_price_at_time must be a finite number (got ${String(raw)})`
    );
  }
  if (x > 1 && x <= 100) {
    x = x / 100;
  }
  if (x < 0 || x > 1) {
    throw new Error(
      `${context}: crowd_price_at_time must be in [0,1] or [0,100] percent after normalization (got ${raw})`
    );
  }
  if (x < MIN_YES || x > MAX_YES) {
    throw new Error(
      `${context}: crowd_price_at_time ${x} outside allowed YES band ${MIN_YES}–${MAX_YES} (7%–93%). ` +
        `Fix Gamma fetch (e.g. use sub_market_id for multi-outcome parents) or market selection.`
    );
  }
  return x;
}

/** Prefer `sub_market_id` so YES price matches the forecast row on multi-outcome parents. */
export async function fetchGammaForMarketCrowdPrice(row: {
  polymarket_id: string;
  sub_market_id?: string | null;
}): Promise<GammaMarket | null> {
  const sub = row.sub_market_id?.trim();
  if (sub) {
    const g = await fetchGammaMarketById(sub);
    if (g) return g;
  }
  return fetchMarketById(row.polymarket_id);
}
