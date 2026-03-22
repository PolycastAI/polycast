/**
 * Shortlist: fetch Gamma /events, filter, Gemini (gemini-2.5-flash) picks 20,
 * enrich from cached event objects only (no extra Polymarket API calls).
 */

import { parseGeminiJsonArray } from "@/lib/ai/geminiJson";
import { getTimeBucket } from "@/lib/markets/timeBuckets";
import type { ShortlistMarket } from "./types";
import {
  mapToStandardCategory,
  enrichShortlistWithGeminiGeographyAndCategories
} from "./categoryAndGeography";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

const EVENTS_URL = `${GAMMA_BASE}/events?active=true&closed=false&limit=100&order=volume&ascending=false`;

const GEMINI_SYSTEM_PROMPT = `You are a market selection agent for Polycast, an AI prediction market forecasting service. Every day you select the 20 most interesting Polymarket events for four AI models to forecast head-to-head.

Select 20 events from the list provided. Your selection must:
- Only include binary YES/NO markets with a probability between 10% and 90%
- Only include events with a known resolution date
- Only include events with volume above $5,000
- Include a mix of resolution timeframes — some resolving in 2-7 days, some in 8-30 days, some in 31+ days. Avoid events resolving today.
- Include genuine variety across all topics and categories present in the list — politics, economics, crypto, sports, tech, AI, science, culture, entertainment, geopolitics, business, legal, environment, or anything else that appears. Do not over-represent any single category. Spread the selection as broadly as possible across whatever topics are available.
- Prioritise events that are genuinely uncertain, interesting to forecast, and likely to generate engagement — events in the news, events with recent volume spikes, events where reasonable people disagree
- Avoid duplicate topics — don't pick two events about the same underlying topic

Return ONLY a valid JSON array with no markdown, no preamble. Each object must have only: id, title, crowd_price (YES probability as integer 0-100), endDate (ISO string), volume (number). In the JSON: use no newlines inside string values, and escape any double-quotes inside title text with a backslash (e.g. \\").`;

/** Fully parsed event after structural filters (cache for post-Gemini). */
export interface ParsedGammaEvent {
  polymarketId: string;
  title: string;
  slug: string;
  description: string | null;
  endDate: Date;
  endDateIso: string;
  startDate: Date | null;
  volume: number;
  liquidity: number;
  category: string | null;
  crowd_price: number;
  yesProbability: number;
  market_url: string;
}

function parsePrices(raw: string | string[] | null | undefined): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((p) => Number(p));
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p.map((x: unknown) => Number(x)) : [];
  } catch {
    return String(raw)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  }
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/**
 * Parse one Gamma event; returns null if it fails structural filters.
 */
export function tryParseGammaEvent(ev: unknown): ParsedGammaEvent | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;

  if (e.active !== true || e.closed !== false) return null;

  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length < 1) return null;

  const m0 = markets[0];
  if (!m0 || typeof m0 !== "object") return null;
  const m = m0 as Record<string, unknown>;

  const opRaw = m.outcomePrices;
  if (opRaw == null) return null;

  const prices = parsePrices(opRaw as string | string[]);
  if (prices.length !== 2) return null;

  const yesDecimal = prices[0];
  if (!Number.isFinite(yesDecimal) || yesDecimal < 0.1 || yesDecimal > 0.9) return null;

  const volume = num(e.volume);
  if (!Number.isFinite(volume) || volume <= 5000) return null;

  const endRaw = e.endDate ?? e.endDateIso;
  if (endRaw == null || endRaw === "") return null;
  const endDate = new Date(String(endRaw));
  if (isNaN(endDate.getTime())) return null;

  const id = e.id != null ? String(e.id) : "";
  if (!id) return null;

  const slug = typeof e.slug === "string" && e.slug.trim() ? e.slug.trim() : "";
  if (!slug) return null;

  const title = typeof e.title === "string" ? e.title : "";
  if (!title.trim()) return null;

  const description =
    typeof e.description === "string" ? e.description : e.description == null ? null : String(e.description);

  const startRaw = e.startDate ?? e.startDateIso;
  const startDate =
    startRaw != null && startRaw !== ""
      ? new Date(String(startRaw))
      : null;
  const startDateOk = startDate && !isNaN(startDate.getTime()) ? startDate : null;

  const liquidity = num(e.liquidity);
  const liquidityOk = Number.isFinite(liquidity) ? liquidity : 0;

  const category =
    typeof e.category === "string" && e.category.trim()
      ? e.category.trim()
      : null;

  const crowd_price = Math.round(yesDecimal * 100);
  const market_url = `https://polymarket.com/event/${slug}`;

  return {
    polymarketId: id,
    title: title.trim(),
    slug,
    description,
    endDate,
    endDateIso: endDate.toISOString(),
    startDate: startDateOk,
    volume,
    liquidity: liquidityOk,
    category,
    crowd_price,
    yesProbability: yesDecimal,
    market_url
  };
}

async function fetchRawEvents(): Promise<unknown[]> {
  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) {
    console.warn("[shortlist] /events fetch failed:", res.status);
    return [];
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : data?.events ?? data?.data ?? [];
  return Array.isArray(list) ? list : [];
}

export interface StrippedForGemini {
  id: string;
  title: string;
  endDate: string;
  volume: number;
  crowd_price: number;
}

