import type { GammaMarket } from "./types";

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

/** Normalize model / user geography strings to allowed shortlist labels. */
export function normalizeGeography(raw: string | null | undefined): string | null {
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

