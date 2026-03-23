"use client";

import { useMemo, useState } from "react";
import type {
  ModelPageCategoryPerf,
  ModelPageHistory,
  ModelPagePerf,
  ModelPagePrediction
} from "./types";

type WindowKey = "7d" | "30d" | "all-time";
type OutcomeFilter = "all" | "correct" | "incorrect";
type SignalFilter = "all" | "BET YES" | "BET NO";

const MODEL_LINKS = [
  { slug: "claude", name: "Claude" },
  { slug: "chatgpt", name: "ChatGPT" },
  { slug: "gemini", name: "Gemini" },
  { slug: "grok", name: "Grok" }
] as const;

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  const rounded = Math.round(Math.abs(v));
  return `${v >= 0 ? "+" : "-"}$${rounded.toLocaleString()}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Math.round(Number(n))}%`;
}

function getResolvedDate(p: ModelPagePrediction): string | null {
  return p.resolution_date ?? p.markets?.resolution_date ?? null;
}

function isBetSignal(signal: string | null): signal is "BET YES" | "BET NO" {
  return signal === "BET YES" || signal === "BET NO";
}

function isCorrect(p: ModelPagePrediction): boolean | null {
  if (!isBetSignal(p.signal) || p.outcome == null) return null;
  if (p.signal === "BET YES") return p.outcome === true;
  return p.outcome === false;
}

