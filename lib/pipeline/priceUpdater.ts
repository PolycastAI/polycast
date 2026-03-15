/* eslint-disable no-console */

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  fetchMarketById,
  getResolutionOutcome
} from "@/lib/polymarket/gamma";

function parseOutcomesFromGamma(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // no-op
  }
  return String(raw).split(",").map((s) => s.trim());
}
function parsePricesFromGamma(raw: string | string[] | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((p) => Number(p));
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((p) => Number(p));
  } catch {
    // no-op
  }
  return String(raw).split(",").map((s) => Number(s.trim()));
}

function getYesPrice(gamma: any): number | null {
  const outcomes = parseOutcomesFromGamma(gamma.outcomes);
  const prices = parsePricesFromGamma(gamma.outcomePrices);
  if (outcomes.length !== 2 || prices.length !== 2) return null;
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yesIdx === -1) return prices[0] ?? null;
  return prices[yesIdx] ?? null;
}

export async function runPriceUpdater() {
  console.log("Price updater starting...");

  const { data: markets, error: marketError } = await supabaseAdmin
    .from("markets")
    .select("id, polymarket_id, resolution_criteria, resolution_criteria_original, resolution_criteria_updated_at")
    .in("status", ["active", "pending"]);

  if (marketError || !markets?.length) {
    console.log("No active/pending markets to update.");
    return;
  }

  for (const market of markets as any[]) {
    try {
      const gamma = await fetchMarketById(market.polymarket_id);
      if (!gamma) continue;
      if (getResolutionOutcome(gamma) !== null) continue; // skip resolved

      const yesPrice = getYesPrice(gamma);
      const volume = gamma.volume ? Number(gamma.volume) : 0;

      const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
      const twentyEightHoursAgo = new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString();

      const { data: oldRow } = await supabaseAdmin
        .from("market_prices")
        .select("volume")
        .eq("market_id", market.id)
        .gte("recorded_at", twentyEightHoursAgo)
        .lte("recorded_at", twentyHoursAgo)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const volume24hAgo = (oldRow as any)?.volume != null ? Number((oldRow as any).volume) : null;
      const momentumScore =
        volume24hAgo != null && volume24hAgo > 0
          ? (volume - volume24hAgo) / volume24hAgo
          : null;

      await supabaseAdmin.from("market_prices").insert({
        market_id: market.id,
        current_price: yesPrice,
        volume,
        momentum_score: momentumScore
      });

      const criteriaFromGamma = gamma.description ?? null;
      const original = market.resolution_criteria_original ?? market.resolution_criteria;
      if (
        criteriaFromGamma &&
        original !== null &&
        String(criteriaFromGamma).trim() !== String(original).trim()
      ) {
        await supabaseAdmin
          .from("markets")
          .update({
            resolution_criteria: criteriaFromGamma,
            resolution_criteria_updated_at: new Date().toISOString(),
            resolution_criteria_original: original
          })
          .eq("id", market.id);

        await supabaseAdmin
          .from("predictions")
          .update({ criteria_amended: true })
          .eq("market_id", market.id);
      }
    } catch (err) {
      console.error(`Price updater error for market ${market.polymarket_id}:`, err);
    }
  }

  console.log("Price updater finished.");
}