/** Call Gemini for N selections. Returns rows (match final selection by id to cache only). */
async function callGeminiForSelection(
  strippedList: StrippedForGemini[],
  wantCount: number
): Promise<{ id: string; title: string; crowd_price: number; endDate: string; volume: number }[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not set");

  const userContent = JSON.stringify(strippedList);
  const instruction =
    wantCount >= strippedList.length
      ? `Select all ${strippedList.length} events from this list. Return only a JSON array.\n\n`
      : `Select exactly ${wantCount} events from this list. Return only a JSON array.\n\n`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: GEMINI_SYSTEM_PROMPT }]
        },
        contents: [{ parts: [{ text: instruction + userContent }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.4
        }
      })
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
  const parsed = parseGeminiJsonArray(text);
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr
    .map((o: any) => ({
      id: String(o?.id ?? ""),
      title: String(o?.title ?? ""),
      crowd_price: Number(o?.crowd_price) || 0,
      endDate: String(o?.endDate ?? ""),
      volume: Number(o?.volume) ?? 0
    }))
    .filter((x: { id: string }) => x.id);
}

export interface GeminiShortlistResult {
  markets: ShortlistMarket[];
  debug: {
    totalFetched: number;
    /** Structural filters only (before prediction/rejected/held dedup). */
    afterStructuralFilters: number;
    /** After requiring days_to_resolution > 0 (before dedup). */
    afterDaysToResolutionFilter: number;
    /** After dedup; pool sent to Gemini. */
    afterDedup: number;
    afterGemini: number;
  };
}

function toStripped(e: ParsedGammaEvent): StrippedForGemini {
  return {
    id: e.polymarketId,
    title: e.title,
    endDate: e.endDateIso,
    volume: e.volume,
    crowd_price: e.crowd_price
  };
}

/**
 * Build shortlist: GET /events → filter → dedup → Gemini (20) → map from cache only.
 */
export async function buildGeminiShortlist(
  existingPolymarketIds: string[],
  excludedPolymarketIds: string[]
): Promise<GeminiShortlistResult> {
  const existingSet = new Set(existingPolymarketIds);
  const excludedSet = new Set(excludedPolymarketIds);

  const raw = await fetchRawEvents();

  const structural: ParsedGammaEvent[] = [];
  for (const row of raw) {
    const p = tryParseGammaEvent(row);
    if (p) structural.push(p);
  }

  console.log(
    `[shortlist] Events passing structural filters (before prediction/rejected/held dedup): ${structural.length}`
  );

  const nowForFilter = new Date();
  const afterPositiveDays = structural.filter((p) => {
    const { daysToResolution } = getTimeBucket(nowForFilter, p.endDate);
    return daysToResolution != null && daysToResolution > 0;
  });

  console.log(
    `[shortlist] Events after days_to_resolution > 0 filter (before dedup): ${afterPositiveDays.length}`
  );

  const pool = afterPositiveDays.filter(
    (p) => !existingSet.has(p.polymarketId) && !excludedSet.has(p.polymarketId)
  );

  console.log(
    `[shortlist] Candidate pool for Gemini (after dedup): ${pool.length}`
  );

  const poolStripped = pool.map(toStripped);

  let selected: { id: string; title: string; crowd_price: number; endDate: string; volume: number }[] =
    [];
  const wantFirst = Math.min(20, poolStripped.length);
  if (poolStripped.length > 0) {
    const first = await callGeminiForSelection(poolStripped, wantFirst);
    selected = first.filter(
      (x) => x.id && !existingSet.has(x.id) && !excludedSet.has(x.id)
    );
  }

  const cache = new Map<string, ParsedGammaEvent>();
  for (const p of pool) cache.set(p.polymarketId, p);

  const maxRounds = 5;
  let round = 0;
  while (selected.length < 20 && round < maxRounds) {
    round += 1;
    const alreadyIds = new Set(selected.map((s) => s.id));
    const remainingStripped = poolStripped.filter((s) => !alreadyIds.has(s.id));
    if (remainingStripped.length === 0) break;
    const need = Math.min(20 - selected.length, remainingStripped.length);
    const more = await callGeminiForSelection(remainingStripped, need);
    for (const x of more) {
      if (!x.id || existingSet.has(x.id) || excludedSet.has(x.id) || alreadyIds.has(x.id)) continue;
      selected.push(x);
      alreadyIds.add(x.id);
    }
    if (more.length === 0) break;
  }

  const now = new Date();
  const markets: ShortlistMarket[] = [];

  for (const sel of selected.slice(0, 20)) {
    const ev = cache.get(sel.id);
    if (!ev) {
      console.warn("[shortlist] Gemini selected unknown id (not in cache):", sel.id);
      continue;
    }

    const { daysToResolution, timeBucket } = getTimeBucket(now, ev.endDate);
    const categoryRaw = ev.category;
    const category = categoryRaw ? mapToStandardCategory(categoryRaw) ?? categoryRaw : null;

    markets.push({
      polymarketId: ev.polymarketId,
      title: ev.title,
      description: ev.description,
      resolutionDate: ev.endDate,
      crowd_price: ev.crowd_price,
      volume: ev.volume,
      startDate: ev.startDate,
      category,
      categoryFromApiRaw: categoryRaw,
      marketGeography: null,
      days_to_resolution: daysToResolution,
      time_bucket: timeBucket,
      marketUrl: ev.market_url,
      probability: ev.yesProbability,
      daysToResolution,
      timeBucket
    });
  }

  await enrichShortlistWithGeminiGeographyAndCategories(markets);

  for (const m of markets) {
    console.log("[shortlist] Selected event (final):", {
      title: m.title,
      crowd_price: m.crowd_price,
      volume: m.volume,
      days_to_resolution: m.days_to_resolution,
      time_bucket: m.time_bucket,
      market_url: m.marketUrl
    });
  }

  return {
    markets,
    debug: {
      totalFetched: raw.length,
      afterStructuralFilters: structural.length,
      afterDaysToResolutionFilter: afterPositiveDays.length,
      afterDedup: pool.length,
      afterGemini: markets.length
    }
  };
}
