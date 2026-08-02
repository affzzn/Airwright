import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractionResultSchema, type ExtractionResult } from "./schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";
import { runToolExtraction } from "./claude";

const TOOL_NAME = "record_takeoff";

// Generate the tool's JSON schema from the Zod contract so they cannot drift.
const toolInputSchema = zodToJsonSchema(extractionResultSchema, {
  target: "openApi3",
  $refStrategy: "none",
}) as Anthropic.Tool.InputSchema;

export interface ExtractDrawingResult {
  data: ExtractionResult;
  meta: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    raw: unknown;
  };
}

/** Extract the scaffold take-off from a drawing PDF (Claude tool-use + Zod). */
export async function extractDrawing(pdf: Buffer): Promise<ExtractDrawingResult> {
  const res = await runToolExtraction({
    pdf,
    system: SYSTEM_PROMPT,
    userText: USER_INSTRUCTION,
    toolName: TOOL_NAME,
    toolDescription: "Record the extracted scaffold take-off measurements.",
    inputSchema: toolInputSchema,
    maxTokens: 4096,
  });

  const data = extractionResultSchema.parse(res.input);

  return {
    data,
    meta: {
      model: res.model,
      promptVersion: PROMPT_VERSION,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      raw: res.input,
    },
  };
}
