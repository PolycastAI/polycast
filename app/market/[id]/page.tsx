import { supabaseAdmin } from "@/lib/supabase/server";
import { XCopyButton } from "@/components/social/XCopyButton";

interface MarketPageProps {
  params: { id: string };
}

async function getMarketWithPredictions(id: string) {
  const { data: market, error: marketError } = await supabaseAdmin
    .from("markets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (marketError || !market) return null;

  const { data: predictions, error: predError } = await supabaseAdmin
    .from("predictions")
    .select("*")
    .eq("market_id", id)
    .order("predicted_at", { ascending: false });

  if (predError || !predictions) return { market, predictions: [] };

  return { market, predictions };
}

export default async function MarketPage({ params }: MarketPageProps) {
  const result = await getMarketWithPredictions(params.id);

  if (!result) {
    return (
      <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
        <p className="text-sm text-slate-400">Market not found.</p>
      </main>
    );
  }

  const { market, predictions } = result as any;

  const byModel = new Map<string, any>();
  for (const p of predictions as any[]) {
    if (!byModel.has(p.model)) {
      byModel.set(p.model, p);
    }
  }

  const resolutionDate = market.resolution_date as string | null;
  const resolutionDisplay = resolutionDate
    ? new Date(resolutionDate).toLocaleString()
    : "TBD";

  const polymarketUrl = market.market_url as string | null;
  const socialTitle =
    market.social_title && market.social_title.length > 0
      ? market.social_title
      : market.title;

  const crowdPrice =
    predictions.length > 0 ? predictions[0].crowd_price_at_time ?? null : null;

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
            {market.title}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Resolves{" "}
            <span className="font-mono text-slate-100">{resolutionDisplay}</span>{" "}
            · Category:{" "}
            <span className="font-medium">
              {market.category ?? "Uncategorized"}
            </span>
          </p>
          {polymarketUrl ? (
            <a
              href={polymarketUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              View on Polymarket
              <span className="ml-1 text-[10px]">↗</span>
            </a>
          ) : (
            <p className="mt-1 text-xs text-slate-500">URL not available</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <XCopyButton
            socialTitle={socialTitle}
            polymarketProbPercent={
              crowdPrice != null ? Number(crowdPrice) * 100 : 50
            }
            resolutionDate={resolutionDate}
            claude={
              byModel.get("Claude")
                ? {
                    estimate: byModel.get("Claude").blind_estimate,
                    signal: byModel.get("Claude").signal
                  }
                : null
            }
            chatgpt={
              byModel.get("ChatGPT")
                ? {
                    estimate: byModel.get("ChatGPT").blind_estimate,
                    signal: byModel.get("ChatGPT").signal
                  }
                : null
            }
            gemini={
              byModel.get("Gemini")
                ? {
                    estimate: byModel.get("Gemini").blind_estimate,
                    signal: byModel.get("Gemini").signal
                  }
                : null
            }
            grok={
              byModel.get("Grok")
                ? {
                    estimate: byModel.get("Grok").blind_estimate,
                    signal: byModel.get("Grok").signal
                  }
                : null
            }
            marketUrl={`https://polycast.ai/market/${params.id}`}
          />
        </div>
      </header>

      <section className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Model estimates
            </h2>
            <div className="grid gap-3 md:grid-cols-4 text-xs text-slate-300">
              {["Claude", "ChatGPT", "Gemini", "Grok"].map((model) => {
                const p = byModel.get(model);
                if (!p) {
                  return (
                    <div
                      key={model}
                      className="rounded-xl bg-slate-900/60 p-3 text-slate-500"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {model}
                      </div>
                      <div className="mt-2 text-[11px]">No prediction yet.</div>
                    </div>
                  );
                }
                return (
                  <div
                    key={model}
                    className="rounded-xl bg-slate-900/60 p-3 text-slate-200"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {model}
                    </div>
                    <div className="mt-2 text-lg font-semibold">
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
                    {p.anchored_estimate != null && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        Anchored: {p.anchored_estimate}% (
                        {p.anchoring_delta ?? 0 >= 0 ? "+" : ""}
                        {p.anchoring_delta ?? 0}pts)
                      </div>
                    )}
                    {p.edge != null && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        Edge vs crowd: {p.edge > 0 ? "+" : ""}
                        {p.edge} pts
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {["Claude", "ChatGPT", "Gemini", "Grok"].map((model) => {
              const p = byModel.get(model);
              if (!p) return null;
              return (
                <details
                  key={model}
                  className="group rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-100">
                    <span>{model} reasoning</span>
                    <span className="text-xs text-slate-500 group-open:hidden">
                      Expand
                    </span>
                    <span className="hidden text-xs text-slate-500 group-open:inline">
                      Collapse
                    </span>
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                    {p.reasoning_text}
                  </pre>
                </details>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Market status
            </h2>
            <p>
              Status:{" "}
              <span className="font-semibold text-slate-100">
                {market.status}
              </span>
            </p>
            {market.estimate_std_dev != null && (
              <p className="mt-1 text-xs text-slate-400">
                Cross-model dispersion:{" "}
                {Number(market.estimate_std_dev).toFixed(1)} pts
              </p>
            )}
          </div>
          {/* Placeholder for price movement and resolution P&L, to be populated by price updater and resolution checker. */}
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">
            Price chart and resolution P&amp;L will appear here once the price
            updater and resolution checker jobs are wired in.
          </div>
        </aside>
      </section>
    </main>
  );
}

