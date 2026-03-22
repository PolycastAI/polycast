/** Raw market from Gamma API (GET /markets) */
export interface GammaMarket {
  id: string;
  question: string | null;
  description?: string | null;
  outcomes?: string | string[] | null;
  outcomePrices?: string | string[] | null;
  volume?: string | number | null;
  active?: boolean | null;
  closed?: boolean | null;
  endDate?: string | null;
  startDate?: string | null;
  category?: string | null;
  /** Canonical page URL when provided by Gamma (prefer over constructing from slugs). */
  url?: string | null;
  marketUrl?: string | null;
  slug?: string | null;
  eventId?: string | null;
  event?: { id?: string; slug?: string | null; url?: string | null; marketUrl?: string | null } | null;
  /** API sometimes returns endDate as YYYY-MM-DD only */
  endDateIso?: string | null;
  gameStartTime?: string | null;
  /** Parent event(s); may have endDate */
  events?: Array<{
    id?: string;
    endDate?: string;
    slug?: string;
    url?: string | null;
    marketUrl?: string | null;
    category?: string | null;
    tags?: Array<{ label?: string; slug?: string } | string> | null;
  }> | null;
  eventSlug?: string | null;
  conditionId?: string | null;
  groupItemTitle?: string | null;
  tags?: Array<{ label?: string; slug?: string }> | null;
}

/** Normalized market for shortlist and pipeline */
export interface ShortlistMarket {
  polymarketId: string;
  title: string;
  description: string | null;
  resolutionDate: Date | null;
  crowd_price: number;
  volume: number;
  startDate: Date | null;
  category: string | null;
  /** Raw category string from Gamma (before standardisation); used for Gemini `existing_category`. */
  categoryFromApiRaw?: string | null;
  /** From Gemini batch (geography); not from Polymarket API. */
  marketGeography: string | null;
  days_to_resolution: number | null;
  time_bucket: string;
  marketUrl: string | null;
  /** 0–1 for backwards compatibility with pipeline */
  probability: number;
  /** Aliases for pipeline (camelCase) */
  daysToResolution?: number | null;
  timeBucket?: string;
}
