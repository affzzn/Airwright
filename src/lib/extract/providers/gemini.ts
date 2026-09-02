import { GoogleGenAI, MediaResolution } from "@google/genai";
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
 *
 * Tuned for dense CAD drawings (2026-09-02):
 *   - mediaResolution HIGH — default (medium) downsamples tiny dimension text on
 *     a busy A3 sheet into a blur; HIGH keeps the printed dimensions legible.
 *   - temperature 0 — deterministic, repeatable reads (no run-to-run drift).
 *   - thinkingBudget -1 (automatic) — Gemini 3.1 Pro is a reasoning model; let it
 *     think as much as it needs for the multi-step per-house/step logic.
 *   - a generous output cap — thinking tokens share maxOutputTokens, so keep
 *     headroom or a heavy think can truncate the JSON.
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
      temperature: 0,
      // Read the drawing at full fidelity — critical for fine dimension text.
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      // Automatic (dynamic) thinking budget for the reasoning-heavy take-off.
      thinkingConfig: { thinkingBudget: -1 },
      // Thinking tokens share this budget with the JSON output — keep headroom.
      maxOutputTokens: Math.max(req.maxTokens ?? 4096, 32768),
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
