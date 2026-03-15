import { NextResponse } from "next/server";
import { runPromptsForApprovedMarkets } from "@/lib/pipeline/blindAnchored";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await runPromptsForApprovedMarkets();
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Admin run-approved error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
