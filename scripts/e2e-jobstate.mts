import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const cols: any[] = await p.$queryRawUnsafe(`select column_name from information_schema.columns where table_schema='pgboss' and table_name='job'`);
console.log("cols:", cols.map(c=>c.column_name).join(","));
const rows: any[] = await p.$queryRawUnsafe(
  `select name, state, left(coalesce(output::text,''),500) as output
   from pgboss.job where name in ('process-pack','extract-drawing') order by created_on desc limit 12`
);
for (const r of rows) console.log(`${r.name} | ${r.state} | ${r.output || ''}`);
await p.$disconnect();
