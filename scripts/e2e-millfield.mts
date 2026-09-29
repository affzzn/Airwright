import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { uploadToStorage } from "../src/lib/supabase/storage";
import { processPack } from "../src/worker/processPack";

/**
 * End-to-end: one Miller drawing (Millfield, Whitford Road) through the REAL pipeline —
 * a new tender like the create form makes, the upload exactly as the app registers it,
 * then processPack (ingest → classify → grouping → queue the read). The read itself is
 * done by whichever worker takes the job: run `npm run worker` locally first. The
 * stored `promptVersion` says which code read it.
 *
 *   npx tsx scripts/e2e-millfield.mts
 */
const FILE =
  "data/816125 Whitford Road, Bromsgrove - Scaffolding Enquiry - WestMids_24 02 2026(2) 2/20. B12 Millfield Bungalow_Combined Working Drawings.pdf";

async function main() {
  const client =
    (await prisma.client.findFirst({ where: { name: "Miller Homes (Whitford Road)" } })) ??
    (await prisma.client.create({ data: { name: "Miller Homes (Whitford Road)" } }));
  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: `E2E Millfield ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      estimatingMode: "HOUSE_BUILD",
      buildType: "TRADITIONAL",
      packs: { create: { version: 1 } },
    },
    include: { packs: true },
  });
  const pack = project.packs[0];
  console.log(`project=${project.id} pack=${pack.id}`);

  const name = basename(FILE);
  const buf = readFileSync(FILE);
  const path = `${pack.id}/raw/${randomUUID()}-${name}`;
  await uploadToStorage(path, buf, "application/pdf", { upsert: true });
  await prisma.packUpload.create({
    data: {
      packId: pack.id,
      fileName: name,
      relativePath: name,
      storagePath: path,
      mimeType: "application/pdf",
      sizeBytes: buf.byteLength,
      isArchive: false,
    },
  });
  console.log(`uploaded ${name} (${(buf.byteLength / 1e6).toFixed(1)} MB)`);

  const t = Date.now();
  await processPack(pack.id);
  const after = await prisma.tenderPack.findUnique({ where: { id: pack.id } });
  console.log(`processPack done in ${((Date.now() - t) / 1000).toFixed(0)}s — groupingStatus ${after?.groupingStatus}`);
  const ex = await prisma.extraction.findMany({
    where: { document: { packId: pack.id } },
    select: { id: true, pageRange: true, status: true, houseType: { select: { name: true, code: true } } },
  });
  for (const e of ex) console.log(`  queued read: ${e.houseType?.name} (${e.houseType?.code ?? "-"}) pages ${e.pageRange} [${e.status}] ${e.id}`);
  console.log(`\nOPEN IN UI: http://localhost:3000/projects/${project.id}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
