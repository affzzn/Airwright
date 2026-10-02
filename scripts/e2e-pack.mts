import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { uploadToStorage } from "../src/lib/supabase/storage";
import { getBoss } from "../src/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE, PROCESS_PACK_QUEUE } from "../src/lib/queue/jobs";
import { takeoffInputFromStored } from "../src/lib/takeoff/fromStored";
import { buildTakeoff, type Configuration } from "../src/lib/takeoff/engine";
import { PROMPT_VERSION } from "../src/lib/extract/prompt";

/**
 * End-to-end driver for a tender pack through the REAL (deployed) pipeline — the same
 * steps the app's upload takes, so the deployed worker does the grouping + reads and
 * the results show in the deployed UI (same database):
 *
 *   upload <manifest.json>  create the tender (client, name, build type), upload each file
 *                           to Storage + register it (relative path kept), then queue
 *                           process-pack exactly like startProcessing().
 *   status <packId>         grouping status, proposed house types, read progress.
 *   confirm <packId>        what the "Confirm grouping" button does (queue the reads).
 *   results <packId>        per house type: config, perimeter (semi/mid), apex, birdcage,
 *                           the prompt version that read it, and the review flags.
 *
 * manifest.json: { "project": "...", "client": "...", "buildType": "TRADITIONAL"|"TIMBER_FRAME",
 *                  "root": "<dir the relative paths start from>", "files": ["<abs path>", ...] }
 */
const [, , cmd, arg] = process.argv;

