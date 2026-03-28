/**
 * Exclude low-signal recurring price-candle / spread noise from the shortlist pool.
 * Returns true = exclude this event (title is noise).
 */

const CRYPTO_ASSETS =
  /\b(btc|eth|sol|bitcoin|ethereum|solana|xrp|doge|cardano|avalanche|polygon|matic|chainlink|link|litecoin|ltc)\b/i;

const DIRECTIONAL = /\b(above|below|higher|lower|over|under)\b/i;

const PRICE_OR_TIME_REF =
  /\$[\d,]+(\.\d+)?|\b\d{1,3}(,\d{3})*(\.\d+)?\s*(k|m|b)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\s*:\s*\d{2}\s*(am|pm)\b|\b(am|pm)\s+et\b|\b\d{1,2}\s*(am|pm)\s+et\b|\bet\b.*\b(am|pm)\b/i;

const TRADFI = /\b(s&p|spx|spy|nasdaq|dow\s*jones|djia)\b/i;
const TRADFI_DIR = /\b(close|above|below|higher|lower)\b/i;

const FX_PAIR = /\b[A-Z]{3}\s*\/\s*[A-Z]{3}\b/;

const COMMODITY =
  /\b(gold|silver|wti|brent|natural\s*gas|crude\s*oil)\b/i;
const COMMODITY_DIR = /\b(close|above|below|higher|lower)\b/i;
const DOLLAR_AMT = /\$[\d,]+(\.\d+)?/;

const YIELD_10Y = /\b10[-\s]?year\s+yield|10yr\s+yield|treasury\s+yield\b/i;

const INTRADAY_ET =
  /\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\s+et\b|\b(am|pm)\s+et\b|\b\d{1,2}pm\s+et\b|\b\d{1,2}am\s+et\b/i;

const CANDLE_WORDS = /\b(candle|hourly|1h\s*close|daily\s*close)\b/i;

const SPREAD_NOISE =
  /\bby\s+more\s+than\s+\d+\.5\s+points\b|\bcover\s+the\s+spread\b|[+-]\d+\.5\b/i;

const VS_SPREAD = /^(.+?)\s+vs\.?\s+(.+)$/i;

/** Keep these even if other patterns match. */
function isExplicitlyProtectedTitle(title: string): boolean {
  const t = title.trim();
  if (/^will\s+.+\s+win\b/i.test(t)) return true;
  if (/\bwho\s+will\s+win\b/i.test(t)) return true;
  if (/\b(approval\s+rating|election|primary|ballot|vote\s+share|impeach|senate|house|president|fed\s+rate|fomc|inflation|cpi|jobs\s+report|non-?farm|gdp|gdp\s+growth)\b/i.test(t))
    return true;
  if (/\b(war|treaty|sanction|nato|ceasefire|invasion|ukraine|russia|israel|gaza|china|taiwan)\b/i.test(t))
    return true;
  if (/\b(ai|openai|gpt|llm|semiconductor|chip)\b/i.test(t)) return true;
  if (/\b(oscar|grammy|emmy|box\s+office|netflix|spotify)\b/i.test(t)) return true;
  if (/\b(end\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)|q[1-4]\s+\d{4}|quarter)\b/i.test(t))
    return true;
  return false;
}

function cryptoPriceCandleNoise(title: string): boolean {
  if (!CRYPTO_ASSETS.test(title)) return false;
  if (!DIRECTIONAL.test(title)) return false;
  return PRICE_OR_TIME_REF.test(title);
}

function tradFiPriceNoise(title: string): boolean {
  if (TRADFI.test(title) && TRADFI_DIR.test(title)) return true;
  if (FX_PAIR.test(title)) return true;
  if (COMMODITY.test(title) && COMMODITY_DIR.test(title) && DOLLAR_AMT.test(title)) return true;
  if (YIELD_10Y.test(title)) return true;
  return false;
}

function intradayCandleNoise(title: string): boolean {
  if (CANDLE_WORDS.test(title)) return true;
  if (INTRADAY_ET.test(title) && CRYPTO_ASSETS.test(title)) return true;
  return false;
}

function sportsSpreadNoise(title: string): boolean {
  if (SPREAD_NOISE.test(title)) return true;
  const m = title.match(VS_SPREAD);
  if (m && /\b[+-]?\d+\.5\b/.test(title)) return true;
  return false;
}

export function isNoiseMarket(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (isExplicitlyProtectedTitle(t)) return false;

  if (cryptoPriceCandleNoise(t)) return true;
  if (tradFiPriceNoise(t)) return true;
  if (intradayCandleNoise(t)) return true;
  if (sportsSpreadNoise(t)) return true;

  return false;
}
