import { parseForecastJson, ParsedForecastJson } from "./lenientJson";

export type ModelName = "Claude" | "ChatGPT" | "Gemini" | "Grok";

export interface ModelCallResult extends ParsedForecastJson {
  rawText: string;
  inputTokens?: number;
  outputTokens?: number;
  responseTimeMs?: number;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAnthropic(prompt: string): Promise<ModelCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await res.json();
  const responseTimeMs = Date.now() - start;

  if (!res.ok) {
    throw new Error(
      `Anthropic error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  const contentText =
    json?.content?.map((c: any) => c.text).join("\n\n") ?? "";

  const parsed = parseForecastJson(contentText);
  if (!parsed) {
    throw new Error("Failed to parse Anthropic forecast JSON");
  }

  return {
    ...parsed,
    rawText: contentText,
    inputTokens: json?.usage?.input_tokens,
    outputTokens: json?.usage?.output_tokens,
    responseTimeMs
  };
}

async function callOpenAI(prompt: string): Promise<ModelCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const start = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await res.json();
  const responseTimeMs = Date.now() - start;

  if (!res.ok) {
    throw new Error(
      `OpenAI error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  const contentText = json?.choices?.[0]?.message?.content ?? "";
  const parsed = parseForecastJson(contentText);
  if (!parsed) {
    throw new Error("Failed to parse OpenAI forecast JSON");
  }

  return {
    ...parsed,
    rawText: contentText,
    inputTokens: json?.usage?.prompt_tokens,
    outputTokens: json?.usage?.completion_tokens,
    responseTimeMs
  };
}

async function callGemini(prompt: string): Promise<ModelCallResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is not set");
  }

  const start = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const json = await res.json();
  const responseTimeMs = Date.now() - start;

  if (!res.ok) {
    throw new Error(
      `Gemini error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  const contentText =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n\n") ??
    "";
  const parsed = parseForecastJson(contentText);
  if (!parsed) {
    throw new Error("Failed to parse Gemini forecast JSON");
  }

  return {
    ...parsed,
    rawText: contentText,
    inputTokens: json?.usageMetadata?.promptTokenCount,
    outputTokens: json?.usageMetadata?.candidatesTokenCount,
    responseTimeMs
  };
}

async function callGrok(prompt: string): Promise<ModelCallResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not set");
  }

  const start = Date.now();
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await res.json();
  const responseTimeMs = Date.now() - start;

  if (!res.ok) {
    throw new Error(
      `xAI error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  const contentText = json?.choices?.[0]?.message?.content ?? "";
  const parsed = parseForecastJson(contentText);
  if (!parsed) {
    throw new Error("Failed to parse Grok forecast JSON");
  }

  return {
    ...parsed,
    rawText: contentText,
    inputTokens: json?.usage?.prompt_tokens,
    outputTokens: json?.usage?.completion_tokens,
    responseTimeMs
  };
}

export async function callModelWithRetry(
  model: ModelName,
  prompt: string
): Promise<ModelCallResult> {
  const maxAttempts = 2;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      switch (model) {
        case "Claude":
          return await callAnthropic(prompt);
        case "ChatGPT":
          return await callOpenAI(prompt);
        case "Gemini":
          return await callGemini(prompt);
        case "Grok":
          return await callGrok(prompt);
      }
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;
      if (status === 429 && attempt < maxAttempts) {
        const backoffMs = 60000 * attempt;
        await sleep(backoffMs);
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unknown error calling model");
}