async function upload(manifestPath: string) {
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    project: string; client: string; buildType: "TRADITIONAL" | "TIMBER_FRAME"; root: string; files: string[];
  };
  const client =
    (await prisma.client.findFirst({ where: { name: m.client } })) ??
    (await prisma.client.create({ data: { name: m.client } }));
  const project = await prisma.project.create({
    data: { clientId: client.id, name: m.project, estimatingMode: "HOUSE_BUILD", buildType: m.buildType, packs: { create: { version: 1 } } },
    include: { packs: true },
  });
  const pack = project.packs[0];
  const top = basename(m.root);
  for (const f of m.files) {
    const buf = readFileSync(f);
    const name = basename(f);
    const path = `${pack.id}/raw/${randomUUID()}-${name}`;
    for (let attempt = 1; ; attempt++) {
      try {
        await uploadToStorage(path, buf, "application/pdf", { upsert: true });
        break;
      } catch (err) {
        if (attempt >= 4) throw err; // a flaky upload must not strand a half-made pack
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    await prisma.packUpload.create({
      data: { packId: pack.id, fileName: name, relativePath: `${top}/${relative(m.root, f)}`, storagePath: path, mimeType: "application/pdf", sizeBytes: buf.byteLength, isArchive: false },
    });
  }
  const boss = await getBoss();
  await boss.send(PROCESS_PACK_QUEUE, { packId: pack.id });
  console.log(`project=${project.id} pack=${pack.id} files=${m.files.length} buildType=${m.buildType} → process-pack queued`);
  await boss.stop();
}

async function status(packId: string) {
  const pack = await prisma.tenderPack.findUniqueOrThrow({ where: { id: packId } });
  const gd = (pack.groupingData ?? {}) as { builderLabel?: string; groups?: { name: string; confidence?: string; relevantPageCount?: number; files?: unknown[] }[] };
  const uploads = await prisma.packUpload.groupBy({ by: ["status"], where: { packId }, _count: true });
  const ex = await prisma.extraction.findMany({ where: { document: { packId } }, select: { status: true, promptVersion: true, houseType: { select: { name: true } } } });
  console.log(`grouping=${pack.groupingStatus ?? "—"} builder=${gd.builderLabel ?? "—"} uploads=${uploads.map((u) => `${u.status}:${u._count}`).join(",")}`);
  for (const g of gd.groups ?? []) console.log(`  group: ${g.name} [${g.confidence ?? "-"}] ${g.relevantPageCount ?? "?"} pages, ${g.files?.length ?? "?"} files`);
  const by = (s: string) => ex.filter((e) => e.status === s).length;
  console.log(`reads: ${ex.length} total · pending ${by("PENDING")} · processing ${by("PROCESSING")} · completed ${by("COMPLETED")} · failed ${by("FAILED")}`);
  for (const e of ex) console.log(`  ${e.status.padEnd(10)} ${e.promptVersion.padEnd(13)} ${e.houseType?.name ?? "?"}`);
}

async function confirm(packId: string) {
  const pack = await prisma.tenderPack.findUniqueOrThrow({ where: { id: packId } });
  if (pack.groupingStatus !== "PROPOSED") return console.log(`not PROPOSED (${pack.groupingStatus}) — nothing to confirm`);
  const pending = await prisma.extraction.findMany({ where: { status: "PENDING", document: { packId } }, select: { id: true, documentId: true, pageRange: true } });
  const boss = await getBoss();
  for (const e of pending) await boss.send(EXTRACT_DRAWING_QUEUE, { documentId: e.documentId, extractionId: e.id, pageRange: e.pageRange });
  await prisma.tenderPack.update({ where: { id: packId }, data: { groupingStatus: "CONFIRMED" } });
  console.log(`confirmed — ${pending.length} reads queued`);
  await boss.stop();
}

async function results(packId: string) {
  const pack = await prisma.tenderPack.findUniqueOrThrow({ where: { id: packId }, include: { project: true } });
  const bt = pack.project.buildType;
  const ex = await prisma.extraction.findMany({
    where: { document: { packId }, status: "COMPLETED" },
    select: { promptVersion: true, houseType: { include: { takeoff: { include: { measurements: true, wallSegments: true } } } } },
  });
  console.log(`${pack.project.name} (${bt}) — expected prompt ${PROMPT_VERSION}`);
  for (const e of ex) {
    const t = e.houseType?.takeoff;
    if (!t) continue;
    const w = (t.warnings ?? {}) as Record<string, unknown>;
    const line = (c: Configuration) => buildTakeoff(takeoffInputFromStored(t.measurements, t.wallSegments, w as never, c, bt));
    const cfg = line(t.configuration as Configuration);
    const semi = line("SEMI_DETACHED");
    const mid = line("MID_TERRACE");
    const walls = t.wallSegments.map((x) => `${x.position[0]}${x.position.includes("LEFT") ? "L" : x.position.includes("RIGHT") ? "R" : ""}=${x.lengthM}${x.isPartyWall ? "P" : ""}`).join(" ");
    const fr = (w.frontageResolution ?? {}) as { declared?: number; divisor?: number };
    console.log(`\n■ ${e.houseType!.name}  [${e.promptVersion}]  structure=${w.structure ?? "?"} config=${t.configuration}`);
    console.log(`  walls ${walls} · frontage read ${fr.declared ?? "?"} → ÷${fr.divisor ?? "?"} · storeys ${t.measurements.find((m) => m.key === "STOREYS")?.valueNumber ?? "?"} · lifts ${cfg.lifts.lifts}`);
    console.log(`  semi ${semi.perimeter.perLiftM} m/lift · mid ${mid.perimeter.perLiftM} · apex(${t.configuration}) ${cfg.apex.count} · birdcage ${cfg.birdcage.totalM2} m² (${cfg.birdcage.floorCount} fl)${cfg.adaptions ? ` · TF adaptions IB ${cfg.adaptions.insideBoardLM} / HU ${cfg.adaptions.hopUpLM}` : ""}`);
    for (const f of cfg.flags) console.log(`  ⚑ ${f.slice(0, 150)}`);
  }
}

const run = { upload, status, confirm, results }[cmd as "upload"];
if (!run || !arg) {
  console.error("usage: e2e-pack.mts upload|status|confirm|results <arg>");
  process.exit(1);
}
await run(arg);
await prisma.$disconnect();
process.exit(0);
