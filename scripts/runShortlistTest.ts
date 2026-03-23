#!/usr/bin/env tsx
/**
 * CLI shortlist smoke test. Uses `tsx` (not plain `node`) so TypeScript + `compilerOptions.paths`
 * (`@/*`) resolve correctly with `"type": "module"`.
 */
/* eslint-disable no-console */

import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local") });

async function main() {
  const { buildGeminiShortlist } = await import("@/lib/polymarket/geminiShortlist");

  console.log("Fetching markets and building Gemini shortlist (no DB)...\n");

  try {
    const result = await buildGeminiShortlist([], []);
    const markets = result.markets;

    console.log(
      `Debug: totalFetched=${result.debug.totalFetched}, ` +
        `afterStructuralFilters=${result.debug.afterStructuralFilters}, ` +
        `afterDaysToResolutionFilter=${result.debug.afterDaysToResolutionFilter}, ` +
        `afterDedup=${result.debug.afterDedup}, afterGemini=${result.debug.afterGemini}\n`
    );

    console.log(`Gemini returned ${markets.length} markets\n`);

    for (const market of markets) {
      console.log({
        title: market.title,
        crowd_price: market.crowd_price,
        days_to_resolution: market.days_to_resolution,
        time_bucket: market.time_bucket,
        market_url: market.marketUrl,
        resolution_criteria_preview: market.description?.slice(0, 300)
      });
    }

    console.log(`\nTotal: ${markets.length} markets`);
    const within30 = markets.filter(
      (m) =>
        m.days_to_resolution != null &&
        m.days_to_resolution >= 1 &&
        m.days_to_resolution <= 30
    ).length;
    console.log(`Markets resolving in 1–30 days: ${within30} of ${markets.length}`);

    console.log("\n=== FINAL 20 MARKETS ===");
    for (const [i, m] of markets.entries()) {
      console.log(`\n${i + 1}. ${m.title}`);
      console.log(
        `   Days: ${m.days_to_resolution} | Price: ${m.crowd_price}% | Volume: $${Math.round(m.volume).toLocaleString()}`
      );
      console.log(`   URL: ${m.marketUrl}`);
      console.log(`   Criteria: ${m.description?.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("FAILED:", err);
    if (err instanceof Error && err.stack) {
      console.error("Stack:\n", err.stack);
    }
    if (err && typeof err === "object" && !(err instanceof Error)) {
      try {
        console.error("Serialized:", JSON.stringify(err, null, 2));
      } catch {
        console.error("Could not stringify error object");
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
