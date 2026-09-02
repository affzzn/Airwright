import type Anthropic from "@anthropic-ai/sdk";
import { runToolExtraction } from "../claude";
import type { ExtractionRequest, ToolRunResult } from "./types";

/**
 * Anthropic adapter — delegates to the existing `claude.ts` (forced tool-use,
 * PDF document block, ephemeral prompt caching). Behaviour is unchanged from
 * before the provider abstraction; this is just the common interface around it.
 */
export function anthropicExtraction(req: ExtractionRequest): Promise<ToolRunResult> {
  return runToolExtraction({
    pdf: req.pdf,
    system: req.system,
    userText: req.userText,
    toolName: req.toolName,
    toolDescription: req.toolDescription,
    inputSchema: req.inputSchema as unknown as Anthropic.Tool.InputSchema,
    maxTokens: req.maxTokens,
  });
}
