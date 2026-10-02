"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createConstructionQuote } from "@/server/actions/construction";
import { uploadConstructionPack, type FileWithPath, type UploadProgress } from "@/components/construction/upload";
import { BoxDrop, emptyBoxes, scenarioPreview, taggedFiles, type BoxFiles } from "@/components/construction/enquiry-boxes";
import { ProgressBar } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Panel } from "@/components/construction/parts";
import { ENQUIRY_BOXES, SCENARIO_COPY, type EnquiryBox } from "@/lib/construction/pack/files";
import { BAND_LABEL, type RateBand } from "@/lib/construction/types";

const BAND_OPTS = (Object.keys(BAND_LABEL) as RateBand[]).map((b) => ({
  value: b,
  label: BAND_LABEL[b],
}));

/**
 * Start a job. The enquiry files are picked up HERE, in three boxes (Scope ·
 * Drawings · Email, all optional), so the estimator never lands on an empty job:
 * the quote is created first (the files need its id for the storage path), the
 * files upload with their box, then we open the enquiry step. The boxes decide
 * the scenario.
 */
export function ConstructionNewForm() {
  const router = useRouter();

  const [reference, setReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [band, setBand] = useState("COMPETITIVE");
  const [durationWeeks, setDurationWeeks] = useState("");
  const [notes, setNotes] = useState("");

  const [boxes, setBoxes] = useState<BoxFiles>(emptyBoxes);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  // A file's path is its identity on the job, so one path sits in one box only.
  const addFiles = (box: EnquiryBox, incoming: FileWithPath[]) =>
    setBoxes((prev) => {
      const seen = new Set(taggedFiles(prev).map((f) => f.relativePath));
      return { ...prev, [box]: [...prev[box], ...incoming.filter((f) => !seen.has(f.relativePath))] };
    });
  const files = taggedFiles(boxes);
  const scenario = SCENARIO_COPY[scenarioPreview({ SCOPE: boxes.SCOPE.length, DRAWINGS: boxes.DRAWINGS.length, EMAIL: boxes.EMAIL.length })];

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
        if (files.length > 0) {
          const p = await uploadConstructionPack(id, files, setProgress);
          if (p.failed > 0 && p.done === 0) throw new Error("The files could not be uploaded — the job was created; add them again from its first step.");
        }
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
            <div className="flex flex-col gap-3">
              {ENQUIRY_BOXES.map((box) => (
                <BoxDrop
                  key={box}
                  box={box}
                  files={boxes[box]}
                  disabled={pending}
                  onAdd={(f) => addFiles(box, f)}
                  onRemove={(idx) => setBoxes((prev) => ({ ...prev, [box]: prev[box].filter((_, k) => k !== idx) }))}
                  onClear={() => setBoxes((prev) => ({ ...prev, [box]: [] }))}
                />
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-hairline px-3.5 py-2.5">
              <p className="text-[13px] font-semibold text-ink">{scenario.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{scenario.body}</p>
            </div>
            {progress && (
              <div className="mt-3">
                <ProgressBar value={progress.bytesTotal ? (progress.bytesDone / progress.bytesTotal) * 100 : 0} />
                <p className="mt-1.5 truncate text-[11px] text-ink-muted">
                  {progress.done} of {progress.total} uploaded
                  {progress.skipped ? ` · ${progress.skipped} already there` : ""}
                  {progress.failed ? ` · ${progress.failed} failed` : ""}
                  {progress.current ? ` · ${progress.current}` : ""}
                </p>
              </div>
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
          {pending && files.length > 0 ? "Uploading" : files.length > 0 ? "Create job and upload" : "Create job"}
        </Button>
      </div>
    </div>
  );
}
