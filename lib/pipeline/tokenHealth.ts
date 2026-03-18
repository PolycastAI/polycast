/**
 * Lightweight token/API health check before pipeline runs.
 * Verifies required env vars are set; does not call paid APIs.
 */
export interface TokenHealthResult {
  ok: boolean;
  missing: string[];
  message: string;
}

export function tokenHealthCheck(): TokenHealthResult {
  // If we run in mock-odds mode, we should not require paid API keys.
  // (Odds generation functions will short-circuit to deterministic mocks.)
  const mockOdds = process.env.POLYCAST_MOCK_ODDS !== "false";
  if (mockOdds) {
    return {
      ok: true,
      missing: [],
      message: "Mock odds enabled; skipping paid token checks."
    };
  }

  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_AI_API_KEY",
    "XAI_API_KEY"
  ] as const;
  const missing = required.filter((k) => {
    const v = process.env[k];
    return !v || String(v).trim() === "";
  });
  const ok = missing.length === 0;
  return {
    ok,
    missing: [...missing],
    message: ok
      ? "All required API keys present."
      : `Missing: ${missing.join(", ")}. Pipeline will not run.`
  };
}
