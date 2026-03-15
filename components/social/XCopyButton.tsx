"use client";

import { useState } from "react";

interface XCopyButtonProps {
  socialTitle: string;
  polymarketProbPercent: number;
  resolutionDate: string | null;
  claude: { estimate: number; signal: string | null } | null;
  chatgpt: { estimate: number; signal: string | null } | null;
  gemini: { estimate: number; signal: string | null } | null;
  grok: { estimate: number; signal: string | null } | null;
  marketUrl: string;
}

export function XCopyButton({
  socialTitle,
  polymarketProbPercent,
  resolutionDate,
  claude,
  chatgpt,
  gemini,
  grok,
  marketUrl
}: XCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function formatLine(
    label: string,
    model: { estimate: number; signal: string | null } | null
  ) {
    if (!model) return `${label}: —`;
    const sig = model.signal ?? "PASS";
    return `${label}: ${Math.round(model.estimate)}% ${sig}`;
  }

  async function handleCopy() {
    const datePart = resolutionDate
      ? new Date(resolutionDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        })
      : "TBD";

    const lines = [
      `🔮 ${socialTitle}`,
      `Polymarket: ${Math.round(polymarketProbPercent)}% | Resolves ${datePart}`,
      formatLine("Claude", claude),
      formatLine("ChatGPT", chatgpt),
      formatLine("Gemini", gemini),
      formatLine("Grok", grok),
      marketUrl
    ];

    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center rounded-full border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-emerald-400/80"
    >
      {copied ? "Copied for X" : "Copy for X"}
    </button>
  );
}

