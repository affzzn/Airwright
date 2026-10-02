"use client";

import { useRef, useState } from "react";
import { FileText, FolderUp, Mail, Ruler, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/construction/parts";
import { filesFromDataTransfer, filesFromInput, type FileWithPath } from "@/components/construction/upload";
import type { EnquiryBox } from "@/lib/construction/pack/files";
import { cn, formatBytes } from "@/lib/utils";

/**
 * The three upload boxes (2026-10-02): Scope · Drawings · Email, all optional.
 * The box a file goes into is its label — nothing is guessed — and the boxes
 * decide the scenario: a scope → Scenario 1, drawings and no scope → 2, else 3.
 */

export const BOX_COPY: Record<EnquiryBox, { title: string; body: string; folder: boolean }> = {
  SCOPE: {
    title: "Scope",
    body: "The client's schedule or scope of works (spreadsheet, PDF or Word). It is priced as written.",
    folder: false,
  },
  DRAWINGS: {
    title: "Drawings",
    body: "A folder, a zip or loose files. Tidied for you: junk and duplicates out, latest revision kept, grouped by building.",
    folder: true,
  },
  EMAIL: {
    title: "Email",
    body: "The enquiry email. With a scope it is read for any extra lines; otherwise it is kept for reference.",
    folder: false,
  },
};

const ICON: Record<EnquiryBox, typeof FileText> = { SCOPE: FileText, DRAWINGS: Ruler, EMAIL: Mail };

export type BoxFiles = Record<EnquiryBox, FileWithPath[]>;

export const emptyBoxes = (): BoxFiles => ({ SCOPE: [], DRAWINGS: [], EMAIL: [] });

/** Every picked file, each tagged with its box, ready for `uploadConstructionPack`. */
export function taggedFiles(boxes: BoxFiles): FileWithPath[] {
  return (Object.keys(boxes) as EnquiryBox[]).flatMap((box) => boxes[box].map((f) => ({ ...f, box })));
}

/**
 * One box. `files` lists what is picked but not yet uploaded (the new-job form);
 * `count` says how many are already on the job (step 1, which uploads at once).
 */
export function BoxDrop({
  box,
  files,
  count,
  disabled,
  compact,
  onAdd,
  onRemove,
  onClear,
}: {
  box: EnquiryBox;
  files?: FileWithPath[];
  count?: number;
  disabled?: boolean;
  compact?: boolean;
  onAdd: (files: FileWithPath[]) => void;
  onRemove?: (index: number) => void;
  onClear?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const copy = BOX_COPY[box];
  const Icon = ICON[box];
  const add = (picked: FileWithPath[]) => picked.length > 0 && onAdd(picked.map((f) => ({ ...f, box })));
  const totalBytes = (files ?? []).reduce((a, f) => a + f.file.size, 0);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) add(await filesFromDataTransfer(e.dataTransfer));
      }}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-dashed border-hairline-strong bg-surface/60 transition-colors",
        compact ? "px-4 py-3" : "px-4 py-4",
        dragOver && "border-ink bg-surface",
      )}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          add(filesFromInput(e.target.files));
          e.target.value = "";
        }}
      />
      {copy.folder && (
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            add(filesFromInput(e.target.files));
            e.target.value = "";
          }}
        />
      )}
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-canvas">
          <Icon className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">
            {copy.title}
            <span className="ml-1.5 font-normal text-ink-subtle">optional</span>
            {count != null && count > 0 && <span className="ml-1.5 font-normal text-ink-muted">· {count} file{count === 1 ? "" : "s"}</span>}
          </p>
          {!compact && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{copy.body}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {copy.folder && (
          <Button size="sm" variant="secondary" className="gap-1.5" disabled={disabled} onClick={() => folderRef.current?.click()}>
            <FolderUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            Folder
          </Button>
        )}
        <Button size="sm" variant="secondary" className="gap-1.5" disabled={disabled} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
          {copy.folder ? "Files or zip" : "Files"}
        </Button>
      </div>

      {files && files.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-ink">
              {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
            </span>
            {onClear && (
              <button type="button" onClick={onClear} disabled={disabled} className="text-[11px] font-semibold text-ink-muted hover:text-ink">
                Clear
              </button>
            )}
          </div>
          {files.length <= 8 ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {files.map((f, i) => (
                <li key={f.relativePath} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{f.relativePath}</span>
                  {onRemove && (
                    <IconButton label="Remove file" disabled={disabled} onClick={() => onRemove(i)}>
                      <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 truncate text-[11px] text-ink-muted">
              {[...new Set(files.map((f) => (f.relativePath.includes("/") ? f.relativePath.split("/")[0] : "loose files")))].join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Which scenario the picked boxes will give — shown before the job is created. */
export function scenarioPreview(boxes: { SCOPE: number; DRAWINGS: number; EMAIL: number }): "A" | "B" | "C" {
  if (boxes.SCOPE > 0) return "A";
  if (boxes.DRAWINGS > 0) return "B";
  return "C";
}
