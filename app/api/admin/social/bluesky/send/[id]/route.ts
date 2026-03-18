import { NextResponse } from "next/server";
import { sendQueuedBlueskyPostById } from "@/lib/social/bluesky";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const uri = await sendQueuedBlueskyPostById(params.id);
    return NextResponse.json({ ok: true, uri });
  } catch (error: unknown) {
    console.error("Send Bluesky queued post error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

