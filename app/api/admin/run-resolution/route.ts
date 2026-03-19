import { NextResponse } from "next/server";
import { runResolutionChecker } from "@/lib/pipeline/resolutionChecker";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await runResolutionChecker();
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Admin run-resolution error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

