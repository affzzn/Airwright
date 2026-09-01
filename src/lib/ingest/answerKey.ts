/**
 * In-pack answer-key cross-check (docs/17 §7).
 *
 * Most tender packs contain a house-type list — a take-off sheet, plot schedule
 * or drawing register. We read it and cross-check it against our grouping: found
 * all of them? extra? missing? A free, runtime self-check that flags "expected
 * 16 house types, found 15" while a human is right there to fix it. It never
 * blocks — if no answer-key file exists or it can't be read, we just skip.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type Anthropic from "@anthropic-ai/sdk";
import { runToolExtraction } from "@/lib/extract/claude";

/** Filenames that look like a pack's own house-type list. */
const ANSWER_KEY_RX =
  /take[ _]?offs?|plot[ _]schedule|drawing[ _]register|house[ _-]?type[ _](list|schedule|register)|schedule[ _]of[ _]house/i;

export interface AnswerKeyDoc {
  id: string;
  fileName: string;
  storagePath: string;
}

/** Find the pack's house-type list document, if any (by filename). */
export function findAnswerKeyDoc<T extends AnswerKeyDoc>(docs: T[]): T | null {
  return docs.find((d) => ANSWER_KEY_RX.test(d.fileName)) ?? null;
}

const houseTypeListSchema = z.object({
  houseTypes: z
    .array(z.string())
    .describe("Every distinct house-type name listed in the sheet (not plot numbers, not totals)."),
});

const SYSTEM = `You are reading a UK new-build scaffolding TAKE-OFF SHEET / plot schedule / drawing register for a housing development. It lists the HOUSE TYPES in the development (e.g. "Aspen", "Byron", "EMA21 Avonsford"), usually one per row, often with measurements or plot numbers beside them.

Return the list of DISTINCT house-type names only. Ignore plot numbers, quantities, totals, headings and column labels. If the same house type appears in several configurations (Detached/Semi/Mid), return the type name once.`;

/** Read the distinct house-type names off an answer-key PDF. Throws on failure. */
export async function extractHouseTypeList(pdf: Buffer): Promise<string[]> {
  const inputSchema = zodToJsonSchema(houseTypeListSchema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Anthropic.Tool.InputSchema;

  const res = await runToolExtraction({
    pdf,
    system: SYSTEM,
    userText: "Return the distinct house-type names listed in this sheet.",
    toolName: "record_house_type_list",
    toolDescription: "Return the distinct house-type names listed in the take-off / schedule sheet.",
    inputSchema,
    maxTokens: 2048,
  });

  const parsed = houseTypeListSchema.parse(res.input);
  return parsed.houseTypes.map((s) => s.trim()).filter(Boolean);
}

export interface CrossCheck {
  expected: string[]; // names read off the answer key
  matched: string[]; // expected names we also grouped
  missing: string[]; // expected but NOT grouped (a possible miss)
  extra: string[]; // grouped but NOT on the sheet (a possible over-split / junk grouped)
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Two names match if their normalised forms are equal or one contains the other. */
function namesMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 3 && long.includes(short);
}

/** Cross-check the grouped house-type names against the answer-key list. Pure. */
export function crossCheckHouseTypes(grouped: string[], expected: string[]): CrossCheck {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const e of expected) {
    if (grouped.some((g) => namesMatch(g, e))) matched.push(e);
    else missing.push(e);
  }
  const extra = grouped.filter((g) => !expected.some((e) => namesMatch(g, e)));
  return { expected, matched, missing, extra };
}
