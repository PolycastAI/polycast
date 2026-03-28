import { GammaMarket, ShortlistMarket } from "./types";
import { getTimeBucket, type TimeBucket } from "../markets/timeBuckets";
import {
  extractRawCategoryFromGammaMarket,
  mapToStandardCategory
} from "./categoryAndGeography";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

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

/** Fetch a single event by id for endDate fallback */
async function fetchEventById(eventId: string): Promise<{ endDate?: string } | null> {
  try {
    const res = await fetch(
      `${GAMMA_BASE}/events?id=${encodeURIComponent(eventId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const ev = Array.isArray(data) ? data[0] : data?.id ? data : null;
    if (ev?.endDate) return { endDate: ev.endDate };
    if (Array.isArray(data) && data.length > 0 && (data[0] as { endDate?: string }).endDate)
      return { endDate: (data[0] as { endDate: string }).endDate };
    return null;
  } catch {
    return null;
  }
}

/** Resolve resolution date: endDate, endDateIso, gameStartTime, events[0].endDate, or fetch event by id. */
async function resolveEndDate(
  m: GammaMarket & { eventId?: string | null }
): Promise<{ endDate: Date | null; fromEvent: boolean }> {
  const iso = m.endDateIso ?? (m as { endDateIso?: string }).endDateIso;
  if (m.endDate) {
    const d = new Date(m.endDate);
    return { endDate: isNaN(d.getTime()) ? null : d, fromEvent: false };
  }
  if (iso) {
    const d = new Date(`${iso}T23:59:59.000Z`);
    return { endDate: isNaN(d.getTime()) ? null : d, fromEvent: false };
  }
  if (m.gameStartTime) {
    const d = new Date(m.gameStartTime);
    return { endDate: isNaN(d.getTime()) ? null : d, fromEvent: false };
  }
  const events = m.events;
  if (events?.length && events[0]?.endDate) {
    const d = new Date(events[0].endDate);
    return { endDate: isNaN(d.getTime()) ? null : d, fromEvent: true };
  }
  const eventId =
    m.eventId ??
    (events?.[0] as { id?: string } | undefined)?.id ??
    (m as { event_id?: string }).event_id;
  if (eventId) {
    const ev = await fetchEventById(eventId);
    if (ev?.endDate) {
      const d = new Date(ev.endDate);
      return { endDate: isNaN(d.getTime()) ? null : d, fromEvent: true };
    }
  }
  return { endDate: null, fromEvent: false };
}

/** Fetch all markets from Gamma (single endpoint). */
export async function fetchGammaMarkets(): Promise<GammaMarket[]> {
  try {
    const res = await fetch(`${GAMMA_BASE}/markets?active=true&closed=false&limit=500`, {
      cache: "no-store"
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.markets ?? [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export interface SlotShortlistResult {
  markets: ShortlistMarket[];
  debug: {
    totalFetched: number;
    afterHardFilters: number;
    excludedNoResolution: number;
  };
}

export interface BuildSlotShortlistOptions {
  previousVolumeByPolymarketId?: Record<string, number>;
  todayApprovedCategorySet?: Set<string>;
}

/** Build shortlist: hard filters, resolve endDate (with event fallback), slot selection, dedup. */
export async function buildSlotShortlist(
  existingPolymarketIds: string[],
  excludedPolymarketIds: string[],
  options: BuildSlotShortlistOptions = {}
): Promise<SlotShortlistResult> {
  const now = new Date();
  const existingSet = new Set(existingPolymarketIds);
  const excludedSet = new Set(excludedPolymarketIds);
  const previousVolume = options.previousVolumeByPolymarketId ?? {};
  const todayApprovedCategories = options.todayApprovedCategorySet ?? new Set<string>();

  const raw = await fetchGammaMarkets();
  let excludedNoResolution = 0;

  const filtered: Array<{
    m: GammaMarket;
    resolutionDate: Date | null;
    yesPrice: number;
    volume: number;
    startDate: Date | null;
    category: string | null;
    categoryRaw: string | null;
    description: string | null;
  }> = [];

  for (const m of raw) {
    if (m.active !== true || m.closed === true) continue;
    const outcomes = parseOutcomes(m.outcomes);
    const prices = parsePrices(m.outcomePrices);
    if (outcomes.length !== 2 || prices.length !== 2) continue;
    const yesPrice = getYesPrice(m);
    if (yesPrice == null || yesPrice < 0.1 || yesPrice > 0.9) continue;
    const volume = Number(m.volume ?? 0);
    if (volume < 5000) continue;

    const { endDate: resolutionDate } = await resolveEndDate(m as GammaMarket & { eventId?: string });
    if (!resolutionDate) {
      excludedNoResolution++;
      continue;
    }

    const startDate = m.startDate ? new Date(m.startDate) : null;
    const categoryRaw = extractRawCategoryFromGammaMarket(m);
    const categoryStd = mapToStandardCategory(categoryRaw);
    const category = categoryStd ?? categoryRaw ?? null;

    if (existingSet.has(m.id) || excludedSet.has(m.id)) continue;

    filtered.push({
      m,
      resolutionDate,
      yesPrice,
      volume,
      startDate,
      category,
      categoryRaw,
      description: m.description ?? null
    });
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toShortlist = async (item: (typeof filtered)[0]): Promise<ShortlistMarket> => {
    const { daysToResolution, timeBucket } = getTimeBucket(now, item.resolutionDate);
    // Polymarket page URL: do not construct here — pick a verbatim API field after inspecting raw Gamma JSON.
    const marketUrl: string | null = null;
    return {
      polymarketId: item.m.id,
      nestedMarketsCount: 1,
      title: item.m.question ?? "Untitled",
      description: item.description,
      resolutionDate: item.resolutionDate,
      crowd_price: Math.round(item.yesPrice * 100),
      volume: item.volume,
      startDate: item.startDate,
      category: mapToStandardCategory(item.categoryRaw) ?? null,
      categoryFromApiRaw: item.categoryRaw,
      marketGeography: null,
      days_to_resolution: daysToResolution,
      time_bucket: timeBucket,
      marketUrl,
      probability: item.yesPrice,
      daysToResolution: daysToResolution,
      timeBucket
    };
  };

  const byVolume = [...filtered].sort((a, b) => b.volume - a.volume);
  const momentumCandidates = filtered.filter((f) => f.volume >= 20000);
  const prevVol = (id: string) => previousVolume[id] ?? 0;
  const momentumSorted = [...momentumCandidates].sort(
    (a, b) => b.volume - prevVol(b.m.id) - (a.volume - prevVol(a.m.id))
  );
  const newestCandidates = filtered.filter(
    (f) => f.startDate && f.startDate >= sevenDaysAgo && f.volume >= 5000
  );
  const newestSorted = [...newestCandidates].sort(
    (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0)
  );
  const categoryCandidates = filtered.filter(
    (f) => f.category && !todayApprovedCategories.has(String(f.category).toLowerCase())
  );
  const categoryByRarity = new Map<string, typeof filtered[0]>();
  for (const f of categoryCandidates) {
    const c = (f.category ?? "").toLowerCase();
    if (!categoryByRarity.has(c)) categoryByRarity.set(c, f);
    else if ((f.volume ?? 0) > (categoryByRarity.get(c)!.volume ?? 0))
      categoryByRarity.set(c, f);
  }
  const categorySorted = [...categoryByRarity.values()].sort((a, b) => b.volume - a.volume);

  const byId = new Map<string, ShortlistMarket>();
  const add = async (item: (typeof filtered)[0]) => {
    if (byId.size >= 20) return;
    if (!byId.has(item.m.id)) byId.set(item.m.id, await toShortlist(item));
  };

  for (let i = 0; i < 4 && i < byVolume.length; i++) await add(byVolume[i]);
  for (let i = 0; i < 4 && i < momentumSorted.length; i++) await add(momentumSorted[i]);
  for (let i = 0; i < 4 && i < newestSorted.length; i++) await add(newestSorted[i]);
  for (let i = 0; i < 4 && i < categorySorted.length; i++) await add(categorySorted[i]);
  for (const f of byVolume) {
    if (byId.size >= 20) break;
    await add(f);
  }

  const markets = [...byId.values()].slice(0, 20);

  if (excludedNoResolution > 0) {
    console.log(`[gamma] Excluded ${excludedNoResolution} markets due to missing resolution date.`);
  }

  return {
    markets,
    debug: {
      totalFetched: raw.length,
      afterHardFilters: filtered.length,
      excludedNoResolution
    }
  };
}

/**
 * When `polymarket_id` in DB is a Gamma **event** id, GET /markets/{id} fails.
 * Fall back to GET /events?id= and use the first nested market (same shape as shortlist).
 */
async function fetchFirstMarketFromEventById(eventId: string): Promise<GammaMarket | null> {
  try {
    const res = await fetch(`${GAMMA_BASE}/events?id=${encodeURIComponent(eventId)}`, {
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ev = Array.isArray(data) && data.length > 0 ? data[0] : data?.id != null ? data : null;
    if (!ev || typeof ev !== "object") return null;
    const rec = ev as Record<string, unknown>;
    const markets = rec.markets;
    if (!Array.isArray(markets) || markets.length < 1) return null;
    const m0 = markets[0] as Record<string, unknown>;
    const eventClosed = rec.closed === true;
    const marketClosed = m0.closed === true;
    return {
      ...(m0 as unknown as GammaMarket),
      id: (m0.id as string) ?? eventId,
      question: (m0.question as string | null) ?? (typeof rec.title === "string" ? rec.title : null),
      description: (m0.description as string | null) ?? (rec.description as string | null),
      endDate: (m0.endDate as string | null) ?? (rec.endDate as string | null),
      volume: rec.volume ?? m0.volume,
      closed: eventClosed || marketClosed,
      active: rec.active ?? m0.active
    } as GammaMarket;
  } catch {
    return null;
  }
}

/**
 * GET /markets/{id} only — no event-id fallback.
 * Use when the id is a concrete Gamma market row (e.g. DB `sub_market_id`). Event fallback would
 * return the wrong nested market for multi-outcome parents.
 */
export async function fetchGammaMarketById(id: string): Promise<GammaMarket | null> {
  try {
    const res = await fetch(`${GAMMA_BASE}/markets/${encodeURIComponent(id)}`, {
      cache: "no-store"
    });
    if (res.ok) return (await res.json()) as GammaMarket;
  } catch {
    /* empty */
  }
  return null;
}

/** Fetch single market by id, or first market under an event id (shortlist stores event ids). */
export async function fetchMarketById(polymarketId: string): Promise<GammaMarket | null> {
  const direct = await fetchGammaMarketById(polymarketId);
  if (direct) return direct;
  return fetchFirstMarketFromEventById(polymarketId);
}

/**
 * Resolved YES = true, NO = false, unclear = null.
 * Requires Gamma `closed === true`, then reads `outcomePrices` (YES leg ~1 = resolved YES, ~0 = NO).
 * Used for both parent markets and nested rows fetched via `fetchGammaMarketById(sub_market_id)`.
 */
export function getResolutionOutcome(m: GammaMarket | null): boolean | null {
  if (!m || m.closed !== true) return null;
  const outcomes = parseOutcomes(m.outcomes ?? null);
  const prices = parsePrices(m.outcomePrices ?? null);
  if (outcomes.length !== 2 || prices.length !== 2) return null;
  const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
  if (yesIdx === -1) return null;
  const yesP = prices[yesIdx];
  const noP = prices[1 - yesIdx];
  if (!Number.isFinite(yesP) || !Number.isFinite(noP)) return null;
  if (yesP >= 0.99) return true;
  if (noP >= 0.99) return false;
  return null;
}
