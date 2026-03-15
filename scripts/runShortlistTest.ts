#!/usr/bin/env ts-node
/* eslint-disable no-console */

import { buildGeminiShortlist } from "../lib/polymarket/geminiShortlist";

async function main() {
  console.log("Fetching markets and building Gemini shortlist (no DB)...\n");
  const result = await buildGeminiShortlist([], []);
  console.log(
    `Debug: totalFetched=${result.debug.totalFetched}, strippedCount=${result.debug.strippedCount}, afterDedup=${result.debug.afterDedup}\n`
  );
  console.log("Final selected markets:");
  console.log("---");
  for (const m of result.markets) {
    console.log({
      question: m.title,
      crowd_price: m.crowd_price,
      volume: m.volume,
      days_to_resolution: m.days_to_resolution,
      time_bucket: m.time_bucket
    });
  }
  console.log("---");
  console.log(`Total: ${result.markets.length} markets`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
