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
    .select("id, polymarket_id, title, social_title, post_id_bluesky, market_url")
    .in("id", marketIds);

  if (marketError || !markets?.length) return;

  // Same for all resolution posts in this run; compute once (do not defer posts until after model_performance).
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
    }

    // Build the social-post model snapshot from canonical rows:
    // earliest ORIGINAL prediction per model (parent is null) = "official bet".
    const pnlByPredictionId = new Map<string, number | null>();
    for (const p of preds as any[]) {
      const pnl = computePnl(
        p.signal,
        Number(p.crowd_price_at_time ?? 0),
        outcome,
        Number(p.stake ?? 100)
      );
      pnlByPredictionId.set(String(p.id), pnl ?? null);
    }

    const latestOriginalByModel = new Map<string, any>();
    const originals = (preds as any[]).filter((p) => p.parent_prediction_id == null);
    const candidates = originals.length > 0 ? originals : (preds as any[]);
    const sortedCandidates = candidates.slice().sort((a, b) => {
      const at = a?.predicted_at ? new Date(a.predicted_at).getTime() : 0;
      const bt = b?.predicted_at ? new Date(b.predicted_at).getTime() : 0;
      return at - bt;
    });
    for (const p of sortedCandidates) {
      const model = String(p.model ?? "");
      if (!MODELS.includes(model as any)) continue;
      if (!latestOriginalByModel.has(model)) latestOriginalByModel.set(model, p);
    }

    const modelPnls: ResolutionModelPnl[] = MODELS.map((model) => {
      const row = latestOriginalByModel.get(model);
      const pnl = row ? (pnlByPredictionId.get(String(row.id)) ?? null) : null;
      return { model, pnl };
    });
    const canonicalRows = MODELS.map((model) => latestOriginalByModel.get(model)).filter(
      Boolean
    ) as any[];

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

    for (const p of canonicalRows) {
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

    const resolvedUrl = market.market_url ?? null;

    await supabaseAdmin
      .from("markets")
      .update({ status: "resolved" })
      .eq("id", market.id);

    // Queue draft social post immediately so a later failure (e.g. model_performance) cannot skip it.
    // Do not sleep between posts — serverless invocations will time out on long delays.
    try {
      await postResolutionToBluesky({
        marketId: market.id,
        socialTitle:
          (market.social_title && market.social_title.length > 0
            ? market.social_title
            : market.title) ?? "Market",
        outcome,
        modelPnls,
        marketUrl: resolvedUrl,
        includeCumulative
      });
      console.log(
        `[resolutionChecker] Queued resolution draft for market ${market.id} (${polymarketId})`
      );
    } catch (err) {
      console.error(
        `[resolutionChecker] Failed to queue resolution social post for market ${market.id}:`,
        err
      );
    }
  }

  for (const model of MODELS) {
    const { data: resolvedPreds } = await supabaseAdmin
      .from("predictions")
      .select(
        "id, market_id, model, pnl, signal, blind_estimate, outcome, predicted_at, parent_prediction_id"
      )
      .eq("model", model)
      .eq("resolved", true);

    // Canonical performance row per market/model = earliest original prediction.
    const canonicalByMarket = new Map<string, any>();
    const modelRows = (resolvedPreds as any[]) ?? [];
    const originals = modelRows.filter((r) => r.parent_prediction_id == null);
    const candidates = originals.length > 0 ? originals : modelRows;
    const sorted = candidates.slice().sort((a, b) => {
      const at = a?.predicted_at ? new Date(a.predicted_at).getTime() : 0;
      const bt = b?.predicted_at ? new Date(b.predicted_at).getTime() : 0;
      return at - bt;
    });
    for (const row of sorted) {
      const mid = String(row.market_id ?? "");
      if (!mid) continue;
      if (!canonicalByMarket.has(mid)) canonicalByMarket.set(mid, row);
    }
    const canonicalRows = [...canonicalByMarket.values()];

    const bets = canonicalRows.filter((r) => r.signal && r.signal !== "PASS");
    const wins = bets.filter((b) => (Number(b.pnl) ?? 0) > 0).length;
    const totalPnl = canonicalRows.reduce(
      (sum, r) => sum + (Number(r.pnl) || 0),
      0
    );
    const brierScores =
      canonicalRows
        .filter((r) => r.blind_estimate != null && r.outcome != null)
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

  console.log("Resolution checker finished.");
}
