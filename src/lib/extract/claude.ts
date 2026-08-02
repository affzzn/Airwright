import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/** Claude pricing per 1M tokens (Opus). Update if the model/pricing changes. */
const INPUT_COST_PER_MTOK = 15;
const OUTPUT_COST_PER_MTOK = 75;

export interface ToolRunResult {
  input: unknown; // the tool_use input (validate with the caller's Zod schema)
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Shared Claude tool-use call: sends a PDF, forces a single tool call for
 * structured JSON, caches the fixed system prompt + tool schema (prompt
 * caching), and returns the raw tool input plus token/cost telemetry.
 */
export async function runToolExtraction(opts: {
  pdf: Buffer;
  system: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Tool.InputSchema;
  maxTokens?: number;
}): Promise<ToolRunResult> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const model = env.extractionModel;
  const started = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
    ],
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: opts.inputSchema,
        cache_control: { type: "ephemeral" },
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: opts.pdf.toString("base64"),
            },
          },
          { type: "text", text: opts.userText },
        ],
      },
    ],
  });

  const latencyMs = Date.now() - started;
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === opts.toolName,
  );
  if (!toolUse) {
    throw new Error(`Claude did not return a tool_use block for ${opts.toolName}.`);
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd =
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;

  return { input: toolUse.input, model, latencyMs, inputTokens, outputTokens, costUsd };
}
