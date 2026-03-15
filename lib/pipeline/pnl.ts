/** PnL for a single bet. Flat $100 stake. PASS => null. */
export function computePnl(
  signal: string | null,
  crowdPriceAtTime: number,
  outcome: boolean,
  stake: number = 100
): number | null {
  if (!signal || signal === "PASS") return null;
  const p = Math.max(0.001, Math.min(0.999, Number(crowdPriceAtTime)));
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
