/**
 * The extraction dispatcher — routes a request to the right provider adapter by
 * the project's chosen model key. Adding a provider = one case + one catalog row.
 *
 * Only the worker imports this (it pulls the provider SDKs). The UI imports the
 * pure `./catalog` directly, so no SDK reaches the Next.js app bundle.
 */
import { resolveModel } from "./catalog";
import { anthropicExtraction } from "./anthropic";
import { openaiExtraction } from "./openai";
import { geminiExtraction } from "./gemini";
import type { ExtractionRequest, ToolRunResult } from "./types";

export {
  EXTRACTION_MODELS,
  DEFAULT_MODEL_KEY,
  resolveModel,
  isValidModelKey,
  type ModelInfo,
  type Provider,
} from "./catalog";
export type { ExtractionRequest, ToolRunResult } from "./types";

/** Run a drawing extraction on the model chosen for this project (or the default). */
export function runExtraction(
  modelKey: string | null | undefined,
  req: ExtractionRequest,
): Promise<ToolRunResult> {
  const model = resolveModel(modelKey);
  switch (model.provider) {
    case "openai":
      return openaiExtraction(req);
    case "gemini":
      return geminiExtraction(req);
    case "anthropic":
    default:
      return anthropicExtraction(req);
  }
}
