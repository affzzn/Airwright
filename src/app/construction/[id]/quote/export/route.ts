import { NextResponse } from "next/server";
import { loadConstructionQuote, priceLoadedQuote, type ConstructionQuoteVM } from "@/server/construction";
import { buildConstructionSectionsWorkbook, buildConstructionWorkbook } from "@/lib/construction/quoteExcel";
import { fillClientTemplate, type TemplateLine } from "@/lib/construction/clientTemplateExcel";
import { buildQuoteSections } from "@/lib/construction/sections";
import { lineAmount, lineExtraHirePerWeek, lineHireBeyondBase } from "@/lib/construction/price";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { prisma } from "@/lib/db";
import type { ConstructionUnit } from "@/lib/construction/types";

export const dynamic = "force-dynamic";

/**
 * Excel export of a construction quote, in the format chosen on the quote step
 * (or `?format=`): SECTIONS — Airwright's lump-sum sections (Quote-1350);
 * SCHEDULE — the itemised schedule (the Wren layout); CLIENT — the client's own
 * schedule workbook, filled in. Every builder sanitises text against formula
 * injection.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await loadConstructionQuote(id);
  if (!quote) return new NextResponse("Not found", { status: 404 });
  const pricing = priceLoadedQuote(quote);
  const asked = new URL(req.url).searchParams.get("format")?.toUpperCase();
  const format = asked === "SECTIONS" || asked === "SCHEDULE" || asked === "CLIENT" ? asked : quote.outputFormat;
  const assumptions = pricing.flags.filter((f) => f.level === "warn").map((f) => f.message);
  const name = (quote.reference || quote.customerName || "construction-quote").replace(/[^a-z0-9]+/gi, "-");
  const xlsx = (bytes: unknown, suffix: string) =>
    new NextResponse(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}-${suffix}.xlsx"`,
      },
    });

  if (format === "CLIENT" && quote.clientTemplate) {
    const tables = quote.clientTemplate.tables;
    const attId = tables[0].attachmentId;
    const att = await prisma.constructionAttachment.findFirst({ where: { id: attId, quoteId: id } });
    if (att) {
      const original = await downloadFromStorage(att.storagePath);
      const res = await fillClientTemplate(
        original,
        tables.filter((t) => t.attachmentId === attId),
        templateLines(quote, pricing.hireIncluded),
        { noneRequired: quote.scopeReview.noneRequired, notes: clientNotes(quote, pricing.hireIncluded, assumptions), reference: quote.reference },
      );
      return xlsx(res.bytes, att.fileName.replace(/\.xlsx?$/i, "").replace(/[^a-z0-9]+/gi, "-") + "-priced");
    }
  }

  if (format === "SECTIONS" || format === "CLIENT") {
    const sections = buildQuoteSections(
      quote.lines.map((l) => ({ ...l, unit: l.unit as ConstructionUnit })),
      { buildings: quote.buildings, jobWeeks: quote.durationWeeks, hireInPrice: pricing.hireIncluded },
    );
    const bytes = await buildConstructionSectionsWorkbook({
      reference: quote.reference,
      customerName: quote.customerName,
      siteAddress: quote.siteAddress,
      band: quote.band,
      sections: sections.map((s) => ({
        title: s.title,
        hireWeeks: pricing.hireIncluded ? s.hireWeeks : (s.baseWeeks ?? s.hireWeeks),
        extraHirePerWeek: s.extraHirePerWeek,
        qty: s.qty,
        rate: s.rate,
        price: s.price,
        includes: s.includes,
      })),
      total: pricing.total,
      hireNote: "Each price includes the hire period shown; extra hire beyond it is charged per week at the rate shown (a part-week is a full week).",
      assumptions,
    });
    return xlsx(bytes, "quotation");
  }

  const bytes = await buildConstructionWorkbook({
    reference: quote.reference,
    customerName: quote.customerName,
    siteAddress: quote.siteAddress,
    band: quote.band,
    durationWeeks: quote.durationWeeks,
    lines: quote.lines.map((l) => ({
      description: l.description,
      lifts: l.lifts,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      note: l.note,
    })),
    total: pricing.total,
    extraHirePerWeek: pricing.extraHirePerWeek,
    extraHireBeyondBase: pricing.extraHireBeyondBase,
    maxWeeksBeyondBase: pricing.maxWeeksBeyondBase,
    assumptions,
  });
  return xlsx(bytes, "schedule");
}

/** Each priced line as the client template needs it: its row, its height, its price as quoted. */
function templateLines(quote: ConstructionQuoteVM, hireIncluded: boolean): TemplateLine[] {
  const heightOf = (buildingId: string | null): number | null => {
    const hs = quote.measurements.filter((m) => (m.key ?? "").startsWith("height:") && (buildingId == null || m.buildingId === buildingId));
    return hs.length ? Math.max(...hs.map((m) => m.valueNumber)) : quote.buildingHeightM;
  };
  return quote.lines.map((l) => {
    const p = {
      unit: l.unit as ConstructionUnit,
      quantity: l.quantity,
      lifts: l.lifts,
      rate: l.rate,
      baseHireWeeks: l.baseHireWeeks,
      extraHirePerWeek: l.extraHirePerWeek,
      extraHireChargePct: l.extraHireChargePct,
      durationWeeks: l.durationWeeks,
    };
    return {
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      lifts: l.lifts,
      durationWeeks: l.durationWeeks ?? quote.durationWeeks,
      rate: l.rate,
      cost: lineAmount(p) + (hireIncluded ? lineHireBeyondBase(p, quote.durationWeeks) : 0),
      extraHirePerWeek: lineExtraHirePerWeek(p),
      heightM: heightOf(l.buildingId),
      sheet: l.clientRef?.sheet ?? null,
      rowRef: l.clientRef?.rowRef ?? null,
    };
  });
}

function clientNotes(quote: ConstructionQuoteVM, hireIncluded: boolean, assumptions: string[]): string[] {
  const bases = [...new Set(quote.lines.map((l) => l.baseHireWeeks).filter((w): w is number => w != null && w > 0))];
  return [
    `Quantities are measured from your drawings; the scaffold run includes ${quote.params.P4_cornerAllowanceM.value} m per external corner.`,
    hireIncluded
      ? "Each Cost covers the hire period on its row; Weekly Rate is the extra hire per week after that."
      : `Each Cost covers the hire included in our rates (${bases.length ? bases.join(" / ") : "4"} weeks); Weekly Rate is the extra hire per week after that, up to the weeks on the row and beyond.`,
    ...assumptions,
  ];
}
