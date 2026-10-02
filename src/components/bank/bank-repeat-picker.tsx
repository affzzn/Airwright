"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { pickBankVersion, readDrawingInsteadOfBank } from "@/server/actions/bank";
import type { BankRepeatOffer, BankVersionOption } from "@/server/bank";
import { formatDate } from "@/lib/utils";

/**
 * Shown on a house type whose drawing was NOT read because it is already in the house
 * bank (its read is HELD — docs/20 v2). The person picks the right version — that
 * fills and confirms the take-off with no read and no AI cost — or says it is a
 * different house and the drawing is read as normal. Nothing happens on its own.
 */
export function BankRepeatPicker({
  houseTypeId,
  offers,
}: {
  houseTypeId: string;
  offers: BankRepeatOffer[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
      setBusy(null);
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded border border-hairline-strong bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface disabled:opacity-50";
  const allPossible = offers.every((o) => o.strength === "POSSIBLE");

  return (
    <div className="mt-3 rounded-md border border-hairline-strong bg-surface/60 px-3 py-2.5 text-xs">
      {offers.length === 0 ? (
        <p className="font-medium text-ink">
          Held for the house bank, but that house type is no longer in the bank.
          <span className="ml-1.5 font-normal text-ink-subtle">Read the drawing to continue.</span>
        </p>
      ) : (
        <p className="font-medium text-ink">
          {allPossible ? "Might already be in the house bank" : "Found in the house bank"}
          <span className="ml-1.5 font-normal text-ink-subtle">
            — not read yet. Pick the right version, or read the drawing.
          </span>
        </p>
      )}

      <div className="mt-2 space-y-2.5">
        {offers.map((o) => (
          <div key={o.entryId}>
            <p className="text-ink">
              <span className="font-medium">{o.name}</span>
              {o.code && <span className="ml-1.5 text-ink-subtle">{o.code}</span>}
              <span className="ml-1.5 text-ink-subtle">
                · {o.builder}
                {o.sameBuilder ? " (same builder)" : ""}
              </span>
              {o.strength === "POSSIBLE" && (
                <span className="ml-1.5 rounded border border-dashed border-hairline-strong px-1 text-[10px] text-ink-muted">
                  possible match — check the name
                </span>
              )}
            </p>
            <ul className="mt-1 divide-y divide-hairline rounded border border-hairline bg-canvas">
              {o.versions.map((v) => (
                <li key={v.versionId} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <VersionLine v={v} />
                  <button
                    type="button"
                    className={btn}
                    disabled={pending}
                    title="Use these numbers for this house type — confirmed, no drawing read"
                    onClick={() => run(v.versionId, () => pickBankVersion(houseTypeId, v.versionId))}
                  >
                    {busy === v.versionId && <Loader2 className="h-3 w-3 animate-spin" />}
                    Use v{v.version}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={pending}
          title="It's a different house — read this drawing with the AI as normal"
          onClick={() => run("read", () => readDrawingInsteadOfBank(houseTypeId))}
        >
          {busy === "read" && <Loader2 className="h-3 w-3 animate-spin" />}
          {offers.length === 0 ? "Read the drawing" : "Not this house — read the drawing"}
        </button>
        {error && <span className="text-ink-muted">{error}</span>}
      </div>
    </div>
  );
}

function VersionLine({ v }: { v: BankVersionOption }) {
  const s = v.summary;
  const facts = s
    ? [
        s.storeys != null ? `${s.storeys}-storey` : null,
        s.configuration.toLowerCase().replace("_", " "),
        s.lifts != null ? `${s.perLiftM} m × ${s.lifts} lifts` : `${s.perLiftM} m`,
        s.birdcageFloors > 0 ? `birdcage ${s.birdcageM2} m² × ${s.birdcageFloors}` : null,
      ].filter(Boolean)
    : [];
  return (
    <div className="min-w-0">
      <p className="text-ink">
        <span className="font-medium">v{v.version}</span>
        <span className="ml-2 text-ink-muted">{facts.join(" · ") || "numbers unavailable"}</span>
      </p>
      <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
        Saved{v.savedAt ? ` ${formatDate(v.savedAt)}` : ""}
        {v.fromProject ? ` · from ${v.fromProject}` : ""}
      </p>
    </div>
  );
}
