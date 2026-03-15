"use client";

import { useState } from "react";

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
}

interface InsufficientSignalRow {
  id: string;
  market_id: string;
  rejected_at: string;
  resurface_at: string | null;
  rejection_reason: string | null;
}

interface HeldRow {
  id: string;
  market_id: string;
  held_at: string;
}

interface Props {
  pending: AdminMarket[];
  insufficientSignals: InsufficientSignalRow[];
  held: HeldRow[];
  bingMonthlyCalls: number;
}

export function AdminDashboard({
  pending,
  insufficientSignals,
  held,
  bingMonthlyCalls
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState(pending);
  const [savingSocialId, setSavingSocialId] = useState<string | null>(null);
  const [runApprovedBusy, setRunApprovedBusy] = useState(false);
  const [fetchShortlistBusy, setFetchShortlistBusy] = useState(false);

  async function callAction(
    id: string,
    action: "approve" | "reject" | "hold"
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/markets/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error(`${action} failed`);
      setLocalPending((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error(err);
      // TODO: add toast
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Pipeline health
          </h2>
          <p className="text-sm text-slate-400">
            Bing API calls this month:{" "}
            <span className="font-mono text-slate-100">{bingMonthlyCalls}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            Fetch shortlist, then approve and run prompts.
          </p>
          <button
            type="button"
            onClick={async () => {
              setFetchShortlistBusy(true);
              try {
                const res = await fetch("/api/admin/fetch-shortlist", {
                  method: "POST"
                });
                const body = await res.json().catch(() => ({}));
                const errMsg = (body as { error?: string })?.error ?? res.statusText;
                if (!res.ok) {
                  alert(`Fetch shortlist failed: ${errMsg}`);
                  return;
                }
                window.location.reload();
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                alert(`Fetch shortlist error: ${msg}`);
              } finally {
                setFetchShortlistBusy(false);
              }
            }}
            disabled={fetchShortlistBusy}
            className="rounded-full bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-500 disabled:opacity-60"
          >
            {fetchShortlistBusy ? "Fetching…" : "Fetch today's shortlist"}
          </button>
          <button
            type="button"
            onClick={async () => {
              setRunApprovedBusy(true);
              try {
                const res = await fetch("/api/admin/run-approved", {
                  method: "POST"
                });
                if (!res.ok) throw new Error("Run failed");
                window.location.reload();
              } catch (e) {
                console.error(e);
              } finally {
                setRunApprovedBusy(false);
              }
            }}
            disabled={runApprovedBusy}
            className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
          >
            {runApprovedBusy ? "Running…" : "Run approved markets"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">
          Pending markets ({localPending.length})
        </h2>
        {localPending.length === 0 ? (
          <p className="text-sm text-slate-500">
            No pending markets right now. Check back after the next pipeline run.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {localPending.map((m) => {
              const titleTooLong = (m.title ?? "").length > 60;
              const resolution =
                m.resolution_date != null
                  ? new Date(m.resolution_date).toLocaleString()
                  : "TBD";
              return (
                <div
                  key={m.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-slate-100">
                        {m.title}
                      </h3>
                      {titleTooLong && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
                          Social title needed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Category:{" "}
                      <span className="font-medium">
                        {m.category ?? "Uncategorized"}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      Resolves:{" "}
                      <span className="font-mono text-slate-200">
                        {resolution}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      Polymarket:{" "}
                      <span className="font-mono text-slate-200">
                        {m.current_price != null
                          ? `${(Number(m.current_price) * 100).toFixed(0)}%`
                          : "—"}
                        {m.volume != null && (
                          <> · ${Number(m.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })} vol</>
                        )}
                      </span>
                    </p>
                    {(titleTooLong || m.social_title) && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          Social title (for posts)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            defaultValue={m.social_title ?? ""}
                            maxLength={80}
                            placeholder={m.title?.slice(0, 57) + "…"}
                            className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                            onBlur={async (e) => {
                              const val = e.target.value.trim();
                              if (val === (m.social_title ?? "")) return;
                              setSavingSocialId(m.id);
                              try {
                                await fetch(`/api/admin/markets/${m.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ social_title: val || null })
                                });
                                setLocalPending((prev) =>
                                  prev.map((x) =>
                                    x.id === m.id ? { ...x, social_title: val || null } : x
                                  )
                                );
                              } finally {
                                setSavingSocialId(null);
                              }
                            }}
                          />
                          {savingSocialId === m.id && (
                            <span className="text-[10px] text-slate-500">Saving…</span>
                          )}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">
                      Resolution criteria and news headlines will be ingested in
                      a later step. For now, review via Polymarket.
                    </p>
                    {m.market_url && (
                      <a
                        href={m.market_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                      >
                        View on Polymarket
                        <span className="ml-1 text-[10px]">↗</span>
                      </a>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => callAction(m.id, "approve")}
                        disabled={busyId === m.id}
                        className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => callAction(m.id, "hold")}
                        disabled={busyId === m.id}
                        className="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-400 disabled:cursor-wait disabled:opacity-60"
                      >
                        Hold
                      </button>
                    </div>
                    <button
                      onClick={() => callAction(m.id, "reject")}
                      disabled={busyId === m.id}
                      className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-red-500/60 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                    >
                      Reject (7 days)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-100">
            Post-prompt rejections (insufficient signals)
          </h2>
          {insufficientSignals.length === 0 ? (
            <p className="text-xs text-slate-500">
              None recorded yet. These appear when the minimum-signal rule
              filters out markets after prompts run.
            </p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-400">
              {insufficientSignals.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-slate-300">
                    {r.market_id}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(r.rejected_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-100">
            Held markets
          </h2>
          {held.length === 0 ? (
            <p className="text-xs text-slate-500">
              Markets you explicitly hold will show here until the next run.
            </p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-400">
              {held.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-slate-300">
                    {h.market_id}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(h.held_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

