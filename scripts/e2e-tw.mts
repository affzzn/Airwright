import { config } from "dotenv";
config({ path: ".env.local" });
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { uploadToStorage } from "../src/lib/supabase/storage";
import { processPack } from "../src/worker/processPack";

const SRC = "data/first-ones-sent/TAYLOR WIMPEY NORTH MIDS PERRYFIELDS 2B";
const PACK_NAME = basename(SRC);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".")) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.pdf$/i.test(n)) out.push(f);
  }
  return out;
}

async function main() {
  const client = await prisma.client.findFirst({ orderBy: { createdAt: "asc" } });
  if (!client) throw new Error("no client in DB");
  const project = await prisma.project.create({
    data: { clientId: client.id, name: `E2E TW Live Test ${new Date().toISOString().slice(0, 16)}`, estimatingMode: "HOUSE_BUILD" },
  });
  const pack = await prisma.tenderPack.create({ data: { projectId: project.id } });
  console.log(`project=${project.id} pack=${pack.id}`);
  console.log(`OPEN IN UI: /projects/${project.id}`);

  const pdfs = walk(SRC);
  console.log(`uploading ${pdfs.length} files…`);
  let done = 0;
  const pool = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < pdfs.length) {
      const full = pdfs[cursor++];
      const rel = `${PACK_NAME}/${relative(SRC, full)}`;
      const base = basename(full);
      const path = `${pack.id}/raw/${randomUUID()}-${base.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 120)}`;
      const buf = readFileSync(full);
      await uploadToStorage(path, buf, "application/pdf", { upsert: true });
      await prisma.packUpload.create({
        data: { packId: pack.id, fileName: base, relativePath: rel, storagePath: path, mimeType: "application/pdf", sizeBytes: buf.byteLength, isArchive: false },
      });
      if (++done % 50 === 0) console.log(`  uploaded ${done}/${pdfs.length}`);
    }
  }
  const tUp = Date.now();
  await Promise.all(Array.from({ length: pool }, worker));
  console.log(`uploaded ${done} files in ${((Date.now() - tUp) / 1000).toFixed(0)}s`);

  console.log(`running processPack…`);
  const tPP = Date.now();
  await processPack(pack.id);
  console.log(`processPack finished in ${((Date.now() - tPP) / 1000).toFixed(0)}s`);

  const after = await prisma.tenderPack.findUnique({ where: { id: pack.id } });
  const gd: any = after?.groupingData ?? {};
  console.log(`\n=== RESULT ===`);
  console.log(`groupingStatus: ${after?.groupingStatus}`);
  console.log(`builder: ${gd.builderLabel}`);
  console.log(`house types: ${gd.groups?.length ?? 0}`);
  for (const g of gd.groups ?? []) console.log(`  • ${g.name}  [${g.confidence}]  ${g.relevantPageCount}/${g.totalPageCount} pages, ${g.files?.length} files`);
  console.log(`unplaced pack-level files: ${gd.unplacedFiles?.length ?? 0}`);
  if (gd.answerKey) console.log(`answerKey: ${gd.answerKey.matched?.length}/${gd.answerKey.expected?.length} matched, missing=${gd.answerKey.missing?.join("|")}, extra=${gd.answerKey.extra?.join("|")}`);
  const assembled = await prisma.document.count({ where: { packId: pack.id, kind: "ASSEMBLED" } });
  const totalDocs = await prisma.document.count({ where: { packId: pack.id } });
  console.log(`documents: ${totalDocs} total (${assembled} assembled)`);
  console.log(`\nOPEN IN UI: /projects/${project.id}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
