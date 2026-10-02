/**
 * End-to-end check of the construction pack pipeline against the REAL database and
 * storage, IN-PROCESS (the worker handlers are called directly, never through the
 * queue — so the deployed worker can never pick the job up with old code).
 *
 *   npx tsx scripts/e2e-construction.mts "<folder>" [--cache <offline read cache>] [--keep]
 *
 * 1. creates a job, uploads every file under the folder to Storage as the browser
 *    would (folder paths kept) and registers them;
 * 2. sorts the pack (ingestConstructionQuote) and prints the register;
 * 3. seeds sheet reads already paid for in the offline cache (so nothing is billed
 *    twice — and the "reuse an unchanged sheet" path is exercised);
 * 4. runs the read (runConstructionRead) and prints the saved measurements;
 * 5. asserts the tables line up, then deletes everything it created (unless --keep).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { uploadToStorage } from "@/lib/supabase/storage";
import { mimeTypeFor, junkReason } from "@/lib/construction/pack/files";
import { ingestConstructionQuote } from "@/server/constructionPack";
import { runConstructionRead } from "@/server/constructionRead";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"))!;
const cacheFile = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : null;
const keep = args.includes("--keep");

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

async function main() {
  const top = basename(root);
  const quote = await prisma.constructionQuote.create({ data: { reference: `E2E ${top}`, customerName: "e2e test" } });
  console.log(`job ${quote.id}`);
  const uploaded: string[] = [];
  try {
    // 1. Upload + register (as the browser does: any file type, folder paths kept).
    for (const p of walk(root)) {
      const rel = `${top}/${relative(root, p)}`;
      const name = basename(p);
      const path = `construction/${quote.id}/${randomUUID()}-${name.replace(/[^A-Za-z0-9._ ()-]/g, "_")}`;
      const bytes = readFileSync(p);
      await uploadToStorage(path, bytes, mimeTypeFor(name), { upsert: true });
      uploaded.push(path);
      await prisma.constructionAttachment.create({
        data: { quoteId: quote.id, fileName: name, relativePath: rel, storagePath: path, mimeType: mimeTypeFor(name), sizeBytes: bytes.byteLength },
      });
    }
    console.log(`uploaded ${uploaded.length} files`);

    // 2. Sort.
    const t0 = Date.now();
    const s = await ingestConstructionQuote(quote.id);
    console.log(`sorted in ${((Date.now() - t0) / 1000).toFixed(1)} s: mode ${s.mode}, buildings ${s.buildings.join(" · ")}`, s.counts);
    const q1 = await prisma.constructionQuote.findUniqueOrThrow({ where: { id: quote.id }, include: { sheets: true, buildings: true, attachments: true } });
    assert(q1.ingestStatus === "DONE", "ingest status DONE");
    assert(q1.attachments.every((a) => a.bucket != null), "every file has a bucket");
    assert(q1.attachments.filter((a) => junkReason(a.relativePath ?? a.fileName)).every((a) => a.bucket === "JUNK"), "junk files are JUNK");
    assert(q1.sheets.filter((x) => x.bucket === "CORE").every((x) => x.geometry != null || !x.hasText), "every vector core sheet has geometry");
    assert(q1.buildings.length === s.buildings.length, "buildings saved");

    // Re-sort is idempotent: same rows, ids kept.
    const before = q1.sheets.map((x) => x.id).sort().join();
    await ingestConstructionQuote(quote.id);
    const again = await prisma.constructionSheet.findMany({ where: { quoteId: quote.id } });
    assert(again.map((x) => x.id).sort().join() === before, "re-sorting keeps the same sheet rows");

    // 3. Seed reads already paid for.
    if (cacheFile && existsSync(cacheFile)) {
      const cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, { read: unknown; raw: unknown }>;
      let seeded = 0;
      for (const sh of q1.sheets) {
        const att = q1.attachments.find((a) => a.id === sh.attachmentId)!;
        const hit = Object.entries(cache).filter(([k]) => k.startsWith(`${att.contentHash}|p${sh.page}|`)).at(-1);
        if (!hit) continue;
        await prisma.constructionSheet.update({
          where: { id: sh.id },
          data: { readStatus: "READ", readKey: hit[0], readRawOutput: hit[1] as never, readKind: hit[0].split("|")[3] },
        });
        seeded++;
      }
      console.log(`seeded ${seeded} cached sheet reads`);
    }

    // 4. Read.
    const run = await prisma.constructionReadRun.create({ data: { quoteId: quote.id } });
    const t1 = Date.now();
    const r = await runConstructionRead(run.id);
    console.log(`read in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${r.sheetsRead} new, ${r.sheetsReused} reused, ${r.sheetsFailed} failed, $${r.costUsd}`);
    const done = await prisma.constructionReadRun.findUniqueOrThrow({ where: { id: run.id } });
    assert(done.status === "DONE", "run DONE");
    const meas = await prisma.constructionMeasurement.findMany({
      where: { quoteId: quote.id },
      include: { building: true },
      orderBy: { sortOrder: "asc" },
    });
    assert(meas.length > 0, "measurements saved");
    assert(meas.every((m) => m.runId === run.id && m.source === "DRAWING"), "every measurement is tagged with the run");
    for (const m of meas)
      console.log(`  ${(m.building?.name ?? "—").padEnd(18)} [${(m.confidence ?? "").padEnd(6)}] ${m.label.padEnd(56)} ${Number(m.valueNumber)} ${m.unit ?? ""}${m.lifts ? ` · ${m.lifts} lifts` : ""}`);
    if (r.draftLines.length) console.log(`draft lines: ${r.draftLines.map((l) => `${l.description} ${l.quantity ?? "?"}×${l.lifts ?? "-"}`).join(" | ")}`);

    // A second run reuses every sheet and replaces (not duplicates) the measurements.
    const run2 = await prisma.constructionReadRun.create({ data: { quoteId: quote.id } });
    const r2 = await runConstructionRead(run2.id);
    assert(r2.sheetsRead === 0 && r2.costUsd === 0, "a second run reads nothing new and costs nothing");
    const meas2 = await prisma.constructionMeasurement.count({ where: { quoteId: quote.id } });
    assert(meas2 === meas.length, "measurements replaced, not duplicated");
  } finally {
    if (!keep) {
      await prisma.constructionQuote.delete({ where: { id: quote.id } });
      const sb = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
      const extra = await sb.storage.from(env.storageBucket).list(`construction/${quote.id}`, { limit: 1000 });
      const all = [...new Set([...uploaded, ...(extra.data ?? []).map((o) => `construction/${quote.id}/${o.name}`)])];
      for (let i = 0; i < all.length; i += 100) await sb.storage.from(env.storageBucket).remove(all.slice(i, i + 100));
      console.log(`cleaned up job + ${all.length} stored files`);
    } else console.log(`kept job ${quote.id}`);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
