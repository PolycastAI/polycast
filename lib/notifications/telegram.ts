/* eslint-disable no-console */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegramMessage(
  text: string
): Promise<{ ok: boolean }> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram env vars not set; skipping Telegram notification");
    return { ok: false };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown"
        })
      }
    );

    if (!res.ok) {
      console.error("Telegram send failed:", res.status, res.statusText);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("Telegram send error:", err);
    return { ok: false };
  }
}

