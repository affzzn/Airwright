/**
 * Tier-2 LLM relevance triage (docs/17 §6).
 *
 * The deterministic Tier-1 classifier (`classify.ts`) keyword-matches the title
 * block. This second pass re-judges the pages it was UNSURE about — by MEANING,
 * not keywords — so an unusually-labelled scaffold drawing ("External Wall
 * Elevation", "GA Elevation") isn't silently excluded on an unknown builder.
 *
 * Doctrine (docs/17 §6): recall beats precision — this pass only ever RESCUES a
 * page (flips not-relevant → relevant); it never removes one (a wrongly-included
 * page just wastes a few tokens; a wrongly-excluded page is a silent hole).
 * Batched small (≤10) with an account-for-every-page check so nothing is dropped.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type Anthropic from "@anthropic-ai/sdk";
import { runToolText } from "@/lib/extract/claude";
import { env } from "@/lib/env";

export const TRIAGE_BATCH = 10;

export interface TriageItem {
  key: string; // stable id (e.g. DocumentPage id) — echoed back via a batch ref
  title: string; // the title-block text / sheet title
  fileName: string;
  folder: string;
}

export interface TriageVerdict {
  relevant: boolean;
  drawingType: string;
  reason: string;
}

const batchSchema = z.object({
  pages: z.array(
    z.object({
      ref: z.number().int().describe("The page's ref number from the list."),
      relevant: z.boolean().describe("Is this a scaffold-relevant drawing?"),
      drawingType: z.string().describe("What the page is (e.g. 'front elevation', 'kitchen layout')."),
      reason: z.string().describe("One short clause why."),
    }),
  ),
});

const SYSTEM = `You are triaging pages of a UK new-build scaffolding tender pack. A page is SCAFFOLD-RELEVANT if it carries a measurement a scaffold take-off needs: the OUTSIDE FACES (elevations), the FOOTPRINT / floor or setting-out plan, the SECTION (heights), or the ROOF plan. It is NOT relevant if it is an internal trade sheet — kitchen/bathroom/wardrobe layouts, M+E/electrical/plumbing, structural calcs, SAP/Part-O, schedules, lintels, joist layouts, drainage, compliance.

Judge by MEANING, not keywords — an unusually named sheet ("External Wall Elevation", "GA Elevation") is still relevant if it shows the outside/plan/section. When genuinely unsure, mark it RELEVANT (a human will confirm; missing a real drawing is worse than including an extra).

For EVERY page in the list, return its ref, whether it is scaffold-relevant, its drawing type, and a one-clause reason. Do not skip any ref.`;

/**
 * Re-judge relevance for a set of uncertain pages. Returns a verdict per input
 * key (missing keys — e.g. a dropped batch — simply aren't in the map, and the
 * caller leaves those pages as Tier 1 had them).
 */
export async function triageRelevance(
  items: TriageItem[],
  model?: string,
): Promise<Map<string, TriageVerdict>> {
  const out = new Map<string, TriageVerdict>();
  const inputSchema = zodToJsonSchema(batchSchema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Anthropic.Tool.InputSchema;

  for (let i = 0; i < items.length; i += TRIAGE_BATCH) {
    const batch = items.slice(i, i + TRIAGE_BATCH);
    const listing = batch
      .map(
        (it, j) =>
          `[${j + 1}] title: "${it.title}" · file: "${it.fileName}" · folder: "${it.folder}"`,
      )
      .join("\n");

    try {
      const res = await runToolText({
        system: SYSTEM,
        userText: `Triage these ${batch.length} pages. Return a verdict for every ref.\n\n${listing}`,
        toolName: "triage_relevance",
        toolDescription: "Classify each listed page as scaffold-relevant or not.",
        inputSchema,
        model: model ?? env.groupingModel,
        maxTokens: 1024,
      });
      const parsed = batchSchema.parse(res.input);
      for (const p of parsed.pages) {
        const item = batch[p.ref - 1];
        if (item) out.set(item.key, { relevant: p.relevant, drawingType: p.drawingType, reason: p.reason });
      }
    } catch {
      // A failed batch → leave those pages as Tier 1 classified them (never drop).
    }
  }
  return out;
}
