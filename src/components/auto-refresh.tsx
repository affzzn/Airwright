"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server component by calling router.refresh() on an interval.
 * Rendered only while an extraction is PENDING/PROCESSING, so the status
 * updates live from Queued → Reading → Ready without a manual refresh.
 */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
