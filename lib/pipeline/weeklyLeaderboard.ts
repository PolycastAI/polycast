/* eslint-disable no-console */

import { getLeaderboardAllTime } from "@/lib/metrics/leaderboard";
import { postWeeklyLeaderboardToBluesky } from "@/lib/social/bluesky";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function runWeeklyLeaderboardPost() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 5 = Friday
  if (day !== 5) {
    console.log("Weekly leaderboard: not Friday, skipping.");
    return;
  }

  const week3Cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
  const { data: firstPred } = await supabaseAdmin
    .from("predictions")
    .select("predicted_at")
    .order("predicted_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (
    !firstPred ||
    new Date((firstPred as any).predicted_at).getTime() > week3Cutoff
  ) {
    console.log("Weekly leaderboard: before week 3, skipping.");
    return;
  }

  const rows = await getLeaderboardAllTime();
  if (rows.length === 0) {
    console.log("Weekly leaderboard: no data.");
    return;
  }

  await postWeeklyLeaderboardToBluesky(
    rows.map((r) => ({
      model: r.model,
      totalPnl: r.totalPnl,
      winRate: r.winRate,
      brierScore: r.brierScore
    }))
  );
  console.log("Weekly leaderboard posted.");
}
