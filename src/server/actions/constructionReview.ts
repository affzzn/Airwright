"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PARAM_DEFS, jobParamsSchema, type ParamKey } from "@/lib/construction/params";

/**
 * The estimator's review actions on a read pack (docs/22 M4): the ⚠ job settings,
 * the scope review (empty sections confirmed "none required") and the output format.
 * (Turning numbers into lines is the section cards' job — `constructionCards.ts`.)
 */

const PARAM_KEYS = new Set(PARAM_DEFS.map((d) => d.key));

/**
 * Set (or reset, with value null) one ⚠ job setting, and whether the estimator
 * confirms it. Validated against the definition; the stored JSON holds overrides
 * only. The measurements change on the next read, which reuses every saved sheet
 * read (no model calls), so the estimator re-runs it from the settings panel.
 */
export async function setConstructionJobParam(
  quoteId: string,
  key: string,
  value: number | string | null,
  confirmed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!PARAM_KEYS.has(key as ParamKey)) return { ok: false, error: "Unknown setting." };
  const def = PARAM_DEFS.find((d) => d.key === key)!;
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId }, select: { jobParams: true, status: true } });
  if (!quote) return { ok: false, error: "Job not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to change its settings." };
  const stored = jobParamsSchema.parse(quote.jobParams ?? {});
  if (value === null && !confirmed) delete stored[key];
  else {
    const v = value ?? def.value;
    if (typeof def.value === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a number of zero or more." };
      stored[key] = { value: n, confirmed };
    } else {
      if (def.options && !def.options.includes(String(v))) return { ok: false, error: "Pick one of the options." };
      stored[key] = { value: String(v), confirmed };
    }
  }
  await prisma.constructionQuote.update({ where: { id: quoteId }, data: { jobParams: stored as Prisma.InputJsonValue } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** Confirm (or un-confirm) that a section the client listed empty needs nothing. */
export async function setConstructionSectionNoneRequired(
  quoteId: string,
  section: string,
  noneRequired: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId }, select: { scopeReview: true } });
  if (!quote) return { ok: false, error: "Job not found." };
  const prev = (quote.scopeReview as { noneRequired?: unknown } | null)?.noneRequired;
  const list = new Set(Array.isArray(prev) ? prev.filter((x): x is string => typeof x === "string") : []);
  if (noneRequired) list.add(section.trim());
  else list.delete(section.trim());
  await prisma.constructionQuote.update({
    where: { id: quoteId },
    data: { scopeReview: { noneRequired: [...list] } as Prisma.InputJsonValue },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** The quote's output: Airwright's sections, the itemised schedule, or the client's workbook. */
export async function setConstructionOutputFormat(quoteId: string, format: string): Promise<{ ok: boolean; error?: string }> {
  if (!["SECTIONS", "SCHEDULE", "CLIENT"].includes(format)) return { ok: false, error: "Unknown format." };
  await prisma.constructionQuote.update({ where: { id: quoteId }, data: { outputFormat: format } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}
