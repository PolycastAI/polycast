/* eslint-disable no-console */

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  buildGeminiShortlist,
  createEmptyPipelineTrace,
  type PipelineStepTrace
} from "@/lib/polymarket/geminiShortlist";
import { renderPromptV1, PROMPT_VERSION } from "@/lib/ai/promptV1";
import { callModelWithRetry, ModelName } from "@/lib/ai/models";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import {
  postPredictionToBluesky,
  PredictionSummaryForPost
} from "@/lib/social/bluesky";

type Signal = "BET YES" | "BET NO" | "PASS";

function formatPipelineZeroPendingAlert(args: {
  trace: PipelineStepTrace;
  dbWritten: number | null;
  dbWriteFailed: boolean;
  dbAttempted: boolean;
  lastError: string | null;
}): string {
  const { trace: t, dbWritten, dbWriteFailed, dbAttempted, lastError } = args;
  const ts = new Date().toISOString();

  const polymarketLine = !t.polymarketFetchOk ? "FAILED" : `${t.polymarketRawCount} events`;
  const geminiLine = t.geminiFailed ? "FAILED" : `${t.geminiReturnedCount} markets`;
  const dbLine =
    dbWriteFailed || (!dbAttempted && lastError)
      ? "FAILED"
      : `${dbWritten ?? 0} markets`;

  const errParts = [
    lastError,
    t.geminiError,
    t.polymarketError
  ].filter(Boolean);
  const errText = errParts.length ? errParts.join("; ") : "none";

  return (
    `⚠️ Polycast Pipeline Failed\n\n` +
    `Run Pipeline returned 0 markets.\n\n` +
    `Progress before failure:\n` +
    `✅ Polymarket fetch: ${polymarketLine}\n` +
    `✅ Structural filters: ${t.structuralCount} events\n` +
    `✅ Days filter: ${t.daysCount} events\n` +
    `✅ Dedup: ${t.dedupCount} events\n` +
    `✅ Gemini selection: ${geminiLine}\n` +
    `✅ Database write: ${dbLine}\n\n` +
    `Error: ${errText}\n` +
    `Time: ${ts}`
  );
}

function classifySignal(edge: number): Signal {
  if (edge > 10) return "BET YES";
  if (edge < -10) return "BET NO";
  return "PASS";
}

async function ensurePromptVersionRow() {
  const { data, error } = await supabaseAdmin
    .from("prompt_versions")
    .select("version")
    .eq("version", PROMPT_VERSION)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking prompt_versions:", error);
    return;
  }

  if (!data) {
    const { error: insertError } = await supabaseAdmin
      .from("prompt_versions")
      .insert({
        version: PROMPT_VERSION,
        description_of_change: "Initial blind prompt v1",
        full_prompt_text: renderPromptV1({
          market_title: "{{market_title}}",
          resolution_criteria: "{{resolution_criteria}}",
          resolution_date: "{{resolution_date}}",
          days_to_resolution: 0,
          category: "{{category}}",
          crowd_price_percent: 0,
          news_1: "{{news_1}}",
          news_2: "{{news_2}}",
          news_3: "{{news_3}}"
        })
      });
    if (insertError) {
      console.error("Failed to seed prompt_versions:", insertError);
    }
  }
}

