import { supabaseAdmin } from "@/lib/supabase/server";
import { getLeaderboardAllTime } from "@/lib/metrics/leaderboard";

async function getTodayFeed() {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).toISOString();
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("predictions")
    .select(
      "id, market_id, model, blind_estimate, signal, edge, predicted_at, markets!inner(title, category, resolution_date, market_url)"
    )
    .gte("predicted_at", start)
    .lt("predicted_at", end)
    .order("predicted_at", { ascending: false })
    .limit(80);

  if (error || !data) return [];

  return data;
}

export default async function HomePage() {
  const [leaderboard, feed] = await Promise.all([
    getLeaderboardAllTime(),
    getTodayFeed()
  ]);

  const groupedByMarket = new Map<
    string,
    {
      market: any;
      predictions: any[];
    }
  >();

  for (const row of feed as any[]) {
    const marketId = row.market_id as string;
    if (!groupedByMarket.has(marketId)) {
      groupedByMarket.set(marketId, {
        market: row.markets,
        predictions: []
      });
    }
    groupedByMarket.get(marketId)!.predictions.push(row);
  }

  const marketEntries = Array.from(groupedByMarket.entries());

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <section className="max-w-3xl space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Polycast
        </h1>
        <p className="text-lg text-gray-300">
          Polycast is an AI-driven prediction market forecaster. Every day, four
          frontier models independently price real-money Polymarket questions,
          turning their edge into a live trading track record.
        </p>
        <p className="text-lg text-gray-300">
          We publish daily signals on Polymarket YES/NO markets, track the
          resulting P&amp;L in real money terms, and let the models build an
          auditable forecasting record.
        </p>
      </section>

      <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Leaderboard (all-time)
        </h2>
        {leaderboard.length === 0 ? (
          <p className="text-xs text-slate-500">
            No resolved bets yet. Once markets settle, model P&amp;L and
            accuracy will appear here.
          </p>
        ) : (
          <div className="grid gap-3 text-sm text-slate-100 md:grid-cols-4">
            {leaderboard.map((row) => (
              <a
                key={row.model}
                href={`/model/${encodeURIComponent(row.model)}`}
                className="flex flex-col rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 hover:border-emerald-400/70"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {row.model}
                </span>
                <span className="mt-1 text-base font-semibold text-emerald-400">
                  {row.totalPnl >= 0 ? "+" : "-"}$
                  {Math.abs(Math.round(row.totalPnl))}
                </span>
                <span className="mt-1 text-[11px] text-slate-400">
                  Win rate:{" "}
                  {row.winRate == null
                    ? "—"
                    : `${Math.round(row.winRate * 100)}%`}
                </span>
                <span className="text-[11px] text-slate-500">
                  Brier:{" "}
                  {row.brierScore == null
                    ? "—"
                    : row.brierScore.toFixed(3)}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">
          Today&apos;s signals
        </h2>
        {marketEntries.length === 0 ? (
          <p className="text-sm text-slate-500">
            No predictions have been published yet today.
          </p>
        ) : (
          <div className="space-y-4">
            {marketEntries.map(([marketId, entry]) => {
              const market = (entry as any).market;
              const preds = (entry as any).predictions as any[];
              const resolution = market.resolution_date
                ? new Date(market.resolution_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric"
                  })
                : "TBD";
              return (
                <a
                  key={marketId}
                  href={`/market/${marketId}`}
                  className="block rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-emerald-400/70"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-100">
                        {market.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Category:{" "}
                        <span className="font-medium">
                          {market.category ?? "Uncategorized"}
                        </span>{" "}
                        · Resolves {resolution}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-4">
                    {["Claude", "ChatGPT", "Gemini", "Grok"].map((model) => {
                      const p = preds.find((x) => x.model === model);
                      if (!p) {
                        return (
                          <div key={model} className="rounded-lg bg-slate-900/60 p-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {model}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600">
                              No signal yet
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={model}
                          className="rounded-lg bg-slate-900/60 p-2"
                        >
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {model}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-100">
                            {p.blind_estimate}%{" "}
                            <span
                              className={
                                p.signal === "PASS"
                                  ? "text-slate-400"
                                  : p.signal === "BET YES"
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              }
                            >
                              {p.signal}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Edge: {p.edge > 0 ? "+" : ""}
                            {p.edge} pts
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

