/**
 * Logs the raw JSON body from Gamma API for one market (no URL logic).
 *
 * Usage:
 *   cd polycast && npx ts-node scripts/logGammaMarketRaw.ts [polymarket-market-id]
 *
 * If you omit the id, fetches /markets?active=true&limit=1 and uses the first market's id.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";

async function fetchFirstActiveMarketId(): Promise<string | null> {
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&limit=1&order=volume&ascending=false`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    console.error("List request failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : data?.markets ?? [];
  const first = Array.isArray(list) && list[0] ? list[0] : null;
  const id = first && typeof first === "object" && "id" in first ? String((first as { id: string }).id) : null;
  return id;
}

async function logSingleMarket(polymarketId: string): Promise<void> {
  const url = `${GAMMA_BASE}/markets/${encodeURIComponent(polymarketId)}`;
  console.log("[logGammaMarketRaw] GET", url);
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  console.log("[logGammaMarketRaw] HTTP status:", res.status);
  try {
    const json = JSON.parse(text) as unknown;
    console.log("[logGammaMarketRaw] Raw JSON (stringified):");
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log("[logGammaMarketRaw] Non-JSON body (first 4000 chars):");
    console.log(text.slice(0, 4000));
  }
}

async function main(): Promise<void> {
  let id = process.argv[2]?.trim();
  if (!id) {
    console.log("[logGammaMarketRaw] No id arg — fetching one active market id from list endpoint…");
    id = (await fetchFirstActiveMarketId()) ?? "";
    if (!id) {
      console.error("[logGammaMarketRaw] Could not resolve a market id. Pass one explicitly.");
      process.exit(1);
    }
    console.log("[logGammaMarketRaw] Using id:", id);
  }
  await logSingleMarket(id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
