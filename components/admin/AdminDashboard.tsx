"use client";

import { useState, useEffect, useMemo } from "react";
import { buildTwitterIntentUrl } from "@/lib/social/twitterIntent";

/** Persisted so a full page reload (e.g. after pipeline) restores the last tab. */
const ADMIN_SECTION_KEY = "polycast-admin-active-section";

type AdminSection =
  | "pending"
  | "approved"
  | "resolved"
  | "blueskyPending"
  | "blueskySent";

const ADMIN_SECTIONS: AdminSection[] = [
  "pending",
  "approved",
  "resolved",
  "blueskyPending",
  "blueskySent"
];

function readStoredAdminSection(): AdminSection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_SECTION_KEY);
    if (!raw || !ADMIN_SECTIONS.includes(raw as AdminSection)) return null;
    return raw as AdminSection;
  } catch {
    return null;
  }
}

function sortPendingByCreatedAtDesc(a: AdminMarket, b: AdminMarket): number {
  const at = a.created_at ? new Date(a.created_at).getTime() : 0;
  const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
  return bt - at;
}

/** Nearest resolution first; missing dates last. */
function sortApprovedByResolutionAsc(a: AdminMarket, b: AdminMarket): number {
  const at = a.resolution_date ? new Date(a.resolution_date).getTime() : Number.POSITIVE_INFINITY;
  const bt = b.resolution_date ? new Date(b.resolution_date).getTime() : Number.POSITIVE_INFINITY;
  return at - bt;
}

interface AdminMarket {
  id: string;
  polymarket_id: string;
  /** Used to restore sort order after failed optimistic update */
  created_at?: string;
  title: string;
  social_title: string | null;
  category: string | null;
  market_geography: string | null;
  resolution_date: string | null;
  market_url: string | null;
  status: string | null;
  current_price: number | null;
  volume: number | null;
  resolution_criteria: string | null;
  days_to_resolution: number | null;
  time_bucket: string;
}

interface ModelOddsSnapshot {
  blind_estimate: number | null;
  anchored_estimate: number | null;
  signal: string | null;
  edge: number | null;
  predicted_at: string | null;
}

interface ApprovedMarket extends AdminMarket {
  ai_odds_by_model: Record<string, ModelOddsSnapshot | undefined>;
}

interface ResolvedModelSnapshot extends ModelOddsSnapshot {
  pnl: number | null;
  outcome: boolean | null;
}

interface ResolvedMarket extends AdminMarket {
  resolved_outcome: "YES" | "NO" | "Unknown";
  ai_odds_by_model: Record<string, ResolvedModelSnapshot | undefined>;
}

interface HeldRow {
  id: string;
  market_id: string;
  held_at: string;
}

interface Props {
  pending: AdminMarket[];
  pendingCount: number;
  held: HeldRow[];
  approved: ApprovedMarket[];
  resolved: ResolvedMarket[];
  blueskyPendingPosts?: any[];
  blueskySentPosts?: any[];
}

