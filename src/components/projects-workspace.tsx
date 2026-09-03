"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  FilePlus2,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  createProject,
  deleteProject,
  setProjectArchived,
} from "@/server/actions/projects";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatDate, cn } from "@/lib/utils";
import { EXTRACTION_MODELS, DEFAULT_MODEL_KEY } from "@/lib/extract/providers/catalog";

export type ProjectStatus = "NEW" | "READING" | "READY" | "QUOTED";

export interface WorkspaceProject {
  id: string;
  name: string;
  clientName: string;
  buildType: "TRADITIONAL" | "TIMBER_FRAME";
  houseTypes: number;
  plots: number;
  createdAt: string; // ISO
  archived: boolean;
  status: ProjectStatus;
  extDone: number;
  extTotal: number;
}

type Filter = "ALL" | ProjectStatus | "ARCHIVED";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "READING", label: "In progress" },
  { key: "READY", label: "Ready" },
  { key: "QUOTED", label: "Quoted" },
  { key: "ARCHIVED", label: "Archived" },
];

export function ProjectsWorkspace({ projects }: { projects: WorkspaceProject[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceProject | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const nonArchived = useMemo(() => projects.filter((p) => !p.archived), [projects]);
  const archived = useMemo(() => projects.filter((p) => p.archived), [projects]);

  const stats = useMemo(
    () => ({
      tenders: nonArchived.length,
      inProgress: nonArchived.filter((p) => p.status === "READING").length,
      awaiting: nonArchived.filter((p) => p.status === "READY").length,
    }),
    [nonArchived],
  );

  const visible = useMemo(() => {
    const base =
      filter === "ARCHIVED"
        ? archived
        : filter === "ALL"
          ? nonArchived
          : nonArchived.filter((p) => p.status === filter);
    const q = query.trim().toLowerCase();
    return q
      ? base.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.clientName.toLowerCase().includes(q),
        )
      : base;
  }, [filter, query, nonArchived, archived]);

  const setArchived = (id: string, value: boolean) => {
    setBusyId(id);
    startTransition(async () => {
      await setProjectArchived(id, value);
      router.refresh();
      setBusyId(null);
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setBusyId(id);
    setDeleteErr(null);
    startTransition(async () => {
      const res = await deleteProject(id);
      if (res?.ok) {
        setDeleteTarget(null);
        router.refresh();
      } else {
        setDeleteErr(res?.error ?? "Couldn’t delete this tender.");
      }
      setBusyId(null);
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Projects</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Tenders</h1>
        </div>
        <Button variant="secondary" onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" strokeWidth={1.75} /> New tender
        </Button>
      </div>

      {/* Stat strip */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="Tenders" value={stats.tenders} />
        <StatCard label="In progress" value={stats.inProgress} />
        <StatCard label="Awaiting review" value={stats.awaiting} />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            strokeWidth={1.75}
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tenders or builders"
            className="pl-9"
            aria-label="Search tenders"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-8 rounded-full border px-3 text-xs transition-colors",
                filter === f.key
                  ? "border-hairline-strong bg-surface-2 font-medium text-ink"
                  : "border-hairline text-ink-muted hover:bg-surface",
              )}
            >
              {f.label}
              {f.key === "ARCHIVED" && archived.length > 0 && (
                <span className="ml-1 tabular-nums opacity-70">{archived.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center text-sm text-ink-subtle">
            {projects.length === 0
              ? "No tenders yet. Create one to upload a pack."
              : filter === "ARCHIVED"
                ? "No archived tenders."
                : "No tenders match your search."}
          </CardBody>
        </Card>
      ) : (
        <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
          {visible.map((p) => (
            <Row
              key={p.id}
              p={p}
              busy={busyId === p.id}
              onArchive={() => setArchived(p.id, !p.archived)}
              onDelete={() => {
                setDeleteErr(null);
                setDeleteTarget(p);
              }}
            />
          ))}
        </div>
      )}

      {/* New tender modal */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        label="New tender"
        className="max-w-lg"
      >
        <div className="flex items-start gap-3.5 border-b border-hairline px-6 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface">
            <FilePlus2 className="h-[18px] w-[18px] text-ink" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">New tender</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Start a new estimate — you can add the drawing pack next.
            </p>
          </div>
        </div>
        <form action={createProject}>
          <div className="space-y-5 px-6 py-5">
            <div>
              <Label htmlFor="clientName">House builder</Label>
              <Input id="clientName" name="clientName" required placeholder="Miller Homes" />
            </div>
            <div>
              <Label htmlFor="projectName">Project / development</Label>
              <Input
                id="projectName"
                name="projectName"
                required
                placeholder="Chesterwood Phase 2"
              />
            </div>
            <div>
              <Label htmlFor="buildType">Build type</Label>
              <Select id="buildType" name="buildType" defaultValue="TRADITIONAL">
                <option value="TRADITIONAL">Traditional</option>
                <option value="TIMBER_FRAME">Timber frame</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="extractionModel">Extraction model</Label>
              <Select
                id="extractionModel"
                name="extractionModel"
                defaultValue={DEFAULT_MODEL_KEY}
              >
                {EXTRACTION_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-ink-subtle">
                Which AI reads this project&rsquo;s drawings. You can compare models per project.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-hairline bg-surface px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <CreateButton />
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => (busyId ? null : setDeleteTarget(null))}
        label="Delete tender"
        className="max-w-md"
      >
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Delete tender</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-ink-muted">
            Permanently delete{" "}
            <span className="font-medium text-ink">{deleteTarget?.name}</span> and its
            pack, house types, and plots. This can’t be undone.
          </p>
          {deleteErr && <p className="mt-3 text-xs text-ink">{deleteErr}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busyId !== null}
              onClick={confirmDelete}
              className="gap-2"
            >
              {busyId === deleteTarget?.id && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Row({
  p,
  busy,
  onArchive,
  onDelete,
}: {
  p: WorkspaceProject;
  busy: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface",
        busy && "opacity-50",
      )}
    >
      <Link href={`/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{p.name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-subtle">
            {p.clientName} · {p.buildType === "TIMBER_FRAME" ? "Timber frame" : "Traditional"}
          </p>
          {p.status === "READING" && p.extTotal > 0 && (
            <div className="mt-1.5 h-[3px] w-32 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-ink-subtle"
                style={{ width: `${Math.round((p.extDone / p.extTotal) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <StatusChip p={p} />
        <div className="hidden w-32 shrink-0 text-right text-xs text-ink-subtle sm:block">
          {p.houseTypes > 0
            ? `${p.houseTypes} type${p.houseTypes === 1 ? "" : "s"}${p.plots > 0 ? ` · ${p.plots} plots` : ""}`
            : "—"}
        </div>
        <div className="hidden w-16 shrink-0 text-right text-xs text-ink-subtle md:block">
          {formatDate(p.createdAt)}
        </div>
      </Link>
      <div className="flex shrink-0 gap-0.5 text-ink-subtle opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={onArchive}
          aria-label={p.archived ? "Unarchive tender" : "Archive tender"}
          title={p.archived ? "Unarchive" : "Archive"}
          className="rounded-md p-1.5 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none"
        >
          {p.archived ? (
            <ArchiveRestore className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Archive className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          aria-label="Delete tender"
          title="Delete"
          className="rounded-md p-1.5 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:pointer-events-none"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function StatusChip({ p }: { p: WorkspaceProject }) {
  const base =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-[11px] text-ink-muted";
  if (p.status === "READY") {
    return (
      <span className={base}>
        <span className="h-1.5 w-1.5 rounded-full bg-ink" />
        Ready to review
      </span>
    );
  }
  if (p.status === "QUOTED") {
    return (
      <span className={base}>
        <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle" />
        Quoted
      </span>
    );
  }
  if (p.status === "READING") {
    return (
      <span className={base}>
        <Loader2 className="h-3 w-3 animate-spin text-ink-subtle" strokeWidth={2} />
        {p.extTotal > 0 ? `Reading ${p.extDone}/${p.extTotal}` : "Reading…"}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-hairline-strong bg-surface px-2.5 py-0.5 text-[11px] text-ink-subtle">
      New
    </span>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
      Create tender
    </Button>
  );
}
