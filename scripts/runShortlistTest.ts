#!/usr/bin/env tsx
/**
 * CLI shortlist smoke test. Uses `tsx` (not plain `node`) so TypeScript + `compilerOptions.paths`
 * (`@/*`) resolve correctly with `"type": "module"`.
 *
 * Note: `npx ts-node --esm` does not apply tsconfig path aliases to ESM resolution; use this script
 * or `npx tsx` for the same TypeScript execution model.
 */
/* eslint-disable no-console */

import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local") });

async function main() {
  const { buildGeminiShortlist } = await import("@/lib/polymarket/geminiShortlist");

  console.log("Fetching markets and building Gemini shortlist (no DB)...\n");
  const result = await buildGeminiShortlist([], []);
  console.log(
    `Debug: totalFetched=${result.debug.totalFetched}, ` +
      `afterStructuralFilters=${result.debug.afterStructuralFilters}, ` +
      `afterDaysToResolutionFilter=${result.debug.afterDaysToResolutionFilter}, ` +
      `afterDedup=${result.debug.afterDedup}, afterGemini=${result.debug.afterGemini}\n`
  );
  console.log("Final selected events:");
  console.log("---");
  for (const m of result.markets) {
    console.log({
      title: m.title,
      crowd_price: m.crowd_price,
      volume: m.volume,
      days_to_resolution: m.days_to_resolution,
      time_bucket: m.time_bucket,
      market_url: m.marketUrl
    });
  }
  console.log("---");
  console.log(`Total: ${result.markets.length} markets`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
