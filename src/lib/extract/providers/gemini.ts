import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";
import { resolveModel } from "./catalog";
import {
  parseJsonLoose,
  schemaInstruction,
  type ExtractionRequest,
  type ToolRunResult,
} from "./types";

/**
 * Google Gemini adapter (Gemini 3.1 Pro) — generateContent with the PDF as
 * inline base64 data and JSON output mode (`responseMimeType: application/json`).
 * The schema is described in the prompt (Gemini's `responseSchema` accepts only a
 * subset of JSON Schema, so we keep JSON mode robust and let Zod validate).
 */
export async function geminiExtraction(req: ExtractionRequest): Promise<ToolRunResult> {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const model = env.geminiExtractionModel;
  const info = resolveModel("gemini-3-1-pro");
  const started = Date.now();

  const b64 = req.pdf.toString("base64");
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: b64 } },
          { text: req.userText + schemaInstruction(req) },
        ],
      },
    ],
    config: {
      systemInstruction: req.system,
      responseMimeType: "application/json",
      maxOutputTokens: req.maxTokens ?? 4096,
    },
  });

  const latencyMs = Date.now() - started;
  const input = parseJsonLoose(response.text ?? "");
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * info.priceInPerMtok +
    (outputTokens / 1_000_000) * info.priceOutPerMtok;

  return { input, model, latencyMs, inputTokens, outputTokens, costUsd };
}
