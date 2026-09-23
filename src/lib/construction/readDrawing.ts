/**
 * Construction DRAWING reader (docs/20 §14) — ONE multimodal Claude call per
 * drawing. Sends the PDF as a `document` block (Claude renders it to an image AND
 * reads its text) plus the text-layer candidate dump, forces the single
 * observation tool, validates with Zod. Self-contained (does not touch the
 * house-build extractor); imported only from the server action.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "@/lib/env";
import { INPUT_COST_PER_MTOK, OUTPUT_COST_PER_MTOK } from "@/lib/extract/config";
import { drawingObservationsSchema, DRAWING_TOOL_NAME, type DrawingObservations } from "./drawingSchema";
import { DRAWING_PROMPT_VERSION, DRAWING_SYSTEM_PROMPT, buildDrawingUserText } from "./drawingPrompt";
import { extractDrawingText } from "./drawingText";

const DRAWING_MAX_TOKENS = 16384;

// Generate the tool's JSON schema from the Zod contract so they cannot drift.
const toolInputSchema = zodToJsonSchema(drawingObservationsSchema, {
  target: "openApi3",
  $refStrategy: "none",
}) as Anthropic.Tool.InputSchema;

export interface ReadDrawingResult {
  observations: DrawingObservations;
  hasText: boolean;
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

/**
 * Read one construction drawing into observations (docs/20 §5). The caller confirms
 * the CONSTRUCTION_AI flag and that the file is an enquiry drawing (never an answer).
 */
export async function readDrawing(pdf: Buffer): Promise<ReadDrawingResult> {
  // Read the text layer first — labels + dimensions become the model's candidates.
  const text = await extractDrawingText(pdf).catch(() => ({
    hasText: false,
    pageCount: 0,
    pageTexts: [] as { page: number; text: string }[],
  }));
  const userText = buildDrawingUserText({ hasText: text.hasText, pageTexts: text.pageTexts });

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const model = env.constructionDrawingModel;
  const started = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: DRAWING_MAX_TOKENS,
    system: [{ type: "text", text: DRAWING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: DRAWING_TOOL_NAME,
        description: "Record the observed features, counts and measurements from this construction drawing.",
        input_schema: toolInputSchema,
        cache_control: { type: "ephemeral" },
      },
    ],
    tool_choice: { type: "tool", name: DRAWING_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const latencyMs = Date.now() - started;
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === DRAWING_TOOL_NAME,
  );
  if (!toolUse) throw new Error(`Claude did not return a tool_use block for ${DRAWING_TOOL_NAME}.`);

  const parsed = drawingObservationsSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `Drawing observations failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 5)
        .join("; ")}`,
    );
  }
  const observations = parsed.data;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd =
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;

  return {
    observations,
    hasText: text.hasText,
    meta: {
      model,
      promptVersion: DRAWING_PROMPT_VERSION,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
      raw: toolUse.input,
    },
  };
}
