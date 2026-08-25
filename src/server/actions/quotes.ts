"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma, RateBand } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadProjectPricing } from "@/server/pricing";

/**
 * Snapshot the priced development into an immutable Quote. It freezes BOTH:
 *   - the true-cost detail lines (component set, stage null), and
 *   - the presented payment-stage rows (stage set, component null),
 * so the client matrix (stage split) and the real per-item cost are both
 * preserved and can never drift. quantity/rate/amount are frozen at quote time.
 */
export async function generateQuote(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const loaded = await loadProjectPricing(projectId);
  if (!loaded) return { ok: false, error: "Project not found." };
  const priced = loaded.pricing.plots.filter((p) => p.status === "PRICED");
  if (priced.length === 0)
    return {
      ok: false,
      error: "Nothing to quote — confirm take-offs and add rates first.",
    };

  const last = await prisma.quote.findFirst({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const lineItems: Prisma.QuoteLineItemCreateWithoutQuoteInput[] = [];
  for (const p of priced) {
    // True-cost detail lines.
    for (const l of p.lines) {
      lineItems.push({
        plot: { connect: { id: p.plotId } },
        description: `${l.note ?? l.component} — ${l.action === "ERECT" ? "erect" : "dismantle"}${
          l.liftLevel ? ` (lift ${l.liftLevel})` : ""
        }`,
        component: l.component as Prisma.QuoteLineItemCreateInput["component"],
        action: l.action as Prisma.QuoteLineItemCreateInput["action"],
        liftLevel: l.liftLevel,
        group: "MAIN",
        quantity: l.quantity,
        unit: l.unit as Prisma.QuoteLineItemCreateInput["unit"],
        rate: l.rate,
        amount: l.amount,
      });
    }
    // Presented payment-stage rows (a share of the plot total, not item cost).
    for (const s of p.stages) {
      lineItems.push({
        plot: { connect: { id: p.plotId } },
        description: s.name,
        stage: s.name,
        group: "MAIN",
        quantity: 1,
        unit: "EACH",
        rate: s.amount,
        amount: s.amount,
      });
    }
  }

  // Garages — frozen as their own section (group GARAGE), so the client matrix
  // can render the garages block + fold them into the grand total (docs/15 §6).
  for (const g of loaded.pricing.garages) {
    for (const l of g.lines) {
      lineItems.push({
        plot: { connect: { id: g.plotId } },
        description: `${l.note ?? l.component} — ${l.action === "ERECT" ? "erect" : "dismantle"}${
          l.liftLevel ? ` (lift ${l.liftLevel})` : ""
        }`,
        component: l.component as Prisma.QuoteLineItemCreateInput["component"],
        action: l.action as Prisma.QuoteLineItemCreateInput["action"],
        liftLevel: l.liftLevel,
        group: "GARAGE",
        quantity: l.quantity,
        unit: l.unit as Prisma.QuoteLineItemCreateInput["unit"],
        rate: l.rate,
        amount: l.amount,
      });
    }
    for (const s of g.stages) {
      lineItems.push({
        plot: { connect: { id: g.plotId } },
        description: s.name,
        stage: s.name,
        group: "GARAGE",
        quantity: 1,
        unit: "EACH",
        rate: s.amount,
        amount: s.amount,
      });
    }
  }

  const quote = await prisma.quote.create({
    data: {
      projectId,
      rateCardId: loaded.rateCard?.id ?? null,
      type: "HOUSEBUILDING",
      band: loaded.project.band as RateBand,
      version,
      status: "DRAFT",
      total: loaded.pricing.grandTotal,
      lineItems: { create: lineItems },
    },
  });

  revalidatePath(`/projects/${projectId}/pricing`);
  redirect(`/quotes/${quote.id}`);
}
