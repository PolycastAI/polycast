/**
 * Shortlist: fetch Gamma /events, filter, one Gemini call (gemini-2.5-flash) picks 20
 * with geography + category in the same response; pad/enforce use in-memory pool only.
 */

import { parseGeminiJsonArrayDetailed } from "@/lib/ai/geminiJson";
import { getTimeBucket } from "@/lib/markets/timeBuckets";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import type { ShortlistMarket } from "./types";
import {
  mapToStandardCategory,
  normalizeGeography,
  STANDARD_CATEGORIES
} from "./categoryAndGeography";
import { isNoiseMarket } from "./noiseMarkets";
import { fetchGammaMarketById } from "./gamma";

const GEO_LABELS =
  "Global, USA, Europe, UK, Russia, Ukraine, Middle East, Asia, Crypto (no geography)";
const CATEGORY_LABELS = STANDARD_CATEGORIES.join(", ");

const GAMMA_BASE = "https://gamma-api.polymarket.com";

const EVENTS_ACTIVE_BASE = `${GAMMA_BASE}/events?active=true&closed=false&limit=50`;
const EVENTS_MOST_ACTIVE_TODAY = `${EVENTS_ACTIVE_BASE}&order=volume24hr&ascending=false`;
const EVENTS_NEWEST = `${EVENTS_ACTIVE_BASE}&order=startDate&ascending=false`;
const EVENTS_HIGH_LIQUIDITY = `${EVENTS_ACTIVE_BASE}&order=liquidity&ascending=false`;
const EVENTS_END_DATE_FALLBACK = `${EVENTS_ACTIVE_BASE}&order=endDate&ascending=true`;

