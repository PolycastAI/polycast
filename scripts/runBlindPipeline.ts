#!/usr/bin/env ts-node
/* eslint-disable no-console */

import { runBlindAndAnchoredPipeline } from "@/lib/pipeline/blindAnchored";

async function main() {
  await runBlindAndAnchoredPipeline();
}

main().catch((err) => {
  console.error("Fatal error in blind+anchored pipeline:", err);
  process.exit(1);
});

