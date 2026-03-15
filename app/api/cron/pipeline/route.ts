import { NextResponse } from "next/server";
import { runShortlistAndNotifyOnly } from "@/lib/pipeline/blindAnchored";
import { requireCronAuth } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauth = requireCronAuth(request);
  if (unauth) return unauth;
  try {
    await runShortlistAndNotifyOnly();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Cron pipeline error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

