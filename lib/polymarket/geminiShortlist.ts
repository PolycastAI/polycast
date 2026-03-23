/**
 * Shortlist: fetch Gamma /events, filter, one Gemini call (gemini-2.5-flash) picks 20
 * with geography + category in the same response; pad/enforce use in-memory pool only.
 */

import { parseGeminiJsonArray } from "@/lib/ai/geminiJson";
import { getTimeBucket } from "@/lib/markets/timeBuckets";
import type { ShortlistMarket } from "./types";
import {
  mapToStandardCategory,
  normalizeGeography,
  STANDARD_CATEGORIES
} from "./categoryAndGeography";

const GEO_LABELS =
  "Global, USA, Europe, UK, Russia, Ukraine, Middle East, Asia, Crypto (no geography)";
const CATEGORY_LABELS = STANDARD_CATEGORIES.join(", ");

const GAMMA_BASE = "https://gamma-api.polymarket.com";

const EVENTS_URL = `${GAMMA_BASE}/events?active=true&closed=false&limit=100&order=volume&ascending=false`;

const GEMINI_SYSTEM_PROMPT = `You are a market selection agent for Polycast, an AI prediction market forecasting service. Every day you select the 20 most interesting Polymarket events for four AI models to forecast head-to-head.

Select 20 events from the list provided. Each row includes id, title, endDate, volume, crowd_price, and days_to_resolution (integer days from today until resolution). Your selection must:
- Only include binary YES/NO markets with a probability between 10% and 90%
- Only include events with a known resolution date
- Only include events with volume above $5,000
- Time horizon (critical): Strongly prefer markets resolving within the next 30 days. At least 10 of the 20 selected markets must have days_to_resolution of 30 or fewer. Only include longer-horizon markets (31+ days) if they are exceptionally high volume or exceptional interest — use those sparingly to fill remaining slots.
- Avoid selecting parent events that are collections of sub-markets with vague umbrella titles (e.g. "What will happen before X", "Which price will Y hit", or similar) when the list offers clearer alternatives — prefer events with a single clear YES/NO question. If you must include a multi-outcome parent, deprioritise vague titles in favour of specific, forecastable questions.
- Include genuine variety across all topics and categories present in the list — politics, economics, crypto, sports, tech, AI, science, culture, entertainment, geopolitics, business, legal, environment, or anything else that appears. Do not over-represent any single category. Spread the selection as broadly as possible across whatever topics are available.
- Prioritise events that are genuinely uncertain, interesting to forecast, and likely to generate engagement — events in the news, events with recent volume spikes, events where reasonable people disagree
- Avoid duplicate topics — don't pick two events about the same underlying topic
- Avoid events resolving today (days_to_resolution <= 0)
- For every selected row you MUST also output geographic scope and topic category:
  - market_geography: exactly one of: ${GEO_LABELS}
  - category: exactly one of: ${CATEGORY_LABELS} (single best fit for the question)

Return ONLY a valid JSON array with no markdown, no preamble. Each object must have: id, title, crowd_price (YES probability as integer 0-100), endDate (ISO string), volume (number), market_geography (string), category (string). In the JSON: use no newlines inside string values, and escape any double-quotes inside title text with a backslash (e.g. \\").`;

/** Fully parsed event after structural filters (cache for post-Gemini). */
export interface ParsedGammaEvent {
  polymarketId: string;
  /** Event-level title from Gamma (used when markets.length === 1). */
  title: string;
  slug: string;
  /** Event-level description (used when markets.length === 1). */
  description: string | null;
  /** Number of nested markets under this event (parent "collection" events have > 1). */
  marketsCount: number;
  /** markets[0].question — used as display title when marketsCount > 1. */
  firstMarketQuestion: string | null;
  /** markets[0].description — used as resolution criteria when marketsCount > 1. */
  firstMarketDescription: string | null;
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

  const eventTitle = typeof e.title === "string" ? e.title : "";
  if (!eventTitle.trim()) return null;

  const eventDescription =
    typeof e.description === "string" ? e.description : e.description == null ? null : String(e.description);

  const marketsCount = markets.length;
  const firstMarketQuestion =
    typeof m.question === "string" && m.question.trim() ? m.question.trim() : null;
  const firstMarketDescription =
    typeof m.description === "string"
      ? m.description
      : m.description == null
        ? null
        : String(m.description);

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
    title: eventTitle.trim(),
    slug,
    description: eventDescription,
    marketsCount,
    firstMarketQuestion,
    firstMarketDescription,
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
  /** Integer days until resolution (for time-horizon selection rules). */
  days_to_resolution: number;
}

