import { NextResponse } from "next/server";
import { runShortlistAndNotifyOnly } from "@/lib/pipeline/blindAnchored";
import { sendTelegramMessage } from "@/lib/notifications/telegram";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runShortlistAndNotifyOnly();
    return NextResponse.json({ ok: true, count: result?.count ?? 0 });
  } catch (error: unknown) {
    console.error("Admin fetch-shortlist error:", error);
    const msg =
      error instanceof Error
        ? error.message
        : typeof (error as any)?.message === "string"
          ? (error as any).message
          : typeof error === "object" && error !== null
            ? JSON.stringify(error).slice(0, 400)
            : String(error);
    try {
      await sendTelegramMessage(`Polycast fetch-shortlist error: ${msg.slice(0, 300)}`);
    } catch {
      // ignore if Telegram also fails
    }
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
