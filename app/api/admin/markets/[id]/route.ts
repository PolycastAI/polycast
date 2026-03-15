import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface Params {
  params: { id: string };
}

export async function PATCH(req: Request, { params }: Params) {
  const marketId = params.id;
  try {
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (typeof body.social_title === "string") {
      updates.social_title = body.social_title.trim() || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true });
    }
    const { error } = await supabaseAdmin
      .from("markets")
      .update(updates)
      .eq("id", marketId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Admin market PATCH error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
