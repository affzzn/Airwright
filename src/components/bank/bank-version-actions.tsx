"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBankCurrentVersion } from "@/server/actions/bank";

/** Promote an older bank version back to the current reference (docs/20 §7). */
export function BankVersionActions({ entryId, versionId }: { entryId: string; versionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const res = await setBankCurrentVersion(entryId, versionId);
          if (!res.ok) setError(res.error ?? "Failed");
          else router.refresh();
        })
      }
      className="rounded border border-hairline-strong bg-canvas px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface disabled:opacity-50"
    >
      {pending ? "…" : error ? "Failed" : "Make current"}
    </button>
  );
}
