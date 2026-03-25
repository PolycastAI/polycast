import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

/**
 * Remove a queued Bluesky post from the audit table (pending only).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const id = params.id;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .delete()
      .eq("id", id)
      .eq("platform", "bluesky")
      .eq("status", "pending")
      .select("id");

    if (error) throw error;

    if (!data?.length) {
      return NextResponse.json(
        { ok: false, error: "Post not found or not a pending Bluesky row" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Delete Bluesky pending post error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
