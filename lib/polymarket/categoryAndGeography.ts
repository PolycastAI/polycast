import type { GammaMarket, ShortlistMarket } from "./types";
import { parseGeminiJsonArray } from "@/lib/ai/geminiJson";

/** Standardised category labels (must match user spec). */
export const STANDARD_CATEGORIES = [
  "Politics",
  "Crypto",
  "Sports",
  "Tech/AI",
  "Economics",
  "Culture",
  "Entertainment",
  "Geopolitics",
  "Business",
  "Legal",
  "Science",
  "Environment"
] as const;

export type StandardCategory = (typeof STANDARD_CATEGORIES)[number];

const KEYWORDS: Record<StandardCategory, string[]> = {
  Politics: [
    "politics",
    "political",
    "election",
    "president",
    "congress",
    "senate",
    "house",
    "vote",
    "democrat",
    "republican",
    "governor",
    "mayor",
    "parliament",
    "primary",
    "ballot"
  ],
  Crypto: [
    "crypto",
    "bitcoin",
    "ethereum",
    "btc",
    "eth",
    "defi",
    "blockchain",
    "solana",
    "token",
    "nft"
  ],
  Sports: [
    "sports",
    "nba",
    "nfl",
    "mlb",
    "nhl",
    "soccer",
    "football",
    "basketball",
    "tennis",
    "olympic",
    "ufc",
    "f1",
    "super bowl",
    "world cup"
  ],
  "Tech/AI": [
    "tech",
    "technology",
    "ai",
    "artificial intelligence",
    "software",
    "openai",
    "google",
    "apple",
    "startup",
    "chip",
    "semiconductor"
  ],
  Economics: [
    "economics",
    "economic",
    "economy",
    "fed",
    "inflation",
    "gdp",
    "recession",
    "interest rate",
    "jobs report",
    "unemployment",
    "treasury"
  ],
  Culture: ["culture", "society", "religion", "social"],
  Entertainment: [
    "entertainment",
    "movie",
    "oscar",
    "grammy",
    "celebrity",
    "music",
    "tv show",
    "streaming",
    "hollywood"
  ],
  Geopolitics: [
    "geopolitics",
    "war",
    "nato",
    "sanctions",
    "invasion",
    "military",
    "conflict",
    "ceasefire"
  ],
  Business: [
    "business",
    "earnings",
    "stock",
    "ipo",
    "merger",
    "company",
    "ceo",
    "revenue",
    "fortune"
  ],
  Legal: ["legal", "court", "lawsuit", "trial", "judge", "supreme court", "indictment", "verdict"],
  Science: ["science", "nasa", "space", "physics", "biology", "research", "study", "clinical"],
  Environment: ["environment", "climate", "carbon", "emission", "renewable", "weather", "hurricane"]
};

function firstTagLabel(tags: unknown): string | null {
  if (!tags || !Array.isArray(tags) || tags.length === 0) return null;
  const t = tags[0];
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const o = t as { label?: string; slug?: string };
    return o.label ?? o.slug ?? null;
  }
  return null;
}

/**
 * Raw category from Polymarket API (order: category → tags[0] → events[0].category → events[0].tags[0]).
 */
export function extractRawCategoryFromGammaMarket(m: GammaMarket | null): string | null {
  if (!m) return null;
  if (typeof m.category === "string" && m.category.trim()) return m.category.trim();

  const tags = m.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    const f = firstTagLabel(tags);
    if (f?.trim()) return f.trim();
  }

  const e0 = m.events?.[0] as
    | { category?: string | null; tags?: unknown }
    | undefined;
  if (e0?.category && String(e0.category).trim()) return String(e0.category).trim();
  if (e0?.tags) {
    const f = firstTagLabel(e0.tags);
    if (f?.trim()) return f.trim();
  }

  return null;
}

/** Map a Polymarket or model string to the closest standard category, or null. */
export function mapToStandardCategory(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  for (const c of STANDARD_CATEGORIES) {
    if (c.toLowerCase() === lower) return c;
  }
  // common aliases
  if (lower === "tech" || lower === "ai") return "Tech/AI";

  let best: StandardCategory | null = null;
  let bestScore = 0;
  for (const c of STANDARD_CATEGORIES) {
    let score = 0;
    for (const kw of KEYWORDS[c]) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

const ALLOWED_GEOGRAPHY = [
  "Global",
  "USA",
  "Europe",
  "UK",
  "Russia",
  "Ukraine",
  "Middle East",
  "Asia",
  "Crypto (no geography)"
] as const;

function normalizeGeography(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  for (const g of ALLOWED_GEOGRAPHY) {
    if (g.toLowerCase() === lower) return g;
  }
  if (lower.includes("crypto") && lower.includes("no geography")) return "Crypto (no geography)";
  if (lower === "us" || lower === "united states" || lower === "america") return "USA";
  if (lower === "united kingdom" || lower === "britain" || lower === "great britain") return "UK";
  for (const g of ALLOWED_GEOGRAPHY) {
    if (lower.includes(g.toLowerCase())) return g;
  }
  return null;
}

const GEOGRAPHY_SYSTEM_PROMPT = `You classify prediction markets only. Output must be strict JSON.`;

/**
 * One Gemini call for all shortlist markets: geography + optional category when missing from API.
 */
export async function enrichShortlistWithGeminiGeographyAndCategories(
  markets: ShortlistMarket[]
): Promise<void> {
  if (markets.length === 0) return;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[categoryAndGeography] GOOGLE_AI_API_KEY missing; skipping geography / missing categories"
    );
    return;
  }

  const payload = markets.map((m) => ({
    id: m.polymarketId,
    question: m.title,
    existing_category: m.category ?? m.categoryFromApiRaw ?? null
  }));

  const userPrompt =
    `For each of the following prediction markets, classify the geographic scope as one of: Global, USA, Europe, UK, Russia, Ukraine, Middle East, Asia, Crypto (no geography). ` +
    `Return ONLY a valid JSON array where each object has: id (the market id I provide), category (if you can determine it and none was provided), market_geography. No markdown, no preamble.\n\n` +
    `Markets:\n${JSON.stringify(payload)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: GEOGRAPHY_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.2
          }
        })
      }
    );

    const json = await res.json();
    if (!res.ok) {
      console.error(
        "[categoryAndGeography] Gemini error:",
        res.status,
        JSON.stringify(json).slice(0, 400)
      );
      return;
    }

    const text =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
    const parsed = parseGeminiJsonArray(text);
    const byId = new Map<
      string,
      { category?: unknown; market_geography?: unknown }
    >();

    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const o = row as { id?: string; category?: unknown; market_geography?: unknown };
      const id = o.id != null ? String(o.id) : "";
      if (!id) continue;
      byId.set(id, o);
    }

    for (const m of markets) {
      const row = byId.get(m.polymarketId);
      if (!row) {
        console.warn(
          "[categoryAndGeography] No Gemini row for market id",
          m.polymarketId
        );
        continue;
      }
      const geo = normalizeGeography(
        row.market_geography != null ? String(row.market_geography) : null
      );
      m.marketGeography = geo;

      if (!m.category && row.category != null && String(row.category).trim()) {
        const raw = String(row.category).trim();
        m.category = mapToStandardCategory(raw) ?? raw;
      }
    }
  } catch (e) {
    console.error("[categoryAndGeography] Gemini batch failed:", e);
  }
}
