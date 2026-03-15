import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

interface Params {
  params: { id: string };
}

export async function POST(_req: Request, { params }: Params) {
  const marketId = params.id;

  try {
    const { error } = await supabaseAdmin
      .from("markets")
      .update({ status: "approved" })
      .eq("id", marketId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Approve market error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

