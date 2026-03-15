"use client";

import { useState, useEffect } from "react";

interface AdminMarket {
  id: string;
  polymarket_id: string;
  title: string;
  social_title: string | null;
  category: string | null;
  resolution_date: string | null;
  market_url: string | null;
  status: string | null;
  current_price: number | null;
  volume: number | null;
  resolution_criteria: string | null;
  days_to_resolution: number | null;
  time_bucket: string;
}

interface HeldRow {
  id: string;
  market_id: string;
  held_at: string;
}

interface Props {
  pending: AdminMarket[];
  held: HeldRow[];
}

export function AdminDashboard({ pending: initialPending, held }: Props) {
  const [pending, setPending] = useState(initialPending);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setPending(initialPending);
  }, [initialPending]);

  useEffect(() => {
    const t = setInterval(() => {
      window.location.reload();
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  async function runPipeline() {
    setPipelineBusy(true);
    setPipelineMessage(null);
    try {
      const res = await fetch("/api/admin/fetch-shortlist", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineMessage(`Failed: ${(body as { error?: string }).error ?? res.statusText}`);
        return;
      }
      const count = (body as { count?: number }).count ?? 0;
      setPipelineMessage(`Fetched ${count} markets. Refreshing…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPipelineMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function action(marketId: string, action: "approve" | "reject" | "hold") {
    setBusyId(marketId);
    try {
      const res = await fetch(`/api/admin/markets/${marketId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error(`${action} failed`);
      setPending((prev) => prev.filter((m) => m.id !== marketId));
    } catch (err) {
      console.error(err);
      alert(`${action} failed`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Pipeline
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Fetch fresh markets from Polymarket (Gemini selects 20). Clears current pending and held.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runPipeline}
              disabled={pipelineBusy}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
            >
              {pipelineBusy ? "Running…" : "Run Pipeline"}
            </button>
            {pipelineMessage && (
              <span className="text-sm text-slate-300">{pipelineMessage}</span>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">
          Pending markets ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-slate-400">
            No pending markets. Click Run Pipeline to fetch fresh markets.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-slate-100">
                    {m.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Category:</span>{" "}
                    {m.category ?? "Uncategorized"}
                  </p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Crowd price:</span>{" "}
                    {m.current_price != null
                      ? `${Math.round(Number(m.current_price) * 100)}%`
                      : "—"}
                    {m.volume != null && (
                      <> · <span className="font-medium text-slate-300">Volume:</span> ${Number(m.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}</>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Resolution:</span>{" "}
                    {m.resolution_date
                      ? new Date(m.resolution_date).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })
                      : "TBD"}
                    {m.days_to_resolution != null && (
                      <> · {m.days_to_resolution} days</>
                    )}
                    {m.time_bucket && (
                      <> · <span className="font-mono text-slate-300">{m.time_bucket}</span></>
                    )}
                  </p>
                  {m.resolution_criteria && (
                    <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Resolution criteria
                      </p>
                      <p className="mt-1 max-h-24 overflow-y-auto text-xs text-slate-300 whitespace-pre-wrap">
                        {m.resolution_criteria}
                      </p>
                    </div>
                  )}
                  {m.market_url && (
                    <a
                      href={m.market_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      View on Polymarket ↗
                    </a>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => action(m.id, "approve")}
                    disabled={busyId === m.id}
                    className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => action(m.id, "hold")}
                    disabled={busyId === m.id}
                    className="rounded-full border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-400 disabled:opacity-60"
                  >
                    Hold
                  </button>
                  <button
                    onClick={() => action(m.id, "reject")}
                    disabled={busyId === m.id}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-red-500/50 hover:bg-slate-700 disabled:opacity-60"
                  >
                    Reject (7 days)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
