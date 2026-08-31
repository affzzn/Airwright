import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractionResultSchema, type ExtractionResult } from "./schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";
import { runToolExtraction } from "./claude";
import { EXTRACTION_MAX_TOKENS } from "./config";
import { extractDimensionsByPage } from "./classify";
import { buildDimensionHint, type PageDims } from "./dimensions";

const TOOL_NAME = "record_takeoff";

// Generate the tool's JSON schema from the Zod contract so they cannot drift.
const toolInputSchema = zodToJsonSchema(extractionResultSchema, {
  target: "openApi3",
  $refStrategy: "none",
}) as Anthropic.Tool.InputSchema;

export interface ExtractDrawingResult {
  data: ExtractionResult;
  /** Per-page text-layer dimensions of the sliced PDF — used to verify the model's cited strings. */
  dimensions: PageDims[];
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
  // Read the exact printed dimension strings off the PDF text layer and feed them
  // to the model as a per-page candidate list, so it snaps to real digits rather
  // than re-reading them off the linework. Empty (no hint) for a scanned PDF.
  const dimensions = await extractDimensionsByPage(pdf).catch(() => [] as PageDims[]);
  const userText = USER_INSTRUCTION + buildDimensionHint(dimensions);

  const res = await runToolExtraction({
    pdf,
    system: SYSTEM_PROMPT,
    userText,
    toolName: TOOL_NAME,
    toolDescription: "Record the extracted scaffold take-off measurements.",
    inputSchema: toolInputSchema,
    maxTokens: EXTRACTION_MAX_TOKENS, // richer field set; large blocks (3-storey, many elevations/floors) can be verbose
  });

  const data = extractionResultSchema.parse(res.input);

  return {
    data,
    dimensions,
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
