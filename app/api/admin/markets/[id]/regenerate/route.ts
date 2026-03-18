import { NextResponse } from "next/server";
import { runPromptsForMarketId } from "@/lib/pipeline/blindAnchored";

interface Params {
  params: { id: string };
}

export const dynamic = "force-dynamic";

// Regenerate AI odds snapshot for a single approved market.
// This appends new rows to `predictions` (we display the latest in the admin snapshot).
export async function POST(_req: Request, { params }: Params) {
  const marketId = params.id;
  try {
    await runPromptsForMarketId(marketId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Regenerate market error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

