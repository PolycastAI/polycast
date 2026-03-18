import { unstable_noStore } from "next/cache";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getTimeBucket } from "@/lib/markets/timeBuckets";
import { fetchMarketById } from "@/lib/polymarket/gamma";

export const dynamic = "force-dynamic";

async function getAdminData() {
  unstable_noStore();
  try {
    const [{ data: pendingRows, error: pendingError }, { count: pendingCount }] = await Promise.all([
      supabaseAdmin
        .from("markets")
        .select("id, polymarket_id, title, social_title, category, resolution_date, market_url, status, current_price, volume, resolution_criteria, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("markets")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
    ]);

    const { data: approvedRows, error: approvedError } = await supabaseAdmin
      .from("markets")
      .select(
        "id, polymarket_id, title, social_title, category, resolution_date, market_url, status, current_price, volume, resolution_criteria, created_at"
      )
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    const now = new Date();
    const pending: any[] = [];
    const maxCriteriaLength = 400;
    for (const row of pendingError ? [] : (pendingRows ?? [])) {
      try {
        const resolutionDate = row.resolution_date ? new Date(row.resolution_date) : null;
        const { daysToResolution, timeBucket } = getTimeBucket(now, resolutionDate);
        const criteria = row.resolution_criteria ?? "";
        const resolution_criteria =
          criteria.length > maxCriteriaLength
            ? criteria.slice(0, maxCriteriaLength) + "…"
            : criteria;
        pending.push({
          ...row,
          resolution_criteria,
          days_to_resolution: daysToResolution,
          time_bucket: timeBucket
        });
      } catch (rowErr) {
        console.error("Admin getAdminData: row failed", row?.id, rowErr);
        pending.push({
          ...row,
          resolution_criteria: (row.resolution_criteria ?? "").slice(0, maxCriteriaLength),
          days_to_resolution: null,
          time_bucket: "extended"
        });
      }
    }

    const approved: any[] = [];
    if (!approvedError && (approvedRows?.length ?? 0) > 0) {
      const approvedIds = approvedRows!.map((r: any) => r.id);
      const { data: predictionRows } = await supabaseAdmin
        .from("predictions")
        .select(
          "market_id, model, blind_estimate, anchored_estimate, signal, edge, predicted_at"
        )
        .in("market_id", approvedIds);

      const modelOrder = ["Claude", "ChatGPT", "Gemini", "Grok"];
      const oddsByMarketId = new Map<string, Record<string, any>>();

      for (const mid of approvedIds) {
        oddsByMarketId.set(mid, {});
      }

      const sortedPreds = (predictionRows ?? []).slice().sort((a: any, b: any) => {
        const at = a?.predicted_at ? new Date(a.predicted_at).getTime() : 0;
        const bt = b?.predicted_at ? new Date(b.predicted_at).getTime() : 0;
        return bt - at;
      });

      for (const p of sortedPreds) {
        const mid = p?.market_id;
        const model = p?.model;
        if (!mid || !model) continue;
        const existing = oddsByMarketId.get(mid);
        if (!existing) continue;
        if (existing[model]) continue; // keep latest per model
        if (!modelOrder.includes(model)) continue;

        existing[model] = {
          blind_estimate: p?.blind_estimate ?? null,
          anchored_estimate: p?.anchored_estimate ?? null,
          signal: p?.signal ?? null,
          edge: p?.edge ?? null,
          predicted_at: p?.predicted_at ?? null
        };
      }

      for (const row of approvedRows ?? []) {
        try {
          const resolutionDate = row.resolution_date ? new Date(row.resolution_date) : null;
          const { daysToResolution, timeBucket } = getTimeBucket(now, resolutionDate);
          const criteria = row.resolution_criteria ?? "";
          const resolution_criteria =
            criteria.length > maxCriteriaLength
              ? criteria.slice(0, maxCriteriaLength) + "…"
              : criteria;

          approved.push({
            ...row,
            resolution_criteria,
            days_to_resolution: daysToResolution,
            time_bucket: timeBucket,
            ai_odds_by_model: oddsByMarketId.get(row.id) ?? {}
          });
        } catch (rowErr) {
          console.error("Admin getAdminData: approved row failed", row?.id, rowErr);
          approved.push({
            ...row,
            resolution_criteria: (row.resolution_criteria ?? "").slice(0, maxCriteriaLength),
            days_to_resolution: null,
            time_bucket: "extended",
            ai_odds_by_model: oddsByMarketId.get(row.id) ?? {}
          });
        }
      }
    }

    // Ensure "View on Polymarket" URLs are real/active:
    // If DB contains the old broken fallback (`/market/{id}`), replace with event-slug URL.
    const maybeFixMarketUrl = async (m: any) => {
      const pmId = m?.polymarket_id;
      const existing = m?.market_url as string | null;
      const needsFix =
        !existing ||
        (typeof existing === "string" && existing.includes("polymarket.com/market/"));
      if (!pmId || !needsFix) return;

      const gamma = await fetchMarketById(pmId);
      const slug = (gamma as any)?.slug ?? null;
      m.market_url = slug ? `https://polymarket.com/event/${slug}` : null;
    };

    await Promise.all([...pending, ...approved].map(maybeFixMarketUrl));

    return {
      pending,
      pendingCount: pendingCount ?? pending.length,
      held: [],
      approved
    };
  } catch (e) {
    console.error("Admin getAdminData error:", e);
    return { pending: [], pendingCount: 0, held: [], approved: [] };
  }
}

export default async function AdminPage() {
  const { pending, pendingCount, held, approved } = await getAdminData();

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Polycast Admin
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Run the pipeline to fetch markets, then approve, hold, or reject each.
          </p>
        </div>
      </header>
      <AdminDashboard
        pending={pending}
        pendingCount={pendingCount}
        held={held}
        approved={approved}
      />
    </main>
  );
}

