import OpenAI from "openai";
import { env } from "@/lib/env";
import { resolveModel } from "./catalog";
import {
  parseJsonLoose,
  schemaInstruction,
  type ExtractionRequest,
  type ToolRunResult,
} from "./types";

/**
 * OpenAI adapter (GPT-5.6) — Responses API with the PDF as an `input_file`
 * (base64 data URL) and JSON-object output mode. The returned JSON text is
 * parsed and handed back for the caller's Zod validation.
 */
export async function openaiExtraction(req: ExtractionRequest): Promise<ToolRunResult> {
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const model = env.openaiExtractionModel;
  const info = resolveModel("openai-gpt-5-6");
  const started = Date.now();

  const b64 = req.pdf.toString("base64");
  const response = await client.responses.create({
    model,
    max_output_tokens: req.maxTokens ?? 4096,
    instructions: req.system,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "drawing.pdf",
            file_data: `data:application/pdf;base64,${b64}`,
          },
          { type: "input_text", text: req.userText + schemaInstruction(req) },
        ],
      },
    ],
    text: { format: { type: "json_object" } },
  });

  const latencyMs = Date.now() - started;
  const input = parseJsonLoose(response.output_text ?? "");
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * info.priceInPerMtok +
    (outputTokens / 1_000_000) * info.priceOutPerMtok;

  return { input, model, latencyMs, inputTokens, outputTokens, costUsd };
}
