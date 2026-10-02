/**
 * End-to-end check of scope mode + output (docs/22 M3–M4) against the REAL
 * database and storage, IN-PROCESS (never through the queue, so the deployed
 * worker cannot take the job with old code).
 *
 *   npx tsx scripts/e2e-scope.mts --job <quoteId> [--resort]      re-read an existing job (saved reads reused;
 *                                                                 --resort first re-sorts it, e.g. after a box rule change)
 *   npx tsx scripts/e2e-scope.mts "<folder>" [--keep] [--cache f]  upload + sort + read a pack as a new job
 *
 * Then: prints the measurement sheet (keys + source sheets), the draft lines with
 * their status / formula / flags, the information list, the empty sections and
 * the scope account; applies the draft (the real server action); prices it;
 * builds Airwright's sections; writes all three Excel outputs to --out (default:
 * the OS temp dir) and reads the client template back.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { uploadToStorage, downloadFromStorage } from "@/lib/supabase/storage";
import { mimeTypeFor } from "@/lib/construction/pack/files";
import { ingestConstructionQuote } from "@/server/constructionPack";
import { runConstructionRead } from "@/server/constructionRead";
import { applyDrawingDraft } from "@/server/actions/constructionDrawings";
import { loadConstructionQuote, priceLoadedQuote } from "@/server/construction";
import { buildQuoteSections } from "@/lib/construction/sections";
import { fillClientTemplate } from "@/lib/construction/clientTemplateExcel";
import { lineAmount, lineExtraHirePerWeek } from "@/lib/construction/price";
import type { ConstructionUnit } from "@/lib/construction/types";

const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const jobArg = val("--job");
const root = jobArg ? null : args.find((a) => !a.startsWith("--") && a !== val("--cache") && a !== val("--out"));
const cacheFile = val("--cache");
const outDir = val("--out") ?? tmpdir();
const keep = args.includes("--keep") || Boolean(jobArg);

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
/** Server actions end with revalidatePath, which needs a Next request; the writes are done by then. */
async function action<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (/static generation store missing/.test((e as Error).message)) return null;
    throw e;
  }
}

