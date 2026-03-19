/* eslint-disable no-console */

import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchMarketById } from "@/lib/polymarket/gamma";
import { renderPromptV1, PROMPT_VERSION } from "@/lib/ai/promptV1";
import { callModelWithRetry, ModelName } from "@/lib/ai/models";
import {
  postReRunUpdateToBluesky,
  ReRunChange
} from "@/lib/social/bluesky";

type Signal = "BET YES" | "BET NO" | "PASS";

function classifySignal(edge: number): Signal {
  if (edge > 10) return "BET YES";
  if (edge < -10) return "BET NO";
  return "PASS";
}

function parseYesPrice(gamma: any): number {
  const raw = gamma.outcomePrices;
  if (!raw) return 0.5;
  let arr: number[];
  if (Array.isArray(raw)) {
    arr = raw.map((p: unknown) => Number(p));
  } else {
    try {
      arr = JSON.parse(raw).map((p: unknown) => Number(p));
    } catch {
      return 0.5;
    }
  }
  const outcomes = gamma.outcomes;
  let yesIdx = 0;
  if (outcomes) {
    const o = Array.isArray(outcomes) ? outcomes : JSON.parse(outcomes);
    yesIdx = o.findIndex((x: string) => String(x).toLowerCase() === "yes");
    if (yesIdx === -1) yesIdx = 0;
  }
  return arr[yesIdx] ?? 0.5;
}

export async function runReRunJob() {
  console.log("Re-run job starting...");

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: due, error: scheduleError } = await supabaseAdmin
    .from("re_run_schedule")
    .select("id, market_id, run_count")
    .lte("next_run_date", today)
    .not("next_run_date", "is", null);

  if (scheduleError || !due?.length) {
    console.log("No re-runs due.");
    return;
  }

  const marketIds = (due as any[]).map((r) => r.market_id);

  const { data: markets, error: marketError } = await supabaseAdmin
    .from("markets")
    .select("id, polymarket_id, title, social_title, resolution_date, category, market_url")
    .in("id", marketIds);

  if (marketError || !markets?.length) return;

  for (const scheduleRow of due as any[]) {
    const market = (markets as any[]).find((m) => m.id === scheduleRow.market_id);
    if (!market) continue;

    const gamma = await fetchMarketById(market.polymarket_id);
    if (!gamma || (gamma as any).closed) continue;

    const crowdPrice = parseYesPrice(gamma);
    const crowdPricePercent = Math.round(crowdPrice * 100);

    const resolutionDateIso = market.resolution_date
      ? new Date(market.resolution_date).toISOString()
      : "unknown";

    const basePromptContext = {
      market_title: market.title,
      resolution_criteria:
        "See Polymarket page for full resolution criteria.",
      resolution_date: resolutionDateIso,
      days_to_resolution: null as number | null,
      category: market.category,
      news_1: "",
      news_2: "",
      news_3: ""
    };

    const { data: originalPreds } = await supabaseAdmin
      .from("predictions")
      .select("id, model, signal")
      .eq("market_id", market.id)
      .is("parent_prediction_id", null)
      .order("predicted_at", { ascending: false });

    const parentByModel = new Map<string, string>();
    for (const p of originalPreds ?? []) {
      const m = (p as any).model;
      if (!parentByModel.has(m)) {
        parentByModel.set(m, (p as any).id);
      }
    }

    const models: ModelName[] = ["Claude", "ChatGPT", "Gemini", "Grok"];
    const changes: ReRunChange[] = [];
    const oldSignalByModel = new Map<string, string>();
    for (const p of originalPreds ?? []) {
      oldSignalByModel.set((p as any).model, (p as any).signal ?? "PASS");
    }

    for (const model of models) {
      try {
        const blindPrompt = renderPromptV1({
          ...basePromptContext,
          crowd_price_percent: undefined
        });
        const res = await callModelWithRetry(model, blindPrompt);
        const estimate = Math.max(0, Math.min(100, Math.round(res.estimate)));
        const edge = estimate - crowdPricePercent;
        const newSignal = classifySignal(edge);

        const parentId = parentByModel.get(model) ?? null;

        await supabaseAdmin.from("predictions").insert({
          market_id: market.id,
          model,
          predicted_at: new Date().toISOString(),
          resolution_date: market.resolution_date ?? null,
          time_bucket: null,
          blind_estimate: estimate,
          crowd_price_at_time: crowdPrice,
          edge,
          signal: newSignal,
          resolved: false,
          stake: 100,
          prompt_version: PROMPT_VERSION,
          reasoning_text: res.rawText,
          input_tokens: res.inputTokens ?? null,
          output_tokens: res.outputTokens ?? null,
          response_time_ms: res.responseTimeMs ?? null,
          parent_prediction_id: parentId,
          re_run_eligible: false,
          alt_prompt_used: false
        });

        const oldSignal = oldSignalByModel.get(model) ?? "PASS";
        if (oldSignal !== newSignal) {
          changes.push({
            model,
            oldSignal,
            newEstimate: estimate,
            newSignal
          });
        }
      } catch (err) {
        console.error(`Re-run failed for ${market.polymarket_id} ${model}:`, err);
      }
    }

    if (changes.length > 0) {
      await postReRunUpdateToBluesky({
        marketId: market.id,
        socialTitle:
          (market.social_title || market.title) ?? "Market",
        marketUrl:
          market.market_url ??
          ((() => {
            const slug = (gamma as any)?.slug;
            const safeSlug =
              typeof slug === "string" && slug.trim().length > 0
                ? encodeURIComponent(slug.trim())
                : null;
            return safeSlug
              ? `https://polymarket.com/event/${safeSlug}`
              : "https://polymarket.com/markets";
          })() as string),
        changes
      });
    }

    await supabaseAdmin
      .from("re_run_schedule")
      .update({
        run_count: (scheduleRow.run_count ?? 0) + 1,
        next_run_date: null
      })
      .eq("id", scheduleRow.id);
  }

  console.log("Re-run job finished.");
}
