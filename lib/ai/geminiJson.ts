/**
 * Parse Gemini's response into a JSON array. Handles markdown fences, leading/trailing text,
 * and truncated or slightly malformed JSON (e.g. unterminated string at end).
 */

function preprocessGeminiJsonRaw(raw: string): { text: string; hadArrayStart: boolean } {
  let text = raw.replace(/```json?\s*/i, "").replace(/```\s*$/, "").trim();
  text = text.replace(/[\u0000-\u001F\u2028\u2029]/g, (m) =>
    m === "\n" || m === "\r" || m === "\t" ? m : " "
  );
  const firstBracket = text.indexOf("[");
  if (firstBracket === -1) return { text: "", hadArrayStart: false };
  text = text.slice(firstBracket);
  const lastBracket = text.lastIndexOf("]");
  if (lastBracket !== -1) text = text.slice(0, lastBracket + 1);
  return { text, hadArrayStart: true };
}

function tryParseWithError(str: string): { ok: true; arr: unknown[] } | { ok: false; err: string } {
  try {
    const out = JSON.parse(str);
    if (Array.isArray(out)) return { ok: true, arr: out };
    return { ok: false, err: "JSON.parse succeeded but root value is not an array" };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

export interface ParseGeminiJsonArrayDetailedResult {
  items: unknown[];
  /** Set when no array could be parsed or root was not an array. */
  parseError: string | null;
}

/**
 * Same behavior as {@link parseGeminiJsonArray} but exposes the last JSON.parse error when parsing fails.
 */
export function parseGeminiJsonArrayDetailed(raw: string): ParseGeminiJsonArrayDetailedResult {
  const { text, hadArrayStart } = preprocessGeminiJsonRaw(raw);
  if (!hadArrayStart) {
    return { items: [], parseError: "No '[' found in model response (no JSON array to parse)" };
  }

  let lastErr: string | null = null;

  const attempt = (str: string): unknown[] | null => {
    const r = tryParseWithError(str);
    if (r.ok) return r.arr;
    lastErr = r.ok === false ? r.err : lastErr;
    return null;
  };

  let result = attempt(text);
  if (result != null) return { items: result, parseError: null };

  const noNewlines = text.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
  result = attempt(noNewlines);
  if (result != null) return { items: result, parseError: null };

  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}" && (text[i + 1] === "," || text[i + 1] === "]")) {
      const truncated = text.slice(0, i + 1) + "]";
      result = attempt(truncated);
      if (result != null) return { items: result, parseError: null };
    }
  }
  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}") {
      const truncated = text.slice(0, i + 1) + "]";
      result = attempt(truncated);
      if (result != null) return { items: result, parseError: null };
    }
  }

  console.warn("[geminiJson] Could not parse Gemini JSON; raw slice:", text.slice(0, 800));
  return {
    items: [],
    parseError: lastErr ?? "Could not parse JSON array after all recovery strategies"
  };
}

export function parseGeminiJsonArray(raw: string): unknown[] {
  return parseGeminiJsonArrayDetailed(raw).items;
}
