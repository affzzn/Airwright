"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Live updates for a construction job while its pack is sorted or read in the
 * background (docs/22 §4.9). Polls the cheap status probe and re-renders the page
 * only when the state CHANGES — never a blind `setInterval(router.refresh())`,
 * which freezes a heavy page (CLAUDE.md). Fast while work is running, a slow
 * heartbeat when idle (which also notices a sort queued from another tab).
 */
export function ConstructionAutoRefresh({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const lastSig = useRef<string | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let active = false;
      try {
        const res = await fetch(`/api/construction/${quoteId}/status`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { active: boolean; signature: string };
          active = data.active;
          const changed = lastSig.current !== null && data.signature !== lastSig.current;
          lastSig.current = data.signature;
          if (changed && Date.now() - lastRefresh.current > 1500) {
            lastRefresh.current = Date.now();
            router.refresh();
          }
        }
      } catch {
        // a transient network error: keep polling
      }
      if (!stopped) timer = setTimeout(tick, active ? 2500 : 8000);
    };
    timer = setTimeout(tick, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router, quoteId]);

  return null;
}
