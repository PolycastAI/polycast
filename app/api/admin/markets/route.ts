import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("markets")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (pendingError) {
      throw pendingError;
    }

    const { data: insufficientSignals, error: rejectedError } =
      await supabaseAdmin
        .from("rejected_markets")
        .select("id, market_id, rejected_at, resurface_at, rejection_reason")
        .eq("rejection_reason", "insufficient_signals")
        .order("rejected_at", { ascending: false })
        .limit(100);

    if (rejectedError) {
      throw rejectedError;
    }

    const { data: held, error: heldError } = await supabaseAdmin
      .from("held_markets")
      .select("*")
      .order("held_at", { ascending: false })
      .limit(100);

    if (heldError) {
      throw heldError;
    }

    return NextResponse.json(
      {
        pending: pending ?? [],
        insufficientSignals: insufficientSignals ?? [],
        held: held ?? []
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Admin markets GET error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