async function main() {
  let quoteId = jobArg ?? "";
  const uploaded: string[] = [];
  if (jobArg && args.includes("--resort")) {
    const s = await ingestConstructionQuote(jobArg);
    console.log(`re-sorted ${jobArg}: scenario ${s.mode}, buildings ${s.buildings.join(" · ") || "none"}`, s.counts);
  }
  if (!jobArg) {
    const top = basename(root!);
    const q = await prisma.constructionQuote.create({ data: { reference: `E2E ${top}`, customerName: "e2e test" } });
    quoteId = q.id;
    for (const p of walk(root!)) {
      const name = basename(p);
      const path = `construction/${quoteId}/${randomUUID()}-${name.replace(/[^A-Za-z0-9._ ()-]/g, "_")}`;
      const bytes = readFileSync(p);
      await uploadToStorage(path, bytes, mimeTypeFor(name), { upsert: true });
      uploaded.push(path);
      await prisma.constructionAttachment.create({
        data: { quoteId, fileName: name, relativePath: `${top}/${relative(root!, p)}`, storagePath: path, mimeType: mimeTypeFor(name), sizeBytes: bytes.byteLength },
      });
    }
    const s = await ingestConstructionQuote(quoteId);
    console.log(`job ${quoteId}: ${uploaded.length} files, mode ${s.mode}, buildings ${s.buildings.join(" · ")}`);
    if (cacheFile && existsSync(cacheFile)) {
      const cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, { read: unknown; raw: unknown }>;
      const q1 = await prisma.constructionQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { sheets: true, attachments: true } });
      let seeded = 0;
      for (const sh of q1.sheets) {
        const att = q1.attachments.find((a) => a.id === sh.attachmentId)!;
        const hit = Object.entries(cache).filter(([k]) => k.startsWith(`${att.contentHash}|p${sh.page}|`)).at(-1);
        if (!hit) continue;
        await prisma.constructionSheet.update({ where: { id: sh.id }, data: { readStatus: "READ", readKey: hit[0], readRawOutput: hit[1] as never, readKind: hit[0].split("|")[3] } });
        seeded++;
      }
      console.log(`seeded ${seeded} cached sheet reads`);
    }
  }

  try {
    const run = await prisma.constructionReadRun.create({ data: { quoteId } });
    const t0 = Date.now();
    const r = await runConstructionRead(run.id);
    console.log(`\nread in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${r.sheetsRead} new, ${r.sheetsReused} reused, ${r.sheetsFailed} failed, $${r.costUsd}`);

    // Save every paid read to the cache file, so a re-run never pays twice.
    if (cacheFile) {
      const cache: Record<string, unknown> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
      const sheets = await prisma.constructionSheet.findMany({ where: { quoteId, readStatus: "READ" } });
      for (const sh of sheets) if (sh.readKey) cache[sh.readKey] = sh.readRawOutput;
      writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`cache: ${Object.keys(cache).length} reads in ${cacheFile}`);
    }

    const quote = await prisma.constructionQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { buildings: true } });
    const bName = new Map(quote.buildings.map((b) => [b.id, b.name]));
    const meas = await prisma.constructionMeasurement.findMany({ where: { quoteId, runId: run.id }, orderBy: { sortOrder: "asc" } });
    console.log(`\n--- measurement sheet (${meas.length}) ---`);
    for (const m of meas) {
      const refs = Array.isArray(m.sheetRefs) ? (m.sheetRefs as { title: string; page: number }[]) : [];
      console.log(
        `  ${(bName.get(m.buildingId ?? "") ?? "—").slice(0, 16).padEnd(16)} [${(m.confidence ?? "").padEnd(6)}] ${(m.key ?? "").padEnd(22)} ${m.label.slice(0, 58).padEnd(58)} ${Number(m.valueNumber)} ${m.unit ?? ""}${m.lifts ? ` · ${m.lifts} lifts` : ""}  ⇐ ${refs.map((x) => x.title.slice(0, 24)).join(", ") || "(no sheet)"}`,
      );
    }
    assert(meas.every((m) => m.key), "every measurement has a key");
    if (meas.length)
      assert(meas.some((m) => Array.isArray(m.sheetRefs) && (m.sheetRefs as unknown[]).length > 0), "measurements link to their source sheets");
    else console.log("  (no measurements — nothing measurable on these drawings)");

    console.log(`\n--- draft lines (${r.draftLines.length}) ---`);
    for (const l of r.draftLines)
      console.log(
        `  ${(l.status ?? "").padEnd(15)} ${(bName.get(l.buildingId ?? "") ?? "job").slice(0, 14).padEnd(14)} ${(l.section ?? "").slice(0, 20).padEnd(20)} ${l.description.slice(0, 34).padEnd(34)} q=${l.quantity ?? "—"} lifts=${l.lifts ?? "—"} hire=${l.hireWeeks ?? "—"}\n` +
          `${"".padEnd(18)}“${l.clientRef?.text ?? ""}” ${l.formula ? `→ ${l.formula}` : ""}${(l.flags ?? []).filter((f) => !/placeholder/.test(f)).map((f) => `\n${"".padEnd(18)}! ${f}`).join("")}`,
      );
    if (r.info?.length) console.log(`\n--- information (not priced) ---\n${r.info.map((i) => `  ${i.buildingName ?? ""}: ${i.label} = ${i.value}`).join("\n")}`);
    if (r.emptySections?.length) console.log(`\nEMPTY SECTIONS: ${r.emptySections.join(", ")}`);
    if (r.account) console.log(`ACCOUNT: ${JSON.stringify(r.account)}`);
    if (r.draftFlags.length) console.log(`FLAGS:\n${r.draftFlags.map((f) => `  - ${f}`).join("\n")}`);

    if (r.account) {
      const a = r.account;
      assert(a.measured + a.stated + a.agrees + a.differs + a.measureByHand + a.unknownBasis + a.needsItem === a.scopeLines, "every scope line accounted for");
    }

    // A second run: every sheet and the scope read are reused — nothing billed.
    const run2 = await prisma.constructionReadRun.create({ data: { quoteId } });
    const r2 = await runConstructionRead(run2.id);
    assert(r2.sheetsRead === 0 && r2.costUsd === 0, "a re-run reads nothing new and costs nothing (sheets + scope cached)");
    assert(r2.draftLines.length === r.draftLines.length, "a re-run drafts the same lines");

    // Apply the draft through the real action, replacing anything an earlier test applied.
    if (r.draftLines.length) {
      const res = await action(
        applyDrawingDraft(quoteId, {
          lines: r.draftLines.filter((l) => l.elementId).map((l) => ({ ...l, hireWeeks: l.hireWeeks ?? null })),
          measurements: [],
          replaceDrafted: true,
        }),
      );
      if (res && !res.ok) throw new Error(res.error);
      const saved = await prisma.constructionQuoteLine.findMany({ where: { quoteId } });
      assert(saved.length >= r.draftLines.filter((l) => l.elementId).length, `applied ${saved.length} lines`);
      const derivable = r.draftLines.filter((l) => l.elementId && l.formula).length;
      assert(saved.filter((l) => l.formula).length === derivable && saved.every((l) => l.isAuto), `applied lines keep their formula (${derivable})`);
      const again = await action(applyDrawingDraft(quoteId, { lines: r.draftLines.filter((l) => l.elementId), measurements: [], replaceDrafted: true }));
      void again;
      assert((await prisma.constructionQuoteLine.count({ where: { quoteId } })) === saved.length, "re-applying with replace does not duplicate");
    }

    // Price + sections + the three outputs.
    const vm = (await loadConstructionQuote(quoteId))!;
    const pricing = priceLoadedQuote(vm);
    const sections = buildQuoteSections(vm.lines.map((l) => ({ ...l, unit: l.unit as ConstructionUnit })), {
      buildings: vm.buildings,
      jobWeeks: vm.durationWeeks,
      hireInPrice: pricing.hireIncluded,
    });
    console.log(`\n--- quote: £${pricing.total.toFixed(2)} (placeholder rates) in ${sections.length} sections ---`);
    for (const s of sections) console.log(`  ${s.title.padEnd(48)} £${s.price.toFixed(2).padStart(10)}  hire ${s.hireWeeks ?? "—"} wk  extra £${s.extraHirePerWeek ?? 0}/wk\n${"".padEnd(4)}Includes for; ${s.includes.join(". ")}`);
    const sum = sections.reduce((a, s) => a + Math.round(s.price * 100), 0) / 100;
    assert(Math.abs(sum - pricing.total) < 0.005, "sections reconcile to the quote total");

    if (vm.clientTemplate) {
      const t = vm.clientTemplate.tables[0];
      const att = await prisma.constructionAttachment.findUniqueOrThrow({ where: { id: t.attachmentId } });
      const filled = await fillClientTemplate(
        await downloadFromStorage(att.storagePath),
        vm.clientTemplate.tables.filter((x) => x.attachmentId === t.attachmentId),
        vm.lines.map((l) => {
          const p = { unit: l.unit as ConstructionUnit, quantity: l.quantity, lifts: l.lifts, rate: l.rate, baseHireWeeks: l.baseHireWeeks, extraHirePerWeek: l.extraHirePerWeek, extraHireChargePct: l.extraHireChargePct, durationWeeks: l.durationWeeks };
          return { description: l.description, unit: l.unit, quantity: l.quantity, lifts: l.lifts, durationWeeks: l.durationWeeks, rate: l.rate, cost: lineAmount(p), extraHirePerWeek: lineExtraHirePerWeek(p), heightM: vm.buildingHeightM, sheet: l.clientRef?.sheet ?? null, rowRef: l.clientRef?.rowRef ?? null };
        }),
        { noneRequired: ["Birdcages"], notes: ["e2e"], reference: vm.reference },
      );
      const file = join(outDir, `e2e-client-template-${quoteId}.xlsx`);
      writeFileSync(file, Buffer.from(filled.bytes as ArrayBuffer));
      console.log(`\nclient template: ${filled.filledRows} rows filled, ${filled.unplaced.length} lines not on the schedule → ${file}`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const ws = wb.getWorksheet(t.sheet)!;
      for (const row of [12, 13, 14, 16, 19, 32, 35, 49].filter((r) => r <= ws.rowCount)) {
        const cells: string[] = [];
        ws.getRow(row).eachCell((c) => cells.push(`${c.address}=${typeof c.value === "object" && c.value ? JSON.stringify(c.value).slice(0, 40) : c.value}`));
        console.log(`  row ${row}: ${cells.join(" | ")}`);
      }
      assert(filled.filledRows > 0, "the client's own workbook has our figures in its rows");
      assert(wb.getWorksheet("Airwright notes") != null, "a notes sheet is added");
    }
    console.log(`\njob kept: ${quoteId}`);
  } finally {
    if (!keep) {
      await prisma.constructionQuote.delete({ where: { id: quoteId } });
      const sb = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
      const extra = await sb.storage.from(env.storageBucket).list(`construction/${quoteId}`, { limit: 1000 });
      const all = [...new Set([...uploaded, ...(extra.data ?? []).map((o) => `construction/${quoteId}/${o.name}`)])];
      for (let i = 0; i < all.length; i += 100) await sb.storage.from(env.storageBucket).remove(all.slice(i, i + 100));
      console.log(`cleaned up job + ${all.length} stored files`);
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
