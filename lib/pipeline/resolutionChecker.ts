/* eslint-disable no-console */

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchMarketById, getResolutionOutcome } from "@/lib/polymarket/gamma";
import { computePnl, brierScore } from "@/lib/pipeline/pnl";
import {
  postResolutionToBluesky,
  ResolutionModelPnl
} from "@/lib/social/bluesky";

const MODELS = ["Claude", "ChatGPT", "Gemini", "Grok"] as const;

export async function runResolutionChecker() {
  console.log("Resolution checker starting...");

  const { data: unresolved, error: predError } = await supabaseAdmin
    .from("predictions")
    .select("market_id")
    .eq("resolved", false);

  if (predError || !unresolved?.length) {
    console.log("No unresolved predictions.");
    return;
  }

  const marketIds = [...new Set(unresolved.map((r: any) => r.market_id))];

  const { data: markets, error: marketError } = await supabaseAdmin
    .from("markets")
    .select("id, polymarket_id, title, social_title, post_id_bluesky")
    .in("id", marketIds);

  if (marketError || !markets?.length) return;

  const resolutionPostQueue: Array<{
    marketId: string;
    marketUrl: string;
    socialTitle: string;
    outcome: boolean;
    modelPnls: ResolutionModelPnl[];
    includeCumulative: boolean;
  }> = [];

  for (const market of markets as any[]) {
    const polymarketId = market.polymarket_id;
    const gamma = await fetchMarketById(polymarketId);
    if (!gamma) continue;
    const outcome = getResolutionOutcome(gamma);
    if (outcome === null) continue;

    const { data: preds, error: predsErr } = await supabaseAdmin
      .from("predictions")
      .select("*")
      .eq("market_id", market.id)
      .eq("resolved", false);

    if (predsErr || !preds?.length) continue;

    const modelPnls: ResolutionModelPnl[] = [];

    for (const p of preds as any[]) {
      const crowd = Number(p.crowd_price_at_time ?? 0);
      const stake = Number(p.stake ?? 100);
      const pnl = computePnl(p.signal, crowd, outcome, stake);

      await supabaseAdmin
        .from("predictions")
        .update({
          resolved: true,
          outcome,
          pnl: pnl ?? undefined
        })
        .eq("id", p.id);

      modelPnls.push({
        model: p.model,
        pnl: pnl ?? null
      });
    }

    const cumulativeByModel = new Map<string, number>();
    for (const model of MODELS) {
      const { data: lastRow } = await supabaseAdmin
        .from("model_pnl_history")
        .select("cumulative_pnl")
        .eq("model", model)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      cumulativeByModel.set(
        model,
        Number((lastRow as any)?.cumulative_pnl ?? 0)
      );
    }

    for (const p of preds as any[]) {
      const pnl = computePnl(
        p.signal,
        Number(p.crowd_price_at_time ?? 0),
        outcome,
        Number(p.stake ?? 100)
      );
      if (pnl == null) continue;
      const prev = cumulativeByModel.get(p.model) ?? 0;
      const cum = prev + pnl;
      cumulativeByModel.set(p.model, cum);
      await supabaseAdmin.from("model_pnl_history").insert({
        model: p.model,
        resolved_market_id: market.id,
        bet_pnl: pnl,
        cumulative_pnl: cum
      });
    }

    for (const row of modelPnls) {
      row.cumulativePnl = cumulativeByModel.get(row.model) ?? 0;
    }

    resolutionPostQueue.push({
      marketId: market.id,
      marketUrl: `https://polycast.ai/market/${market.id}`,
      socialTitle:
        (market.social_title && market.social_title.length > 0
          ? market.social_title
          : market.title) ?? "Market",
      outcome,
      modelPnls,
      includeCumulative: false
    });

    await supabaseAdmin
      .from("markets")
      .update({ status: "resolved" })
      .eq("id", market.id);
  }

  for (const model of MODELS) {
    const { data: resolvedPreds } = await supabaseAdmin
      .from("predictions")
      .select("id, pnl, signal, blind_estimate, outcome")
      .eq("model", model)
      .eq("resolved", true);

    const bets = (resolvedPreds as any[])?.filter(
      (r) => r.signal && r.signal !== "PASS"
    ) ?? [];
    const wins = bets.filter((b) => (Number(b.pnl) ?? 0) > 0).length;
    const totalPnl =
      (resolvedPreds as any[])?.reduce(
        (sum, r) => sum + (Number(r.pnl) || 0),
        0
      ) ?? 0;
    const brierScores =
      (resolvedPreds as any[])
        ?.filter((r) => r.blind_estimate != null && r.outcome != null)
        .map((r) => brierScore(r.blind_estimate, r.outcome)) ?? [];
    const avgBrierModel =
      brierScores.length > 0
        ? brierScores.reduce((a, b) => a + b, 0) / brierScores.length
        : null;

    const { data: existing } = await supabaseAdmin
      .from("model_performance")
      .select("id")
      .eq("model", model)
      .is("category", null)
      .is("time_bucket", null)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("model_performance")
        .update({
          total_bets: bets.length,
          wins,
          losses: bets.length - wins,
          total_pnl: totalPnl,
          brier_score: avgBrierModel,
          updated_at: new Date().toISOString()
        })
        .eq("id", (existing as any).id);
    } else {
      await supabaseAdmin.from("model_performance").insert({
        model: model as string,
        category: null,
        time_bucket: null,
        total_bets: bets.length,
        wins,
        losses: bets.length - wins,
        total_pnl: totalPnl,
        brier_score: avgBrierModel
      });
    }
  }

  const week3Cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
  const { data: firstPred } = await supabaseAdmin
    .from("predictions")
    .select("predicted_at")
    .order("predicted_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const includeCumulative: boolean = Boolean(
    firstPred &&
      new Date((firstPred as any).predicted_at).getTime() < week3Cutoff
  );

  for (let i = 0; i < resolutionPostQueue.length; i++) {
    const item = resolutionPostQueue[i];
    if (item.includeCumulative !== includeCumulative) {
      item.includeCumulative = includeCumulative;
    }
    await postResolutionToBluesky({
      marketId: item.marketId,
      socialTitle: item.socialTitle,
      outcome: item.outcome,
      modelPnls: item.modelPnls,
      marketUrl: item.marketUrl,
      includeCumulative: item.includeCumulative
    });
    if (i < resolutionPostQueue.length - 1) {
      await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
    }
  }

  console.log("Resolution checker finished.");
}
