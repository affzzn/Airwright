/**
 * Proves the read-only path end to end: SELECT works, every write is refused by
 * the database. The write attempt runs inside a transaction that ALWAYS rolls
 * back, so even if the grant were wrong nothing could persist.
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.READONLY_DATABASE_URL;
if (!url) throw new Error("READONLY_DATABASE_URL not set (expected in .env.readonly)");
if (/service_role|^postgresql:\/\/postgres\.[a-z]+:/.test(url) && !url.includes("claude_ro"))
  throw new Error("refusing to run: READONLY_DATABASE_URL is not the claude_ro role");

const prisma = new PrismaClient({ datasourceUrl: url });

const who = await prisma.$queryRawUnsafe<{ user: string }[]>("select current_user as user");
console.log("connected as:", who[0].user);

const counts = await prisma.$queryRawUnsafe<{ t: string; n: bigint }[]>(
  `select 'projects' as t, count(*) as n from "Project"
   union all select 'house types', count(*) from "HouseType"
   union all select 'takeoffs', count(*) from "Takeoff"
   union all select 'plots', count(*) from "Plot"`,
);
console.log("SELECT ok:", counts.map((c) => `${c.t}=${c.n}`).join(" · "));

let wrote = false;
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`insert into "Project" (id, name) values ('ro-probe', 'ro-probe')`);
    wrote = true;
    throw new Error("ROLLBACK"); // never commit, even on an unexpected success
  });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (wrote) console.log("WRITE: ⚠️  INSERT WAS ACCEPTED (rolled back) — the role is NOT read-only");
  else if (/permission denied/i.test(msg)) console.log("WRITE: refused by Postgres — permission denied ✓");
  else console.log("WRITE: refused —", msg.split("\n").find((l) => l.trim()) ?? msg);
}

await prisma.$disconnect();
