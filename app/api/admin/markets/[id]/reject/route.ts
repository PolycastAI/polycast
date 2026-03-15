import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface Params {
  params: { id: string };
}

export async function POST(req: Request, { params }: Params) {
  const marketId = params.id;

  try {
    const body = await req.json().catch(() => ({}));
    const reason = body?.reason ?? "rejected_by_admin";

    // Fetch polymarket_id for logging in rejected_markets
    const { data: market, error: fetchError } = await supabaseAdmin
      .from("markets")
      .select("polymarket_id")
      .eq("id", marketId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const resurfaceAt = new Date(Date.now() + sevenDaysMs).toISOString();

    await supabaseAdmin.from("rejected_markets").insert({
      market_id: market?.polymarket_id ?? marketId,
      resurface_at: resurfaceAt,
      rejection_reason: reason
    });

    const { error: updateError } = await supabaseAdmin
      .from("markets")
      .update({ status: "rejected" })
      .eq("id", marketId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Reject market error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

