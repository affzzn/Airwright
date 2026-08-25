import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildQuoteWorkbook } from "@/lib/pricing/quoteExcel";

export const dynamic = "force-dynamic";

/**
 * Excel export of a frozen quote in Colin's client-matrix format. The workbook is
 * built by `buildQuoteWorkbook` (src/lib/pricing/quoteExcel.ts) so the route and
 * the offline regenerate script produce the identical file.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      project: { include: { client: true } },
      lineItems: {
        include: {
          plot: {
            include: {
              houseType: {
                select: {
                  name: true,
                  code: true,
                  buildType: true,
                  // Storeys for the matrix's Storey column (identity, not price).
                  takeoff: {
                    select: { measurements: { where: { key: "STOREYS" }, select: { valueNumber: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!quote) return new NextResponse("Not found", { status: 404 });

  // Flatten the take-off's STOREYS measurement onto each line item's plot so the
  // workbook can fill the Storey column without re-pricing.
  const quoteForExcel = {
    ...quote,
    lineItems: quote.lineItems.map((li) => ({
      ...li,
      plot: li.plot
        ? {
            ...li.plot,
            storeys: li.plot.houseType.takeoff?.measurements[0]?.valueNumber
              ? Number(li.plot.houseType.takeoff.measurements[0].valueNumber)
              : null,
            houseType: {
              name: li.plot.houseType.name,
              code: li.plot.houseType.code,
              buildType: li.plot.houseType.buildType,
            },
          }
        : null,
    })),
  };

  const bytes = await buildQuoteWorkbook(quoteForExcel);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="quote-v${quote.version}-${quote.project.name.replace(/[^a-z0-9]+/gi, "-")}.xlsx"`,
    },
  });
}
