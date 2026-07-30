import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "@/lib/env";
import { extractionResultSchema, type ExtractionResult } from "./schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";

/** Claude pricing per 1M tokens (Opus). Update if the model/pricing changes. */
const INPUT_COST_PER_MTOK = 15;
const OUTPUT_COST_PER_MTOK = 75;

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

/**
 * The single interface everything else calls. Sends a PDF (bytes) to Claude
 * with forced tool-use for structured JSON, prompt caching on the fixed
 * system prompt + tool schema, validates against Zod, and returns the result
 * plus token/cost telemetry.
 */
export async function extractDrawing(
  pdf: Buffer,
): Promise<ExtractDrawingResult> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const model = env.extractionModel;
  const started = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    // Fixed instructions are cached so only the PDF bytes cost full price.
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: TOOL_NAME,
        description: "Record the extracted scaffold take-off measurements.",
        input_schema: toolInputSchema,
        cache_control: { type: "ephemeral" },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdf.toString("base64"),
            },
          },
          { type: "text", text: USER_INSTRUCTION },
        ],
      },
    ],
  });

  const latencyMs = Date.now() - started;

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return a tool_use block for extraction.");
  }

  // Validate the model output against the same contract the tool schema came from.
  const data = extractionResultSchema.parse(toolUse.input);

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd =
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;

  return {
    data,
    meta: {
      model,
      promptVersion: PROMPT_VERSION,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
      raw: toolUse.input,
    },
  };
}