export interface GeminiSelectionRow {
  id: string;
  title: string;
  crowd_price: number;
  endDate: string;
  volume: number;
  market_geography: string | null;
  category: string | null;
}

/** Single Gemini call: select N events with geography + category per row. */
async function callGeminiForSelection(
  strippedList: StrippedForGemini[],
  wantCount: number
): Promise<GeminiSelectionRow[]> {
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
    console.error(
      "[shortlist][Gemini] HTTP error — full body:\n",
      JSON.stringify(json, null, 2).slice(0, 12000)
    );
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 2000)}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";

  console.log(
    "[shortlist][Gemini] Raw model text (before parseGeminiJsonArray), length=",
    text.length,
    ":\n",
    text
  );
  if (!text.trim()) {
    console.error(
      "[shortlist][Gemini] Empty text — full API JSON (truncated):\n",
      JSON.stringify(json, null, 2).slice(0, 12000)
    );
  }

  const parsed = parseGeminiJsonArray(text);
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr
    .map((o: Record<string, unknown>) => {
      const mg = o?.market_geography;
      const cat = o?.category;
      return {
        id: String(o?.id ?? ""),
        title: String(o?.title ?? ""),
        crowd_price: Number(o?.crowd_price) || 0,
        endDate: String(o?.endDate ?? ""),
        volume: Number(o?.volume) ?? 0,
        market_geography:
          mg != null && String(mg).trim() ? String(mg).trim() : null,
        category: cat != null && String(cat).trim() ? String(cat).trim() : null
      };
    })
    .filter((x: GeminiSelectionRow) => x.id);
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

function toStripped(e: ParsedGammaEvent, now: Date): StrippedForGemini {
  const { daysToResolution } = getTimeBucket(now, e.endDate);
  const d = daysToResolution ?? 0;
  return {
    id: e.polymarketId,
    title: e.title,
    endDate: e.endDateIso,
    volume: e.volume,
    crowd_price: e.crowd_price,
    days_to_resolution: d
  };
}

/** 1–30 days inclusive (post “positive days” pool filter). */
function isWithin30DaysHorizon(days: number | null | undefined): boolean {
  return days != null && days >= 1 && days <= 30;
}

/** Gemini-provided labels for the initial selection only (pad/swap uses pool-only defaults). */
export type GeminiMarketLabels = {
  market_geography: string | null;
  category: string | null;
};

function buildShortlistMarketFromParsed(
  ev: ParsedGammaEvent,
  now: Date,
  gemini?: GeminiMarketLabels | null
): ShortlistMarket {
  const { daysToResolution, timeBucket } = getTimeBucket(now, ev.endDate);
  const categoryRaw = ev.category;
  let category = categoryRaw ? mapToStandardCategory(categoryRaw) ?? categoryRaw : null;
  if (gemini?.category != null && gemini.category.trim()) {
    const raw = gemini.category.trim();
    category = mapToStandardCategory(raw) ?? raw;
  }

  let marketGeography: string | null = null;
  if (gemini?.market_geography != null && gemini.market_geography.trim()) {
    marketGeography = normalizeGeography(gemini.market_geography);
  }

  const multiParent = ev.marketsCount > 1;
  const displayTitle =
    multiParent && ev.firstMarketQuestion && ev.firstMarketQuestion.trim().length > 0
      ? ev.firstMarketQuestion.trim()
      : ev.title;
  const displayDescription = multiParent ? ev.firstMarketDescription ?? null : ev.description;

  return {
    polymarketId: ev.polymarketId,
    title: displayTitle,
    description: displayDescription,
    resolutionDate: ev.endDate,
    crowd_price: ev.crowd_price,
    volume: ev.volume,
    startDate: ev.startDate,
    category,
    categoryFromApiRaw: categoryRaw,
    marketGeography,
    days_to_resolution: daysToResolution,
    time_bucket: timeBucket,
    marketUrl: ev.market_url,
    probability: ev.yesProbability,
    daysToResolution,
    timeBucket
  };
}

