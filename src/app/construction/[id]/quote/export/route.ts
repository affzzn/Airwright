import { NextResponse } from "next/server";
import { loadConstructionQuote, priceLoadedQuote } from "@/server/construction";
import { buildConstructionWorkbook } from "@/lib/construction/quoteExcel";

export const dynamic = "force-dynamic";

/**
 * Excel export of a construction quote in Airwright's own scaffolding-schedule
 * layout (docs/19 §10). Built by `buildConstructionWorkbook` so any caller
 * produces the identical file.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const quote = await loadConstructionQuote(id);
  if (!quote) return new NextResponse("Not found", { status: 404 });
  const pricing = priceLoadedQuote(quote);

  const bytes = await buildConstructionWorkbook({
    reference: quote.reference,
    customerName: quote.customerName,
    siteAddress: quote.siteAddress,
    band: quote.band,
    durationWeeks: quote.durationWeeks,
    extraHirePctPerWeek: quote.extraHirePctPerWeek,
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
    assumptions: pricing.flags.filter((f) => f.level === "warn").map((f) => f.message),
  });

  const name = (quote.reference || quote.customerName || "construction-quote").replace(
    /[^a-z0-9]+/gi,
    "-",
  );
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}-schedule.xlsx"`,
    },
  });
}
