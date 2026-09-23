/** Which layer is rejecting claude_ro: the pooler, or the password? Tries both
 *  Supavisor ports. Prints no secrets. */
import { PrismaClient } from "@prisma/client";

const base = process.env.READONLY_DATABASE_URL;
if (!base) throw new Error("READONLY_DATABASE_URL not set");

const u = new URL(base);
console.log("user:", decodeURIComponent(u.username), "| host:", u.hostname, "| pw length:", (u.password ?? "").length);

for (const port of ["6543", "5432"]) {
  const t = new URL(base);
  t.port = port;
  if (port === "5432") t.searchParams.delete("pgbouncer"); // session mode: no pgbouncer flag
  const prisma = new PrismaClient({ datasourceUrl: t.toString() });
  try {
    const r = await prisma.$queryRawUnsafe<{ u: string }[]>("select current_user as u");
    console.log(`port ${port}: OK — connected as ${r[0].u}`);
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter(Boolean);
    console.log(`port ${port}: FAIL — ${m.find((l) => /failed|denied|error|not valid|reach/i.test(l)) ?? m[0]}`);
  } finally {
    await prisma.$disconnect();
  }
}
