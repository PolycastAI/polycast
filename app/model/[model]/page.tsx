import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ModelProfileClient } from "./ModelProfileClient";
import type {
  ModelPageCategoryPerf,
  ModelPageHistory,
  ModelPagePerf,
  ModelPagePrediction
} from "./types";

const MODEL_MAP = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok"
} as const;

type ModelSlug = keyof typeof MODEL_MAP;

interface ModelPageProps {
  params: { model: string };
}

async function getModelPageData(modelName: string) {
  const [{ data: perf }, { data: history }, { data: predictions }, { data: categoryPerf }] =
    await Promise.all([
      supabaseAdmin
        .from("model_performance")
        .select("total_pnl, wins, losses, brier_score")
        .eq("model", modelName)
        .is("category", null)
        .is("time_bucket", null)
        .maybeSingle(),
      supabaseAdmin
        .from("model_pnl_history")
        .select("recorded_at, cumulative_pnl, bet_pnl, resolved_market_id")
        .eq("model", modelName)
        .order("recorded_at", { ascending: true })
        .limit(5000),
      supabaseAdmin
        .from("predictions")
        .select(
          "id, market_id, model, model_version, predicted_at, resolution_date, days_to_resolution, time_bucket, blind_estimate, anchored_estimate, anchoring_delta, crowd_price_at_time, signal, resolved, outcome, pnl, markets(title, category, market_url, resolution_date)"
        )
        .eq("model", modelName)
        .order("predicted_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("model_performance")
        .select("category, total_bets, wins, losses, total_pnl")
        .eq("model", modelName)
        .not("category", "is", null)
        .is("time_bucket", null)
        .order("category", { ascending: true })
    ]);

  const pendingMarketIds = new Set<string>();
  for (const p of predictions ?? []) {
    if (p?.resolved !== true && p?.market_id) pendingMarketIds.add(String(p.market_id));
  }

  let latestPriceByMarketId: Record<string, { current_price: number | null; recorded_at: string | null }> =
    {};
  if (pendingMarketIds.size > 0) {
    const { data: prices } = await supabaseAdmin
      .from("market_prices")
      .select("market_id, current_price, recorded_at")
      .in("market_id", Array.from(pendingMarketIds))
      .order("recorded_at", { ascending: false })
      .limit(10000);

    const out: Record<string, { current_price: number | null; recorded_at: string | null }> = {};
    for (const r of prices ?? []) {
      const id = String(r.market_id ?? "");
      if (!id || out[id]) continue;
      out[id] = {
        current_price: r.current_price != null ? Number(r.current_price) : null,
        recorded_at: r.recorded_at != null ? String(r.recorded_at) : null
      };
    }
    latestPriceByMarketId = out;
  }

  return {
    perf: (perf as ModelPagePerf) ?? null,
    history: ((history ?? []) as any[]).map(
      (h): ModelPageHistory => ({
        recorded_at: String(h.recorded_at),
        cumulative_pnl: h.cumulative_pnl != null ? Number(h.cumulative_pnl) : null,
        bet_pnl: h.bet_pnl != null ? Number(h.bet_pnl) : null,
        resolved_market_id: h.resolved_market_id ? String(h.resolved_market_id) : null
      })
    ),
    predictions: ((predictions ?? []) as any[]).map(
      (p): ModelPagePrediction => ({
        id: String(p.id),
        market_id: String(p.market_id),
        model: String(p.model),
        model_version: p.model_version != null ? String(p.model_version) : null,
        predicted_at: p.predicted_at != null ? String(p.predicted_at) : null,
        resolution_date: p.resolution_date != null ? String(p.resolution_date) : null,
        days_to_resolution: p.days_to_resolution != null ? Number(p.days_to_resolution) : null,
        time_bucket: p.time_bucket != null ? String(p.time_bucket) : null,
        blind_estimate: p.blind_estimate != null ? Number(p.blind_estimate) : null,
        anchored_estimate:
          p.anchored_estimate != null ? Number(p.anchored_estimate) : null,
        anchoring_delta: p.anchoring_delta != null ? Number(p.anchoring_delta) : null,
        crowd_price_at_time:
          p.crowd_price_at_time != null ? Number(p.crowd_price_at_time) : null,
        signal: p.signal != null ? String(p.signal) : null,
        resolved: p.resolved != null ? Boolean(p.resolved) : null,
        outcome:
          p.outcome == null ? null : Boolean(p.outcome),
        pnl: p.pnl != null ? Number(p.pnl) : null,
        markets: p.markets
          ? {
              title: p.markets.title != null ? String(p.markets.title) : null,
              category: p.markets.category != null ? String(p.markets.category) : null,
              market_url:
                p.markets.market_url != null ? String(p.markets.market_url) : null,
              resolution_date:
                p.markets.resolution_date != null
                  ? String(p.markets.resolution_date)
                  : null
            }
          : null
      })
    ),
    categoryPerf: ((categoryPerf ?? []) as any[]).map(
      (row): ModelPageCategoryPerf => ({
        category: row.category != null ? String(row.category) : null,
        total_bets: row.total_bets != null ? Number(row.total_bets) : null,
        wins: row.wins != null ? Number(row.wins) : null,
        losses: row.losses != null ? Number(row.losses) : null,
        total_pnl: row.total_pnl != null ? Number(row.total_pnl) : null
      })
    ),
    latestPriceByMarketId
  };
}

export default async function ModelPage({ params }: ModelPageProps) {
  const slug = params.model.toLowerCase() as ModelSlug;
  if (!(slug in MODEL_MAP)) notFound();

  const modelName = MODEL_MAP[slug];
  const data = await getModelPageData(modelName);

  return (
    <ModelProfileClient
      modelName={modelName}
      modelSlug={slug}
      perf={data.perf}
      history={data.history}
      predictions={data.predictions}
      categoryPerf={data.categoryPerf}
      latestPriceByMarketId={data.latestPriceByMarketId}
    />
  );
}

