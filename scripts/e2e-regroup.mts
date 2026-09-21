/**
 * Re-run grouping (with the recipe fix) for an already-uploaded pack, LOCALLY —
 * calls processPack() in-process so the fixed code runs (not the shared Render
 * worker), then confirms the grouping to enqueue extraction. Run the worker to
 * process the extractions.
 *
 *   npx tsx scripts/e2e-regroup.mts <packId>
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { prisma } from "../src/lib/db";
import { processPack } from "../src/worker/processPack";
import { getBoss } from "../src/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "../src/lib/queue/jobs";

const packId = process.argv[2] ?? "cmu0vax2e0003ityikqe3ihyz";

async function main() {
  // Clean slate: drop any prior extractions, house types and assembled docs so the
  // re-group starts fresh (a prior partial run may have created some).
  const pk = await prisma.tenderPack.findUnique({ where: { id: packId }, select: { projectId: true } });
  const projectId = pk!.projectId;
  await prisma.extraction.deleteMany({ where: { document: { packId } } });
  await prisma.plot.deleteMany({ where: { projectId } });
  await prisma.houseType.deleteMany({ where: { projectId } });
  await prisma.document.deleteMany({ where: { packId, kind: "ASSEMBLED" } });
  // Reset grouping so processPack re-groups with the fixed recipe apply step.
  await prisma.tenderPack.update({
    where: { id: packId },
    data: { groupingStatus: null, groupingData: undefined, builderProfileId: null },
  });
  console.log(`Re-grouping pack ${packId} (local, fixed code)…`);
  await processPack(packId);

  // Summary of what grouping produced.
  const pack = await prisma.tenderPack.findUnique({
    where: { id: packId },
    select: { groupingStatus: true, groupingData: true, projectId: true },
  });
  const data = (pack?.groupingData ?? {}) as any;
  console.log(`\ngroupingStatus=${pack?.groupingStatus}`);
  const groups: any[] = data.groups ?? [];
  console.log(`House types (${groups.length}):`);
  for (const g of groups.sort((a, b) => b.relevantPageCount - a.relevantPageCount))
    console.log(`  ${g.name}: ${g.relevantPageCount} relevant / ${g.totalPageCount} total pages, ${g.files.length} files [${g.confidence}]`);
  if (data.answerKey)
    console.log(`Answer-key (${data.answerKey.source}): ${data.answerKey.matched.length}/${data.answerKey.expected.length} matched · missing=[${data.answerKey.missing.join(", ")}] · extra=[${data.answerKey.extra.join(", ")}]`);
  console.log(`Unplaced files: ${(data.unplacedFiles ?? []).length}`);

  // Confirm → enqueue every pending extraction (replicates confirmGrouping).
  const pending = await prisma.extraction.findMany({
    where: { status: "PENDING", document: { packId } },
    select: { id: true, documentId: true, pageRange: true },
  });
  const boss = await getBoss();
  for (const e of pending)
    await boss.send(EXTRACT_DRAWING_QUEUE, { documentId: e.documentId, extractionId: e.id, pageRange: e.pageRange });
  await prisma.tenderPack.update({ where: { id: packId }, data: { groupingStatus: "CONFIRMED" } });
  console.log(`\nConfirmed → enqueued ${pending.length} extractions (Anthropic). Worker will process them.`);

  await prisma.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
