export interface PromptMarketContext {
  market_title: string;
  resolution_criteria: string;
  resolution_date: string;
  days_to_resolution: number | null;
  category: string | null;
  crowd_price_percent?: number;
  news_1?: string;
  news_2?: string;
  news_3?: string;
}

export const PROMPT_VERSION = 1;

export const PROMPT_V1_TEXT = `
You are a prediction market forecaster. Your job is to estimate the probability that a specific event will resolve YES on Polymarket.

You have no access to real-time data. Reason from what you know. Be direct. Do not hedge excessively.

---

MARKET
Title: {{market_title}}
Resolution criteria: {{resolution_criteria}}
Resolves: {{resolution_date}} ({{days_to_resolution}} days from today)
Category: {{category}}
Current Polymarket crowd price: {{crowd_price_percent}}%

RECENT NEWS
{{news_1}}
{{news_2}}
{{news_3}}

---

Work through the following steps in order. Your total response for Steps 1–7 must not exceed 400 words. Be concise. Every step should be 1–3 sentences. The JSON block does not count toward this limit.

Step 1 — Base rate
What is the historical base rate for this type of event? Anchor your thinking here before considering specifics.

Step 2 — Current evidence
What do you know about the current state of affairs relevant to this market? What has happened recently that is material?

Step 3 — Resolution criteria check
Read the resolution criteria carefully. Are there any ambiguities, edge cases, or ways this could resolve unexpectedly? Flag them explicitly.

Step 4 — Bull case
What is the strongest argument for YES? What would have to be true for this to resolve YES?

Step 5 — Bear case
What is the strongest argument for NO? What would have to be true for this to resolve NO?

Step 6 — Synthesis
Weigh the evidence. Where do you land and why? Be direct. Commit to a single number — do not give a range.

Step 7 — Key uncertainty
Name the single most important piece of missing information that, if you had it, would move your estimate by 20 or more percentage points in either direction.

---

Now output your final answer as a JSON block. Your estimate must be a single integer — not a range. If you are uncertain, pick the midpoint and commit to it. No markdown fences. No preamble. Just the JSON.

{
  "estimate": [integer 0-100],
  "signal": ["BET YES" | "BET NO" | "PASS"],
  "edge": [integer, your estimate minus crowd price],
  "key_uncertainty": "[one sentence]"
}

Note: signal and edge are calculated externally and will be overwritten by the pipeline. Include your best guess but do not anchor your prose reasoning on these values.
`.trim();

export function renderPromptV1(ctx: PromptMarketContext): string {
  const days =
    ctx.days_to_resolution === null ? "unknown" : String(ctx.days_to_resolution);

  return PROMPT_V1_TEXT.replace("{{market_title}}", ctx.market_title)
    .replace("{{resolution_criteria}}", ctx.resolution_criteria)
    .replace("{{resolution_date}}", ctx.resolution_date)
    .replace("{{days_to_resolution}}", days)
    .replace("{{category}}", ctx.category ?? "Uncategorized")
    .replace(
      "{{crowd_price_percent}}",
      ctx.crowd_price_percent !== undefined
        ? String(ctx.crowd_price_percent)
        : "hidden"
    )
    .replace("{{news_1}}", ctx.news_1 ?? "")
    .replace("{{news_2}}", ctx.news_2 ?? "")
    .replace("{{news_3}}", ctx.news_3 ?? "");
}

