import PgBoss from "pg-boss";
import { env } from "@/lib/env";
import {
  CONSTRUCTION_INGEST_QUEUE,
  CONSTRUCTION_READ_QUEUE,
  EXTRACT_DRAWING_QUEUE,
  PROCESS_PACK_QUEUE,
} from "./jobs";

/**
 * pg-boss singleton. IMPORTANT: pg-boss uses LISTEN/NOTIFY + advisory locks,
 * which do NOT work through PgBouncer — so it connects on DIRECT_URL (5432),
 * not the pooled DATABASE_URL. It manages its own `pgboss` schema.
 */
let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: env.directUrl });
      boss.on("error", (err) => console.error("[pg-boss]", err));
      await boss.start();
      // Queues must exist before send/work in pg-boss v10 (idempotent).
      await boss.createQueue(PROCESS_PACK_QUEUE);
      await boss.createQueue(EXTRACT_DRAWING_QUEUE);
      // "stately": at most one queued + one running sort per job key, so a burst of
      // uploads collapses into one re-sort instead of N.
      await boss.createQueue(CONSTRUCTION_INGEST_QUEUE, { name: CONSTRUCTION_INGEST_QUEUE, policy: "stately" });
      await boss.createQueue(CONSTRUCTION_READ_QUEUE);
      return boss;
    })();
  }
  return bossPromise;
}
