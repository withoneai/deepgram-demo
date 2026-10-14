/**
 * Think models the app offers in its picker. All are Deepgram-managed, so no
 * extra provider key is needed. Times are from our own runs: a typed question
 * to the first spoken words, with a find and a run in between.
 * Deepgram's full list: https://developers.deepgram.com/docs/voice-agent-llm-models
 */
export type ThinkModel = { id: string; provider: "open_ai" | "anthropic" | "google"; label: string; note: string };

export const THINK_MODELS: ThinkModel[] = [
  { id: "gpt-5.5", provider: "open_ai", label: "GPT-5.5", note: "Smartest that still feels live, ~3.7s" },
  { id: "gpt-5.4-mini", provider: "open_ai", label: "GPT-5.4 mini", note: "Fastest, ~3.4s" },
  { id: "gemini-3.5-flash", provider: "google", label: "Gemini 3.5 Flash", note: "~6s" },
  { id: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6", note: "Most natural, ~6s" },
  { id: "claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", note: "Quick Claude" },
];

/** The requested model if it is on the list, else the env default, else GPT-5.5. */
export function resolveModel(requested?: string | null): ThinkModel {
  const envId = process.env.DEEPGRAM_THINK_MODEL;
  return (
    THINK_MODELS.find((m) => m.id === requested) ??
    THINK_MODELS.find((m) => m.id === envId) ??
    (envId ? { id: envId, provider: (process.env.DEEPGRAM_THINK_PROVIDER as ThinkModel["provider"]) || "open_ai", label: envId, note: "From .env.local" } : THINK_MODELS[0])
  );
}
