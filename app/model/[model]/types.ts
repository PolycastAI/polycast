export type ModelPagePrediction = {
  id: string;
  market_id: string;
  model: string;
  model_version: string | null;
  predicted_at: string | null;
  resolution_date: string | null;
  days_to_resolution: number | null;
  time_bucket: string | null;
  blind_estimate: number | null;
  anchored_estimate: number | null;
  anchoring_delta: number | null;
  crowd_price_at_time: number | null;
  signal: string | null;
  resolved: boolean | null;
  outcome: boolean | null;
  pnl: number | null;
  markets: {
    title: string | null;
    category: string | null;
    market_url: string | null;
    resolution_date: string | null;
  } | null;
};

export type ModelPageHistory = {
  recorded_at: string;
  cumulative_pnl: number | null;
  bet_pnl: number | null;
  resolved_market_id: string | null;
};

export type ModelPageCategoryPerf = {
  category: string | null;
  total_bets: number | null;
  wins: number | null;
  losses: number | null;
  total_pnl: number | null;
};

export type ModelPagePerf = {
  total_pnl: number | null;
  wins: number | null;
  losses: number | null;
  brier_score: number | null;
} | null;