const GEMINI_SYSTEM_PROMPT = `You are a market selection agent for Polycast, an AI prediction market forecasting service. Every day you select the 20 most interesting Polymarket events for four AI models to forecast head-to-head.

Select 20 events from the list provided. Each row includes id, title, crowd_price, and days_to_resolution (integer days from today until resolution). Some rows may include an optional category field when the source API provided one. Your selection must:
- Only include binary YES/NO markets with a probability between 7% and 93%
- Only include events with a known resolution horizon (use days_to_resolution from each row)
- The list is already pre-filtered for tiered minimum volume by horizon; prefer diverse, high-interest questions
- Time horizon: Prefer markets resolving within the next 30 days — aim for at least half your selection to resolve within 30 days where the pool allows. Only include longer-horizon markets (31+ days) if they are exceptionally high volume or exceptional interest — use those sparingly to fill remaining slots.
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
  /** Sub-market question — for multi-outcome parents, the picked sub-market (YES closest to 50%). */
  firstMarketQuestion: string | null;
  /** Sub-market description — for multi-outcome parents, same picked sub-market as firstMarketQuestion. */
  firstMarketDescription: string | null;
  /** Gamma id of the picked sub-market (null if missing on payload). */
  subMarketId: string | null;
  /**
   * Resolution instant for DB `markets.resolution_date`: after shortlist build, prefer
   * `GET /markets/{subMarketId}` (canonical row); embedded `/events` dates are a fallback only.
   */
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

/** Tiered minimum USD volume by days until resolution (see shortlist spec). */
export function minVolumeForDays(daysToResolution: number | null | undefined): number {
  if (daysToResolution == null || !Number.isFinite(daysToResolution) || daysToResolution <= 0) {
    return 5000;
  }
  if (daysToResolution <= 7) return 1000;
  if (daysToResolution <= 30) return 3000;
  return 5000;
}

function getGammaEventTitle(e: Record<string, unknown>): string {
  const eventTitle = typeof e.title === "string" ? e.title : "";
  return eventTitle.trim();
}

/**
 * Resolution instant from a Gamma **market** or **event** record (embedded JSON only).
 * Mirrors `lib/polymarket/gamma.ts` `resolveEndDate` field order for sync parsing:
 * `endDate` (full timestamp), `endDateIso` (calendar day → end-of-day UTC), `gameStartTime`.
 * Using `new Date(endDateIso)` alone is wrong for YYYY-MM-DD (midnight vs EOD).
 */
function parseResolutionInstantFromGammaRecord(
  rec: Record<string, unknown>
): Date | null {
  const endDate = rec.endDate;
  if (endDate != null && endDate !== "") {
    if (typeof endDate === "number" && Number.isFinite(endDate)) {
      const d = new Date(endDate);
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(String(endDate));
    if (!isNaN(d.getTime())) return d;
  }
  const iso = rec.endDateIso;
  if (iso != null && String(iso).trim() !== "") {
    const s = String(iso).trim();
    const d = new Date(`${s}T23:59:59.000Z`);
    if (!isNaN(d.getTime())) return d;
  }
  const gst = rec.gameStartTime;
  if (gst != null && gst !== "") {
    const d = new Date(String(gst));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** One Gamma sub-market chosen for an event; all fields come from the same `raw` row. */
type SelectedSubMarket = {
  raw: Record<string, unknown>;
  question: string;
  description: string | null;
  endDate: Date;
  yesDecimal: number;
};

const SUBMARKET_CACHE = new WeakMap<
  object,
  { minuteBucket: number; selection: SelectedSubMarket | null }
>();

function getSelectedSubMarketCached(
  e: Record<string, unknown>,
  now: Date
): SelectedSubMarket | null {
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  const prev = SUBMARKET_CACHE.get(e);
  if (prev && prev.minuteBucket === minuteBucket) return prev.selection;
  const selection = selectSubMarketForEvent(e, now);
  SUBMARKET_CACHE.set(e, { minuteBucket, selection });
  return selection;
}

/**
 * Date used for volume tier, days_to_resolution, and stored resolution_date.
 * Always the selected sub-market's endDate (single- or multi-outcome).
 */
function getResolutionEndDateForFilters(e: Record<string, unknown>, now: Date): Date | null {
  return getSelectedSubMarketCached(e, now)?.endDate ?? null;
}

function subMarketIdFromPrimary(m: Record<string, unknown>): string | null {
  const id = m.id;
  if (id == null || id === "") return null;
  const s = String(id).trim();
  return s || null;
}

function getDaysToResolutionForRawEvent(ev: unknown, now: Date): number | null {
  if (!ev || typeof ev !== "object") return null;
  const endDate = getResolutionEndDateForFilters(ev as Record<string, unknown>, now);
  if (!endDate) return null;
  return getTimeBucket(now, endDate).daysToResolution ?? null;
}

function isBinarySettledOutcomePrices(opRaw: unknown): boolean {
  const prices = parsePrices(opRaw as string | string[]);
  if (prices.length !== 2) return false;
  const a = prices[0];
  const b = prices[1];
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return (near(a, 0) && near(b, 1)) || (near(a, 1) && near(b, 0));
}

/** True if every nested market is closed or has settled 0/1 outcome prices. */
export function isEntirelyResolvedParentEvent(ev: unknown): boolean {
  if (!ev || typeof ev !== "object") return false;
  const e = ev as Record<string, unknown>;
  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length === 0) return false;
  return markets.every((m) => {
    if (!m || typeof m !== "object") return false;
    const mr = m as Record<string, unknown>;
    if (mr.closed === true) return true;
    return isBinarySettledOutcomePrices(mr.outcomePrices);
  });
}

const PROB_MIN = 0.07;
const PROB_MAX = 0.93;

function passesProbabilityBand(yesDecimal: number): boolean {
  return Number.isFinite(yesDecimal) && yesDecimal >= PROB_MIN && yesDecimal <= PROB_MAX;
}

function getYesDecimalFromMarket(m: Record<string, unknown>): number | null {
  const opRaw = m.outcomePrices;
  if (opRaw == null) return null;
  const prices = parsePrices(opRaw as string | string[]);
  if (prices.length !== 2) return null;
  const yesDecimal = prices[0];
  if (!Number.isFinite(yesDecimal) || !Number.isFinite(prices[1])) return null;
  return yesDecimal;
}

function subMarketQuestionText(m: Record<string, unknown>): string {
  const q = m.question;
  return typeof q === "string" && q.trim() ? q.trim() : "";
}

function subMarketDescriptionText(m: Record<string, unknown>): string | null {
  const d = m.description;
  if (typeof d === "string") return d;
  if (d == null) return null;
  return String(d);
}

/** Raw `endDate` / `endDateIso` on the nested market (for logs; no parsing). */
function getSubMarketEndDateRawString(m: Record<string, unknown>): string | null {
  const v = m.endDate ?? m.endDateIso;
  if (v == null || v === "") return null;
  return String(v);
}

/**
 * Authoritative resolution time for a sub-market: that row's `endDate`/`endDateIso` only,
 * falling back to the parent event end date when the market omits it. No question-text parsing.
 * DB `markets.resolution_date` / ShortlistMarket.resolutionDate come from this path only.
 */
function getSubMarketResolutionEndDate(
  m: Record<string, unknown>,
  e: Record<string, unknown>
): Date | null {
  const fromMarket = parseResolutionInstantFromGammaRecord(m);
  if (fromMarket) return fromMarket;
  return parseResolutionInstantFromGammaRecord(e);
}

/** Log every nested row for multi-outcome parents: sub_index, question, raw API endDate string. */
function logMultiOutcomeSubMarketApiEndDates(
  e: Record<string, unknown>,
  eventId: string
): void {
  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length <= 1) return;
  for (let i = 0; i < markets.length; i++) {
    const raw = markets[i];
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const q = subMarketQuestionText(m) || "(no question)";
    const rawStr = getSubMarketEndDateRawString(m);
    const hasMarketDate = parseResolutionInstantFromGammaRecord(m) != null;
    const hasEventDate = parseResolutionInstantFromGammaRecord(e) != null;
    const resolutionSource =
      hasMarketDate ? "market" : hasEventDate ? "event_fallback" : "none";
    console.log(
      `[shortlist] multi_sub_market: event_id=${eventId} sub_index=${i} question=${JSON.stringify(q.slice(0, 160))} market.endDate_raw=${rawStr === null ? "null" : JSON.stringify(rawStr)} resolution_source=${resolutionSource}`
    );
    if (rawStr == null && parseResolutionInstantFromGammaRecord(e) == null) {
      console.warn(
        `[shortlist] multi_sub_market: event_id=${eventId} sub_index=${i} missing market.endDate and event.endDate — Polymarket/Gamma data gap`
      );
    }
  }
}

type EligibleSubCandidate = {
  raw: Record<string, unknown>;
  question: string;
  description: string | null;
  endDate: Date;
  yesDecimal: number;
  idx: number;
};

function buildEligibleSubMarketCandidates(
  e: Record<string, unknown>,
  now: Date
): EligibleSubCandidate[] {
  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length < 1) return [];
  const eventTitle = getGammaEventTitle(e);
  const eventId = e.id != null ? String(e.id) : "";
  const isMulti = markets.length > 1;
  const out: EligibleSubCandidate[] = [];

  if (isMulti) {
    logMultiOutcomeSubMarketApiEndDates(e, eventId);
  }

  for (let i = 0; i < markets.length; i++) {
    const raw = markets[i];
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (m.closed !== false) continue;

    const yesDecimal = getYesDecimalFromMarket(m);
    if (yesDecimal == null || !passesProbabilityBand(yesDecimal)) continue;

    let question = subMarketQuestionText(m);
    if (!question && markets.length === 1) question = eventTitle;
    if (!question) continue;

    const endDate = getSubMarketResolutionEndDate(m, e);
    if (!endDate) continue;
    if (endDate.getTime() <= now.getTime()) continue;

    const description = subMarketDescriptionText(m);

    out.push({
      raw: m,
      question,
      description,
      endDate,
      yesDecimal,
      idx: i
    });
  }

  if (isMulti && out.length > 0) {
    console.log(
      `[shortlist] multi_sub_market: event_id=${eventId} eligible_after_filters=${out.length} nested=${markets.length}`
    );
  }

  return out;
}

/**
 * Pick one sub-market: question, description, prices from that row; resolution time from
 * `getSubMarketResolutionEndDate` (market endDate, else event endDate). Multi-outcome: closest YES to 50%.
 */
function selectSubMarketForEvent(
  e: Record<string, unknown>,
  now: Date
): SelectedSubMarket | null {
  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length < 1) return null;

  const eligible = buildEligibleSubMarketCandidates(e, now);
  if (eligible.length === 0) return null;

  const eventId = e.id != null ? String(e.id) : "";
  const isMulti = markets.length > 1;

  eligible.sort((a, b) => {
    const da = Math.abs(a.yesDecimal - 0.5);
    const db = Math.abs(b.yesDecimal - 0.5);
    if (Math.abs(da - db) < 1e-12) return a.idx - b.idx;
    return da - db;
  });

  const toSelected = (c: EligibleSubCandidate): SelectedSubMarket => ({
    raw: c.raw,
    question: c.question,
    description: c.description,
    endDate: c.endDate,
    yesDecimal: c.yesDecimal
  });

  if (!isMulti) {
    return toSelected(eligible[0]);
  }

  console.log(
    `[shortlist] multi_sub_market_selected: event_id=${eventId} sub_index=${eligible[0].idx} (closest YES to 50% among eligible sub-markets)`
  );
  return toSelected(eligible[0]);
}

function passesEventStructure(e: Record<string, unknown>): boolean {
  if (e.active !== true || e.closed !== false) return false;
  const markets = e.markets;
  if (!Array.isArray(markets) || markets.length < 1) return false;
  const id = e.id != null ? String(e.id) : "";
  if (!id) return false;
  const slug = typeof e.slug === "string" && e.slug.trim() ? e.slug.trim() : "";
  if (!slug) return false;
  if (!getGammaEventTitle(e)) return false;
  return true;
}

/** Shape required before probability / volume / days filters (excludes noise & all-sub-resolved). */
function passesGammaShell(e: Record<string, unknown>, now: Date): boolean {
  if (!passesEventStructure(e)) return false;
  return getSelectedSubMarketCached(e, now) != null;
}

function getYesDecimalFromShellRow(e: Record<string, unknown>, now: Date): number | null {
  return getSelectedSubMarketCached(e, now)?.yesDecimal ?? null;
}

function buildParsedGammaEventFromRow(
  e: Record<string, unknown>,
  now: Date
): ParsedGammaEvent | null {
  if (!passesGammaShell(e, now)) return null;

  const sel = getSelectedSubMarketCached(e, now);
  if (!sel) return null;

  const markets = e.markets as unknown[];
  const endDate = sel.endDate;
  const yesDecimal = sel.yesDecimal;
  const primary = sel.raw;

  const subMarketId = subMarketIdFromPrimary(primary);

  const volume = num(e.volume);
  if (!Number.isFinite(volume)) return null;

  const id = String(e.id);
  const slug = (e.slug as string).trim();

  const eventDescription =
    typeof e.description === "string" ? e.description : e.description == null ? null : String(e.description);

  const marketsCount = markets.length;
  const firstMarketQuestion = sel.question;
  const firstMarketDescription = sel.description;

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
    title: getGammaEventTitle(e),
    slug,
    description: eventDescription,
    marketsCount,
    firstMarketQuestion,
    firstMarketDescription,
    subMarketId,
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

const HYDRATE_MARKET_API_CHUNK = 12;

/**
 * `/events` nested `markets[]` often mirrors the parent window; per-outcome resolution lives on
 * `GET /markets/{id}`. Hydrate `ParsedGammaEvent.endDate` from that endpoint when `subMarketId` is set.
 */
async function hydrateParsedEventEndDateFromSubMarketApi(
  p: ParsedGammaEvent
): Promise<ParsedGammaEvent> {
  const sid = p.subMarketId?.trim();
  if (!sid) return p;
  try {
    const gm = await fetchGammaMarketById(sid);
    if (!gm) {
      if (p.marketsCount > 1) {
        console.warn(
          `[shortlist] resolution_date_hydrate_failed: event_id=${p.polymarketId} sub_market_id=${sid} (GET /markets null; keeping embedded date)`
        );
      }
      return p;
    }
    const rec = gm as unknown as Record<string, unknown>;
    const d = parseResolutionInstantFromGammaRecord(rec);
    if (!d || isNaN(d.getTime())) return p;
    const driftMs = Math.abs(d.getTime() - p.endDate.getTime());
    if (p.marketsCount > 1 && driftMs > 60_000) {
      console.warn(
        `[shortlist] resolution_date_sub_market_api: event_id=${p.polymarketId} sub_market_id=${sid} events_embedded=${p.endDate.toISOString()} markets_endpoint=${d.toISOString()}`
      );
    }
    return { ...p, endDate: d, endDateIso: d.toISOString() };
  } catch {
    return p;
  }
}

async function hydrateParsedEventsEndDatesFromMarketApi(
  rows: ParsedGammaEvent[]
): Promise<ParsedGammaEvent[]> {
  const out: ParsedGammaEvent[] = [];
  for (let i = 0; i < rows.length; i += HYDRATE_MARKET_API_CHUNK) {
    const chunk = rows.slice(i, i + HYDRATE_MARKET_API_CHUNK);
    const done = await Promise.all(
      chunk.map((row) => hydrateParsedEventEndDateFromSubMarketApi(row))
    );
    out.push(...done);
  }
  return out;
}

/**
 * Parse one Gamma event; returns null if it fails the same filters as the shortlist pipeline
 * (noise, resolved parent, shell, probability 7–93%, tiered volume, days_to_resolution > 0).
 * Does not call `GET /markets/{subMarketId}` — `buildGeminiShortlist` hydrates `endDate` after parse.
 */
export function tryParseGammaEvent(ev: unknown, nowArg?: Date): ParsedGammaEvent | null {
  const now = nowArg ?? new Date();
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;

  if (e.active !== true || e.closed !== false) return null;
  if (isNoiseMarket(getGammaEventTitle(e))) return null;
  if (isEntirelyResolvedParentEvent(ev)) return null;
  if (!passesGammaShell(e, now)) return null;

  const sel = getSelectedSubMarketCached(e, now);
  if (!sel) return null;

  const { daysToResolution } = getTimeBucket(now, sel.endDate);
  if (daysToResolution == null || daysToResolution <= 0) return null;

  const volume = num(e.volume);
  if (!Number.isFinite(volume) || volume < minVolumeForDays(daysToResolution)) return null;

  return buildParsedGammaEventFromRow(e, now);
}

export interface PipelineStepTrace {
  polymarketHttpStatus: number;
  polymarketFetchOk: boolean;
  polymarketRawCount: number;
  polymarketError: string | null;
  structuralCount: number;
  daysCount: number;
  dedupCount: number;
  geminiSentCount: number;
  /** Raw row count from Gemini JSON (before pool id validation / pad). */
  geminiReturnedCount: number;
  finalMarketsCount: number;
  geminiFailed: boolean;
  geminiError: string | null;
}

export function createEmptyPipelineTrace(): PipelineStepTrace {
  return {
    polymarketHttpStatus: 0,
    polymarketFetchOk: false,
    polymarketRawCount: 0,
    polymarketError: null,
    structuralCount: 0,
    daysCount: 0,
    dedupCount: 0,
    geminiSentCount: 0,
    geminiReturnedCount: 0,
    finalMarketsCount: 0,
    geminiFailed: false,
    geminiError: null
  };
}

function mergeEventsById(lists: unknown[][]): unknown[] {
  const map = new Map<string, unknown>();
  for (const list of lists) {
    for (const ev of list) {
      if (!ev || typeof ev !== "object") continue;
      const id = (ev as Record<string, unknown>).id;
      if (id == null) continue;
      const key = String(id);
      if (!map.has(key)) map.set(key, ev);
    }
  }
  return [...map.values()];
}

async function fetchEventsList(url: string): Promise<{
  events: unknown[];
  status: number;
  ok: boolean;
  parseError: string | null;
}> {
  let status = 0;
  try {
    const res = await fetch(url, { cache: "no-store" });
    status = res.status;
    if (!res.ok) {
      return { events: [], status, ok: false, parseError: null };
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.events ?? data?.data ?? [];
    const events = Array.isArray(list) ? list : [];
    return { events, status, ok: true, parseError: null };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
    return { events: [], status: status || 0, ok: false, parseError: msg };
  }
}

/**
 * Resolving in next 72h: try end_date_min/max; on HTTP failure fall back to endDate order + 1–3d filter.
 */
async function fetchEventsResolving72hOrFallback(now: Date): Promise<{
  events: unknown[];
  status: number;
  ok: boolean;
  parseError: string | null;
  usedEndDateFallback: boolean;
}> {
  const nowIso = now.toISOString();
  const maxIso = new Date(now.getTime() + 72 * 3600 * 1000).toISOString();
  const primaryUrl =
    `${EVENTS_ACTIVE_BASE}&end_date_min=${encodeURIComponent(nowIso)}&end_date_max=${encodeURIComponent(maxIso)}`;

  const primary = await fetchEventsList(primaryUrl);
  if (!primary.ok) {
    const fb = await fetchEventsList(EVENTS_END_DATE_FALLBACK);
    if (!fb.ok) {
      return {
        events: [],
        status: fb.status || primary.status,
        ok: false,
        parseError: fb.parseError ?? primary.parseError,
        usedEndDateFallback: true
      };
    }
    const filtered = fb.events.filter((ev) => {
      const d = getDaysToResolutionForRawEvent(ev, now);
      return d != null && d >= 1 && d <= 3;
    });
    return {
      events: filtered,
      status: fb.status,
      ok: fb.ok && fb.parseError == null,
      parseError: fb.parseError,
      usedEndDateFallback: true
    };
  }

  return {
    events: primary.events,
    status: primary.status,
    ok: primary.ok && primary.parseError == null,
    parseError: primary.parseError,
    usedEndDateFallback: false
  };
}

async function fetchRawEventsQuad(now: Date): Promise<{
  events: unknown[];
  statuses: number[];
  ok: boolean;
  parseError: string | null;
  usedEndDateFallback: boolean;
}> {
  const [volRes, startRes, liqRes, soonRes] = await Promise.all([
    fetchEventsList(EVENTS_MOST_ACTIVE_TODAY),
    fetchEventsList(EVENTS_NEWEST),
    fetchEventsList(EVENTS_HIGH_LIQUIDITY),
    fetchEventsResolving72hOrFallback(now)
  ]);

  const merged = mergeEventsById([
    volRes.events,
    startRes.events,
    liqRes.events,
    soonRes.events
  ]);
  const statuses = [volRes.status, startRes.status, liqRes.status, soonRes.status];
  const parseError =
    volRes.parseError ??
    startRes.parseError ??
    liqRes.parseError ??
    soonRes.parseError ??
    null;
  const ok =
    volRes.ok &&
    startRes.ok &&
    liqRes.ok &&
    soonRes.ok &&
    volRes.parseError == null &&
    startRes.parseError == null &&
    liqRes.parseError == null &&
    soonRes.parseError == null;

  return {
    events: merged,
    statuses,
    ok,
    parseError,
    usedEndDateFallback: soonRes.usedEndDateFallback
  };
}

/** Minimal fields sent to Gemini (no volume/endDate ISO — saves input tokens). */
export interface StrippedForGemini {
  id: string;
  title: string;
  crowd_price: number;
  /** Integer days until resolution (for time-horizon selection rules). */
  days_to_resolution: number;
  /** Present when Gamma provided a category string. */
  category?: string;
  /** Reserved if a geography label is ever supplied upstream (usually omitted). */
  market_geography?: string;
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
  wantCount: number,
  retryAttempt = 0
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
          maxOutputTokens: 4096,
          temperature: 0.2,
          // 2.5 Flash charges thinking against maxOutputTokens unless disabled — was truncating JSON mid-array.
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      })
    }
  );

  const json = await res.json();

  if (res.status === 429) {
    if (retryAttempt === 0) {
      console.log(
        "[shortlist][Gemini] QUOTA ERROR 429 — waiting 60 seconds then retrying once"
      );
      await new Promise((r) => setTimeout(r, 60_000));
      return callGeminiForSelection(strippedList, wantCount, 1);
    }
    const bodySnippet = JSON.stringify(json, null, 2).slice(0, 3500);
    console.error(
      "[shortlist][Gemini] HTTP 429 after retry — full body:\n",
      bodySnippet
    );
    const time = new Date().toISOString();
    await sendTelegramMessage(
      `⚠️ Polycast Gemini rate limited (429) after retry\n\n${bodySnippet}\n\nTime: ${time}`,
      { plain: true }
    );
    throw new Error(
      "Gemini API rate limited (429) after one 60s retry — check quota or try again later"
    );
  }

  if (!res.ok) {
    const bodySnippet = JSON.stringify(json, null, 2).slice(0, 3500);
    console.error(
      "[shortlist][Gemini] HTTP error — full body:\n",
      bodySnippet
    );
    const time = new Date().toISOString();
    const telegramPrefix = `⚠️ Polycast Gemini API error (HTTP ${res.status})`;
    await sendTelegramMessage(
      `${telegramPrefix}\n\n${bodySnippet}\n\nTime: ${time}`,
      { plain: true }
    );
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 2000)}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";

  console.log("[shortlist][Gemini] Raw response length:", text.length);
  console.log(
    "[shortlist][Gemini] Raw response first 500 chars:",
    text.slice(0, 500)
  );
  console.log(
    "[shortlist][Gemini] Raw response last 200 chars:",
    text.slice(-200)
  );

  if (!text.trim()) {
    console.error(
      "[shortlist][Gemini] Empty text — full API JSON (truncated):\n",
      JSON.stringify(json, null, 2).slice(0, 12000)
    );
  }

  const { items: parsed, parseError } = parseGeminiJsonArrayDetailed(text);
  console.log("[shortlist][Gemini] Parsed object count:", parsed.length);
  if (parseError) {
    console.error("[shortlist][Gemini] JSON parse failed — full error:", parseError);
  }

  if (parsed.length < 10) {
    console.warn(
      `[shortlist][Gemini] WARNING: Only ${parsed.length} markets returned — expected 20. Raw text follows:\n${text}`
    );
  }

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
  const row: StrippedForGemini = {
    id: e.polymarketId,
    title: e.title,
    crowd_price: e.crowd_price,
    days_to_resolution: d
  };
  const cat = e.category?.trim();
  if (cat) row.category = cat;
  return row;
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
    subMarketId: ev.subMarketId,
    nestedMarketsCount: ev.marketsCount,
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
 * Best-effort: shift selection toward 1–30 day horizons by swapping in pool events,
 * up to min(10, short-horizon count in pool). If the pool cannot support more,
 * returns the list unchanged (no warning).
 */
function enforceMinTenWithin30Days(
  markets: ShortlistMarket[],
  pool: ParsedGammaEvent[],
  now: Date
): ShortlistMarket[] {
  let current = [...markets].slice(0, 20);

  const countWithin = () =>
    current.filter((m) => isWithin30DaysHorizon(m.days_to_resolution)).length;

  const poolWithin30Count = pool.filter((p) =>
    isWithin30DaysHorizon(getTimeBucket(now, p.endDate).daysToResolution)
  ).length;
  const targetWithin = Math.min(10, poolWithin30Count);

  let swaps = 0;
  while (countWithin() < targetWithin) {
    const within = current.filter((m) => isWithin30DaysHorizon(m.days_to_resolution));
    const beyond = current.filter((m) => !isWithin30DaysHorizon(m.days_to_resolution));
    if (beyond.length === 0) {
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
      `[shortlist] Preferred 1–30d horizon: ${swaps} swap(s); now ${countWithin()} within range (pool allows up to ${targetWithin}).`
    );
  }

  return current.slice(0, 20);
}

/**
 * Build shortlist: GET /events → filter → dedup → Gemini (20) → map from cache only.
 */
export async function buildGeminiShortlist(
  existingPolymarketIds: string[],
  excludedPolymarketIds: string[],
  traceIn?: PipelineStepTrace
): Promise<GeminiShortlistResult> {
  const existingSet = new Set(existingPolymarketIds);
  const excludedSet = new Set(excludedPolymarketIds);
  const t = traceIn ?? createEmptyPipelineTrace();

  const fetchAt = new Date();
  const rawRes = await fetchRawEventsQuad(fetchAt);
  const badStatuses = rawRes.statuses.filter((s) => s >= 400);
  t.polymarketHttpStatus =
    badStatuses.length > 0 ? Math.max(...badStatuses) : 200;
  t.polymarketFetchOk = rawRes.ok && rawRes.parseError == null;
  t.polymarketRawCount = rawRes.events.length;
  if (rawRes.parseError) {
    t.polymarketFetchOk = false;
    t.polymarketError = rawRes.parseError;
  }

  console.log(
    `[pipeline] Step 2: Polymarket quad fetch merged ${rawRes.events.length} unique events (HTTP ${t.polymarketHttpStatus})`
  );

  if (rawRes.parseError) {
    t.polymarketFetchOk = false;
    t.polymarketError = rawRes.parseError;
    console.error("[pipeline] Polymarket response JSON error:", rawRes.parseError);
    await sendTelegramMessage(
      `⚠️ Polycast Polymarket API response parse error (HTTP ${t.polymarketHttpStatus})\n\n${rawRes.parseError}\nTime: ${new Date().toISOString()}`,
      { plain: true }
    );
  } else if (!rawRes.ok) {
    t.polymarketError = t.polymarketError ?? `HTTP ${t.polymarketHttpStatus}`;
    console.error(
      "[pipeline] Polymarket /events request failed:",
      rawRes.statuses.join(", ")
    );
    await sendTelegramMessage(
      `⚠️ Polycast Polymarket API error\n\n/events returned HTTP ${t.polymarketHttpStatus}\nTime: ${new Date().toISOString()}`,
      { plain: true }
    );
  } else if (rawRes.events.length === 0) {
    console.error(
      "[pipeline] Polymarket returned 0 events after successful HTTP response — check API payload shape"
    );
  }

  let poolRows = rawRes.events;

  console.log(`[shortlist] After fetch + dedup: ${poolRows.length} events`);

  const noiseRemovedTitles: string[] = [];
  poolRows = poolRows.filter((ev) => {
    if (!ev || typeof ev !== "object") return false;
    const e = ev as Record<string, unknown>;
    const title = getGammaEventTitle(e);
    if (isNoiseMarket(title)) {
      noiseRemovedTitles.push(title || "(empty)");
      return false;
    }
    return true;
  });
  const removedNoise = noiseRemovedTitles.length;
  console.log(
    `[shortlist] After noise filter: ${poolRows.length} events (removed ${removedNoise} noise markets)`
  );
  for (const title of noiseRemovedTitles) {
    console.log(`[shortlist] Noise removed: ${title}`);
  }

  poolRows = poolRows.filter((ev) => !isEntirelyResolvedParentEvent(ev));
  console.log(
    `[shortlist] After closed sub-market filter: ${poolRows.length} events`
  );

  const nowForFilter = new Date();

  const afterProb = poolRows.filter((ev) => {
    if (!ev || typeof ev !== "object") return false;
    const e = ev as Record<string, unknown>;
    return passesGammaShell(e, nowForFilter);
  });
  console.log(
    `[shortlist] After probability filter (7-93%): ${afterProb.length} events`
  );

  const afterVol = afterProb.filter((ev) => {
    const e = ev as Record<string, unknown>;
    const endDate = getResolutionEndDateForFilters(e, nowForFilter);
    if (!endDate) return false;
    const { daysToResolution } = getTimeBucket(nowForFilter, endDate);
    const volume = num(e.volume);
    if (!Number.isFinite(volume)) return false;
    return volume >= minVolumeForDays(daysToResolution);
  });
  console.log(`[shortlist] After volume filter: ${afterVol.length} events`);

  const afterDaysRows = afterVol.filter((ev) => {
    const e = ev as Record<string, unknown>;
    const endDate = getResolutionEndDateForFilters(e, nowForFilter);
    if (!endDate) return false;
    const { daysToResolution } = getTimeBucket(nowForFilter, endDate);
    return daysToResolution != null && daysToResolution > 0;
  });
  console.log(
    `[shortlist] After days_to_resolution > 0 filter: ${afterDaysRows.length} events`
  );

  const structural: ParsedGammaEvent[] = [];
  for (const row of afterDaysRows) {
    const e = row as Record<string, unknown>;
    const p = buildParsedGammaEventFromRow(e, nowForFilter);
    if (p) structural.push(p);
  }

  const structuralHydrated = await hydrateParsedEventsEndDatesFromMarketApi(structural);
  const nowPostHydrate = new Date();
  const structuralFinal = structuralHydrated.filter((p) => {
    const { daysToResolution } = getTimeBucket(nowPostHydrate, p.endDate);
    if (daysToResolution == null || daysToResolution <= 0) return false;
    return p.volume >= minVolumeForDays(daysToResolution);
  });

  if (structuralHydrated.length > structuralFinal.length) {
    console.log(
      `[shortlist] resolution_date_hydrate: dropped ${structuralHydrated.length - structuralFinal.length} row(s) after GET /markets/{sub_market_id} (days≤0 or volume tier)`
    );
  }

  t.structuralCount = afterVol.length;
  t.daysCount = structuralFinal.length;

  console.log(
    `[pipeline] Step 3: After structural filters (pre–days): ${afterVol.length} events`
  );
  if (poolRows.length > 0 && afterVol.length === 0) {
    console.error(
      "[pipeline] All Polymarket events failed structural filters (0 passed volume/probability shell)"
    );
  }

  console.log(
    `[pipeline] Step 4: After days_to_resolution filter: ${structuralFinal.length} events`
  );
  if (afterVol.length > 0 && structuralFinal.length === 0) {
    console.error(
      "[pipeline] After volume filter, 0 events remained with days_to_resolution > 0"
    );
  }

  const pool = structuralFinal.filter(
    (p) => !existingSet.has(p.polymarketId) && !excludedSet.has(p.polymarketId)
  );
  t.dedupCount = pool.length;

  console.log(
    `[shortlist] After dedup against DB: ${pool.length} events — sending to Gemini`
  );
  console.log(`[pipeline] Step 5: After dedup: ${pool.length} events`);
  if (structuralFinal.length > 0 && pool.length === 0) {
    console.error(
      "[pipeline] Pool is empty after dedup — all candidates may already be predicted, held, or rejected"
    );
  }

  const nowForStripped = new Date();
  const poolStripped = pool.map((p) => toStripped(p, nowForStripped));

  let selected: GeminiSelectionRow[] = [];
  const wantCount = Math.min(20, poolStripped.length);
  t.geminiSentCount = poolStripped.length;
  t.geminiReturnedCount = 0;
  t.geminiFailed = false;
  t.geminiError = null;

  console.log(
    `[pipeline] Step 6: Sending ${poolStripped.length} events to Gemini for selection`
  );

  if (poolStripped.length > 0) {
    try {
      const first = await callGeminiForSelection(poolStripped, wantCount);
      selected = first.filter(
        (x) => x.id && !existingSet.has(x.id) && !excludedSet.has(x.id)
      );
      t.geminiReturnedCount = first.length;
    } catch (err) {
      t.geminiFailed = true;
      t.geminiError =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      console.error("[pipeline] Gemini selection failed — full error:", err);
      throw err;
    }
  } else {
    console.error(
      "[pipeline] Skipping Gemini call (0 events in pool after dedup)"
    );
  }

  console.log(
    `[pipeline] Step 7: Gemini returned ${t.geminiReturnedCount} markets`
  );
  if (poolStripped.length > 0 && t.geminiReturnedCount === 0) {
    console.error(
      "[pipeline] Gemini returned 0 markets (pool was non-empty)"
    );
  } else if (poolStripped.length > 0 && selected.length === 0 && t.geminiReturnedCount > 0) {
    console.error(
      "[pipeline] Gemini returned rows but none matched the candidate pool (invalid or duplicate ids)"
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
    `[shortlist] Final shortlist: ${markets.length} markets; ${within30} with 1–30 days to resolution (best-effort when pool allows)`
  );

  for (const m of markets) {
    const crit =
      m.description && m.description.length > 220
        ? `${m.description.slice(0, 220)}…`
        : m.description ?? "";
    console.log("[shortlist] Selected event (final):", {
      title: m.title,
      resolution_date: m.resolutionDate?.toISOString() ?? null,
      sub_market_id: m.subMarketId ?? null,
      resolution_criteria_preview: crit,
      crowd_price: m.crowd_price,
      volume: m.volume,
      days_to_resolution: m.days_to_resolution,
      time_bucket: m.time_bucket,
      market_url: m.marketUrl
    });
  }

  t.finalMarketsCount = markets.length;

  return {
    markets,
    debug: {
      totalFetched: rawRes.events.length,
      afterStructuralFilters: afterVol.length,
      afterDaysToResolutionFilter: structuralFinal.length,
      afterDedup: pool.length,
      afterGemini: markets.length
    }
  };
}
