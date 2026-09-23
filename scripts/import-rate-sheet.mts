/**
 * Import Airwright's master rate sheet (`picking list.xlsm`, sheet "Excel Import")
 * into the element library.
 *
 *   npx tsx scripts/import-rate-sheet.mts <path-to-xlsm> [--dry-run] [--lines=CON,TF]
 *
 * The sheet is the source of truth for BOTH sides of the business: the item title
 * carries the business line, the height bracket and the commercial band (see
 * `src/lib/construction/rateSheet.ts`). Re-running is safe: elements are keyed by
 * line + family, so an updated sheet updates rates in place. Items that vanish
 * from the sheet are DEACTIVATED, never deleted, because quote lines point at them.
 *
 * Column layout (row 1/2 headers, data from row 4):
 *   A Item Title · C Measure · D Based on (Hire Period) · E Rate
 *   G E/H Value  · I %age to charge
 */

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { buildImport, type BusinessLine, type RateSheetRow } from "@/lib/construction/rateSheet";
import type { HeightBracket, RateBand } from "@prisma/client";

const SHEET = "Excel Import";
const FIRST_DATA_ROW = 4;

const str = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (o.result != null) return String(o.result).trim();
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
  }
  return String(v).trim();
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.result === "number") return o.result;
  }
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const LINE_PREFIX: Record<BusinessLine, string> = {
  CONSTRUCTION: "con",
  TRADITIONAL: "trad",
  TIMBER_FRAME: "tf",
  GENERAL: "gen",
};

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const linesArg = args.find((a) => a.startsWith("--lines="))?.split("=")[1];
  const wanted = linesArg
    ? new Set(
        linesArg.split(",").map((l) => {
          const k = l.trim().toUpperCase();
          return k === "CON" ? "CONSTRUCTION" : k === "TF" ? "TIMBER_FRAME" : k === "TRAD" ? "TRADITIONAL" : k;
        }) as BusinessLine[],
      )
    : null;
  if (!path) {
    console.error("usage: tsx scripts/import-rate-sheet.mts <path-to-xlsm> [--dry-run] [--lines=CON,TF]");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) {
    console.error(`No "${SHEET}" sheet in ${path}. Sheets: ${wb.worksheets.map((w) => w.name).join(", ")}`);
    process.exit(1);
  }

  const rows: RateSheetRow[] = [];
  for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
    const g = (c: number) => ws.getRow(r).getCell(c).value;
    const title = str(g(1));
    if (!title) continue;
    rows.push({
      title,
      measure: str(g(3)),
      baseHireWeeks: num(g(4)),
      rate: num(g(5)),
      extraHirePerWeek: num(g(7)),
      extraHireChargePct: num(g(9)),
    });
  }

  const { elements: all, skipped, collisions } = buildImport(rows);
  const elements = wanted ? all.filter((e) => wanted.has(e.line)) : all;

  const byLine: Record<string, number> = {};
  let rateCount = 0;
  let assumed = 0;
  for (const e of elements) {
    byLine[e.line] = (byLine[e.line] ?? 0) + 1;
    rateCount += e.rates.length;
    assumed += e.rates.filter((r) => r.bandAssumed).length;
  }

  console.log(`Read ${rows.length} rows from "${SHEET}"`);
  console.log(`  elements: ${elements.length} ${JSON.stringify(byLine)}`);
  console.log(`  rates:    ${rateCount} (${assumed} copied across bands from an unbanded price)`);
  console.log(`  skipped:  ${skipped.length} (legacy rows are skipped silently)`);
  console.log(`  collisions resolved: ${collisions}`);
  if (skipped.length) {
    console.log("  first skipped:");
    for (const s of skipped.slice(0, 6)) console.log(`    ${s.reason}: ${s.title}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    const sample = elements.filter((e) => e.line === "CONSTRUCTION").slice(0, 5);
    for (const e of sample) {
      console.log(`\n  ${e.name}  [${e.unit}${e.usesLifts ? ", per lift" : ""}, ${e.category}]`);
      for (const r of e.rates.slice(0, 6))
        console.log(
          `     ${r.bracket.padEnd(9)} ${r.band.padEnd(18)} £${r.rate.toFixed(2).padStart(8)}  base ${r.baseHireWeeks}wk  E/H £${r.extraHirePerWeek}/wk @ ${r.extraHireChargePct}%`,
        );
    }
    return;
  }

  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const [i, e] of elements.entries()) {
    const id = `${LINE_PREFIX[e.line]}-${slug(e.family)}`;
    seen.add(id);
    const data = {
      line: e.line as BusinessLine,
      name: e.name,
      category: e.category,
      unit: e.unit,
      usesLifts: e.usesLifts,
      usesHeightBracket: e.usesHeightBracket,
      sourceTitle: e.sourceTitle,
      sortOrder: i * 10,
      isActive: true,
    };
    const existing = await prisma.constructionElement.findUnique({ where: { id } });
    if (existing) {
      await prisma.constructionElement.update({ where: { id }, data });
      updated++;
    } else {
      await prisma.constructionElement.create({ data: { id, ...data, aliases: [] } });
      created++;
    }
    // Rates are fully replaced: the sheet is the source of truth.
    await prisma.constructionRate.deleteMany({ where: { elementId: id } });
    await prisma.constructionRate.createMany({
      data: e.rates.map((r) => ({
        elementId: id,
        band: r.band as RateBand,
        bracket: r.bracket as HeightBracket,
        rate: r.rate,
        baseHireWeeks: r.baseHireWeeks,
        extraHirePerWeek: r.extraHirePerWeek,
        extraHireChargePct: r.extraHireChargePct,
      })),
    });
  }

  // Anything the sheet no longer carries is retired, not deleted: quote lines
  // and past quotes still point at it.
  const retired = await prisma.constructionElement.updateMany({
    where: { id: { notIn: [...seen] }, isActive: true },
    data: { isActive: false },
  });

  console.log(`\nWrote: ${created} created, ${updated} updated, ${rateCount} rates.`);
  console.log(`Retired (no longer in the sheet): ${retired.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
