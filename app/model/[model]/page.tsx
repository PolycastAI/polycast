import { supabaseAdmin } from "@/lib/supabase/server";

interface ModelPageProps {
  params: { model: string };
}

async function getModelData(modelName: string) {
  const { data: perf, error: perfError } = await supabaseAdmin
    .from("model_performance")
    .select("model, total_pnl, wins, losses, brier_score")
    .eq("model", modelName)
    .is("time_bucket", null)
    .maybeSingle();

  const { data: history, error: histError } = await supabaseAdmin
    .from("model_pnl_history")
    .select("recorded_at, cumulative_pnl, bet_pnl, resolved_market_id")
    .eq("model", modelName)
    .order("recorded_at", { ascending: true })
    .limit(500);

  return {
    perf: perfError ? null : perf,
    history: histError || !history ? [] : history
  };
}

function buildEquityPoints(history: any[]) {
  if (!history.length) return [];
  const maxAbs = Math.max(
    ...history.map((h) => Math.abs(Number(h.cumulative_pnl ?? 0))),
    1
  );
  return history.map((h, idx) => {
    const x = (idx / Math.max(history.length - 1, 1)) * 100;
    const y =
      50 -
      (Number(h.cumulative_pnl ?? 0) / maxAbs) *
        40; /* center at 50, span roughly 80% */
    return { x, y };
  });
}

export default async function ModelPage({ params }: ModelPageProps) {
  const modelName = decodeURIComponent(params.model);
  const { perf, history } = await getModelData(modelName);
  const equityPoints = buildEquityPoints(history as any[]);

  const totalPnl = perf?.total_pnl ?? 0;
  const wins = perf?.wins ?? 0;
  const losses = perf?.losses ?? 0;
  const totalBets = wins + losses;
  const winRate = totalBets > 0 ? wins / totalBets : null;
  const brier =
    perf?.brier_score != null ? Number(perf.brier_score).toFixed(3) : "—";

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {modelName} performance
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Equity curve, hit rate, and Brier score for {modelName}&apos;s
            real-money Polymarket bets.
          </p>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Equity curve
              </h2>
              <span className="text-xs text-slate-500">All-time</span>
            </div>
            {equityPoints.length === 0 ? (
              <p className="text-xs text-slate-500">
                No resolved bets yet for this model.
              </p>
            ) : (
              <svg
                viewBox="0 0 100 60"
                className="h-48 w-full rounded-xl bg-slate-950/80"
                preserveAspectRatio="none"
              >
                <polyline
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="0.9"
                  points={equityPoints
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                />
                <line
                  x1="0"
                  x2="100"
                  y1="50"
                  y2="50"
                  stroke="#1e293b"
                  strokeWidth="0.4"
                />
              </svg>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Resolved bets
            </h2>
            {history.length === 0 ? (
              <p className="text-slate-500">
                Once markets start resolving, individual bet results will appear
                here.
              </p>
            ) : (
              <ul className="space-y-1">
                {(history as any[])
                  .slice()
                  .reverse()
                  .slice(0, 30)
                  .map((h) => (
                    <li
                      key={h.recorded_at}
                      className="flex items-center justify-between"
                    >
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(h.recorded_at).toLocaleDateString()}
                      </span>
                      <span
                        className={
                          Number(h.bet_pnl ?? 0) >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {Number(h.bet_pnl ?? 0) >= 0 ? "+" : "-"}$
                        {Math.abs(Math.round(Number(h.bet_pnl ?? 0)))}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Summary stats
            </h2>
            <p>
              Cumulative P&amp;L:{" "}
              <span
                className={
                  Number(totalPnl) >= 0 ? "text-emerald-400" : "text-rose-400"
                }
              >
                {Number(totalPnl) >= 0 ? "+" : "-"}$
                {Math.abs(Math.round(Number(totalPnl)))}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Win rate:{" "}
              {winRate == null
                ? "—"
                : `${Math.round((winRate ?? 0) * 100)}% (${wins}–${losses})`}
            </p>
            <p className="mt-1 text-xs text-slate-400">Brier: {brier}</p>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">
            Category breakdown and PASS history will be added here once more
            data accrues and the resolution checker is live.
          </div>
        </aside>
      </section>
    </main>
  );
}

