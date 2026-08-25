/**
 * Backfill house-type name + code from each type's stored extraction output
 * (docs/16 · N). Segmentation named most house types from the FILE; the AI read
 * the real name/code but persist.ts (before this change) never wrote it back.
 * This re-applies the fix to already-extracted data — NO Claude calls, no re-bill,
 * it only reads `Extraction.rawOutput`.
 *
 *   npx tsx scripts/backfill-house-type-names.mts           # DRY RUN (default) — prints before→after
 *   npx tsx scripts/backfill-house-type-names.mts --apply   # writes the changes
 *
 * The same code-uniqueness guard as persist.ts applies: a proposed code that
 * another house type in the project already holds is dropped (kept as-is).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";
import { resolveHouseTypeIdentity } from "../src/lib/extract/houseTypeIdentity";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Extracted = { name?: string | null; code?: string | null; confidence?: string | null };

function readHouseType(rawOutput: unknown): Extracted | null {
  if (!rawOutput || typeof rawOutput !== "object") return null;
  const ht = (rawOutput as Record<string, unknown>).houseType;
  if (!ht || typeof ht !== "object") return null;
  const o = ht as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : null,
    code: typeof o.code === "string" ? o.code : null,
    confidence: typeof o.confidence === "string" ? o.confidence : null,
  };
}

async function main() {
  const houseTypes = await prisma.houseType.findMany({
    include: {
      project: { select: { id: true, name: true } },
      extractions: {
        where: { status: "COMPLETED", rawOutput: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { rawOutput: true },
      },
    },
    orderBy: [{ projectId: "asc" }, { name: "asc" }],
  });

  // Per-project set of codes already taken (so we never propose a duplicate).
  const takenByProject = new Map<string, Set<string>>();
  for (const ht of houseTypes) {
    const set = takenByProject.get(ht.projectId) ?? new Set<string>();
    if (ht.code) set.add(ht.code);
    takenByProject.set(ht.projectId, set);
  }

  type Change = {
    project: string;
    id: string;
    from: { name: string; code: string | null };
    to: { name: string; code: string | null };
    source: "AI" | "cleaned-fallback";
    codeDropped: boolean;
  };
  const changes: Change[] = [];
  let unchanged = 0;
  let noExtraction = 0;

  for (const ht of houseTypes) {
    const extracted = ht.extractions.map((e) => readHouseType(e.rawOutput)).find(Boolean) ?? null;
    if (!extracted) noExtraction++;

    const identity = resolveHouseTypeIdentity({
      extractedName: extracted?.name,
      extractedConfidence: extracted?.confidence,
      extractedCode: extracted?.code,
      currentName: ht.name,
      currentCode: ht.code,
    });

    // Code-uniqueness guard (same as persist.ts).
    const taken = takenByProject.get(ht.projectId)!;
    let code = identity.code;
    let codeDropped = false;
    if (code && code !== ht.code && taken.has(code)) {
      code = ht.code;
      codeDropped = true;
    }
    if (code) taken.add(code);

    if (identity.name === ht.name && code === ht.code) {
      unchanged++;
      continue;
    }
    changes.push({
      project: ht.project.name,
      id: ht.id,
      from: { name: ht.name, code: ht.code },
      to: { name: identity.name, code },
      source: identity.usedExtractedName ? "AI" : "cleaned-fallback",
      codeDropped,
    });
  }

  // --- Report ---
  const fmt = (n: string, c: string | null) => `${JSON.stringify(n)}${c ? ` [${c}]` : ""}`;
  let lastProject = "";
  for (const ch of changes) {
    if (ch.project !== lastProject) {
      console.log(`\n=== ${ch.project} ===`);
      lastProject = ch.project;
    }
    console.log(
      `  ${fmt(ch.from.name, ch.from.code)}\n    → ${fmt(ch.to.name, ch.to.code)}  (${ch.source}${ch.codeDropped ? ", code kept — clash" : ""})`,
    );
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${changes.length} to change, ${unchanged} unchanged, ${noExtraction} with no completed extraction.`,
  );
  if (!APPLY) {
    console.log("Re-run with --apply to write these changes.");
  } else {
    for (const ch of changes) {
      await prisma.houseType.update({
        where: { id: ch.id },
        data: { name: ch.to.name, code: ch.to.code },
      });
    }
    console.log(`Wrote ${changes.length} updates.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
