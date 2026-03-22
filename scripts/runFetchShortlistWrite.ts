#!/usr/bin/env tsx
/**
 * Runs runShortlistAndNotifyOnly() (fetch shortlist + reset_and_insert_shortlist when
 * POLYCAST_SHORTLIST_WRITE_ENABLED=true). Load env from .env.local first.
 */
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local") });

async function main() {
  const { runShortlistAndNotifyOnly } = await import("@/lib/pipeline/blindAnchored");
  const result = await runShortlistAndNotifyOnly();
  console.log("runShortlistAndNotifyOnly finished:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
