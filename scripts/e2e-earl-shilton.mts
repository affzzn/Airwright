/**
 * FULL end-to-end run of a real tender pack THROUGH THE SYSTEM (DB + Storage +
 * queue), so results show in the UI. Mirrors exactly what the browser folder
 * uploader does (createSignedUploads → PUT → registerUploads → startProcessing),
 * but server-side: the service-role Storage upload lands identical objects, so the
 * worker's ingest → classify → AI grouping → assemble → extract runs the same.
 *
 * Run the WORKER separately to process what this enqueues:  npm run worker
 *
 *   npx tsx scripts/e2e-earl-shilton.mts "<folder>" "<project name>" TIMBER_FRAME
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { uploadToStorage } from "../src/lib/supabase/storage";
import { registerUploads } from "../src/server/actions/upload";
import { getBoss } from "../src/lib/queue/boss";
import { PROCESS_PACK_QUEUE } from "../src/lib/queue/jobs";
import { isUploadableName, isArchiveName } from "../src/lib/upload/plan";

const folder = process.argv[2];
const projectName = process.argv[3] ?? "Earl Shilton — TF (E2E)";
const buildType = (process.argv[4] ?? "TIMBER_FRAME") as "TRADITIONAL" | "TIMBER_FRAME";
const MODEL_KEY = "anthropic-opus-4-8"; // Anthropic only, per request
const CLIENT_NAME = "Vistry SEM (E2E test)";
const CONCURRENCY = 5;

if (!folder) {
  console.error('Usage: tsx scripts/e2e-earl-shilton.mts "<folder>" "<name>" TIMBER_FRAME');
  process.exit(1);
}

/** Every PDF/ZIP under the folder, with a webkitRelativePath-style relative path. */
function walk(dir: string, rootName: string, root: string): { full: string; relativePath: string }[] {
  const out: { full: string; relativePath: string }[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, rootName, root));
    else if (isUploadableName(name)) out.push({ full, relativePath: `${rootName}/${relative(root, full)}` });
  }
  return out;
}

async function main() {
  const rootName = basename(folder);
  const files = walk(folder, rootName, folder);
  const bytes = files.reduce((a, f) => a + statSync(f.full).size, 0);
  console.log(`Pack "${rootName}": ${files.length} uploadable files, ${(bytes / 1e6).toFixed(0)} MB`);

  // 1) Client + project + empty pack — exactly like createProject (docs/18: TF is project-level).
  const client =
    (await prisma.client.findFirst({ where: { name: CLIENT_NAME } })) ??
    (await prisma.client.create({ data: { name: CLIENT_NAME } }));
  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: projectName,
      estimatingMode: "HOUSE_BUILD",
      buildType,
      extractionModel: MODEL_KEY,
      packs: { create: { version: 1 } },
    },
    include: { packs: true },
  });
  const packId = project.packs[0].id;
  console.log(`Project ${project.id}  (buildType=${buildType}, model=${MODEL_KEY})  pack ${packId}`);

  // 2) Upload every file to Storage (service role → same object/path the browser would create).
  let done = 0;
  const descriptors: {
    path: string; name: string; relativePath: string; type: string; size: number; isArchive: boolean;
  }[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const f = files[cursor++];
      const name = basename(f.full);
      const storagePath = `${packId}/raw/${randomUUID()}-${name}`;
      const buf = readFileSync(f.full);
      for (let attempt = 0; ; attempt++) {
        try {
          await uploadToStorage(storagePath, buf, "application/pdf", { upsert: true });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      descriptors.push({
        path: storagePath, name, relativePath: f.relativePath,
        type: "application/pdf", size: buf.length, isArchive: isArchiveName(name),
      });
      if (++done % 25 === 0 || done === files.length) console.log(`  uploaded ${done}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 3) Register the PackUploads (batched). Processing is driven separately via
  //    e2e-regroup (calls processPack locally with the current fixed code, so the
  //    shared Render worker — possibly on older code — can't race the grouping).
  for (let i = 0; i < descriptors.length; i += 20)
    await registerUploads(packId, descriptors.slice(i, i + 20));
  void getBoss; void PROCESS_PACK_QUEUE; // (enqueue handled by e2e-regroup)
  console.log(`\nUploaded + registered. Next:  npx tsx scripts/e2e-regroup.mts ${packId}`);
  console.log(`PACKID=${packId}`);
  console.log(`Project id: ${project.id}`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
