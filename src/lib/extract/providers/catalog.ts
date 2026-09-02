/**
 * The extraction-model catalog — the SINGLE source of truth for which models the
 * app offers, their labels, and their pricing. PURE (no SDK imports), so the UI
 * dropdown, the cost calc and the worker can all read it.
 *
 * A project stores a model KEY (below); the worker resolves it to a provider +
 * adapter at extraction time. Default = Anthropic Opus 4.8 (unchanged behaviour).
 */

export type Provider = "anthropic" | "gemini" | "openai";

export interface ModelInfo {
  /** Stable key stored on Project.extractionModel. */
  key: string;
  provider: Provider;
  /** Default API model id (each adapter also honours an env override). */
  apiModelId: string;
  /** Shown in the new-project dropdown. */
  label: string;
  /** ⚠️ APPROXIMATE pricing per 1M tokens (telemetry only, not billing) — update
   *  from the provider's live pricing page. */
  priceInPerMtok: number;
  priceOutPerMtok: number;
}

export const DEFAULT_MODEL_KEY = "anthropic-opus-4-8";

export const EXTRACTION_MODELS: ModelInfo[] = [
  {
    key: "anthropic-opus-4-8",
    provider: "anthropic",
    apiModelId: "claude-opus-4-8",
    label: "Anthropic · Claude Opus 4.8",
    priceInPerMtok: 15,
    priceOutPerMtok: 75,
  },
  {
    key: "gemini-3-1-pro",
    provider: "gemini",
    apiModelId: "gemini-3.1-pro-preview",
    label: "Google · Gemini 3.1 Pro",
    // ⚠️ approximate — confirm on ai.google.dev pricing.
    priceInPerMtok: 2,
    priceOutPerMtok: 12,
  },
  {
    key: "openai-gpt-5-6",
    provider: "openai",
    apiModelId: "gpt-5.6",
    label: "OpenAI · GPT-5.6",
    // ⚠️ approximate — confirm on openai.com pricing.
    priceInPerMtok: 1.25,
    priceOutPerMtok: 10,
  },
];

const BY_KEY = new Map(EXTRACTION_MODELS.map((m) => [m.key, m]));

export function isValidModelKey(key: string | null | undefined): boolean {
  return !!key && BY_KEY.has(key);
}

/** Resolve a stored key to a model; unknown/empty → the default (Anthropic). */
export function resolveModel(key: string | null | undefined): ModelInfo {
  return (key && BY_KEY.get(key)) || BY_KEY.get(DEFAULT_MODEL_KEY)!;
}
