/* eslint-disable no-console */

const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE;
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;

interface BlueskySession {
  accessJwt: string;
  did: string;
}

async function createSession(): Promise<BlueskySession | null> {
  if (!BLUESKY_HANDLE || !BLUESKY_APP_PASSWORD) {
    console.warn("Bluesky env vars not set; skipping Bluesky posting");
    return null;
  }

  const res = await fetch(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: BLUESKY_HANDLE,
        password: BLUESKY_APP_PASSWORD
      })
    }
  );

  if (!res.ok) {
    console.error("Bluesky createSession failed:", res.status, res.statusText);
    return null;
  }

  const json = await res.json();
  return {
    accessJwt: json.accessJwt,
    did: json.did
  };
}

export interface PredictionSummaryForPost {
  model: "Claude" | "ChatGPT" | "Gemini" | "Grok";
  estimate: number;
  signal: "BET YES" | "BET NO" | "PASS";
}

export async function postPredictionToBluesky(args: {
  marketId: string;
  socialTitle: string;
  polymarketProbPercent: number;
  resolutionDate: string | null;
  predictions: PredictionSummaryForPost[];
}): Promise<string | null> {
  const session = await createSession();
  if (!session) return null;

  const { marketId, socialTitle, polymarketProbPercent, resolutionDate } = args;

  const datePart = resolutionDate
    ? new Date(resolutionDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      })
    : "TBD";

  const lines: string[] = [];
  lines.push(`🔮 ${socialTitle}`);
  lines.push(
    `Polymarket: ${Math.round(polymarketProbPercent)}% | Resolves ${datePart}`
  );

  const order = ["Claude", "ChatGPT", "Gemini", "Grok"] as const;
  for (const model of order) {
    const p = args.predictions.find((x) => x.model === model);
    if (!p) continue;
    lines.push(
      `${model}: ${Math.round(p.estimate)}% ${p.signal === "PASS" ? "PASS" : p.signal}`
    );
  }

  const link = `https://polycast.ai/market/${marketId}`;
  lines.push(link);

  const text = lines.join("\n");

  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString()
  };

  const res = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record
      })
    }
  );

  if (!res.ok) {
    console.error("Bluesky post failed:", res.status, res.statusText);
    return null;
  }

  const json = await res.json();
  const uri: string | undefined = json?.uri;
  return uri ?? null;
}

export interface ResolutionModelPnl {
  model: "Claude" | "ChatGPT" | "Gemini" | "Grok";
  pnl: number | null; // null = PASS
  cumulativePnl?: number;
}

export async function postResolutionToBluesky(args: {
  socialTitle: string;
  outcome: boolean; // true = YES
  modelPnls: ResolutionModelPnl[];
  marketUrl: string;
  includeCumulative?: boolean;
}): Promise<string | null> {
  const session = await createSession();
  if (!session) return null;

  const lines: string[] = [];
  lines.push(`✅ Resolved: ${args.outcome ? "YES" : "NO"}`);
  lines.push(`\"${args.socialTitle}\"`);
  const order: ("Claude" | "ChatGPT" | "Gemini" | "Grok")[] = [
    "Claude",
    "ChatGPT",
    "Gemini",
    "Grok"
  ];
  for (const model of order) {
    const row = args.modelPnls.find((x) => x.model === model);
    const pnlStr =
      row?.pnl == null
        ? "PASS"
        : `${row.pnl >= 0 ? "+" : ""}$${Math.round(row.pnl)}`;
    lines.push(`${model}: ${pnlStr}`);
  }
  if (args.includeCumulative) {
    const cum = order
      .map((m) => {
        const row = args.modelPnls.find((x) => x.model === m);
        const c = row?.cumulativePnl ?? 0;
        return `${m} ${c >= 0 ? "+" : ""}$${Math.round(c)}`;
      })
      .join(", ");
    lines.push(`Cumulative: ${cum}`);
  }
  lines.push(args.marketUrl);

  const record = {
    $type: "app.bsky.feed.post",
    text: lines.join("\n"),
    createdAt: new Date().toISOString()
  };

  const res = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record
      })
    }
  );
  if (!res.ok) {
    console.error("Bluesky resolution post failed:", res.status, res.statusText);
    return null;
  }
  const json = await res.json();
  return json?.uri ?? null;
}

export interface ReRunChange {
  model: "Claude" | "ChatGPT" | "Gemini" | "Grok";
  oldSignal: string;
  newEstimate: number;
  newSignal: string;
}

export async function postReRunUpdateToBluesky(args: {
  socialTitle: string;
  marketUrl: string;
  changes: ReRunChange[];
}): Promise<string | null> {
  const session = await createSession();
  if (!session) return null;

  const lines: string[] = [];
  lines.push("🔄 Update (re-run): " + args.socialTitle);
  for (const c of args.changes) {
    if (c.oldSignal === c.newSignal) continue;
    lines.push(
      `${c.model}: ${c.newEstimate}% ${c.newSignal} (was ${c.oldSignal})`
    );
  }
  if (lines.length <= 1) return null;
  lines.push(args.marketUrl);

  const record = {
    $type: "app.bsky.feed.post",
    text: lines.join("\n"),
    createdAt: new Date().toISOString()
  };

  const res = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record
      })
    }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json?.uri ?? null;
}

export interface LeaderboardRowForPost {
  model: string;
  totalPnl: number;
  winRate: number | null;
  brierScore: number | null;
}

export async function postWeeklyLeaderboardToBluesky(
  rows: LeaderboardRowForPost[]
): Promise<string | null> {
  const session = await createSession();
  if (!session) return null;

  const lines: string[] = [];
  lines.push("📊 Polycast weekly leaderboard (all-time)");
  for (const r of rows) {
    const pnlStr =
      r.totalPnl >= 0 ? `+$${Math.round(r.totalPnl)}` : `-$${Math.abs(Math.round(r.totalPnl))}`;
    const wrStr =
      r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—";
    const brierStr =
      r.brierScore != null ? r.brierScore.toFixed(3) : "—";
    lines.push(`${r.model}: ${pnlStr} | Win rate ${wrStr} | Brier ${brierStr}`);
  }
  lines.push("https://polycast.ai");

  const record = {
    $type: "app.bsky.feed.post",
    text: lines.join("\n"),
    createdAt: new Date().toISOString()
  };

  const res = await fetch(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessJwt}`
      },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record
      })
    }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json?.uri ?? null;
}

