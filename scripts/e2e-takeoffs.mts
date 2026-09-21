import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
import { buildTakeoff, type Configuration } from "../src/lib/takeoff/engine";
import { takeoffInputFromStored } from "../src/lib/takeoff/fromStored";
const pid = process.argv[2] ?? "cmu0x7p0w0001itep9jz0bqxo";
const hts = await prisma.houseType.findMany({ where: { projectId: pid },
  include: { takeoff: { include: { measurements: true, wallSegments: true } } } });
const num = (m:any[],k:string)=>{const x=m.find(z=>z.key===k);return x?.valueNumber!=null?Number(x.valueNumber):null;};
for (const ht of hts.sort((a,b)=>a.name.localeCompare(b.name))) {
  const t = ht.takeoff; if (!t) { console.log(`\n${ht.name}: no takeoff`); continue; }
  const meas = t.measurements.map(m=>({key:m.key as string, valueNumber:m.valueNumber!=null?Number(m.valueNumber):null}));
  const walls = t.wallSegments.map(w=>({position:w.position as string, lengthM:Number(w.lengthM)}));
  const warn = (t.warnings ?? {}) as any;
  const st = num(meas,"STOREYS"); const gq = num(meas,"GABLE_QTY");
  console.log(`\n=== ${ht.name} ${ht.code?`[${ht.code}]`:""}  storeys=${st} gables(read)=${gq} height=${num(meas,"HEIGHT_TO_SOFFIT")} ===`);
  for (const cfg of ["DETACHED","SEMI_DETACHED"] as Configuration[]) {
    const inp = takeoffInputFromStored(meas, walls, warn, cfg, "TIMBER_FRAME");
    const line = buildTakeoff(inp);
    console.log(`  ${cfg.padEnd(14)} perim/lift=${line.perimeter.perLiftM}m  lifts=${line.lifts.lifts}  apex=${line.apex.count}  adaptions IB=${line.adaptions?.insideBoardLM} HU=${line.adaptions?.hopUpLM}`);
  }
}
await prisma.$disconnect();
