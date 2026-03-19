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
  slug?: string | null;
  /** API sometimes returns endDate as YYYY-MM-DD only */
  endDateIso?: string | null;
  gameStartTime?: string | null;
  /** Parent event(s); may have endDate */
  events?: Array<{ id?: string; endDate?: string; slug?: string }> | null;
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
  days_to_resolution: number | null;
  time_bucket: string;
  marketUrl: string | null;
  /** 0–1 for backwards compatibility with pipeline */
  probability: number;
  /** Aliases for pipeline (camelCase) */
  daysToResolution?: number | null;
  timeBucket?: string;
}
