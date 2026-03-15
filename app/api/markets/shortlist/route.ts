import { NextResponse } from "next/server";
import { buildGeminiShortlist } from "@/lib/polymarket/geminiShortlist";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: predictionRows, error } = await supabaseAdmin
      .from("predictions")
      .select("market_id, markets!inner(polymarket_id)");

    if (error) console.error("Error fetching existing predictions:", error);

    const existingPolymarketIds =
      predictionRows
        ?.map((row: any) => row.markets?.polymarket_id)
        .filter(Boolean) ?? [];

    const now = new Date().toISOString();
    const { data: rejected } = await supabaseAdmin
      .from("rejected_markets")
      .select("market_id")
      .or(`resurface_at.is.null,resurface_at.gte.${now}`);
    const { data: held } = await supabaseAdmin.from("held_markets").select("market_id");
    const excludedIds = new Set<string>();
    for (const r of rejected ?? []) excludedIds.add((r as any).market_id);
    for (const h of held ?? []) excludedIds.add((h as any).market_id);

    const shortlist = await buildGeminiShortlist(
      existingPolymarketIds,
      [...excludedIds]
    );

    return NextResponse.json(shortlist, { status: 200 });
  } catch (err: any) {
    console.error("Shortlist error:", err);
    return NextResponse.json(
      { error: "Failed to build shortlist" },
      { status: 500 }
    );
  }
}

