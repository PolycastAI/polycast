import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Remove all queued Bluesky posts (pending only) from the audit table.
 */
export async function DELETE() {
  try {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .delete()
      .eq("platform", "bluesky")
      .eq("status", "pending")
      .select("id");

    if (error) throw error;

    const deleted = data?.length ?? 0;
    return NextResponse.json({ ok: true, deleted });
  } catch (error: unknown) {
    console.error("Delete all Bluesky pending posts error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
