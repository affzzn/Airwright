/**
 * Grade a read construction job against its answer key (docs/22 §7, docs/23 §18).
 * Reads what the job already holds — the saved measurements and the latest run's
 * draft — so it costs nothing; read the pack first (UI, or scripts/e2e-scope.mts).
 *
 *   npx tsx scripts/construction-eval.mts --job <quoteId> --key cband|ke|wren|murray
 *
 * The keys are the real evidence: Airwright's own quotes (CBAND 1350, Murray Park
 * 1375 — structure, lifts, gables, hire; no metreage), the numbers the client wrote
 * on the Wren mark-up, and a hand-worked key for King Edward (levels and heights
 * printed on the drawings; the scope's 24 lines, its empty section, its open bases).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import type { DrawingDraftLine } from "@/lib/construction/assemble";

type Check = { what: string; expected: string; got: string; pass: boolean };
const args = process.argv.slice(2);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const jobId = val("--job")!;
const key = (val("--key") ?? "").toLowerCase();

const near = (a: number | null | undefined, b: number, tol = Math.max(0.2, 0.01 * b)) => a != null && Math.abs(a - b) <= tol;

async function main() {
  const q = await prisma.constructionQuote.findUniqueOrThrow({
    where: { id: jobId },
    include: { buildings: true, measurements: true, readRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const result = (q.readRuns[0]?.result ?? null) as { draftLines?: DrawingDraftLine[]; emptySections?: string[]; account?: Record<string, number> | null } | null;
  const lines = result?.draftLines ?? [];
  const b = (name: string) => q.buildings.find((x) => x.name.toLowerCase().includes(name.toLowerCase()))?.id ?? null;
  const ms = (bid: string | null, k: string) => q.measurements.filter((m) => (bid == null || m.buildingId === bid) && (m.key ?? "").startsWith(k));
  const one = (bid: string | null, k: string) => ms(bid, k)[0];
  const maxHeight = (bid: string | null) => ms(bid, "height:").reduce<{ v: number; lifts: number | null; band: string | null } | null>(
    (a, m) => (a == null || Number(m.valueNumber) > a.v ? { v: Number(m.valueNumber), lifts: m.lifts, band: m.heightBracket } : a),
    null,
  );
  const checks: Check[] = [];
  const check = (what: string, expected: string | number, got: string | number | null | undefined, pass: boolean) =>
    checks.push({ what, expected: String(expected), got: got == null ? "—" : String(got), pass });

  // The rule since 2026-10-02: a number is either RIGHT or left BLANK for the estimator.
  const UNRELIABLE = ["scaffold-run", "perimeter", "corners", "internal-footprint", "markup-ext:c", "markup-birdcage:c", "pitch", "roof-", "openings", "void-edge", "risers", "lift-", "stair-cores", "external-doors", "slab-edge", "parapet-above"];
  const unreliable = q.measurements.filter((m) => m.runId && UNRELIABLE.some((k) => (m.key ?? "").startsWith(k)));
  check("Nothing unreliable is filled automatically", 0, unreliable.map((m) => m.key).join(", ") || 0, unreliable.length === 0);
  if (key === "cband") {
    const hall = b("hall");
    const pav = b("pavil");
    check("Hall external lifts (quote: 2)", 2, maxHeight(hall)?.lifts, maxHeight(hall)?.lifts === 2);
    check("Pavilion external lifts (quote: 2)", 2, maxHeight(pav)?.lifts, maxHeight(pav)?.lifts === 2);
    const pp = one(pav, "ext-perimeter");
    check("Pavilion perimeter, checked by plan + roof plan", "59.516 (high)", pp ? `${Number(pp.valueNumber)} (${pp.confidence})` : null, near(Number(pp?.valueNumber), 59.516) && pp?.confidence === "high");
    check("Pavilion corners", 4, one(pav, "ext-corners")?.valueNumber?.toString(), Number(one(pav, "ext-corners")?.valueNumber) === 4);
    check("Pavilion main gables, roof + elevations agree (quote: apex ×2)", 2, one(pav, "gables")?.valueNumber?.toString(), Number(one(pav, "gables")?.valueNumber) === 2);
    check("Hall perimeter NOT filled (L-shape: Colin measures)", "blank", one(hall, "ext-perimeter")?.valueNumber?.toString() ?? "blank", !one(hall, "ext-perimeter"));
    check("Hall gables NOT filled (roof 2 vs elevations 3)", "blank", one(hall, "gables")?.valueNumber?.toString() ?? "blank", !one(hall, "gables"));
    check("Pavilion clear height offered (quote: internal 1 lift)", 2.99, ms(pav, "clear:")[0]?.valueNumber?.toString(), near(Number(ms(pav, "clear:")[0]?.valueNumber), 2.99, 0.01));
    check("Hall clear height offered (quote: internal 2 lifts)", 4.882, ms(hall, "clear:")[0]?.valueNumber?.toString(), near(Number(ms(hall, "clear:")[0]?.valueNumber), 4.882, 0.01));
    check("No scope → no draft lines (measure mode)", 0, lines.length, lines.length === 0);
  } else if (key === "ke") {
    // Scenario 1 (a scope was uploaded): the scope only, the client's numbers as given.
    check("Scenario 1 (scope uploaded)", "A", q.mode, q.mode === "A");
    check("Drawings not read: no measurements, no buildings", "0 · 0", `${q.measurements.filter((m) => m.runId).length} · ${q.buildings.length}`, q.measurements.filter((m) => m.runId).length === 0 && q.buildings.length === 0);
    const scopeLines = lines.filter((l) => l.clientRef);
    check("Every schedule row drafted (22 rows)", 22, scopeLines.length, scopeLines.length === 22);
    check("No cross-check labels", 0, lines.filter((l) => l.status || l.formula).length, lines.every((l) => !l.status && !l.formula));
    check("Empty section → confirm none required", "Birdcages", (result?.emptySections ?? []).join(", "), (result?.emptySections ?? []).includes("Birdcages"));
    const find = (re: RegExp) => scopeLines.filter((l) => re.test(l.clientRef?.text ?? ""));
    const ind = find(/independent tied/i)[0];
    check("Independent scaffold: blank (no size in the scope), 30 wk hire", "blank · 30", `${ind?.quantity ?? "blank"} · ${ind?.hireWeeks}`, ind?.quantity == null && ind?.hireWeeks === 30);
    const towers = find(/staircase access towers/i)[0];
    check("Staircase access towers: the scope's 2nr", 2, towers?.quantity, towers?.quantity === 2);
    const hires = [...new Set(scopeLines.map((l) => l.hireWeeks).filter((w) => w != null))].sort((a, b) => a! - b!);
    check("Hire per line from the rows (8/10/16/30)", "8,10,16,30", hires.join(","), hires.join(",") === "8,10,16,30");
  } else if (key === "wren") {
    // Scenario 1: the schedule's own numbers, exactly; the email adds only what the schedule lacks.
    check("Scenario 1 (scope uploaded)", "A", q.mode, q.mode === "A");
    const want: [RegExp, number, number | null][] = [
      [/independent|perimet|external/i, 35.15746, 2],
      [/independent|perimet|external/i, 42.19896, 3],
      [/birdcage|crash/i, 203.34, 2],
      [/birdcage|crash/i, 123.88, 3],
      [/roof edge|triple/i, 77.35725, null],
    ];
    for (const [re, qty, lifts] of want) {
      const hit = lines.find((l) => re.test(l.description) && l.quantity === qty && (lifts == null || l.lifts === lifts));
      check(`${re.source.split("|")[0]} ${qty}${lifts ? ` × ${lifts}` : ""} (exact)`, `${qty}${lifts ? ` × ${lifts}` : ""}`, hit ? `${hit.quantity} × ${hit.lifts ?? "-"}` : "missing", Boolean(hit));
    }
    const haki = lines.filter((l) => /haki/i.test(l.description)).map((l) => l.lifts).sort();
    check("Haki ×2: 2 and 3 lifts", "2,3", haki.join(","), haki.join(",") === "2,3");
    const lb = lines.filter((l) => /loading bay/i.test(l.description)).map((l) => l.lifts).sort();
    check("Loading bays ×2: 2 and 3 lifts", "2,3", lb.join(","), lb.join(",") === "2,3");
    const rows = lines.filter((l) => l.clientRef?.rowRef);
    const weeks = [...new Set(rows.map((l) => l.hireWeeks).filter(Boolean))];
    check("Hire from the schedule rows (7 wk)", 7, weeks.join(","), weeks.length === 1 && weeks[0] === 7);
    const extra = lines.filter((l) => !l.clientRef?.rowRef);
    check("Email adds only what the schedule lacks (roof access)", "1", extra.map((l) => l.description).join(", "), extra.length === 1 && /roof access/i.test(extra[0].description));
  } else if (key === "murray") {
    check("Raster plan: no invented perimeter", "none", ms(null, "perimeter").length, ms(null, "perimeter").length === 0);
    check("(quote 1375: 66 m × 2 lifts × 4 m — measured by hand)", "flags only", q.measurements.length, true);
  } else throw new Error("--key cband | ke | wren | murray");

  const w = Math.max(...checks.map((c) => c.what.length));
  for (const c of checks) console.log(`${c.pass ? "PASS" : "DIFF"}  ${c.what.padEnd(w)}  expected ${c.expected.padEnd(18)} got ${c.got}`);
  console.log(`\n${checks.filter((c) => c.pass).length} / ${checks.length} pass`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
