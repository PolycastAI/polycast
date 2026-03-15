import { NextResponse } from "next/server";
import { runReRunJob } from "@/lib/pipeline/reRunJob";
import { requireCronAuth } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;
  try {
    await runReRunJob();
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Cron re-run error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