/** Pad to 20 using highest-volume pool rows not yet selected. */
function padMarketsToTwenty(
  markets: ShortlistMarket[],
  pool: ParsedGammaEvent[],
  now: Date
): ShortlistMarket[] {
  const out = [...markets];
  const selectedIds = new Set(out.map((m) => m.polymarketId));
  while (out.length < 20) {
    const next = pool
      .filter((p) => !selectedIds.has(p.polymarketId))
      .sort((a, b) => b.volume - a.volume)[0];
    if (!next) break;
    out.push(buildShortlistMarketFromParsed(next, now));
    selectedIds.add(next.polymarketId);
  }
  if (out.length < 20) {
    console.warn(
      `[shortlist] Only ${out.length} markets after padding (pool exhausted before 20).`
    );
  }
  return out.slice(0, 20);
}

/**
 * Ensure at least 10 markets have days_to_resolution in 1–30 by swapping in
 * highest-volume in-range pool events and dropping lowest-volume beyond-30 rows.
 */
function enforceMinTenWithin30Days(
  markets: ShortlistMarket[],
  pool: ParsedGammaEvent[],
  now: Date
): ShortlistMarket[] {
  let current = [...markets].slice(0, 20);

  const countWithin = () =>
    current.filter((m) => isWithin30DaysHorizon(m.days_to_resolution)).length;

  let swaps = 0;
  while (countWithin() < 10) {
    const within = current.filter((m) => isWithin30DaysHorizon(m.days_to_resolution));
    const beyond = current.filter((m) => !isWithin30DaysHorizon(m.days_to_resolution));
    if (beyond.length === 0) {
      console.warn(
        `[shortlist] Cannot reach 10 within-30 markets: no beyond-30 rows left to replace (have ${within.length}).`
      );
      break;
    }

    const selectedIds = new Set(current.map((m) => m.polymarketId));
    const add = pool
      .filter((p) => !selectedIds.has(p.polymarketId))
      .filter((p) => {
        const d = getTimeBucket(now, p.endDate).daysToResolution;
        return isWithin30DaysHorizon(d);
      })
      .sort((a, b) => b.volume - a.volume)[0];

    if (!add) {
      console.warn(
        `[shortlist] Cannot reach 10 within-30 markets: no eligible pool candidates (currently ${within.length} within 30).`
      );
      break;
    }

    beyond.sort((a, b) => Number(a.volume) - Number(b.volume));
    const remove = beyond[0];
    current = current.filter((m) => m.polymarketId !== remove.polymarketId);
    current.push(buildShortlistMarketFromParsed(add, now));
    swaps += 1;
  }

  if (swaps > 0) {
    console.log(
      `[shortlist] Enforced 30-day minimum: ${swaps} swap(s); now ${countWithin()} markets with 1–30 days to resolution.`
    );
  }

  return current.slice(0, 20);
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

  const nowForStripped = new Date();
  const poolStripped = pool.map((p) => toStripped(p, nowForStripped));

  let selected: GeminiSelectionRow[] = [];
  const wantCount = Math.min(20, poolStripped.length);
  if (poolStripped.length > 0) {
    const first = await callGeminiForSelection(poolStripped, wantCount);
    selected = first.filter(
      (x) => x.id && !existingSet.has(x.id) && !excludedSet.has(x.id)
    );
  }

  const cache = new Map<string, ParsedGammaEvent>();
  for (const p of pool) cache.set(p.polymarketId, p);

  const now = new Date();
  let markets: ShortlistMarket[] = [];

  const seenIds = new Set<string>();
  for (const sel of selected) {
    if (seenIds.has(sel.id)) continue;
    const ev = cache.get(sel.id);
    if (!ev) {
      console.warn("[shortlist] Gemini selected unknown id (not in cache):", sel.id);
      continue;
    }
    seenIds.add(sel.id);
    markets.push(
      buildShortlistMarketFromParsed(ev, now, {
        market_geography: sel.market_geography,
        category: sel.category
      })
    );
    if (markets.length >= 20) break;
  }

  markets = padMarketsToTwenty(markets, pool, now);
  markets = enforceMinTenWithin30Days(markets, pool, now);

  const within30 = markets.filter((m) =>
    isWithin30DaysHorizon(m.days_to_resolution)
  ).length;
  console.log(
    `[shortlist] Final shortlist: ${markets.length} markets; ${within30} with 1–30 days to resolution (requirement: at least 10)`
  );

  for (const m of markets) {
    const crit =
      m.description && m.description.length > 220
        ? `${m.description.slice(0, 220)}…`
        : m.description ?? "";
    console.log("[shortlist] Selected event (final):", {
      title: m.title,
      resolution_criteria_preview: crit,
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
