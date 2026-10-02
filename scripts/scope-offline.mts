/**
 * Read a client's scope on its own (docs/23 §11) — no job, no drawings, no queue:
 * the schedule structure (code), the scope reader (one model call) and the binding
 * with no buildings (every quantity is the client's own, flagged). For checking the
 * scope reader on Stanmore / KE / Wren without a full pack read.
 *
 *   npx tsx scripts/scope-offline.mts "<scope file>" [--no-ai]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { prisma } from "@/lib/db";
import { readScopeFile } from "@/lib/construction/scopeText";
import { draftFromScope } from "@/lib/construction/draftFromScope";
import { bindScope } from "@/lib/construction/bindScope";
import { resolveJobParams } from "@/lib/construction/params";
import { loadConstructionLibrary } from "@/server/construction";
import type { ConstructionUnit } from "@/lib/construction/types";

const file = process.argv[2];
const noAi = process.argv.includes("--no-ai");

async function main() {
  const read = await readScopeFile({ name: basename(file), mimeType: "", bytes: readFileSync(file) });
  console.log(`=== ${basename(file)}: ${read.tables.length} schedule table(s), ${read.text.length} chars ===`);
  for (const t of read.tables)
    console.log(
      `table "${t.sheet}": header rows ${t.headerRows.join(",")}, item column ${t.itemCol}, ${t.rows.filter((r) => r.kind === "ITEM").length} items, ` +
        `sections ${t.sections.map((s) => `${s.name}(${s.itemCount})`).join(", ") || "none"}\n  columns: ${t.columns.map((c) => `${c.letter} ${c.role}`).join(" · ")}`,
    );
  if (noAi) {
    console.log(read.text);
    return;
  }
  const library = await loadConstructionLibrary();
  const d = await draftFromScope(
    read.text,
    library.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, unit: e.unit, usesLifts: e.usesLifts, category: e.category })),
    read.tables,
  );
  console.log(`\nscope read: ${d.lines.length} lines, $${d.meta.costUsd.toFixed(4)}, sections ${JSON.stringify(d.sections)}`);
  const byId = new Map(library.map((e) => [e.id, e.name]));
  const bound = bindScope({
    items: d.lines,
    buildings: [],
    library: library.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, unit: e.unit as ConstructionUnit, usesLifts: e.usesLifts, usesHeightBracket: e.usesHeightBracket, category: e.category })),
    params: resolveJobParams(null),
    sections: d.sections,
    emptyTableSections: read.tables.flatMap((t) => t.sections.filter((s) => s.itemCount === 0).map((s) => s.name)),
  });
  for (const [i, l] of d.lines.entries()) {
    const b = bound.lines[i];
    console.log(
      `  ${(l.rowRef ?? "—").padEnd(5)} ${(l.section ?? "").slice(0, 22).padEnd(22)} ${l.clientText.slice(0, 52).padEnd(52)} → ${(l.elementId ? byId.get(l.elementId) : "NO ITEM")!.slice(0, 32).padEnd(32)} ` +
        `q=${b?.quantity ?? "—"} hire=${l.hireWeeks ?? "—"} count=${l.statedCount ?? "—"} [${l.confidence}] ${b?.status ?? ""}` +
        (l.flags?.length ? `\n${"".padEnd(30)}! ${l.flags.join("\n" + "".padEnd(30) + "! ")}` : ""),
    );
  }
  console.log(`\nEMPTY SECTIONS: ${bound.emptySections.join(", ") || "none"}\nACCOUNT: ${JSON.stringify(bound.account)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
