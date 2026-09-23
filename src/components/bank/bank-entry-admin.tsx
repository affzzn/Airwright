"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  renameBankEntry,
  updateBankAliases,
  archiveBankEntry,
  mergeBankEntries,
} from "@/server/actions/bank";

/**
 * Admin controls for a bank entry (docs/20 §7): rename / set canonical code, edit
 * the learned aliases, merge a duplicate entry into this one, and archive. All
 * human-in-the-loop — the bank is company-owned, so a person curates it.
 */
export function BankEntryAdmin({
  entryId,
  name,
  code,
  aliases,
  archived,
  mergeable,
}: {
  entryId: string;
  name: string;
  code: string | null;
  aliases: string[];
  archived: boolean;
  mergeable: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [nameV, setNameV] = useState(name);
  const [codeV, setCodeV] = useState(code ?? "");
  const [aliasList, setAliasList] = useState<string[]>(aliases);
  const [newAlias, setNewAlias] = useState("");
  const [mergeId, setMergeId] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-ink">Manage</h2>
      </CardHeader>
      <CardBody className="space-y-6">
        {/* Rename / canonical code */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-ink-subtle">Canonical name</label>
          <input
            value={nameV}
            onChange={(e) => setNameV(e.target.value)}
            className="w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink"
          />
          <label className="text-xs font-medium text-ink-subtle">Code</label>
          <input
            value={codeV}
            onChange={(e) => setCodeV(e.target.value)}
            placeholder="—"
            className="w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-ink"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || (nameV.trim() === name && (codeV.trim() || null) === code)}
            onClick={() => run(() => renameBankEntry(entryId, nameV, codeV || null))}
          >
            Save name
          </Button>
        </div>

        {/* Aliases */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-ink-subtle">
            Aliases — other names/codes that mean this type
          </label>
          {aliasList.length === 0 ? (
            <p className="text-xs text-ink-subtle">None learned yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {aliasList.map((a) => (
                <li
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline-strong bg-surface px-2 py-0.5 text-xs text-ink"
                >
                  {a}
                  <button
                    type="button"
                    aria-label={`Remove ${a}`}
                    onClick={() => {
                      const next = aliasList.filter((x) => x !== a);
                      setAliasList(next);
                      run(() => updateBankAliases(entryId, next));
                    }}
                    className="text-ink-subtle hover:text-ink"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="Add an alias…"
              className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-ink"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || !newAlias.trim()}
              onClick={() => {
                const next = [...aliasList, newAlias.trim()];
                setAliasList(next);
                setNewAlias("");
                run(() => updateBankAliases(entryId, next));
              }}
            >
              Add
            </Button>
          </div>
        </div>

        {/* Merge */}
        {mergeable.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-subtle">
              Merge a duplicate into this one
            </label>
            <select
              value={mergeId}
              onChange={(e) => setMergeId(e.target.value)}
              className="w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <option value="">Select an entry…</option>
              {mergeable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || !mergeId}
              onClick={() => {
                if (!mergeId) return;
                if (!confirm("Merge the selected entry into this one? Its versions and links move here, and it is deleted.")) return;
                run(async () => {
                  const res = await mergeBankEntries(entryId, mergeId);
                  if (res.ok) setMergeId("");
                  return res;
                });
              }}
            >
              Merge in
            </Button>
          </div>
        )}

        {/* Archive */}
        <div className="border-t border-hairline pt-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => archiveBankEntry(entryId, !archived))}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </div>

        {error && <p className="text-xs text-ink-muted">{error}</p>}
      </CardBody>
    </Card>
  );
}
