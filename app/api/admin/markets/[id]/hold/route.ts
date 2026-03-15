import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface Params {
  params: { id: string };
}

export async function POST(_req: Request, { params }: Params) {
  const marketId = params.id;

  try {
    // Fetch polymarket_id for held_markets
    const { data: market, error: fetchError } = await supabaseAdmin
      .from("markets")
      .select("polymarket_id")
      .eq("id", marketId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    await supabaseAdmin.from("held_markets").insert({
      market_id: market?.polymarket_id ?? marketId
    });

    const { error: updateError } = await supabaseAdmin
      .from("markets")
      .update({ status: "held" })
      .eq("id", marketId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Hold market error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

