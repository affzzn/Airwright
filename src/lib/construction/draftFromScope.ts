/**
 * "Draft from enquiry" (docs/19) — orchestration: build the picking-list context,
 * make ONE text-only Claude tool call (via the shared `runToolText` helper),
 * validate the output with Zod, and reconcile it against the real element ids.
 *
 * Thin by design — the pure, tested parts are in `scopePrompt.ts` / `scopeDraft.ts`
 * / `scopeSchema.ts`. This module is the only one here that talks to the model, so
 * it is imported only from the server action (never the client bundle).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runToolText } from "@/lib/extract/claude";
import { env } from "@/lib/env";
import { constructionDraftSchema, DRAFT_TOOL_NAME } from "./scopeSchema";
import {
  SCOPE_PROMPT_VERSION,
  SCOPE_SYSTEM_PROMPT,
  buildPickingListContext,
  buildScopeUserText,
} from "./scopePrompt";
import { reconcileDraftLines, type ReconciledDraftLine } from "./scopeDraft";
import type { ConstructionUnit } from "./types";

const DRAFT_MAX_TOKENS = 8192;

// Generate the tool's JSON schema from the Zod contract so they cannot drift.
const toolInputSchema = zodToJsonSchema(constructionDraftSchema, {
  target: "openApi3",
  $refStrategy: "none",
}) as Anthropic.Tool.InputSchema;

export interface DraftElementInput {
  id: string;
  name: string;
  aliases: string[];
  unit: ConstructionUnit | string;
  usesLifts: boolean;
  category?: string | null;
}

export interface DraftFromScopeResult {
  lines: ReconciledDraftLine[];
  notes: string;
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
 * Read a written scope-of-works into draft quote lines mapped to the picking list.
 * Never prices, never invents an element id. The caller (a server action) confirms
 * the CONSTRUCTION_AI flag first and persists the raw output for audit.
 */
export async function draftFromScope(
  scopeText: string,
  elements: DraftElementInput[],
): Promise<DraftFromScopeResult> {
  const context = buildPickingListContext(elements);
  const userText = buildScopeUserText(context, scopeText);

  const res = await runToolText({
    system: SCOPE_SYSTEM_PROMPT,
    userText,
    toolName: DRAFT_TOOL_NAME,
    toolDescription:
      "Record the draft quote lines mapped from the client's written scope of works.",
    inputSchema: toolInputSchema,
    model: env.constructionModel,
    maxTokens: DRAFT_MAX_TOKENS,
  });

  const parsed = constructionDraftSchema.parse(res.input);
  const validIds = new Set(elements.map((e) => e.id));
  const lines = reconcileDraftLines(parsed.lines, validIds);

  return {
    lines,
    notes: parsed.notes?.trim() ?? "",
    meta: {
      model: res.model,
      promptVersion: SCOPE_PROMPT_VERSION,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      raw: res.input,
    },
  };
}
