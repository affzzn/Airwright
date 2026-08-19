"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Live updates for the project page WITHOUT hammering the server.
 *
 * The full project-page render is heavy (~3s). A naive setInterval(refresh)
 * fires a new render before the last finishes, so they abort each other and the
 * page never updates (the "frozen until manual refresh" bug). Instead we poll a
 * cheap status endpoint and only call router.refresh() when the state actually
 * CHANGES — with a debounce so refreshes can never stack — then back off to a
 * slow heartbeat when idle (which also catches a fresh upload).
 */
export function AutoRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();
  const lastSig = useRef<string | null>(null);
  const lastRefresh = useRef(0);
  const sawActive = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      let active = false;
      try {
        const res = await fetch(`/api/projects/${projectId}/pack-status`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as { active: boolean; signature: string };
          active = data.active;
          const changed = lastSig.current !== null && data.signature !== lastSig.current;
          lastSig.current = data.signature;
          if (active) sawActive.current = true;
          // Refresh on a real change, or once when work has just settled.
          const settled = !active && sawActive.current;
          if ((changed || settled) && Date.now() - lastRefresh.current > 3500) {
            lastRefresh.current = Date.now();
            router.refresh();
          }
          if (settled) sawActive.current = false;
        }
      } catch {
        // transient network error — keep polling
      }
      // Fast while the pipeline is working; slow heartbeat when idle so a new
      // upload is still picked up without a manual refresh.
      if (!stopped) timer = setTimeout(tick, active ? 2000 : 8000);
    };

    timer = setTimeout(tick, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router, projectId]);

  return null;
}
