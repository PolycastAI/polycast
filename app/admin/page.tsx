import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getTimeBucket } from "@/lib/markets/timeBuckets";

export const dynamic = "force-dynamic";

async function getAdminData() {
  try {
    const { data: pendingRows, error: pendingError } = await supabaseAdmin
      .from("markets")
      .select("id, polymarket_id, title, social_title, category, resolution_date, market_url, status, current_price, volume, resolution_criteria, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const now = new Date();
    const pending = (pendingError ? [] : (pendingRows ?? [])).map((row: any) => {
      const resolutionDate = row.resolution_date ? new Date(row.resolution_date) : null;
      const { daysToResolution, timeBucket } = getTimeBucket(now, resolutionDate);
      return {
        ...row,
        days_to_resolution: daysToResolution,
        time_bucket: timeBucket
      };
    });

    return {
      pending,
      held: []
    };
  } catch {
    return { pending: [], held: [] };
  }
}

export default async function AdminPage() {
  const { pending, held } = await getAdminData();

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
      <AdminDashboard pending={pending} held={held} />
    </main>
  );
}

