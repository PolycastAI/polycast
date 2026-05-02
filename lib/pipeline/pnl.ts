/**
 * Normalize crowd price read from DB for PnL: expects YES probability as decimal \([0,1]\).
 * Legacy rows may store 7–93 meaning percent — scale down so stake/p is not nonsense.
 */
export function normalizeCrowdPriceForPnl(input: unknown): number {
  let x = Number(input);
  if (!Number.isFinite(x)) return 0.5;
  if (x > 1 && x <= 100) x = x / 100;
  return Math.max(0.001, Math.min(0.999, x));
}

/** PnL for a single bet. Flat $100 stake. PASS => null. `crowdPriceAtTime` = YES decimal 0–1. */
export function computePnl(
  signal: string | null,
  crowdPriceAtTime: number,
  outcome: boolean,
  stake: number = 100
): number | null {
  if (!signal || signal === "PASS") return null;
  const p = normalizeCrowdPriceForPnl(crowdPriceAtTime);
  if (signal === "BET YES") {
    if (outcome) return stake / p - stake;
    return -stake;
  }
  if (signal === "BET NO") {
    if (!outcome) return stake / (1 - p) - stake;
    return -stake;
  }
  return null;
}

/** Brier score: (blind_estimate/100 - outcome)². outcome 1 = YES, 0 = NO. */
export function brierScore(blindEstimate: number, outcome: boolean): number {
  const o = outcome ? 1 : 0;
  const p = blindEstimate / 100;
  return (p - o) ** 2;
}