async function upsertMarketFromShortlist(m: any) {
  const { data, error } = await supabaseAdmin
    .from("markets")
    .upsert(
      {
        polymarket_id: m.polymarketId,
        title: m.title,
        category: m.category ?? null,
        market_geography: m.marketGeography ?? null,
        resolution_date: m.resolutionDate?.toISOString() ?? null,
        resolution_criteria: m.description ?? null,
        market_url: m.marketUrl,
        status: "pending",
        current_price: m.probability != null ? Number(m.probability) : null,
        volume: m.volume != null ? Number(m.volume) : null
      },
      { onConflict: "polymarket_id" }
    )
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

async function logErrorToDb(args: {
  job: string;
  marketId?: string;
  model?: ModelName;
  error: unknown;
  severity?: "error" | "warning" | "info";
}) {
  const { job, marketId, model, error, severity = "error" } = args;
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
      ? error
      : JSON.stringify(error).slice(0, 1000);

  await supabaseAdmin.from("error_log").insert({
    job,
    market_id: marketId ?? null,
    model: model ?? null,
    error_type: "pipeline_blind_anchored",
    error_message: message,
    severity
  });
  if (severity === "error") {
    await sendTelegramMessage(
      `Polycast error (${job})${marketId ? ` market ${marketId}` : ""}${model ? ` ${model}` : ""}: ${message.slice(0, 200)}`
    );
  }
}

/** Upsert a market from shortlist data; returns market UUID. */
export async function upsertMarketFromShortlistPublic(m: any): Promise<string> {
  return upsertMarketFromShortlist(m);
}

/** Run blind + anchored prompts for an existing market (no upsert). Use for approved-market run. */
export async function runBlindAndAnchoredForMarketWithId(
  marketId: string,
  m: any,
  options?: { socialTitle?: string | null }
) {

  const resolutionDateIso = m.resolutionDate
    ? m.resolutionDate.toISOString()
    : "unknown";

  const basePromptContext = {
    market_title: m.title,
    resolution_criteria:
      "See Polymarket page for full resolution criteria. (Criteria ingestion to be wired shortly.)",
    resolution_date: resolutionDateIso,
    days_to_resolution: m.daysToResolution,
    category: m.category,
    news_1: "",
    news_2: "",
    news_3: ""
  };

  const models: ModelName[] = ["Claude", "ChatGPT", "Gemini", "Grok"];

  const results: {
    model: ModelName;
    estimate: number;
    signal: Signal;
    edge: number;
  }[] = [];

  for (const model of models) {
    const crowdPricePercent = Math.round(m.probability * 100);
    const blindPrompt = renderPromptV1({
      ...basePromptContext,
      crowd_price_percent: undefined
    });

    try {
      const res = await callModelWithRetry(model, blindPrompt);

      const estimate = Math.max(0, Math.min(100, Math.round(res.estimate)));
      const edge = estimate - crowdPricePercent;
      const signal = classifySignal(edge);

      const { data: insertRow, error: insertError } = await supabaseAdmin
        .from("predictions")
        .insert({
          market_id: marketId,
          model,
          model_version: null,
          predicted_at: new Date().toISOString(),
          resolution_date: m.resolutionDate
            ? m.resolutionDate.toISOString()
            : null,
          days_to_resolution: m.daysToResolution,
          time_bucket: m.timeBucket,
          blind_estimate: estimate,
          crowd_price_at_time: m.probability,
          edge,
          signal,
          resolved: false,
          stake: 100,
          prompt_version: PROMPT_VERSION,
          news_sources_provided: [],
          criteria_amended: false,
          reasoning_text: res.rawText,
          stated_uncertainty: null,
          input_tokens: res.inputTokens ?? null,
          output_tokens: res.outputTokens ?? null,
          response_time_ms: res.responseTimeMs ?? null,
          re_run_eligible: false,
          alt_prompt_used: false
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      const predictionId = insertRow.id as string;

      results.push({ model, estimate, signal, edge });

      // Conditional anchored prompt: only if blind estimate is outside ±10 band.
      if (Math.abs(edge) > 10) {
        const anchoredPrompt = renderPromptV1({
          ...basePromptContext,
          crowd_price_percent: crowdPricePercent
        });

        try {
          const anchoredRes = await callModelWithRetry(model, anchoredPrompt);
          const anchoredEstimate = Math.max(
            0,
            Math.min(100, Math.round(anchoredRes.estimate))
          );
          const anchoringDelta = estimate - anchoredEstimate;

          await supabaseAdmin
            .from("predictions")
            .update({
              anchored_estimate: anchoredEstimate,
              anchoring_delta: anchoringDelta,
              alt_prompt_used: false,
              alt_blind_estimate: null,
              // Optionally store anchored result summary in notes for analysis
              notes: `Anchored estimate: ${anchoredEstimate}.`
            })
            .eq("id", predictionId);
        } catch (anchoredError) {
          console.error(
            `Anchored prompt failed for market ${marketId}, model ${model}:`,
            anchoredError
          );
          await logErrorToDb({
            job: "blind_anchored_pipeline",
            marketId,
            model,
            error: anchoredError,
            severity: "warning"
          });
        }
      }
    } catch (error) {
      console.error(`Error running blind prompt for ${model}:`, error);
      await logErrorToDb({
        job: "blind_anchored_pipeline",
        marketId,
        model,
        error,
        severity: "error"
      });
    }
  }

  // Minimum signal rule: if fewer than 2 BET signals, drop market
  const betCount = results.filter((r) => r.signal !== "PASS").length;
  if (betCount < 2) {
    await supabaseAdmin.from("rejected_markets").insert({
      market_id: m.polymarketId,
      rejection_reason: "insufficient_signals"
    });
    await logErrorToDb({
      job: "blind_anchored_pipeline",
      marketId,
      error: "insufficient_signals",
      severity: "info"
    });
  }

  // Queue Bluesky "prediction" post for human review (never gated by min-signal rule).
  // We always want an audit log entry in `social_posts` so the admin UI can display pending/sent.
  try {
    if (betCount >= 2) {
      await supabaseAdmin
        .from("markets")
        .update({ status: "active" })
        .eq("id", marketId);
    }

    const polymarketProbPercent = Math.round(m.probability * 100);
    const socialTitle =
      options?.socialTitle != null && options.socialTitle !== ""
        ? options.socialTitle
        : (m.title?.length ?? 0) > 60
          ? `${m.title.slice(0, 57)}…`
          : m.title;

    const predictionsForPost: PredictionSummaryForPost[] = results.map((r) => ({
      model: r.model,
      estimate: r.estimate,
      signal: r.signal
    }));

    await postPredictionToBluesky({
      marketId,
      marketUrl: m.marketUrl ?? null,
      socialTitle,
      polymarketProbPercent,
      resolutionDate: m.resolutionDate
        ? m.resolutionDate.toISOString()
        : null,
      predictions: predictionsForPost
    });
  } catch (blueskyError) {
    console.error(
      `Failed to queue Bluesky prediction for market ${marketId}:`,
      blueskyError
    );
    await logErrorToDb({
      job: "blind_anchored_pipeline",
      marketId,
      error: blueskyError,
      severity: "error"
    });
  }
}

async function runBlindAndAnchoredForMarket(m: any) {
  const marketId = await upsertMarketFromShortlist(m);
  await runBlindAndAnchoredForMarketWithId(marketId, m);
}

/**
 * Shortlist dedup: held markets, plus rejected rows still in cooldown (resurface_at strictly in the future).
 * Does not exclude rejected rows with null/past resurface_at (eligible to reappear).
 */
/** @internal Exported for /api/markets/shortlist alignment */
export async function getExcludedPolymarketIds(): Promise<string[]> {
  const now = new Date().toISOString();
  const { data: rejectedCooldown } = await supabaseAdmin
    .from("rejected_markets")
    .select("market_id")
    .gt("resurface_at", now);
  const { data: held } = await supabaseAdmin
    .from("held_markets")
    .select("market_id");
  const ids = new Set<string>();
  for (const r of rejectedCooldown ?? []) {
    ids.add(String((r as { market_id: string }).market_id));
  }
  for (const h of held ?? []) {
    ids.add(String((h as { market_id: string }).market_id));
  }
  return [...ids];
}

export async function runBlindAndAnchoredPipeline() {
  console.log("Starting blind + anchored prompt pipeline...");
  await ensurePromptVersionRow();

  const [existingIds, excludedIds] = await Promise.all([
    (async () => {
      const { data } = await supabaseAdmin
        .from("predictions")
        .select("market_id, markets!inner(polymarket_id)");
      return (data ?? [])
        .map((r: any) => r.markets?.polymarket_id)
        .filter(Boolean);
    })(),
    getExcludedPolymarketIds()
  ]);

  const shortlist = await buildGeminiShortlist(existingIds, excludedIds);
  console.log(
    `[pipeline] Shortlist debug: raw events=${shortlist.debug.totalFetched}, ` +
      `after structural filters=${shortlist.debug.afterStructuralFilters}, ` +
      `after dedup=${shortlist.debug.afterDedup}, final=${shortlist.debug.afterGemini}`
  );

  // Telegram notification to trigger approval dashboard usage.
  await sendTelegramMessage(
    `Polycast pipeline starting.\n` +
      `Candidates (post-dedup pool): ${shortlist.debug.afterDedup}. Shortlist: ${shortlist.markets.length}.\n\n` +
      `Open /admin to review and approve markets.`
  );

  for (const m of shortlist.markets) {
    try {
      console.log(`Running blind+anchored prompts for market ${m.polymarketId}...`);
      await runBlindAndAnchoredForMarket(m);
    } catch (error) {
      console.error(
        `Error in blind+anchored pipeline for market ${m.polymarketId}:`,
        error
      );
      await logErrorToDb({
        job: "blind_anchored_pipeline",
        marketId: undefined,
        error
      });
    }
  }

  console.log("Blind + anchored prompt pipeline finished.");
}

/** Phase 1: Build shortlist, upsert markets as pending, send Telegram. No prompts. */
export async function runShortlistAndNotifyOnly() {
  const trace = createEmptyPipelineTrace();
  let dbAttempted = false;
  let dbWriteFailed = false;
  let dbWritten: number | null = null;

  const { tokenHealthCheck } = await import("@/lib/pipeline/tokenHealth");
  const health = tokenHealthCheck();
  if (!health.ok) {
    console.error(
      "[pipeline] Aborted before Step 1: token health check failed:",
      health.message
    );
    await sendTelegramMessage(`Polycast pipeline skipped: ${health.message}`, {
      plain: true
    });
    return { count: 0 };
  }
  try {
    await ensurePromptVersionRow();
    const [existingIds, excludedIds] = await Promise.all([
      (async () => {
        const { data } = await supabaseAdmin
          .from("predictions")
          .select("market_id, markets!inner(polymarket_id)");
        return (data ?? [])
          .map((r: any) => r.markets?.polymarket_id)
          .filter(Boolean);
      })(),
      getExcludedPolymarketIds()
    ]);

    console.log("[pipeline] Step 1: Starting Polymarket fetch");
    const shortlist = await buildGeminiShortlist(existingIds, excludedIds, trace);

    const canWrite = process.env.POLYCAST_SHORTLIST_WRITE_ENABLED === "true";
    if (!canWrite) {
      console.warn(
        "[shortlist] Skipping database write (reset_and_insert_shortlist). " +
          "Set POLYCAST_SHORTLIST_WRITE_ENABLED=true after verifying logs."
      );
      console.log(
        `[pipeline] Step 8: Skipping database write (dry run) — ${shortlist.markets.length} markets would be written`
      );
      console.log(
        `[pipeline] Step 9: Complete — ${shortlist.markets.length} markets (dry run, not persisted)`
      );
      await sendTelegramMessage(
        `Polycast shortlist dry run (no DB write).\n` +
          `Raw events: ${shortlist.debug.totalFetched}. Structural: ${shortlist.debug.afterStructuralFilters}. ` +
          `Pool: ${shortlist.debug.afterDedup}. Selected: ${shortlist.markets.length}.\n` +
          `Set POLYCAST_SHORTLIST_WRITE_ENABLED=true to persist.`,
        { plain: true }
      );
      return { count: shortlist.markets.length };
    }

    console.log(
      `[pipeline] Step 8: Writing ${shortlist.markets.length} markets to database`
    );

    const payload = shortlist.markets.map((m) => ({
      polymarket_id: m.polymarketId,
      title: m.title,
      category: m.category ?? null,
      market_geography: m.marketGeography ?? null,
      resolution_date: m.resolutionDate ? m.resolutionDate.toISOString() : null,
      resolution_criteria: m.description ?? null,
      market_url: m.marketUrl ?? null,
      current_price: m.probability ?? null,
      volume: m.volume ?? null
    }));

    dbAttempted = true;
    const { error: resetError } = await supabaseAdmin.rpc("reset_and_insert_shortlist", {
      new_markets: payload
    });
    if (resetError) {
      dbWriteFailed = true;
      console.error("[pipeline] Database write failed — full error:", resetError);
      throw resetError;
    }

    const { count: pendingCount } = await supabaseAdmin
      .from("markets")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    dbWritten = pendingCount ?? 0;

    console.log(
      `[pipeline] Step 9: Complete — ${dbWritten} pending markets ready for approval`
    );

    if (dbWritten === 0) {
      console.error(
        "[pipeline] Pipeline wrote 0 pending markets — sending Telegram alert"
      );
      await sendTelegramMessage(
        formatPipelineZeroPendingAlert({
          trace,
          dbWritten: 0,
          dbWriteFailed: false,
          dbAttempted: true,
          lastError: null
        }),
        { plain: true }
      );
      console.log("Shortlist finished with 0 pending (no success Telegram spam).");
      return { count: shortlist.markets.length };
    }

    const selectionForTelegram = JSON.stringify(
      shortlist.markets.map((m) => ({
        id: m.polymarketId,
        question: m.title,
        crowd_price: m.crowd_price,
        endDate: m.resolutionDate ? m.resolutionDate.toISOString() : null,
        volume: m.volume
      })),
      null,
      2
    );

    await sendTelegramMessage(
      `Polycast shortlist ready.\n` +
        `Pool (post-dedup): ${shortlist.debug.afterDedup}. Shortlist: ${shortlist.markets.length}.\n` +
        `DB pending count: ${pendingCount ?? 0}.\n\n` +
        `Admin: https://polycast-blue.vercel.app/admin`
    );

    await sendTelegramMessage(
      "Gemini selection JSON (post-dedup):\n```json\n" +
        selectionForTelegram.slice(0, 3500) +
        "\n```"
    );
    console.log("Shortlist + notify finished.");
    return { count: shortlist.markets.length };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof (err as any)?.message === "string"
          ? (err as any).message
          : typeof err === "object" && err !== null
            ? JSON.stringify(err).slice(0, 400)
            : String(err);
    console.error("[pipeline] Shortlist error — full error:", err);
    await sendTelegramMessage(
      formatPipelineZeroPendingAlert({
        trace,
        dbWritten,
        dbWriteFailed,
        dbAttempted,
        lastError: msg
      }),
      { plain: true }
    );
    throw err;
  }
}

/** Phase 2: Run blind+anchored prompts only for markets with status = approved. */
export async function runPromptsForApprovedMarkets() {
  const { tokenHealthCheck } = await import("@/lib/pipeline/tokenHealth");
  const health = tokenHealthCheck();
  if (!health.ok) {
    console.error("Token health check failed:", health.message);
    await sendTelegramMessage(`Polycast run-approved skipped: ${health.message}`);
    return;
  }
  const { getTimeBucket } = await import("@/lib/markets/timeBuckets");
  const { fetchMarketById } = await import("@/lib/polymarket/gamma");
  await ensurePromptVersionRow();

  const { data: approved, error } = await supabaseAdmin
    .from("markets")
    .select("id, polymarket_id, title, social_title, resolution_date, category, market_url")
    .eq("status", "approved");

  if (error || !approved?.length) {
    console.log("No approved markets to run.");
    return;
  }

  const now = new Date();
  for (const market of approved as any[]) {
    const gamma = await fetchMarketById(market.polymarket_id);
    if (!gamma || (gamma as any).closed) continue;
    const outcomes = (gamma as any).outcomes;
    const prices = (gamma as any).outcomePrices;
    let prob = 0.5;
    if (outcomes && prices) {
      const o = Array.isArray(outcomes) ? outcomes : JSON.parse(outcomes);
      const p = Array.isArray(prices) ? prices : JSON.parse(prices);
      const yesIdx = o.findIndex((x: string) => String(x).toLowerCase() === "yes");
      if (yesIdx >= 0 && p[yesIdx] != null) prob = Number(p[yesIdx]);
    }
    const vol = (gamma as any).volume ? Number((gamma as any).volume) : 0;
    const resolutionDate = market.resolution_date
      ? new Date(market.resolution_date)
      : null;
    const { daysToResolution, timeBucket } = getTimeBucket(now, resolutionDate);
    const m = {
      polymarketId: market.polymarket_id,
      title: market.title,
      category: market.category,
      probability: prob,
      volume: vol,
      resolutionDate,
      daysToResolution,
      timeBucket,
      marketUrl: market.market_url ?? null
    };
    try {
      await runBlindAndAnchoredForMarketWithId(market.id, m, {
        socialTitle: market.social_title
      });
    } catch (err) {
      console.error(`Approved run failed for market ${market.id}:`, err);
      await logErrorToDb({
        job: "run_prompts_approved",
        marketId: market.id,
        error: err
      });
    }
  }
  console.log("Prompts for approved markets finished.");
}

/** Run prompt pipeline for a single market (e.g. after Approve in admin). */
export async function runPromptsForMarketId(marketId: string): Promise<void> {
  const { getTimeBucket } = await import("@/lib/markets/timeBuckets");
  const { fetchMarketById } = await import("@/lib/polymarket/gamma");
  await ensurePromptVersionRow();
  const { data: market, error } = await supabaseAdmin
    .from("markets")
    .select("id, polymarket_id, title, social_title, resolution_date, category, market_url")
    .eq("id", marketId)
    .single();
  if (error || !market) throw new Error("Market not found");
  const gamma = await fetchMarketById((market as any).polymarket_id);
  let prob = 0.5;
  let vol = 0;
  if (gamma && !(gamma as any).closed) {
    const outcomes = (gamma as any).outcomes;
    const prices = (gamma as any).outcomePrices;
    if (outcomes && prices) {
      const o = Array.isArray(outcomes) ? outcomes : JSON.parse(outcomes);
      const p = Array.isArray(prices) ? prices : JSON.parse(prices);
      const yesIdx = o.findIndex((x: string) => String(x).toLowerCase() === "yes");
      if (yesIdx >= 0 && p[yesIdx] != null) prob = Number(p[yesIdx]);
    }
    vol = (gamma as any).volume ? Number((gamma as any).volume) : 0;
  }
  const resolutionDate = (market as any).resolution_date
    ? new Date((market as any).resolution_date)
    : null;
  const { daysToResolution, timeBucket } = getTimeBucket(new Date(), resolutionDate);
  const m = {
    polymarketId: (market as any).polymarket_id,
    title: (market as any).title,
    category: (market as any).category,
    probability: prob,
    volume: vol,
    resolutionDate,
    daysToResolution,
    timeBucket,
    marketUrl: (market as any).market_url ?? null
  };
  await runBlindAndAnchoredForMarketWithId(marketId, m, {
    socialTitle: (market as any).social_title
  });
}

