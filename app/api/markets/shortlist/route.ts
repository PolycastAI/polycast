import { NextResponse } from "next/server";
import { buildGeminiShortlist } from "@/lib/polymarket/geminiShortlist";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getExcludedPolymarketIds } from "@/lib/pipeline/blindAnchored";

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

    const excludedIds = await getExcludedPolymarketIds();

    const shortlist = await buildGeminiShortlist(
      existingPolymarketIds,
      excludedIds
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

