import { PrismaClient } from "@prisma/client";

/**
 * Add sane connection-pool params so heavy concurrent load (the worker + the
 * project page polling) doesn't exhaust the Supabase pooler. connection_limit
 * stays under the pooler's per-user cap; pool_timeout gives queries room to
 * wait instead of erroring.
 */
function pooledUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  const extra: string[] = [];
  if (!/[?&]connection_limit=/.test(url)) extra.push("connection_limit=8");
  if (!/[?&]pool_timeout=/.test(url)) extra.push("pool_timeout=30");
  return extra.length ? `${url}${sep}${extra.join("&")}` : url;
}

/** Prisma singleton — avoids exhausting connections during dev hot-reload. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const url = pooledUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
