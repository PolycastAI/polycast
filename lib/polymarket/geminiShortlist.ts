/**
 * Market selection via Gemini: fetch raw markets, strip to minimal fields,
 * prompt Gemini for 20 selections, fetch full details for description, dedup, return ShortlistMarket[].
 */

import { getTimeBucket } from "@/lib/markets/timeBuckets";
import type { ShortlistMarket, GammaMarket } from "./types";
import { fetchMarketById } from "./gamma";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

const GEMINI_SYSTEM_PROMPT = `You are a market selection agent for Polycast, an AI prediction market forecasting service. Every day you select the 20 most interesting Polymarket markets for four AI models to forecast head-to-head.

Select 20 markets from the list provided. Your selection must:
- Only include binary YES/NO markets with a probability between 10% and 90%
- Only include markets with a known resolution date
- Only include markets with volume above $5,000
- Include a mix of resolution timeframes — some resolving in 2-7 days, some in 8-30 days, some in 31+ days. Avoid markets resolving today.
- Include genuine variety across all topics and categories present in the list — politics, economics, crypto, sports, tech, AI, science, culture, entertainment, geopolitics, business, legal, environment, or anything else that appears. Do not over-represent any single category. Spread the selection as broadly as possible across whatever topics are available.
- Prioritise markets that are genuinely uncertain, interesting to forecast, and likely to generate engagement — markets in the news, markets with recent volume spikes, markets where reasonable people disagree
- Avoid duplicate topics — don't pick two markets about the same underlying event

Return ONLY a valid JSON array with no markdown, no preamble. Each object must have only: id, question, crowd_price (YES probability as integer 0-100), endDate (ISO string), volume (number). In the JSON: use no newlines inside string values, and escape any double-quotes inside question text with a backslash (e.g. \\").`;

/** Raw market row we send to Gemini (no description). */
export interface StrippedMarket {
  id: string;
  question: string;
  endDate: string;
  volume: number;
  yesPrice: number;
  slug?: string | null;
}

function parseOutcomes(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return String(raw).split(",").map((s) => s.trim());
  }
}

function parsePrices(raw: string | string[] | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((p) => Number(p));
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p.map((x: unknown) => Number(x)) : [];
  } catch {
    return String(raw).split(",").map((s) => Number(s.trim()));
  }
}

function getYesPrice(m: GammaMarket): number | null {
  const outcomes = parseOutcomes(m.outcomes);
  const prices = parsePrices(m.outcomePrices);
  if (outcomes.length !== 2 || prices.length !== 2) return null;
  const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
  if (yesIdx === -1) return null;
  const v = prices[yesIdx];
  return Number.isFinite(v) ? v : null;
}

