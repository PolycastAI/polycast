export interface ParsedForecastJson {
  estimate: number;
  signal?: string;
  edge?: number;
  key_uncertainty?: string;
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

export function parseForecastJson(raw: string): ParsedForecastJson | null {
  const text = stripMarkdownFences(raw);

  // Try a direct parse first
  try {
    const obj = JSON.parse(text);
    if (typeof obj.estimate === "number") {
      return obj as ParsedForecastJson;
    }
  } catch {
    // fall through
  }

  // Fallback: find the first {...} block and try that.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);
  try {
    const obj = JSON.parse(candidate);
    if (typeof obj.estimate === "number") {
      return obj as ParsedForecastJson;
    }
  } catch {
    return null;
  }
  return null;
}

