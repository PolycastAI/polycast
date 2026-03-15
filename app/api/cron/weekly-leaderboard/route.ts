import { NextResponse } from "next/server";
import { runWeeklyLeaderboardPost } from "@/lib/pipeline/weeklyLeaderboard";
import { requireCronAuth } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;
  try {
    await runWeeklyLeaderboardPost();
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Cron weekly-leaderboard error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
