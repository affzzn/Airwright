/**
 * The AI structure pass (docs/17 §4.3): infer the packaging RECIPE for a pack.
 *
 * Hands the model a TEXT manifest (folder tree + filenames + title snippets) and
 * asks it — with a strict schema, one forced tool call — to pick ONE grouping
 * strategy + a few constrained params + the junk keywords + the distinct house
 * type names it sees. It does NOT place files (that drops items); code applies
 * the recipe exhaustively (`compileRecipe` → `groupPack`).
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type Anthropic from "@anthropic-ai/sdk";
import { runToolText } from "@/lib/extract/claude";
import { env } from "@/lib/env";
import { recipeSchema, type Recipe } from "./recipe";

const TOOL_NAME = "propose_grouping_recipe";

const SYSTEM = `You are organising a UK new-build scaffolding tender pack — a tree of PDF drawings for a housing development — into HOUSE TYPES. A house type is a specific house design (e.g. "Aspen", "Byron", "EMA21 Avonsford"); a development repeats a handful of them across many plots.

Your ONLY job is to work out HOW THIS PACK IS ORGANISED and return a small RULE. You do NOT list which file goes where — code applies your rule to every file. Look at the folder structure and filename patterns in the manifest and pick ONE strategy:

- "folder-parent": each file sits directly in a folder named after its house type (e.g. .../Aspen/plan.pdf). Use for per-type subfolders and for apartment-block folders.
- "folder-after-marker": the house-type folder is the one immediately AFTER a fixed marker folder (set folderMarker, e.g. "Scaffold" when types live in Scaffold/<Type>/...).
- "filename-prefix": the house type is the START of the filename, before a sheet number (e.g. "CROMFORD-201-03..." → CROMFORD).
- "filename-name-token": the house type is a NAME word inside the filename, after a leading numeric code and before a revision marker (e.g. "372_BYRON_ISSUE_4.13" → BYRON).
- "combined-pdf": the real drawing is a pre-combined PDF inside a specific sub-folder; the house type is the folder ABOVE it (set combinedPdfFolder, e.g. "00_House_Type_PDF"; the type is its parent folder). Loose sheets elsewhere fall back to their parent folder.

Also return:
- junkFolderKeywords: folder-name words that are NON-scaffold trades (e.g. "Kitchens", "SAP", "Ventilation", "Wardrobes", "Lintels", "M+E", "Structural", "Boundaries"). Files in these are still grouped, just marked not-relevant.
- junkFileKeywords: filename words that are non-scaffold (e.g. "Schedule", "Take Off", "Materials Layout", "Compliance", "Kitchen Layout").
- houseTypeNames: the DISTINCT house type names you can see in the pack (for a sanity check).
- confidence + one-line reasoning.

Pick the single strategy that best fits the pack. Do not invent folders or names not in the manifest.`;

export interface InferRecipeResult {
  recipe: Recipe;
  model: string;
  latencyMs: number;
  costUsd: number;
}

/** Infer the grouping recipe from a text manifest. Throws on API/parse failure
 *  (the caller falls back to the deterministic profile path). */
export async function inferRecipe(manifest: string): Promise<InferRecipeResult> {
  const inputSchema = zodToJsonSchema(recipeSchema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Anthropic.Tool.InputSchema;

  const res = await runToolText({
    system: SYSTEM,
    userText: `Here is the pack manifest. Return the grouping recipe.\n\n${manifest}`,
    toolName: TOOL_NAME,
    toolDescription: "Return the packaging recipe (strategy + params) for grouping this pack into house types.",
    inputSchema,
    model: env.groupingModel,
    maxTokens: 2048,
  });

  const recipe = recipeSchema.parse(res.input);
  return { recipe, model: res.model, latencyMs: res.latencyMs, costUsd: res.costUsd };
}
