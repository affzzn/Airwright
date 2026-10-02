import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { uploadToStorage } from "../src/lib/supabase/storage";
import { processPack } from "../src/worker/processPack";
import { saveToBank, holdBankRepeats } from "../src/server/bank";
import { ensureDefaultPlot } from "../src/server/plots";

/**
 * House bank v2 — end-to-end on the REAL database, in-process (docs/20). Everything it
 * creates is KEPT so it can be checked in the UI. Phases:
 *
 *   npx tsx scripts/e2e-bank.mts seed       confirm + "Save to house bank" a set of the
 *                                           29 Sep take-offs (Traditional + Timber-Frame)
 *   npx tsx scripts/e2e-bank.mts repeat     a NEW tender for a DIFFERENT builder with the
 *                                           same Miller drawings → processPack → repeats HELD
 *   npx tsx scripts/e2e-bank.mts tf         a Timber-Frame repeat (Earl Shilton uploads,
 *                                           grouped path → confirm the grouping in the UI)
 *   npx tsx scripts/e2e-bank.mts variant    "Denton-XYZ" (no code) under another builder
 *   npx tsx scripts/e2e-bank.mts status     what is in the bank + what each test tender shows
 *
 * processPack runs here (this checkout's code), so a HELD read is never put on the queue.
 * A read that is NOT held IS queued and is taken by whichever worker is running.
 */

const WHITFORD_DIR = "data/816125 Whitford Road, Bromsgrove - Scaffolding Enquiry - WestMids_24 02 2026(2) 2";
const WHITFORD = "cmumymlvs0001it8zax39v5jl"; // E2E Whitford Road (29 Sep) — Miller Homes (Whitford Road)
const EARL_SHILTON = "cmumxft5m0001it36ztu3esj8"; // E2E Earl Shilton TF (29 Sep) — Vistry South East Midlands
const TOP_WIGHAY = "cmumxysl60001itxtm7hvyyss"; // E2E Top Wighay (29 Sep) — Vistry South East Midlands