export function AdminDashboard({
  pending: initialPending,
  pendingCount,
  approved: initialApproved,
  resolved: initialResolved,
  blueskyPendingPosts: initialBlueskyPendingPosts = [],
  blueskySentPosts: initialBlueskySentPosts = []
}: Props) {
  const [pending, setPending] = useState(initialPending);
  const [approved, setApproved] = useState(initialApproved);
  const [resolved, setResolved] = useState(initialResolved);
  const [blueskyPendingPosts, setBlueskyPendingPosts] = useState(
    initialBlueskyPendingPosts
  );
  const [blueskySentPosts, setBlueskySentPosts] = useState(
    initialBlueskySentPosts
  );
  const [activeSection, setActiveSection] = useState<AdminSection>("pending");
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveAllBusy, setApproveAllBusy] = useState(false);
  /** Stays in sync with server pending count for the “X of Y loaded” banner; updated optimistically. */
  const [pendingTotalCount, setPendingTotalCount] = useState(pendingCount);

  const approvedSorted = useMemo(
    () => [...approved].sort(sortApprovedByResolutionAsc),
    [approved]
  );

  useEffect(() => {
    setPending(initialPending);
  }, [initialPending]);

  useEffect(() => {
    setApproved(initialApproved);
  }, [initialApproved]);

  useEffect(() => {
    setResolved(initialResolved);
  }, [initialResolved]);

  useEffect(() => {
    setBlueskyPendingPosts(initialBlueskyPendingPosts);
  }, [initialBlueskyPendingPosts]);

  useEffect(() => {
    setBlueskySentPosts(initialBlueskySentPosts);
  }, [initialBlueskySentPosts]);

  useEffect(() => {
    setPendingTotalCount(pendingCount);
  }, [pendingCount]);

  useEffect(() => {
    const s = readStoredAdminSection();
    if (s) setActiveSection(s);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(ADMIN_SECTION_KEY, activeSection);
    } catch {
      /* ignore quota / private mode */
    }
  }, [activeSection]);

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

  async function regenerateApprovedOddsAll() {
    setPipelineBusy(true);
    setPipelineMessage(null);
    try {
      const res = await fetch("/api/admin/run-approved", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineMessage(
          `Failed: ${(body as { error?: string }).error ?? res.statusText}`
        );
        return;
      }
      setPipelineMessage(`Regenerating approved odds. Refreshing…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPipelineMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function runResolutionCheck() {
    setPipelineBusy(true);
    setPipelineMessage(null);
    try {
      const res = await fetch("/api/admin/run-resolution", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineMessage(
          `Failed: ${(body as { error?: string }).error ?? res.statusText}`
        );
        return;
      }
      setPipelineMessage("Resolution check finished. Refreshing…");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPipelineMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function action(
    marketId: string,
    actionType: "approve" | "reject" | "hold"
  ) {
    const removed = pending.find((m) => m.id === marketId);
    if (!removed) return;

    setPending((prev) => prev.filter((m) => m.id !== marketId));
    setPendingTotalCount((c) => Math.max(0, c - 1));

    setBusyId(marketId);
    try {
      const res = await fetch(`/api/admin/markets/${marketId}/${actionType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error(`${actionType} failed`);
    } catch (err) {
      console.error(err);
      setPending((prev) => [...prev, removed].sort(sortPendingByCreatedAtDesc));
      setPendingTotalCount((c) => c + 1);
      alert(`${actionType} failed`);
    } finally {
      setBusyId(null);
    }
  }

  async function approveAllPending() {
    const queue = [...pending];
    if (queue.length === 0) return;
    if (
      !confirm(
        `Approve all ${queue.length} pending market(s)? Each one runs AI pricing and may take a while in total.`
      )
    ) {
      return;
    }

    setApproveAllBusy(true);
    setPipelineMessage(null);
    const remaining = [...queue];
    const total = queue.length;
    try {
      while (remaining.length > 0) {
        const m = remaining[0];
        const done = total - remaining.length;
        setPipelineMessage(
          `Approving ${done + 1} / ${total}: ${m.title.length > 70 ? `${m.title.slice(0, 70)}…` : m.title}`
        );
        const res = await fetch(`/api/admin/markets/${m.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        remaining.shift();
        setPending((prev) => prev.filter((p) => p.id !== m.id));
        setPendingTotalCount((c) => Math.max(0, c - 1));
      }
      setPipelineMessage(`Approved ${total} market(s). Run “Regenerate Approved Odds” if you need a full batch refresh.`);
    } catch (err) {
      console.error(err);
      const failed = remaining[0];
      setPipelineMessage(
        failed
          ? `Approve all stopped: failed on “${failed.title.length > 80 ? `${failed.title.slice(0, 80)}…` : failed.title}”.`
          : "Approve all failed."
      );
      alert(
        failed
          ? `Approve failed on “${failed.title}”. Markets approved before this one are already saved.`
          : "Approve all failed."
      );
    } finally {
      setApproveAllBusy(false);
    }
  }

  async function regenerateMarketOdds(marketId: string) {
    setBusyId(marketId);
    setPipelineMessage(null);
    try {
      const res = await fetch(`/api/admin/markets/${marketId}/regenerate`, {
        method: "POST"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      setPipelineMessage(`Regenerated odds. Refreshing…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineMessage(`Error: ${msg}`);
      alert(`Regenerate failed: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  async function sendAllBlueskyPendingPosts() {
    setPipelineBusy(true);
    setPipelineMessage(null);
    try {
      const res = await fetch("/api/admin/social/bluesky/send", {
        method: "POST"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineMessage(
          `Send failed: ${(body as { error?: string }).error ?? res.statusText}`
        );
        return;
      }
      const count = (body as { count?: number }).count ?? 0;
      setPipelineMessage(`Sent ${count} pending Bluesky posts. Refreshing…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPipelineMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function sendSingleBlueskyPost(postId: string) {
    setBusyId(postId);
    setPipelineMessage(null);
    try {
      const res = await fetch(`/api/admin/social/bluesky/send/${postId}`, {
        method: "POST"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? res.statusText ?? "send failed"
        );
      }
      setPipelineMessage("Sent to Bluesky. Refreshing…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineMessage(`Error: ${msg}`);
      alert(`Send failed: ${msg}`);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBlueskyPendingPost(postId: string) {
    if (
      !confirm(
        "Remove this queued post from the list and database? This cannot be undone."
      )
    ) {
      return;
    }
    setBusyId(postId);
    setPipelineMessage(null);
    try {
      const res = await fetch(`/api/admin/social/bluesky/pending/${postId}`, {
        method: "DELETE"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? res.statusText ?? "delete failed"
        );
      }
      setBlueskyPendingPosts((prev) => prev.filter((p: { id: string }) => p.id !== postId));
      setPipelineMessage("Removed queued post.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPipelineMessage(`Error: ${msg}`);
      alert(`Delete failed: ${msg}`);
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
              Split controls: shortlist pipeline (daily), resolution check (can run multiple times/day), and odds regeneration.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runPipeline}
              disabled={pipelineBusy}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
            >
              {pipelineBusy ? "Running…" : "Run Pipeline (New Markets)"}
            </button>
            <button
              type="button"
              onClick={runResolutionCheck}
              disabled={pipelineBusy}
              className="rounded-full border border-cyan-700 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-cyan-200 shadow hover:bg-slate-900 disabled:opacity-60"
            >
              {pipelineBusy ? "Working…" : "Run Pipeline (Check Resolved)"}
            </button>
            <button
              type="button"
              onClick={regenerateApprovedOddsAll}
              disabled={pipelineBusy}
              className="rounded-full border border-emerald-700 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 shadow hover:bg-slate-900 disabled:opacity-60"
            >
              {pipelineBusy ? "Working…" : "Regenerate Approved Odds"}
            </button>
            {pipelineMessage && (
              <span className="text-sm text-slate-300">{pipelineMessage}</span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection("pending")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeSection === "pending"
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 text-slate-200 hover:border-slate-500"
            }`}
          >
            Pending ({pending.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("approved")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeSection === "approved"
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 text-slate-200 hover:border-slate-500"
            }`}
          >
            Approved/Active ({approved.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("blueskyPending")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeSection === "blueskyPending"
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 text-slate-200 hover:border-slate-500"
            }`}
          >
            Bluesky Pending ({blueskyPendingPosts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("resolved")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeSection === "resolved"
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 text-slate-200 hover:border-slate-500"
            }`}
          >
            Resolved ({resolved.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("blueskySent")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              activeSection === "blueskySent"
                ? "bg-emerald-500 text-slate-950"
                : "border border-slate-700 text-slate-200 hover:border-slate-500"
            }`}
          >
            Bluesky Sent ({blueskySentPosts.length})
          </button>
        </div>
      </section>

      {activeSection === "pending" && (
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-100">
            Pending markets ({pending.length}
            {pending.length !== pendingTotalCount ? ` of ${pendingTotalCount}` : ""})
          </h2>
          {pending.length > 0 ? (
            <button
              type="button"
              onClick={() => void approveAllPending()}
              disabled={approveAllBusy || pipelineBusy || busyId != null}
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-60"
            >
              {approveAllBusy ? "Approving all…" : `Approve all (${pending.length})`}
            </button>
          ) : null}
        </div>
        {pending.length !== pendingTotalCount && pendingTotalCount > 0 && (
          <p className="mb-2 text-sm text-amber-400">
            DB has {pendingTotalCount} pending; only {pending.length} loaded. Refresh or check server logs.
          </p>
        )}
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
                  {m.market_geography != null && m.market_geography !== "" && (
                    <p className="text-xs text-slate-400">
                      <span className="font-medium text-slate-300">Geography:</span>{" "}
                      {m.market_geography}
                    </p>
                  )}
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
                      ? new Date(m.resolution_date).toLocaleString(undefined, {
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
                  {m.market_url ? (
                    <a
                      href={m.market_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      View on Polymarket ↗
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">URL not available</span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => action(m.id, "approve")}
                    disabled={busyId === m.id || approveAllBusy}
                    className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => action(m.id, "hold")}
                    disabled={busyId === m.id || approveAllBusy}
                    className="rounded-full border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-400 disabled:opacity-60"
                  >
                    Hold
                  </button>
                  <button
                    onClick={() => action(m.id, "reject")}
                    disabled={busyId === m.id || approveAllBusy}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-red-500/50 hover:bg-slate-700 disabled:opacity-60"
                  >
                    Reject (2 days)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === "approved" && (
      <section>
        <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-100">
          Approved/Active markets ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-slate-400">
            No approved markets yet. Approve pending markets to generate AI odds.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {approvedSorted.map((m) => (
              <div
                key={m.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="space-y-2">
                  <div>
                    <p className="text-base font-bold leading-snug text-slate-100">
                      {m.resolution_date
                        ? new Date(m.resolution_date).toLocaleString(undefined, {
                            dateStyle: "long",
                            timeStyle: "short"
                          })
                        : "Resolution date TBD"}
                    </p>
                    {(m.days_to_resolution != null || m.time_bucket) && (
                      <p className="mt-1 text-xs text-slate-400">
                        {m.days_to_resolution != null && (
                          <span>{m.days_to_resolution} days to resolution</span>
                        )}
                        {m.time_bucket && (
                          <>
                            {m.days_to_resolution != null ? " · " : null}
                            <span className="font-mono text-slate-300">{m.time_bucket}</span>
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  <h3 className="text-base font-semibold leading-snug text-slate-100">{m.title}</h3>

                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      AI odds snapshot
                    </p>
                    <div className="mt-2 space-y-1">
                      {(["Claude", "ChatGPT", "Gemini", "Grok"] as const).map((model) => {
                        const o = m.ai_odds_by_model?.[model];
                        const estimate =
                          o?.anchored_estimate != null
                            ? o.anchored_estimate
                            : o?.blind_estimate;
                        return (
                          <p key={model} className="text-xs text-slate-300">
                            <span className="font-medium text-slate-200">{model}:</span>{" "}
                            {estimate != null ? `${estimate}%` : "—"}
                            {o?.signal ? ` (${o.signal})` : ""}
                          </p>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Category:</span>{" "}
                    {m.category ?? "Uncategorized"}
                  </p>
                  {m.market_geography != null && m.market_geography !== "" && (
                    <p className="text-xs text-slate-400">
                      <span className="font-medium text-slate-300">Geography:</span>{" "}
                      {m.market_geography}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Crowd price:</span>{" "}
                    {m.current_price != null
                      ? `${Math.round(Number(m.current_price) * 100)}%`
                      : "—"}
                    {m.volume != null && (
                      <>
                        {" "}
                        · <span className="font-medium text-slate-300">Volume:</span> $
                        {Number(m.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </>
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

                  {m.market_url ? (
                    <a
                      href={m.market_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      View on Polymarket ↗
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">URL not available</span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => regenerateMarketOdds(m.id)}
                    disabled={busyId === m.id}
                    className="rounded-full border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:border-emerald-500 disabled:opacity-60"
                  >
                    Regenerate
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
                    Reject (2 days)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === "resolved" && (
      <section>
        <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-100">
          Resolved markets ({resolved.length})
        </h2>
        {resolved.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-slate-400">
            No resolved markets yet.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {resolved.map((m) => (
              <div
                key={m.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="space-y-2">
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Real-world result
                    </p>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        m.resolved_outcome === "YES"
                          ? "text-emerald-300"
                          : m.resolved_outcome === "NO"
                            ? "text-red-300"
                            : "text-slate-300"
                      }`}
                    >
                      {m.resolved_outcome}
                    </p>
                  </div>

                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Model P&L snapshot
                    </p>
                    <div className="mt-2 space-y-1">
                      {(["Claude", "ChatGPT", "Gemini", "Grok"] as const).map((model) => {
                        const o = m.ai_odds_by_model?.[model];
                        const estimate =
                          o?.anchored_estimate != null
                            ? o.anchored_estimate
                            : o?.blind_estimate;
                        const pnl = o?.pnl;
                        return (
                          <p key={model} className="text-xs text-slate-300">
                            <span className="font-medium text-slate-200">{model}:</span>{" "}
                            {estimate != null ? `${estimate}%` : "—"}
                            {o?.signal ? ` (${o.signal})` : ""}
                            {" · "}
                            <span
                              className={
                                pnl == null
                                  ? "text-slate-300"
                                  : Number(pnl) >= 0
                                    ? "text-emerald-300"
                                    : "text-red-300"
                              }
                            >
                              {pnl == null ? "PASS" : `${Number(pnl) >= 0 ? "+" : ""}$${Math.round(Number(pnl))}`}
                            </span>
                          </p>
                        );
                      })}
                    </div>
                  </div>

                  <h3 className="text-base font-semibold text-slate-100">{m.title}</h3>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Category:</span>{" "}
                    {m.category ?? "Uncategorized"}
                  </p>
                  {m.market_geography != null && m.market_geography !== "" && (
                    <p className="text-xs text-slate-400">
                      <span className="font-medium text-slate-300">Geography:</span>{" "}
                      {m.market_geography}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Crowd price:</span>{" "}
                    {m.current_price != null
                      ? `${Math.round(Number(m.current_price) * 100)}%`
                      : "—"}
                    {m.volume != null && (
                      <>
                        {" "}
                        · <span className="font-medium text-slate-300">Volume:</span> $
                        {Number(m.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Resolution date:</span>{" "}
                    {m.resolution_date
                      ? new Date(m.resolution_date).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })
                      : "TBD"}
                    {m.time_bucket && (
                      <>
                        {" "}
                        · <span className="font-mono text-slate-300">{m.time_bucket}</span>
                      </>
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

                  {m.market_url ? (
                    <a
                      href={m.market_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      View on Polymarket ↗
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">URL not available</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === "blueskyPending" && (
      <section>
        <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-100">
          Bluesky pending posts ({blueskyPendingPosts.length})
        </h2>
        <p className="mb-4 max-w-3xl text-sm text-slate-400">
          Copy is queued as <code className="text-slate-300">pending</code> when the pipeline runs. Use{" "}
          <strong className="text-slate-200">Send</strong> / <strong className="text-slate-200">Send All Pending</strong>{" "}
          to post to Bluesky (server needs <code className="text-slate-300">BLUESKY_*</code>).{" "}
          <strong className="text-slate-200">Post on X</strong> is optional—opens X with the text pre-filled. Nothing
          auto-posts from crons.
        </p>
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={sendAllBlueskyPendingPosts}
            disabled={pipelineBusy || blueskyPendingPosts.length === 0}
            className="rounded-full border border-emerald-700 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 shadow hover:bg-slate-950 disabled:opacity-60"
          >
            Send All Pending
          </button>
        </div>
        {blueskyPendingPosts.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-slate-400">
            No queued posts. When predictions or resolution copy is generated, it will appear here.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {blueskyPendingPosts.map((p: any) => (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-slate-100">
                    {p.title ?? p.post_type ?? "Social post"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Type:</span>{" "}
                    {p.post_type ?? "—"} · <span className="font-medium text-slate-300">Status:</span>{" "}
                    <span className="font-mono">{p.status ?? "—"}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Created:</span>{" "}
                    {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
                  </p>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Posted:</span>{" "}
                    {p.posted_at ? new Date(p.posted_at).toLocaleString() : "—"}
                    {p.platform_post_id ? (
                      <> · <span className="font-mono">{String(p.platform_post_id).slice(0, 32)}…</span></>
                    ) : null}
                  </p>

                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Post text
                    </p>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-slate-200">
                      {p.post_text}
                    </pre>
                  </div>

                  {p.error_message && (
                    <div className="rounded border border-red-900/40 bg-red-950/30 p-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-red-300">
                        Error
                      </p>
                      <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-red-200">
                        {p.error_message}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => sendSingleBlueskyPost(p.id)}
                    disabled={busyId === p.id}
                    className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-60"
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteBlueskyPendingPost(p.id)}
                    disabled={busyId === p.id}
                    className="rounded-full border border-red-500/60 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-red-300 hover:border-red-400 hover:bg-slate-800 disabled:opacity-60"
                  >
                    Delete
                  </button>
                  <a
                    href={buildTwitterIntentUrl(
                      typeof p.post_text === "string" ? p.post_text : ""
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-sky-500"
                  >
                    Post on X
                  </a>
                  {p.market_url ? (
                    <a
                      href={p.market_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-xs font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      Polymarket ↗
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">URL not available</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeSection === "blueskySent" && (
      <section>
        <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-100">
          Bluesky sent posts ({blueskySentPosts.length})
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Posts successfully sent via the Bluesky API from this admin panel.
        </p>
        {blueskySentPosts.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-8 text-center text-slate-400">
            No sent posts yet.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {blueskySentPosts.map((p: any) => (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-slate-100">
                    {p.title ?? p.post_type ?? "Social post"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Type:</span>{" "}
                    {p.post_type ?? "—"} · <span className="font-medium text-slate-300">Posted:</span>{" "}
                    {p.posted_at ? new Date(p.posted_at).toLocaleString() : "—"}
                  </p>
                  {p.platform_post_id && (
                    <p className="text-xs text-slate-400">
                      <span className="font-medium text-slate-300">URI:</span>{" "}
                      <span className="font-mono">
                        {String(p.platform_post_id).slice(0, 32)}
                        …
                      </span>
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded border border-slate-700 bg-slate-900/50 p-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Post text
                  </p>
                  <pre className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-xs text-slate-200">
                    {p.post_text}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
