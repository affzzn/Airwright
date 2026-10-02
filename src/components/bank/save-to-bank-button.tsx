"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { getSaveToBankOptions, saveTakeoffToHouseBank } from "@/server/actions/bank";
import type { SaveCandidate, SaveChoice, SaveOptions } from "@/server/bank";

/**
 * "Save to house bank" — beside Confirm take-off (docs/20 v2). Confirming never saves
 * to the bank; this button is the only way in. It opens a short dialog that compares
 * this take-off with the bank and asks one question: a new house type, a new version
 * of one (the old versions are never touched), or "already saved as vN".
 */
export function SaveToBankButton({
  takeoffId,
  confirmed,
  linkedLabel,
}: {
  takeoffId: string;
  confirmed: boolean;
  /** e.g. "In house bank · Denton v2" when this house type is already in the bank. */
  linkedLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [options, setOptions] = useState<SaveOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    setError(null);
    setDone(null);
    setOptions(null);
    startLoading(async () => {
      const o = await getSaveToBankOptions(takeoffId);
      if (!o) setError("This take-off can't go in the house bank (house-build only).");
      setOptions(o);
    });
  }

  function save(choice: SaveChoice, label: string) {
    setError(null);
    startSaving(async () => {
      const res = await saveTakeoffToHouseBank(takeoffId, choice);
      if (!res.ok) {
        setError(res.error ?? "Could not save");
        return;
      }
      setDone(`${label}${res.version ? ` — v${res.version}` : ""}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="gap-1.5"
        onClick={openDialog}
        disabled={!confirmed}
        title={
          confirmed
            ? "Save this confirmed take-off to the shared house bank"
            : "Confirm the take-off first — only confirmed numbers go in the house bank"
        }
      >
        <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {linkedLabel ?? "Save to house bank"}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} label="Save to house bank" className="max-w-lg">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Save to house bank</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {loading && (
            <p className="flex items-center gap-2 text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the house bank…
            </p>
          )}

          {done && (
            <div className="rounded-md border border-hairline-strong bg-surface px-3 py-2">
              <p className="font-medium text-ink">Saved: {done}</p>
              <button type="button" className="mt-1 text-xs text-ink-muted hover:text-ink" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          )}

          {options && !done && (
            <>
              <div>
                <p className="font-medium text-ink">
                  {options.houseTypeName}
                  {options.houseTypeCode && <span className="ml-1.5 text-ink-subtle">{options.houseTypeCode}</span>}
                </p>
                <p className="text-xs text-ink-subtle">
                  {options.builder}
                  {options.summary &&
                    ` · ${options.summary.perLiftM} m${options.summary.lifts != null ? ` × ${options.summary.lifts} lifts` : ""}${
                      options.summary.birdcageFloors > 0
                        ? ` · birdcage ${options.summary.birdcageM2} m² × ${options.summary.birdcageFloors}`
                        : ""
                    }`}
                </p>
              </div>

              {options.candidates.length === 0 ? (
                <p className="text-ink-muted">Nothing like this is in the house bank yet.</p>
              ) : (
                <div className="space-y-3">
                  {options.candidates.map((c) => (
                    <CandidateCard
                      key={c.entryId}
                      c={c}
                      linked={options.linked}
                      disabled={saving}
                      onSave={save}
                    />
                  ))}
                </div>
              )}

              <div className="border-t border-hairline pt-3">
                <Button
                  size="sm"
                  variant={options.candidates.length === 0 ? "primary" : "secondary"}
                  disabled={saving}
                  onClick={() => save({ kind: "NEW_ENTRY" }, `${options.houseTypeName} (new house type)`)}
                >
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {options.candidates.length === 0
                    ? `Save “${options.houseTypeName}” as a new house type`
                    : `It's a different house — save as a new house type`}
                </Button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-ink-muted">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

function CandidateCard({
  c,
  linked,
  disabled,
  onSave,
}: {
  c: SaveCandidate;
  linked: SaveOptions["linked"];
  disabled: boolean;
  onSave: (choice: SaveChoice, label: string) => void;
}) {
  const isLinkedHere =
    linked?.entryId === c.entryId && c.identicalTo && linked.version === c.identicalTo.version;
  return (
    <div className="rounded-md border border-hairline-strong px-3 py-2.5">
      <p className="text-ink">
        <span className="font-medium">{c.name}</span>
        {c.code && <span className="ml-1.5 text-ink-subtle">{c.code}</span>}
        <span className="ml-1.5 text-xs text-ink-subtle">
          · {c.builder} · {c.versionCount} version{c.versionCount === 1 ? "" : "s"}
        </span>
        {c.strength === "POSSIBLE" && (
          <span className="ml-1.5 rounded border border-dashed border-hairline-strong px-1 text-[10px] text-ink-muted">
            similar name
          </span>
        )}
      </p>

      {c.identicalTo ? (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Same numbers as <span className="font-medium text-ink">v{c.identicalTo.version}</span> — nothing new to save.
          </p>
          {isLinkedHere ? (
            <p className="mt-1.5 text-xs font-medium text-ink">Already in the bank as v{c.identicalTo.version}.</p>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={disabled}
              onClick={() => onSave({ kind: "SAME_AS", entryId: c.entryId }, `${c.name} (already saved)`)}
            >
              Yes, it&rsquo;s {c.name} — link it to v{c.identicalTo.version}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            {c.latestVersion != null ? `Differs from v${c.latestVersion}:` : "No saved numbers to compare."}
          </p>
          {c.diffs.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-ink">
              {c.diffs.slice(0, 8).map((d) => (
                <li key={d.field}>
                  {d.label}: {fmt(d.from)} → {fmt(d.to)}
                </li>
              ))}
            </ul>
          )}
          {c.verdict === "DIFFERENT" && (
            <p className="mt-1 text-xs text-ink-muted">
              A big change ({c.bigChanges.join(", ") || "the measurements"}) — make sure it&rsquo;s the same house before
              saving it as a version.
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={disabled}
            onClick={() => onSave({ kind: "NEW_VERSION", entryId: c.entryId }, `${c.name} (new version)`)}
          >
            Save as v{c.nextVersion} of {c.name}
          </Button>
          <p className="mt-1 text-[11px] text-ink-subtle">
            The older version{c.versionCount === 1 ? "" : "s"} stay{c.versionCount === 1 ? "s" : ""} exactly as saved.
          </p>
        </>
      )}
    </div>
  );
}

function fmt(v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  return v.toLowerCase().replace(/_/g, " ");
}