async function confirmAndSave(projectId: string, name: string, code?: string | null) {
  const ht = await prisma.houseType.findFirst({
    where: { projectId, name, ...(code !== undefined ? { code } : {}) },
    select: { id: true, name: true, code: true, bankMatchState: true, takeoff: { select: { id: true, status: true } } },
  });
  if (!ht?.takeoff) throw new Error(`no take-off for ${name} in ${projectId}`);
  // Exactly what the Confirm button writes (confirmTakeoff — which needs a signed-in
  // request, so it can't be called from a script): lock it + the default plot.
  if (ht.takeoff.status !== "CONFIRMED") {
    await prisma.takeoff.update({ where: { id: ht.takeoff.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
    await ensureDefaultPlot(ht.id);
  }
  const after = await prisma.houseType.findUnique({ where: { id: ht.id }, select: { bankEntryId: true } });
  if (after?.bankEntryId && ht.bankMatchState !== "SAVED")
    throw new Error(`FAIL: confirming ${name} put it in the bank — it must not`);
  if (ht.bankMatchState === "SAVED") {
    console.log(`  = ${name} already saved`);
    return;
  }
  const res = await saveToBank(ht.takeoff.id, { kind: "NEW_ENTRY" });
  if (!res.ok) throw new Error(`save ${name}: ${res.error}`);
  console.log(`  + ${name}${ht.code ? ` (${ht.code})` : ""} → bank v${res.version}`);
}

async function newTender(builder: string, name: string, buildType: "TRADITIONAL" | "TIMBER_FRAME") {
  const client =
    (await prisma.client.findFirst({ where: { name: { equals: builder, mode: "insensitive" } } })) ??
    (await prisma.client.create({ data: { name: builder } }));
  return prisma.project.create({
    data: { clientId: client.id, name, estimatingMode: "HOUSE_BUILD", buildType, packs: { create: { version: 1 } } },
    include: { packs: true },
  });
}

async function uploadFile(packId: string, file: string) {
  const name = basename(file);
  const buf = readFileSync(file);
  const path = `${packId}/raw/${randomUUID()}-${name}`;
  await uploadToStorage(path, buf, "application/pdf", { upsert: true });
  await prisma.packUpload.create({
    data: { packId, fileName: name, relativePath: name, storagePath: path, mimeType: "application/pdf", sizeBytes: buf.byteLength, isArchive: false },
  });
}

async function report(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      client: { select: { name: true } },
      packs: { select: { groupingStatus: true } },
      houseTypes: {
        select: {
          name: true,
          code: true,
          bankMatchState: true,
          bankVersion: { select: { version: true, bankEntry: { select: { canonicalName: true } } } },
          takeoff: { select: { status: true } },
          extractions: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!p) return;
  console.log(`\n${p.name} [${p.client.name}] grouping=${p.packs[0]?.groupingStatus} — http://localhost:3100/projects/${projectId}`);
  for (const h of p.houseTypes) {
    const ex = h.extractions[0];
    const bank = h.bankVersion ? ` · ${h.bankMatchState} ${h.bankVersion.bankEntry.canonicalName} v${h.bankVersion.version}` : "";
    console.log(`  - ${h.name}${h.code ? ` (${h.code})` : ""}: read=${ex?.status ?? "—"} take-off=${h.takeoff?.status ?? "—"}${bank}`);
  }
}

async function queuedJobsFor(extractionIds: string[]): Promise<number> {
  if (extractionIds.length === 0) return 0;
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint as n from pgboss.job where name = 'extract-drawing' and data->>'extractionId' = any($1)`,
    extractionIds,
  );
  return Number(rows[0]?.n ?? 0);
}

const phase = process.argv[2];

if (phase === "seed") {
  console.log("Seeding the bank from the 29 Sep tenders (Confirm, then Save to house bank):");
  for (const n of ["Millfield", "Delmont", "Whitton", "Hayton", "Taywood (AL40)"]) await confirmAndSave(WHITFORD, n);
  await confirmAndSave(EARL_SHILTON, "Curlew", "CURLEW-H2B-2B3P-781-N-2-ST");
  for (const n of ["B5", "Jackdaw"]) await confirmAndSave(EARL_SHILTON, n);
  for (const n of ["The Trent", "The Sowe"]) await confirmAndSave(TOP_WIGHAY, n);
} else if (phase === "repeat") {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const project = await newTender("Bloor Homes (bank test)", `Bank test — repeat Miller drawings, other builder ${stamp}`, "TRADITIONAL");
  const pack = project.packs[0];
  const files = [
    "11. 250814 Denton (L356).pdf",
    "9. 250813 Charford (L356 DT).pdf",
    "20. B12 Millfield Bungalow_Combined Working Drawings.pdf",
    "25. L255_Delmont_Combined Working Drawings.pdf",
    "31. L463_Cherrywood_Combined Working Drawings.pdf",
  ];
  for (const f of files) await uploadFile(pack.id, `${WHITFORD_DIR}/${f}`);
  console.log(`project ${project.id}: uploaded ${files.length} files — processing (this checkout's code)…`);
  await processPack(pack.id);
  const ex = await prisma.extraction.findMany({ where: { houseType: { projectId: project.id } }, select: { id: true, status: true } });
  const held = ex.filter((e) => e.status === "HELD").map((e) => e.id);
  const queuedForHeld = await queuedJobsFor(held);
  console.log(`held ${held.length} of ${ex.length}; queue jobs for the held reads: ${queuedForHeld} (must be 0)`);
  if (queuedForHeld !== 0) throw new Error("FAIL: a held read was queued");
  await report(project.id);
} else if (phase === "tf") {
  const src = await prisma.tenderPack.findFirst({ where: { projectId: EARL_SHILTON }, select: { uploads: true } });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const project = await newTender("VISTRY south east midlands", `Bank test — Timber frame repeat ${stamp}`, "TIMBER_FRAME");
  const pack = project.packs[0];
  for (const u of src!.uploads) {
    await prisma.packUpload.create({
      data: { packId: pack.id, fileName: u.fileName, relativePath: u.relativePath, storagePath: u.storagePath, mimeType: u.mimeType, sizeBytes: u.sizeBytes, isArchive: u.isArchive },
    });
  }
  console.log(`project ${project.id} (builder typed in another case → same client?): ${src!.uploads.length} uploads — processing…`);
  await processPack(pack.id);
  await report(project.id);
} else if (phase === "variant") {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const project = await newTender("Persimmon Homes (bank test)", `Bank test — Denton-XYZ name variant ${stamp}`, "TRADITIONAL");
  await uploadFile(project.packs[0].id, `${WHITFORD_DIR}/11. 250814 Denton (L356).pdf`);
  // Classify + segment without the bank check first, so the name can be changed to the
  // variant before the check runs (as if the title block had said "Denton-XYZ").
  await processPack(project.packs[0].id);
  const ht = await prisma.houseType.findFirstOrThrow({ where: { projectId: project.id }, include: { extractions: true } });
  await prisma.houseType.update({ where: { id: ht.id }, data: { name: "Denton-XYZ", code: null } });
  await prisma.extraction.updateMany({ where: { houseTypeId: ht.id, status: "HELD" }, data: { status: "PENDING" } });
  const { held } = await holdBankRepeats(ht.extractions.map((e) => e.id));
  console.log(`"Denton-XYZ" (no code, builder Persimmon) held for the bank: ${held.size === 1 ? "YES" : "NO"}`);
  if (held.size !== 1) throw new Error("FAIL: Denton-XYZ was not matched");
  await report(project.id);
} else if (phase === "status") {
  const entries = await prisma.houseTypeBankEntry.findMany({
    include: { client: { select: { name: true } }, versions: { select: { version: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`House bank: ${entries.length} house types`);
  for (const e of entries)
    console.log(`  ${e.canonicalName}${e.canonicalCode ? ` (${e.canonicalCode})` : ""} · ${e.client.name} · ${e.buildType} · v${e.versions.map((v) => v.version).join(",v")}${e.aliases.length ? ` · aliases ${e.aliases.join(" | ")}` : ""}`);
  const tests = await prisma.project.findMany({ where: { name: { startsWith: "Bank test" } }, select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const t of tests) await report(t.id);
} else {
  console.log("phase: seed | repeat | tf | variant | status");
}
await prisma.$disconnect();
process.exit(0); // the queue connection (processPack) would keep the script alive
