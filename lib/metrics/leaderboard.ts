import { supabaseAdmin } from "@/lib/supabase/server";

export interface LeaderboardRow {
  model: string;
  totalPnl: number;
  winRate: number | null;
  brierScore: number | null;
}

export async function getLeaderboardAllTime(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabaseAdmin
    .from("model_performance")
    .select("model, total_pnl, wins, losses, brier_score")
    .is("time_bucket", null)
    .is("category", null);

  if (error || !data) return [];

  return data.map((row: any) => {
    const wins = row.wins ?? 0;
    const losses = row.losses ?? 0;
    const total = wins + losses;
    return {
      model: row.model,
      totalPnl: Number(row.total_pnl ?? 0),
      winRate: total > 0 ? wins / total : null,
      brierScore: row.brier_score != null ? Number(row.brier_score) : null
    };
  });
}

