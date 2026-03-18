/* eslint-disable no-console */

import { supabaseAdmin } from "@/lib/supabase/server";

const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE;
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;

async function createSocialPostLog(args: {
  platform: string;
  postType: string;
  marketId: string | null;
  postText: string;
  status?: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .insert({
      platform: args.platform,
      post_type: args.postType,
      market_id: args.marketId,
      post_text: args.postText,
      status: args.status ?? "pending",
      platform_post_id: null,
      error_message: null
    })
    .select("id")
    .single();

  if (error) {
    // Fail loudly so we can see immediately in logs when social posting is misconfigured.
    throw new Error(`social_posts insert failed: ${error.message}`);
  }

  return data?.id ?? null;
}

async function updateSocialPostLog(
  logId: string | null,
  updates: {
    status: string;
    platformPostId?: string | null;
    errorMessage?: string | null;
    postedAt?: string | null;
  }
) {
  if (!logId) return;
  try {
    await supabaseAdmin
      .from("social_posts")
      .update({
        status: updates.status,
        platform_post_id: updates.platformPostId ?? null,
        error_message: updates.errorMessage ?? null,
        posted_at: updates.postedAt
      })
      .eq("id", logId);
  } catch (err) {
    console.error("social_posts update threw:", err);
  }
}

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

  await createSocialPostLog({
    platform: "bluesky",
    postType: "prediction",
    marketId,
    postText: text,
    status: "pending"
  });

  // Queue only. Admin will later send the pending post and update `social_posts`.
  return null;
}

export interface ResolutionModelPnl {
  model: "Claude" | "ChatGPT" | "Gemini" | "Grok";
  pnl: number | null; // null = PASS
  cumulativePnl?: number;
}

export async function postResolutionToBluesky(args: {
  marketId: string;
  socialTitle: string;
  outcome: boolean; // true = YES
  modelPnls: ResolutionModelPnl[];
  marketUrl: string;
  includeCumulative?: boolean;
}): Promise<string | null> {
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

  await createSocialPostLog({
    platform: "bluesky",
    postType: "resolution",
    marketId: args.marketId,
    postText: record.text,
    status: "pending"
  });

  // Queue only. Admin will later send the pending post.
  return null;
}

export interface ReRunChange {
  model: "Claude" | "ChatGPT" | "Gemini" | "Grok";
  oldSignal: string;
  newEstimate: number;
  newSignal: string;
}

export async function postReRunUpdateToBluesky(args: {
  marketId: string;
  socialTitle: string;
  marketUrl: string;
  changes: ReRunChange[];
}): Promise<string | null> {
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

  await createSocialPostLog({
    platform: "bluesky",
    postType: "re_run_update",
    marketId: args.marketId,
    postText: record.text,
    status: "pending"
  });

  // Queue only. Admin will later send the pending post.
  return null;
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

  await createSocialPostLog({
    platform: "bluesky",
    postType: "weekly_leaderboard",
    marketId: null,
    postText: record.text,
    status: "pending"
  });

  // Queue only. Admin will later send the pending post.
  return null;
}

async function sendTextToBluesky(text: string): Promise<string> {
  const session = await createSession();
  if (!session) {
    throw new Error("Bluesky env vars not set; cannot send queued post");
  }

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
    throw new Error(`Bluesky post failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const uri: string | undefined = json?.uri;
  if (!uri) throw new Error("Bluesky post succeeded but no uri returned");
  return uri;
}

export async function sendQueuedBlueskyPostById(
  socialPostId: string
): Promise<string | null> {
  const { data: row, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, post_text, market_id")
    .eq("id", socialPostId)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  if (row.id !== socialPostId) return null;
  // Only send pending posts.
  if (row.status && row.status !== "pending") return null;

  try {
    const uri = await sendTextToBluesky(row.post_text);

    await updateSocialPostLog(socialPostId, {
      status: "posted",
      platformPostId: uri,
      errorMessage: null,
      postedAt: new Date().toISOString()
    });

    if (row.market_id) {
      await supabaseAdmin
        .from("markets")
        .update({ post_id_bluesky: uri })
        .eq("id", row.market_id);
    }

    return uri;
  } catch (err) {
    await updateSocialPostLog(socialPostId, {
      status: "failed",
      errorMessage:
        err instanceof Error ? err.message : "Unknown error sending Bluesky post",
      postedAt: null
    });
    return null;
  }
}

export async function sendAllQueuedBlueskyPosts(): Promise<number> {
  const { data: rows, error } = await supabaseAdmin
    .from("social_posts")
    .select("id")
    .eq("platform", "bluesky")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw error;
  if (!rows?.length) return 0;

  let successCount = 0;
  for (const r of rows) {
    const uri = await sendQueuedBlueskyPostById(r.id);
    if (uri) successCount += 1;
  }
  return successCount;
}

