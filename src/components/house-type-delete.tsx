"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteHouseType } from "@/server/actions/plots";

/**
 * Delete a house type — for clearing junk types created from a filename when a
 * builder's combined-drawing format can't be parsed to a real code, or the
 * "Unknown" plot stub. Blocked (with a message) while plots still reference it.
 */
export function HouseTypeDelete({ houseTypeId }: { houseTypeId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  if (error)
    return (
      <span className="text-[11px] text-ink-muted" title={error}>
        {error.length > 40 ? "Can’t delete" : error}
      </span>
    );

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        start(async () => {
          const res = await deleteHouseType(houseTypeId);
          if (!res.ok) setError(res.error ?? "Delete failed");
          else router.refresh();
        });
      }}
      onBlur={() => setArmed(false)}
      className="text-[11px] text-ink-subtle hover:text-ink disabled:opacity-50"
    >
      {pending ? "…" : armed ? "Confirm delete" : "Delete"}
    </button>
  );
}
