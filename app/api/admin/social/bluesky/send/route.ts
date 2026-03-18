import { NextResponse } from "next/server";
import { sendAllQueuedBlueskyPosts } from "@/lib/social/bluesky";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const count = await sendAllQueuedBlueskyPosts();
    return NextResponse.json({ ok: true, count });
  } catch (error: unknown) {
    console.error("Send all Bluesky queued posts error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