/** Fetch raw markets from Gamma (limit 100, by volume desc). */
async function fetchRawMarkets(): Promise<GammaMarket[]> {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=100&order=volume&ascending=false`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const list = Array.isArray(data) ? data : data?.markets ?? [];
  return Array.isArray(list) ? list : [];
}

/**
 * Strip to id, question, endDate, volume, yesPrice. Only include binary 10–90%, volume > 5000, has endDate.
 */
function stripMarkets(raw: GammaMarket[]): StrippedMarket[] {
  const out: StrippedMarket[] = [];
  for (const m of raw) {
    if (m.active !== true || m.closed === true) continue;
    const outcomes = parseOutcomes(m.outcomes);
    const prices = parsePrices(m.outcomePrices);
    if (outcomes.length !== 2 || prices.length !== 2) continue;
    const yesPrice = getYesPrice(m);
    if (yesPrice == null || yesPrice < 0.1 || yesPrice > 0.9) continue;
    const volume = Number(m.volume ?? 0);
    if (volume < 5000) continue;
    // Prefer market's own resolution fields; fall back to parent event's endDate if present.
    const endDate =
      m.endDate ??
      (m as { endDateIso?: string }).endDateIso ??
      m.gameStartTime ??
      m.events?.[0]?.endDate ??
      null;
    if (!endDate) continue;
    out.push({
      id: m.id,
      question: m.question ?? "Untitled",
      endDate: String(endDate),
      volume,
      yesPrice,
      slug: m.slug ?? null
    });
  }
  return out;
}

/**
 * Parse Gemini's response into a JSON array. Handles markdown fences, leading/trailing text,
 * and truncated or slightly malformed JSON (e.g. unterminated string at end).
 */
function parseGeminiJsonArray(raw: string): unknown[] {
  let text = raw.replace(/```json?\s*/i, "").replace(/```\s*$/, "").trim();
  // Remove control characters that can break JSON (e.g. U+2028 line separator)
  text = text.replace(/[\u0000-\u001F\u2028\u2029]/g, (m) => (m === "\n" || m === "\r" || m === "\t" ? m : " "));
  const firstBracket = text.indexOf("[");
  if (firstBracket === -1) return [];
  text = text.slice(firstBracket);
  const lastBracket = text.lastIndexOf("]");
  if (lastBracket !== -1) text = text.slice(0, lastBracket + 1);

  const tryParse = (str: string): unknown[] | null => {
    try {
      const out = JSON.parse(str);
      return Array.isArray(out) ? out : [];
    } catch {
      return null;
    }
  };

  let result = tryParse(text);
  if (result != null) return result;

  // Fix unescaped newlines in response (common cause of "Unterminated string")
  const noNewlines = text.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
  result = tryParse(noNewlines);
  if (result != null) return result;

  // Truncate at last complete object boundary to recover partial array
  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}" && (text[i + 1] === "," || text[i + 1] === "]")) {
      const truncated = text.slice(0, i + 1) + "]";
      result = tryParse(truncated);
      if (result != null) return result;
    }
  }
  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}") {
      const truncated = text.slice(0, i + 1) + "]";
      result = tryParse(truncated);
      if (result != null) return result;
    }
  }

  console.warn("[geminiShortlist] Could not parse Gemini JSON; raw slice:", text.slice(0, 800));
  return [];
}

/** Call Gemini for N selections from the given list. Returns array of { id, question, crowd_price, endDate, volume }. */
async function callGeminiForSelection(
  strippedList: StrippedMarket[],
  wantCount: number
): Promise<{ id: string; question: string; crowd_price: number; endDate: string; volume: number }[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not set");

  // Send only the fields requested in the system prompt.
  const safeList = strippedList.map((s) => ({
    id: s.id,
    question: s.question,
    endDate: s.endDate,
    volume: s.volume,
    yesPrice: s.yesPrice
  }));
  const userContent = JSON.stringify(safeList);
  const instruction =
    wantCount >= strippedList.length
      ? `Select all ${strippedList.length} markets from this list. Return only a JSON array.\n\n`
      : `Select exactly ${wantCount} markets from this list. Return only a JSON array.\n\n`;

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
      question: String(o?.question ?? ""),
      crowd_price: Number(o?.crowd_price) || 0,
      endDate: String(o?.endDate ?? ""),
      volume: Number(o?.volume) ?? 0
    }))
    .filter((x: { id: string }) => x.id);
}

/** Fetch full market by id to get description. */
async function fetchFullMarket(polymarketId: string): Promise<GammaMarket | null> {
  return fetchMarketById(polymarketId);
}

export interface GeminiShortlistResult {
  markets: ShortlistMarket[];
  debug: {
    totalFetched: number;
    strippedCount: number;
    afterDedup: number;
  };
}

/**
 * Build shortlist via Gemini: fetch raw → strip → Gemini select 20 → fetch full for description → dedup (re-prompt to fill).
 */
export async function buildGeminiShortlist(
  existingPolymarketIds: string[],
  excludedPolymarketIds: string[]
): Promise<GeminiShortlistResult> {
  const existingSet = new Set(existingPolymarketIds);
  const excludedSet = new Set(excludedPolymarketIds);

  const raw = await fetchRawMarkets();
  const stripped = stripMarkets(raw);
  const slugById = new Map<string, string | null>(stripped.map((s) => [s.id, s.slug ?? null]));
  const pool = stripped.filter((s) => !existingSet.has(s.id) && !excludedSet.has(s.id));

  let selected: { id: string; question: string; crowd_price: number; endDate: string; volume: number }[] = [];
  const wantFirst = Math.min(20, pool.length);
  if (pool.length > 0) {
    const first = await callGeminiForSelection(pool, wantFirst);
    selected = first.filter((x) => x.id && !existingSet.has(x.id) && !excludedSet.has(x.id));
  }

  // Dedup: replace any removed by re-prompting with remaining pool until we have 20 or pool exhausted.
  const maxRounds = 5;
  let round = 0;
  while (selected.length < 20 && round < maxRounds) {
    round += 1;
    const alreadyIds = new Set(selected.map((s) => s.id));
    const remainingPool = pool.filter((s) => !alreadyIds.has(s.id));
    if (remainingPool.length === 0) break;
    const need = Math.min(20 - selected.length, remainingPool.length);
    const more = await callGeminiForSelection(remainingPool, need);
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
    const full = await fetchFullMarket(sel.id);
    const resolutionDate = sel.endDate ? new Date(sel.endDate) : null;
    if (!resolutionDate || isNaN(resolutionDate.getTime())) continue;
    const { daysToResolution, timeBucket } = getTimeBucket(now, resolutionDate);
    // Polymarket URLs are event-slug based.
    const slug = (full as { slug?: string | null } | null)?.slug ?? slugById.get(sel.id) ?? null;
    const safeSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? encodeURIComponent(slug.trim())
        : null;
    const marketUrl = safeSlug ? `https://polymarket.com/event/${safeSlug}` : null;
    const description = full?.description ?? null;
    const category = full?.category ?? null;

    markets.push({
      polymarketId: sel.id,
      title: sel.question,
      description,
      resolutionDate,
      crowd_price: sel.crowd_price,
      volume: sel.volume,
      startDate: null,
      category,
      days_to_resolution: daysToResolution,
      time_bucket: timeBucket,
      marketUrl,
      probability: sel.crowd_price / 100,
      daysToResolution,
      timeBucket
    });
  }

  return {
    markets,
    debug: {
      totalFetched: raw.length,
      strippedCount: stripped.length,
      afterDedup: markets.length
    }
  };
}
