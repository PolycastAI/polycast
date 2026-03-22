/**
 * Parse Gemini's response into a JSON array. Handles markdown fences, leading/trailing text,
 * and truncated or slightly malformed JSON (e.g. unterminated string at end).
 */
export function parseGeminiJsonArray(raw: string): unknown[] {
  let text = raw.replace(/```json?\s*/i, "").replace(/```\s*$/, "").trim();
  text = text.replace(/[\u0000-\u001F\u2028\u2029]/g, (m) =>
    m === "\n" || m === "\r" || m === "\t" ? m : " "
  );
  const firstBracket = text.indexOf("[");
  if (firstBracket === -1) return [];
  text = text.slice(firstBracket);
  const lastBracket = text.lastIndexOf("]");
  if (lastBracket !== -1) text = text.slice(0, lastBracket + 1);

  const tryParse = (str: string): unknown[] | null => {
    try {
      const out = JSON.parse(str);
      return Array.isArray(out) ? out : [];
    } catch {
      return null;
    }
  };

  let result = tryParse(text);
  if (result != null) return result;

  const noNewlines = text.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
  result = tryParse(noNewlines);
  if (result != null) return result;

  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}" && (text[i + 1] === "," || text[i + 1] === "]")) {
      const truncated = text.slice(0, i + 1) + "]";
      result = tryParse(truncated);
      if (result != null) return result;
    }
  }
  for (let i = text.length - 1; i > 0; i--) {
    if (text[i] === "}") {
      const truncated = text.slice(0, i + 1) + "]";
      result = tryParse(truncated);
      if (result != null) return result;
    }
  }

  console.warn("[geminiJson] Could not parse Gemini JSON; raw slice:", text.slice(0, 800));
  return [];
}
