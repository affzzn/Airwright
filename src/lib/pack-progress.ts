/**
 * Derives the real processing stage of a tender pack from live DB state — not a
 * fake/demo animation. Each step's status reflects actual rows:
 *   Uploaded    → a PackUpload exists
 *   Unpacking   → a PackUpload is still PENDING (being turned into Documents)
 *   Classifying → a Document has not been classified yet
 *   Reading     → an Extraction is PENDING/PROCESSING (Claude is reading)
 *   Done        → none of the above
 */

export type StepStatus = "done" | "active" | "pending";

export interface ProgressStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface PackProgressInput {
  uploads: { status: string }[];
  documents: { classifiedAt: Date | null; isReadable: boolean }[];
  extractions: { status: string }[];
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function computePackProgress(input: PackProgressInput): {
  steps: ProgressStep[];
  complete: boolean;
} {
  const { uploads, documents, extractions } = input;

  const hasUploads = uploads.length > 0;
  const unpacking = uploads.some((u) => u.status === "PENDING");
  const hasDocs = documents.length > 0;
  const classifying = documents.some(
    (d) => d.classifiedAt === null && d.isReadable,
  );
  const classifiedDocs = documents.filter((d) => d.classifiedAt !== null).length;
  const hasExtractions = extractions.length > 0;
  const reading = extractions.some(
    (e) => e.status === "PENDING" || e.status === "PROCESSING",
  );
  const doneExtractions = extractions.filter(
    (e) => e.status === "COMPLETED" || e.status === "FAILED",
  ).length;

  const complete = hasUploads && !unpacking && !classifying && !reading;

  const steps: ProgressStep[] = [
    {
      key: "uploaded",
      label: "Uploaded",
      status: hasUploads ? "done" : "pending",
    },
    {
      key: "unpacking",
      label: "Unpacking",
      status: unpacking ? "active" : hasUploads ? "done" : "pending",
      detail: unpacking ? count(uploads.length, "file") : undefined,
    },
    {
      key: "classifying",
      label: "Classifying",
      status: classifying
        ? "active"
        : hasDocs && !unpacking
          ? "done"
          : "pending",
      detail: classifying
        ? `${classifiedDocs}/${documents.length} documents`
        : undefined,
    },
    {
      key: "reading",
      label: "Reading",
      status: reading
        ? "active"
        : hasExtractions && !classifying && !unpacking
          ? "done"
          : "pending",
      detail: reading
        ? `${doneExtractions}/${extractions.length} house types`
        : undefined,
    },
    {
      key: "done",
      label: "Done",
      status: complete ? "done" : "pending",
    },
  ];

  return { steps, complete };
}
