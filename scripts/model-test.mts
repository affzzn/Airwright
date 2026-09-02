import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync } from "node:fs";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { lowLevelQty } from "../src/lib/extract/schema";
import { EXTRACTION_MODELS } from "../src/lib/extract/providers/catalog";

const PDF = process.argv[2] ?? "data/new-laura/470_HALLAM_ISSUE_4.8.pdf";

async function main() {
  const buf = readFileSync(PDF);
  console.log(`\nModel comparison on ${PDF} (${(buf.length / 1e6).toFixed(1)} MB)\n`);

  for (const m of EXTRACTION_MODELS) {
    console.log("=".repeat(78));
    console.log(`${m.label}   [${m.key} → ${m.apiModelId}]`);
    console.log("=".repeat(78));
    const started = Date.now();
    try {
      const { data, meta } = await extractDrawing(buf, m.key);
      console.log(
        `✓ ${(meta.latencyMs / 1000).toFixed(1)}s   in=${meta.inputTokens} out=${meta.outputTokens}   ~$${meta.costUsd.toFixed(3)}   (${meta.model})`,
      );
      console.log(
        `  house: ${data.houseType.name ?? "-"} (${data.houseType.code ?? "-"})   structure: ${data.structure.form}   storeys: ${data.storeys.value}   roof: ${data.roof.overallType}`,
      );
      console.log(
        `  height: ${data.heightToSoffitM.value} m [${data.heightToSoffitM.confidence}]   corners: ${data.cornerCount.value}   dwellingsWide: ${data.dwellingsWide.value}   lowLevel: ${lowLevelQty(data.lowLevel) ?? "-"}   chimney: ${data.chimney.value}`,
      );
      console.log(
        `  walls: ${data.wallSegments.map((w) => `${w.position}=${w.lengthM}`).join("  ")}`,
      );
      console.log(
        `  apex/face: ${data.elevations.map((e) => `${e.face}=${e.apexCount}`).join("  ")}`,
      );
      console.log(
        `  floors: ${data.floorAreas.map((f) => `${f.level}[${(f.rectangles ?? []).length}rect gia=${f.statedGrossInternalM2 ?? "-"}]`).join("  ")}`,
      );
    } catch (err) {
      console.log(`✗ FAILED in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
