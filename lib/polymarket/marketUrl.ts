/**
 * Resolve Polymarket page URLs from Gamma API payloads only.
 * Never derive URLs from titles/questions. Store API values verbatim in DB.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";

async function fetchGammaEventById(eventId: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${GAMMA_BASE}/events?id=${encodeURIComponent(eventId)}`, {
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0];
    if (data && typeof data === "object" && (data as { id?: string }).id != null)
      return data;
    return null;
  } catch {
    return null;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Use url / marketUrl as returned by the API; allow root-relative paths. */
function verbatimUrlFromApiField(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const t = value.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  if (t.startsWith("/")) return `https://polymarket.com${t}`;
  return null;
}

/** Only for explicit `slug` fields from the API (not guessed). */
function urlFromEventSlug(slug: string): string {
  return `https://polymarket.com/event/${slug.trim()}`;
}

type UnknownRecord = Record<string, unknown>;

function readEventSlugFromParent(market: UnknownRecord): string | null {
  const ev = market.event;
  if (ev && typeof ev === "object") {
    const s = (ev as UnknownRecord).slug;
    if (isNonEmptyString(s)) return s.trim();
  }
  const first = market.events;
  if (Array.isArray(first) && first.length > 0) {
    const e0 = first[0];
    if (e0 && typeof e0 === "object") {
      const s = (e0 as UnknownRecord).slug;
      if (isNonEmptyString(s)) return s.trim();
    }
  }
  return null;
}

/**
 * Synchronous extraction from one Gamma-like object (market or event).
 * Order: url → marketUrl → slug → event.slug (nested or events[0].slug).
 */
export function extractPolymarketUrlFromApiObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const m = obj as UnknownRecord;

  const directUrl = verbatimUrlFromApiField(m.url);
  if (directUrl) return directUrl;

  const marketUrlField = verbatimUrlFromApiField(m.marketUrl);
  if (marketUrlField) return marketUrlField;

  if (isNonEmptyString(m.slug)) {
    return urlFromEventSlug(m.slug);
  }

  const parentSlug = readEventSlugFromParent(m);
  if (parentSlug) {
    return urlFromEventSlug(parentSlug);
  }

  return null;
}

function getEventIdForFallback(market: unknown): string | null {
  if (!market || typeof market !== "object") return null;
  const m = market as UnknownRecord;

  if (isNonEmptyString(m.eventId)) return m.eventId.trim();

  const ev = m.event;
  if (ev && typeof ev === "object" && isNonEmptyString((ev as UnknownRecord).id)) {
    return String((ev as UnknownRecord).id).trim();
  }

  const events = m.events;
  if (Array.isArray(events) && events.length > 0) {
    const e0 = events[0];
    if (e0 && typeof e0 === "object" && isNonEmptyString((e0 as UnknownRecord).id)) {
      return String((e0 as UnknownRecord).id).trim();
    }
  }

  const legacy = (m as { event_id?: unknown }).event_id;
  if (isNonEmptyString(legacy)) return legacy.trim();

  return null;
}

/**
 * Full resolution: in-object fields, then GET /events?id={eventId} and same rules on the event.
 */
export async function resolvePolymarketUrlFromGammaMarket(
  market: unknown,
  context?: { polymarketId?: string }
): Promise<string | null> {
  const sync = extractPolymarketUrlFromApiObject(market);
  if (sync) return sync;

  const eventId = getEventIdForFallback(market);
  if (!eventId) {
    console.warn(
      "[polymarket-url] No URL fields and no eventId on Gamma market",
      context?.polymarketId ?? ""
    );
    return null;
  }

  const eventPayload = await fetchGammaEventById(eventId);
  if (!eventPayload) {
    console.warn(
      "[polymarket-url] Failed to fetch event",
      eventId,
      "for market",
      context?.polymarketId ?? ""
    );
    return null;
  }

  const fromEvent = extractPolymarketUrlFromApiObject(eventPayload);
  if (fromEvent) return fromEvent;

  console.warn(
    "[polymarket-url] No usable URL in event response",
    eventId,
    "for market",
    context?.polymarketId ?? ""
  );
  return null;
}
