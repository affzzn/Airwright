import { prisma } from "@/lib/db";
import { STANDARD_STOREY_LIFTS } from "@/lib/takeoff/engine";

/**
 * The storey→lifts template for a client's active builder profile, or the
 * Standard default. The template is BUILDER-SPECIFIC (docs/08: Barratt 2→3 vs
 * Standard 2→4), so the lift count — and thus the whole external price — depends
 * on getting this right. Falls back to Standard when no profile / no template is
 * set, so nothing regresses until real per-builder templates are entered.
 */
export async function getStoreyLiftTemplate(
  clientId: string,
): Promise<Record<string, number>> {
  const profile = await prisma.builderProfile.findFirst({
    where: { clientId, isActive: true },
    orderBy: { effectiveFrom: "desc" },
    select: { storeyLiftTemplate: true },
  });
  return sanitizeTemplate(profile?.storeyLiftTemplate) ?? STANDARD_STOREY_LIFTS;
}

/** Accept only a plain map of positive numbers keyed by storey ("1","2","2.5"…). */
function sanitizeTemplate(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
