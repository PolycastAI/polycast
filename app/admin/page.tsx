import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { supabaseAdmin } from "@/lib/supabase/server";

// Always load fresh data so pending list updates after "Fetch shortlist"
export const dynamic = "force-dynamic";

async function getAdminData() {
  try {
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("markets")
      .select("id, polymarket_id, title, social_title, category, resolution_date, market_url, status, current_price, volume, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const { data: insufficientSignals, error: rejectedError } =
      await supabaseAdmin
        .from("rejected_markets")
        .select("id, market_id, rejected_at, resurface_at, rejection_reason")
        .eq("rejection_reason", "insufficient_signals")
        .order("rejected_at", { ascending: false })
        .limit(100);

    const { data: held, error: heldError } = await supabaseAdmin
      .from("held_markets")
      .select("*")
      .order("held_at", { ascending: false })
      .limit(100);

    return {
      pending: pendingError ? [] : (pending ?? []),
      insufficientSignals: rejectedError ? [] : (insufficientSignals ?? []),
      held: heldError ? [] : (held ?? [])
    };
  } catch {
    return { pending: [], insufficientSignals: [], held: [] };
  }
}

export default async function AdminPage() {
  const { pending, insufficientSignals, held } = await getAdminData();

  // Bing API usage wiring will come later; 0 for now.
  const bingMonthlyCalls = 0;

  return (
    <main className="min-h-screen px-6 py-10 md:px-12 lg:px-24">
      <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Polycast Admin
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Morning pipeline candidates land here for human approval before
            going live to Polycast and Bluesky.
          </p>
        </div>
      </header>
      <AdminDashboard
        pending={pending}
        insufficientSignals={insufficientSignals}
        held={held}
        bingMonthlyCalls={bingMonthlyCalls}
      />
    </main>
  );
}

