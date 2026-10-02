/**
 * Construction sheet readers (docs/23 §12) — the one Claude call every reader
 * uses: PDF documents + a forced tool + Zod validation + cost telemetry.
 * SERVER/WORKER ONLY (Anthropic SDK). Prompts and hints live in `prompts.ts`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "@/lib/env";
import { INPUT_COST_PER_MTOK, OUTPUT_COST_PER_MTOK } from "@/lib/extract/config";

const round = (n: number) => Math.round(n * 10000) / 10000;

export interface ReaderMeta {
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ReaderResult<T> {
  data: T;
  raw: unknown;
  meta: ReaderMeta;
}

/**
 * One forced-tool Claude call over one or more PDF documents. The system prompt and
 * tool schema are prompt-cached; the result is validated with the reader's Zod
 * schema (arrays degrade to empty rather than failing the whole read).
 */
export async function callSheetReader<S extends z.ZodTypeAny>(opts: {
  documents: Buffer[];
  system: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  schema: S;
  promptVersion: string;
  maxTokens?: number;
}): Promise<ReaderResult<z.infer<S>>> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const model = env.constructionDrawingModel;
  const inputSchema = zodToJsonSchema(opts.schema, { target: "openApi3", $refStrategy: "none" }) as Anthropic.Tool.InputSchema;
  const expectedKeys =
    opts.schema instanceof z.ZodObject ? new Set(Object.keys((opts.schema as z.AnyZodObject).shape)) : null;
  const started = Date.now();

  const call = () =>
    client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16384,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: inputSchema,
          cache_control: { type: "ephemeral" },
        },
      ],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [
        {
          role: "user",
          content: [
            ...opts.documents.map((d) => ({
              type: "document" as const,
              source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.toString("base64") },
            })),
            { type: "text" as const, text: opts.userText },
          ],
        },
      ],
    });

  /**
   * A broken tool call: on long, dense answers the model occasionally serialises a
   * list as markup text ("<parameter name=…") and the remaining fields leak to the
   * top level, losing most of the answer. Detected, retried once, then refused.
   */
  const malformed = (input: unknown): string | null => {
    const json = JSON.stringify(input ?? {});
    if (json.includes("<parameter")) return "the answer contained raw tool markup";
    if (expectedKeys && input && typeof input === "object") {
      const extra = Object.keys(input as object).filter((k) => !expectedKeys.has(k));
      if (extra.length) return `unexpected fields ${extra.slice(0, 4).join(", ")}`;
    }
    return null;
  };

  let response = await call();
  let toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.toolName,
  );
  let inputTokens = response.usage.input_tokens;
  let outputTokens = response.usage.output_tokens;
  let problem = toolUse ? malformed(toolUse.input) : "no tool call";
  if (problem) {
    response = await call();
    toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.toolName);
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    problem = toolUse ? malformed(toolUse.input) : "no tool call";
    if (problem) throw new Error(`The model's answer for ${opts.toolName} was malformed twice (${problem}).`);
  }
  const latencyMs = Date.now() - started;
  if (!toolUse) throw new Error(`The model did not return ${opts.toolName}.`);
  const parsed = opts.schema.safeParse(toolUse.input);
  if (!parsed.success)
    throw new Error(
      `${opts.toolName} failed validation: ${parsed.error.issues
        .slice(0, 4)
        .map((i: z.ZodIssue) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  return {
    data: parsed.data,
    raw: toolUse.input,
    meta: {
      model,
      promptVersion: opts.promptVersion,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd: round((inputTokens / 1e6) * INPUT_COST_PER_MTOK + (outputTokens / 1e6) * OUTPUT_COST_PER_MTOK),
    },
  };
}
