/**
 * The provider-agnostic extraction interface. Every adapter (anthropic / gemini /
 * openai) takes an ExtractionRequest and returns a ToolRunResult, so the caller
 * (`extractDrawing`) is identical regardless of provider.
 */

export interface ToolRunResult {
  /** The structured output (validate with the caller's Zod schema). */
  input: unknown;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ExtractionRequest {
  pdf: Buffer;
  system: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  /** A plain JSON Schema object (from zod-to-json-schema). */
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}

/**
 * Appended to the user text for JSON-mode providers (Gemini / OpenAI), which
 * return JSON *text* rather than a schema-enforced tool call. Anthropic doesn't
 * need this — its tool `input_schema` enforces the shape natively.
 */
export function schemaInstruction(req: ExtractionRequest): string {
  return `\n\nIMPORTANT: Respond with ONLY a single JSON object — no prose, no markdown code fences — that conforms to this JSON schema:\n${JSON.stringify(req.inputSchema)}`;
}

/**
 * Parse model output that should be a JSON object, tolerant of ```json fences or
 * leading/trailing prose. Throws (→ the extraction is marked FAILED) if no JSON
 * object can be found, which is the right behaviour — never fabricate a result.
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip a ```json … ``` fence, or grab the outermost { … }.
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1] : trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model did not return a parseable JSON object.");
  }
}