function toDateValue(s: string | null): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Axis labels: signed dollars without forcing "+" on positive (cleaner ticks). */
function fmtAxisUsd(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  return `${sign}$${Math.abs(r).toLocaleString()}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ~4–5 evenly spaced Y ticks including min/max domain used for scaling. */
function buildYTicks(rangeMin: number, rangeMax: number, count = 5): number[] {
  const span = rangeMax - rangeMin;
  if (span <= 0) {
    const pad = Math.max(Math.abs(rangeMin) * 0.05, 25);
    return buildYTicks(rangeMin - pad, rangeMax + pad, count);
  }
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => rangeMin + step * i);
}

function EquityChart({
  history,
  windowKey
}: {
  history: ModelPageHistory[];
  windowKey: WindowKey;
}) {
  const filtered = useMemo(() => {
    if (windowKey === "all-time") return history;
    const now = Date.now();
    const days = windowKey === "7d" ? 7 : 30;
    const minTs = now - days * 24 * 60 * 60 * 1000;
    return history.filter((h) => toDateValue(h.recorded_at) >= minTs);
  }, [history, windowKey]);

  const chartGeom = useMemo(() => {
    const W = 720;
    const H = 300;
    const pad = { left: 58, right: 18, top: 16, bottom: 44 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    return { W, H, pad, innerW, innerH };
  }, []);

  const layout = useMemo(() => {
    if (filtered.length === 0) return null;

    const vals = filtered.map((h) => Number(h.cumulative_pnl ?? 0));
    const dataMin = Math.min(...vals);
    const dataMax = Math.max(...vals);
    const spread = dataMax - dataMin;
    const padY = Math.max(spread * 0.12, 25);
    let rangeMin = dataMin - padY;
    let rangeMax = dataMax + padY;
    if (rangeMax - rangeMin < 1) {
      rangeMin -= 50;
      rangeMax += 50;
    }
    const ySpan = rangeMax - rangeMin;

    const yTicks = buildYTicks(rangeMin, rangeMax, 5);

    const n = filtered.length;
    const xAt = (i: number) =>
      chartGeom.pad.left + (n <= 1 ? chartGeom.innerW / 2 : (i / (n - 1)) * chartGeom.innerW);
    const yAt = (v: number) =>
      chartGeom.pad.top +
      chartGeom.innerH -
      ((v - rangeMin) / ySpan) * chartGeom.innerH;

    const linePoints = filtered.map((h, i) => ({
      x: xAt(i),
      y: yAt(Number(h.cumulative_pnl ?? 0))
    }));

    const last = Number(filtered[filtered.length - 1]?.cumulative_pnl ?? 0);
    const lineColor = last >= 0 ? "#22c55e" : "#f43f5e";

    const zeroY =
      rangeMin <= 0 && rangeMax >= 0 ? yAt(0) : null;

    const xLabelIndices =
      n <= 1
        ? [0]
        : n === 2
          ? [0, 1]
          : [0, Math.floor((n - 1) / 2), n - 1];

    const xLabels = xLabelIndices.map((i) => ({
      x: xAt(i),
      label: formatShortDate(filtered[i].recorded_at)
    }));

    return {
      ...chartGeom,
      rangeMin,
      rangeMax,
      yTicks,
      yAt,
      linePoints,
      lineColor,
      zeroY,
      xLabels
    };
  }, [filtered, chartGeom]);

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No resolved bets in this time range.
      </p>
    );
  }

  if (!layout) return null;

  const { W, H, pad, innerW, innerH, yTicks, yAt, linePoints, lineColor, zeroY, xLabels } =
    layout;

  return (
    <div className="space-y-2">
      <p className="text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Cumulative P&amp;L (USD)
      </p>
      <div className="w-full overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="min-h-[260px] w-full min-w-[320px]"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Equity curve: cumulative profit and loss over time"
        >
          {/* Plot border */}
          <rect
            x={pad.left}
            y={pad.top}
            width={innerW}
            height={innerH}
            fill="none"
            stroke="#334155"
            strokeWidth={1}
          />

          {/* Y grid + labels */}
          {yTicks.map((tick) => {
            const y = yAt(tick);
            return (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={pad.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={pad.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#94a3b8"
                  style={{ fontSize: 11 }}
                >
                  {fmtAxisUsd(tick)}
                </text>
              </g>
            );
          })}

          {/* X axis line */}
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={pad.top + innerH}
            y2={pad.top + innerH}
            stroke="#475569"
            strokeWidth={1}
          />

          {/* Zero line (P&amp;L = 0) when visible */}
          {zeroY != null && zeroY >= pad.top && zeroY <= pad.top + innerH ? (
            <line
              x1={pad.left}
              x2={pad.left + innerW}
              y1={zeroY}
              y2={zeroY}
              stroke="#64748b"
              strokeWidth={1}
            />
          ) : null}

          {/* Equity line */}
          <polyline
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={linePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          />

          {/* X tick labels */}
          {xLabels.map((xl, idx) => (
            <text
              key={idx}
              x={xl.x}
              y={H - 10}
              textAnchor="middle"
              fill="#94a3b8"
              style={{ fontSize: 11 }}
            >
              {xl.label}
            </text>
          ))}
        </svg>
      </div>
      <p className="text-center text-[11px] text-slate-500">Date (resolved)</p>
    </div>
  );
}

export function ModelProfileClient({
  modelName,
  modelSlug,
  perf,
  history,
  predictions,
  categoryPerf,
  latestPriceByMarketId
}: {
  modelName: string;
  modelSlug: string;
  perf: ModelPagePerf;
  history: ModelPageHistory[];
  predictions: ModelPagePrediction[];
  categoryPerf: ModelPageCategoryPerf[];
  latestPriceByMarketId: Record<
    string,
    { current_price: number | null; recorded_at: string | null }
  >;
}) {
  const [windowKey, setWindowKey] = useState<WindowKey>("all-time");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [timeBucketFilter, setTimeBucketFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");

  const latestModelVersion = useMemo(() => {
    const row = predictions.find((p) => p.model_version && p.model_version.trim());
    return row?.model_version ?? "Unknown version";
  }, [predictions]);

  const betPredictions = useMemo(
    () => predictions.filter((p) => isBetSignal(p.signal)),
    [predictions]
  );
  const passPredictions = useMemo(
    () => predictions.filter((p) => p.signal === "PASS"),
    [predictions]
  );

  const pending = useMemo(
    () =>
      predictions
        .filter((p) => p.resolved !== true)
        .sort((a, b) => toDateValue(b.predicted_at) - toDateValue(a.predicted_at)),
    [predictions]
  );

  const resolvedBets = useMemo(
    () =>
      predictions
        .filter((p) => p.resolved === true && isBetSignal(p.signal))
        .sort((a, b) => toDateValue(getResolvedDate(b)) - toDateValue(getResolvedDate(a))),
    [predictions]
  );

  const passResolved = useMemo(
    () =>
      passPredictions
        .filter((p) => p.resolved === true)
        .sort((a, b) => toDateValue(getResolvedDate(b)) - toDateValue(getResolvedDate(a))),
    [passPredictions]
  );

  const summary = useMemo(() => {
    const totalBetsPlaced = betPredictions.length;
    const totalPass = passPredictions.length;

    const winsFromPerf = Number(perf?.wins ?? 0);
    const lossesFromPerf = Number(perf?.losses ?? 0);
    const totalFromPerf = winsFromPerf + lossesFromPerf;

    const resolvedForStreak = resolvedBets
      .slice()
      .sort((a, b) => toDateValue(getResolvedDate(a)) - toDateValue(getResolvedDate(b)));

    let longestWin = 0;
    let longestLoss = 0;
    let curWin = 0;
    let curLoss = 0;
    for (const r of resolvedForStreak) {
      const correct = isCorrect(r);
      if (correct === true) {
        curWin += 1;
        curLoss = 0;
      } else if (correct === false) {
        curLoss += 1;
        curWin = 0;
      } else {
        curWin = 0;
        curLoss = 0;
      }
      longestWin = Math.max(longestWin, curWin);
      longestLoss = Math.max(longestLoss, curLoss);
    }

    const winningPnls = resolvedBets
      .map((r) => Number(r.pnl ?? 0))
      .filter((n) => n > 0);
    const losingPnls = resolvedBets
      .map((r) => Number(r.pnl ?? 0))
      .filter((n) => n < 0);

    const avgWin =
      winningPnls.length > 0
        ? winningPnls.reduce((a, b) => a + b, 0) / winningPnls.length
        : null;
    const avgLoss =
      losingPnls.length > 0
        ? Math.abs(losingPnls.reduce((a, b) => a + b, 0) / losingPnls.length)
        : null;

    const winRate =
      totalFromPerf > 0 ? winsFromPerf / totalFromPerf : null;

    const totalPnl =
      perf?.total_pnl != null
        ? Number(perf.total_pnl)
        : resolvedBets.reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);

    return {
      totalPnl,
      winRate,
      totalBetsPlaced,
      totalPass,
      avgWin,
      avgLoss,
      longestWin,
      longestLoss
    };
  }, [betPredictions, passPredictions, perf, resolvedBets]);

  const resolvedFiltered = useMemo(() => {
    return resolvedBets.filter((r) => {
      if (categoryFilter !== "all" && (r.markets?.category ?? "Uncategorized") !== categoryFilter) {
        return false;
      }
      if (timeBucketFilter !== "all" && (r.time_bucket ?? "unknown") !== timeBucketFilter) {
        return false;
      }
      if (signalFilter !== "all" && r.signal !== signalFilter) return false;
      const correct = isCorrect(r);
      if (outcomeFilter === "correct" && correct !== true) return false;
      if (outcomeFilter === "incorrect" && correct !== false) return false;
      return true;
    });
  }, [resolvedBets, categoryFilter, timeBucketFilter, signalFilter, outcomeFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of resolvedBets) set.add(r.markets?.category ?? "Uncategorized");
    return Array.from(set).sort();
  }, [resolvedBets]);
  const timeBuckets = useMemo(() => {
    const set = new Set<string>();
    for (const r of resolvedBets) set.add(r.time_bucket ?? "unknown");
    return Array.from(set).sort();
  }, [resolvedBets]);

  const categoryRows = useMemo(() => {
    const cleanPerf = categoryPerf.filter((r) => r.category != null);
    if (cleanPerf.length > 0) {
      return cleanPerf
        .map((r) => {
          const wins = Number(r.wins ?? 0);
          const losses = Number(r.losses ?? 0);
          const total = Number(r.total_bets ?? wins + losses);
          const winRate = total > 0 ? wins / total : null;
          return {
            category: String(r.category),
            winRate,
            totalPnl: Number(r.total_pnl ?? 0),
            bets: total
          };
        })
        .sort((a, b) => b.bets - a.bets);
    }

    const byCategory = new Map<string, { wins: number; losses: number; pnl: number; bets: number }>();
    for (const r of resolvedBets) {
      const cat = r.markets?.category ?? "Uncategorized";
      const cur = byCategory.get(cat) ?? { wins: 0, losses: 0, pnl: 0, bets: 0 };
      const correct = isCorrect(r);
      if (correct === true) cur.wins += 1;
      if (correct === false) cur.losses += 1;
      cur.pnl += Number(r.pnl ?? 0);
      cur.bets += 1;
      byCategory.set(cat, cur);
    }
    return Array.from(byCategory.entries())
      .map(([category, s]) => ({
        category,
        winRate: s.bets > 0 ? s.wins / s.bets : null,
        totalPnl: s.pnl,
        bets: s.bets
      }))
      .sort((a, b) => b.bets - a.bets);
  }, [categoryPerf, resolvedBets]);

  const anchoringRows = useMemo(
    () =>
      predictions
        .filter((p) => p.anchored_estimate != null)
        .sort((a, b) => toDateValue(b.predicted_at) - toDateValue(a.predicted_at)),
    [predictions]
  );

  const avgAnchoringDelta = useMemo(() => {
    if (anchoringRows.length === 0) return null;
    const values = anchoringRows.map((p) =>
      p.anchoring_delta != null
        ? Number(p.anchoring_delta)
        : Number(p.blind_estimate ?? 0) - Number(p.anchored_estimate ?? 0)
    );
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [anchoringRows]);

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <header className="mb-8 space-y-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{modelName}</h1>
          <p className="mt-1 text-sm text-slate-400">{latestModelVersion}</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {MODEL_LINKS.map((m) => (
            <a
              key={m.slug}
              href={`/model/${m.slug}`}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                m.slug === modelSlug
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
            >
              {m.name}
            </a>
          ))}
        </nav>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Equity curve
          </h2>
          <div className="flex gap-2 text-xs">
            {(["7d", "30d", "all-time"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setWindowKey(k)}
                className={`rounded-full px-3 py-1 ${
                  windowKey === k
                    ? "bg-emerald-500 text-slate-950"
                    : "border border-slate-700 text-slate-300"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <EquityChart history={history} windowKey={windowKey} />
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total cumulative P&L", value: fmtUsd(summary.totalPnl), pnl: summary.totalPnl },
          { label: "Win rate", value: summary.winRate == null ? "—" : `${Math.round(summary.winRate * 100)}%` },
          { label: "Total bets placed", value: `${summary.totalBetsPlaced}` },
          { label: "Total markets PASSed", value: `${summary.totalPass}` },
          { label: "Avg return (winning bet)", value: summary.avgWin == null ? "—" : `$${Math.round(summary.avgWin).toLocaleString()}` },
          { label: "Avg loss (losing bet)", value: summary.avgLoss == null ? "—" : `-$${Math.round(summary.avgLoss).toLocaleString()}` },
          { label: "Longest winning streak", value: `${summary.longestWin}` },
          { label: "Longest losing streak", value: `${summary.longestLoss}` }
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</p>
            <p
              className={`mt-1 text-lg font-semibold ${
                s.label === "Total cumulative P&L"
                  ? (s.pnl ?? 0) >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                  : "text-slate-100"
              }`}
            >
              {s.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Pending markets
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">No pending predictions yet.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => {
              const latest = latestPriceByMarketId[p.market_id];
              const nowPricePct =
                latest?.current_price != null ? Number(latest.current_price) * 100 : null;
              const crowdAtPredPct =
                p.crowd_price_at_time != null ? Number(p.crowd_price_at_time) * 100 : null;
              const delta =
                nowPricePct != null && crowdAtPredPct != null ? nowPricePct - crowdAtPredPct : null;
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <a href={`/market/${p.market_id}`} className="font-semibold text-slate-100 hover:text-emerald-300">
                      {p.markets?.title ?? "Untitled market"}
                    </a>
                    {p.markets?.market_url ? (
                      <a
                        href={p.markets.market_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Polymarket ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Estimate: {fmtPct(p.blind_estimate)}</span>
                    <span>Signal: {p.signal ?? "—"}</span>
                    <span>
                      Predicted:{" "}
                      {p.predicted_at ? new Date(p.predicted_at).toLocaleString() : "—"}
                    </span>
                    <span>
                      Current price: {nowPricePct == null ? "—" : `${Math.round(nowPricePct)}%`}
                    </span>
                    <span
                      className={
                        delta == null
                          ? ""
                          : delta >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      Move:{" "}
                      {delta == null
                        ? "—"
                        : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)} pts`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <h2 className="mr-3 self-center text-sm font-semibold uppercase tracking-wide text-slate-300">
            Resolved bets
          </h2>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={timeBucketFilter}
            onChange={(e) => setTimeBucketFilter(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="all">All time buckets</option>
            {timeBuckets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={signalFilter}
            onChange={(e) => setSignalFilter(e.target.value as SignalFilter)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="all">All signals</option>
            <option value="BET YES">BET YES</option>
            <option value="BET NO">BET NO</option>
          </select>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="all">All outcomes</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Incorrect</option>
          </select>
        </div>
        {resolvedFiltered.length === 0 ? (
          <p className="text-sm text-slate-500">No resolved bets yet.</p>
        ) : (
          <div className="space-y-2">
            {resolvedFiltered.map((p) => {
              const correct = isCorrect(p);
              return (
                <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <a href={`/market/${p.market_id}`} className="font-semibold text-slate-100 hover:text-emerald-300">
                      {p.markets?.title ?? "Untitled market"}
                    </a>
                    {p.markets?.market_url ? (
                      <a
                        href={p.markets.market_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Polymarket ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Estimate: {fmtPct(p.blind_estimate)}</span>
                    <span>Signal: {p.signal}</span>
                    <span className={correct ? "text-emerald-400" : "text-red-400"}>
                      {correct ? "✓ Correct" : "✗ Incorrect"}
                    </span>
                    <span className={Number(p.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
                      P&amp;L: {fmtUsd(Number(p.pnl ?? 0))}
                    </span>
                    <span>
                      Resolved:{" "}
                      {getResolvedDate(p)
                        ? new Date(getResolvedDate(p) as string).toLocaleDateString()
                        : "—"}
                    </span>
                    <span>Days held: {p.days_to_resolution ?? "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          PASS history
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          PASS rate: {passPredictions.length} PASSes out of {predictions.length} total predictions (
          {predictions.length > 0
            ? `${Math.round((passPredictions.length / predictions.length) * 100)}%`
            : "0%"}
          )
        </p>
        {passResolved.length === 0 ? (
          <p className="text-sm text-slate-500">No PASS predictions yet.</p>
        ) : (
          <div className="space-y-2">
            {passResolved.map((p) => {
              const est = Number(p.blind_estimate ?? 0);
              const outcomeBool = p.outcome;
              const directionalCorrect =
                outcomeBool == null
                  ? null
                  : (est > 50 && outcomeBool === true) || (est < 50 && outcomeBool === false);
              const brier =
                outcomeBool == null || p.blind_estimate == null
                  ? null
                  : Math.pow(est / 100 - (outcomeBool ? 1 : 0), 2);
              return (
                <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <a href={`/market/${p.market_id}`} className="font-semibold text-slate-100 hover:text-emerald-300">
                      {p.markets?.title ?? "Untitled market"}
                    </a>
                    {p.markets?.market_url ? (
                      <a
                        href={p.markets.market_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Polymarket ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Estimate: {fmtPct(p.blind_estimate)}</span>
                    <span>
                      Crowd at prediction:{" "}
                      {p.crowd_price_at_time == null
                        ? "—"
                        : `${Math.round(Number(p.crowd_price_at_time) * 100)}%`}
                    </span>
                    <span>
                      Resolved: {p.outcome == null ? "—" : p.outcome ? "YES" : "NO"}
                    </span>
                    <span
                      className={
                        directionalCorrect == null
                          ? ""
                          : directionalCorrect
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      Directional:{" "}
                      {directionalCorrect == null
                        ? "—"
                        : directionalCorrect
                        ? "Correct"
                        : "Incorrect"}
                    </span>
                    <span>Brier: {brier == null ? "—" : brier.toFixed(3)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
          Category breakdown
        </h2>
        {categoryRows.length === 0 ? (
          <p className="text-sm text-slate-500">No category data available.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {categoryRows.map((r) => (
              <div
                key={r.category}
                className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 md:grid-cols-4"
              >
                <span className="font-medium text-slate-100">{r.category}</span>
                <span className="text-slate-400">
                  Win rate: {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
                </span>
                <span className={r.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                  P&amp;L: {fmtUsd(r.totalPnl)}
                </span>
                <span className="text-slate-400">Bets: {r.bets}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-300">
          Anchoring delta panel
        </summary>
        <p className="mt-3 text-xs text-slate-400">
          Average anchoring delta:{" "}
          {avgAnchoringDelta == null ? "—" : `${avgAnchoringDelta.toFixed(2)} pts`}
        </p>
        {anchoringRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No anchoring data available.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {anchoringRows.map((p) => {
              const delta =
                p.anchoring_delta != null
                  ? Number(p.anchoring_delta)
                  : Number(p.blind_estimate ?? 0) - Number(p.anchored_estimate ?? 0);
              return (
                <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <a href={`/market/${p.market_id}`} className="font-semibold text-slate-100 hover:text-emerald-300">
                      {p.markets?.title ?? "Untitled market"}
                    </a>
                    {p.markets?.market_url ? (
                      <a
                        href={p.markets.market_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Polymarket ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>Blind: {fmtPct(p.blind_estimate)}</span>
                    <span>Anchored: {fmtPct(p.anchored_estimate)}</span>
                    <span className={delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                      Anchoring delta: {delta >= 0 ? "+" : ""}
                      {delta.toFixed(1)} pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </details>
    </main>
  );
}
