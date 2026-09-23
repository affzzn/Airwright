"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { createConstructionQuote } from "@/server/actions/construction";
import { filesFromDataTransfer, fileKindLabel, uploadConstructionFiles } from "@/components/construction/upload";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, IconButton, Panel } from "@/components/construction/parts";
import { BAND_LABEL, type RateBand } from "@/lib/construction/types";
import { cn, formatBytes } from "@/lib/utils";

const BAND_OPTS = (Object.keys(BAND_LABEL) as RateBand[]).map((b) => ({
  value: b,
  label: BAND_LABEL[b],
}));

/**
 * Start a job. The enquiry files are picked up HERE, so the estimator never
 * lands on an empty job: the quote is created first (the files need its id for
 * the storage path), the files upload, then we open the enquiry step.
 */
export function ConstructionNewForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [reference, setReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [band, setBand] = useState("COMPETITIVE");
  const [durationWeeks, setDurationWeeks] = useState("");
  const [notes, setNotes] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  };

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        const { id } = await createConstructionQuote({
          reference,
          customerName,
          siteAddress,
          band,
          durationWeeks: durationWeeks ? Number(durationWeeks) : null,
          notes,
        });
        if (files.length > 0) await uploadConstructionFiles(id, files);
        router.push(`/construction/${id}?step=enquiry`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the job.");
      }
    });
  };

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel title="Job details">
            <div className="flex flex-col gap-4">
              <Field label="Job reference" htmlFor="q-ref">
                <Input
                  id="q-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Wren Park"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer" htmlFor="q-cust">
                  <Input
                    id="q-cust"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Stepnell"
                  />
                </Field>
                <Field label="Site address" htmlFor="q-site">
                  <Input
                    id="q-site"
                    value={siteAddress}
                    onChange={(e) => setSiteAddress(e.target.value)}
                    placeholder="Town or site name"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Rate band" htmlFor="q-band">
                  <Select id="q-band" value={band} onChange={(e) => setBand(e.target.value)}>
                    {BAND_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Hire duration (weeks)" htmlFor="q-weeks">
                  <Input
                    id="q-weeks"
                    inputMode="numeric"
                    value={durationWeeks}
                    onChange={(e) => setDurationWeeks(e.target.value)}
                    placeholder="4"
                    className="tabular-nums"
                  />
                </Field>
              </div>
              <Field label="Scope note for the quote" htmlFor="q-notes">
                <textarea
                  id="q-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  className="w-full resize-y rounded-lg border border-hairline-strong bg-canvas p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
                />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <Panel title="Enquiry files">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(await filesFromDataTransfer(e.dataTransfer));
              }}
              className={cn(
                "rounded-xl border border-dashed border-hairline-strong bg-surface/60 px-5 py-7 text-center transition-colors",
                dragOver && "border-ink bg-surface",
              )}
            >
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-canvas">
                <UploadCloud className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
              </span>
              <p className="text-sm font-semibold text-ink">Drop files here</p>
              <p className="mt-1 text-xs text-ink-muted">Email, drawings, scope of works</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                className="mt-3.5"
                onClick={() => inputRef.current?.click()}
              >
                Browse files
              </Button>
            </div>

            {files.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-3 rounded-lg border border-hairline px-3 py-2"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{f.name}</span>
                      <span className="block text-[11px] text-ink-muted">{formatBytes(f.size)}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                      {fileKindLabel(f.type, f.name)}
                    </span>
                    <IconButton
                      label="Remove file"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-ink">{error}</p>}

      <div className="mt-5 flex items-center justify-end gap-3">
        <Link href="/construction">
          <Button variant="ghost">Cancel</Button>
        </Link>
        <Button onClick={submit} disabled={pending} className="gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {pending && files.length > 0 ? "Uploading" : "Create job"}
        </Button>
      </div>
    </div>
  );
}
