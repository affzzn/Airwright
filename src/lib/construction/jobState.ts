/**
 * The construction job's STEP STATE — pure, unit-tested (no Prisma, no React).
 *
 * A construction job runs in four steps: read the enquiry, confirm the site
 * facts, build the items, issue the quote. This module derives, from a flat set
 * of facts about a quote, (a) each step's status + one short hint, (b) the
 * pre-issue checks, and (c) the single next action to offer on the jobs list.
 *
 * Copy here is deliberately terse: the screens are meant to read at a glance.
 */

import { isDraftableFile, looksLikeOurOwnQuote } from "./fileKinds";
import { PER_LIFT_UNITS, type ConstructionUnit } from "./types";

export type JobStep = "enquiry" | "facts" | "items" | "quote";

export const JOB_STEPS: { key: JobStep; label: string }[] = [
  { key: "enquiry", label: "Enquiry" },
  { key: "facts", label: "Site facts" },
  { key: "items", label: "Scaffold items" },
  { key: "quote", label: "Quote" },
];

export type StepStatus = "done" | "attention" | "todo";

export interface JobStepState {
  key: JobStep;
  label: string;
  status: StepStatus;
  /** A few words, shown under the step label. Never a sentence. */
  hint: string;
}

/** Everything the step logic needs, flattened off a loaded quote. */
export interface JobFacts {
  status: string; // DRAFT | CONFIRMED | QUOTED
  attachmentCount: number;
  /** Attachments the AI is allowed to read (draftable, not an answer file). */
  readableCount: number;
  /** Attachments already read. */
  readCount: number;
  hasEnquiryText: boolean;
  siteType: string | null;
  buildingHeightM: number | null;
  heightBracket: string | null;
  durationWeeks: number | null;
  lineCount: number;
  unpricedCount: number;
  perLiftMissingLifts: number;
  measurementCount: number;
  /** Doorways + fire exits + walk-unders read or entered. */
  accessPointCount: number;
  /** True when a foam line is already on the quote. */
  hasFoamLine: boolean;
  total: number;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The minimum shape `factsFromQuote` reads. Structural, so both the server
 *  loaders and the client screens can build facts from the same code. */
export interface QuoteShapeForFacts {
  status: string;
  siteType: string | null;
  buildingHeightM: number | null;
  defaultHeightBracket: string | null;
  durationWeeks: number | null;
  doorwayCount: number | null;
  fireExitCount: number | null;
  pedestrianAccessCount: number | null;
  hasEnquiryText: boolean;
  lines: {
    unit: string;
    quantity: number;
    lifts: number | null;
    rate: number;
    amount: number;
    description: string;
  }[];
  measurements: unknown[];
  attachments: {
    fileName: string;
    mimeType: string;
    readStatus: string | null;
  }[];
}

/** Flatten a loaded quote into the facts the step logic runs on. */
export function factsFromQuote(q: QuoteShapeForFacts): JobFacts {
  const readable = q.attachments.filter(
    (a) => isDraftableFile(a.mimeType, a.fileName) && !looksLikeOurOwnQuote(a.fileName),
  );
  return {
    status: q.status,
    attachmentCount: q.attachments.length,
    readableCount: readable.length,
    readCount: readable.filter((a) => a.readStatus === "READ").length,
    hasEnquiryText: q.hasEnquiryText,
    siteType: q.siteType,
    buildingHeightM: q.buildingHeightM,
    heightBracket: q.defaultHeightBracket,
    durationWeeks: q.durationWeeks,
    lineCount: q.lines.length,
    unpricedCount: q.lines.filter((l) => l.rate <= 0 && l.quantity > 0).length,
    perLiftMissingLifts: q.lines.filter(
      (l) => PER_LIFT_UNITS.has(l.unit as ConstructionUnit) && (l.lifts == null || l.lifts <= 0),
    ).length,
    measurementCount: q.measurements.length,
    accessPointCount:
      (q.doorwayCount ?? 0) + (q.fireExitCount ?? 0) + (q.pedestrianAccessCount ?? 0),
    hasFoamLine: q.lines.some((l) => /foam/i.test(l.description)),
    total: q.lines.reduce((a, l) => a + l.amount, 0),
  };
}

/** Has the enquiry been read, or has the estimator pasted the scope in? */
export function enquiryRead(f: JobFacts): boolean {
  return f.readCount > 0 || f.hasEnquiryText;
}

/** How many site facts are still missing (site type, height/band, duration). */
export function missingFacts(f: JobFacts): number {
  let n = 0;
  if (!f.siteType) n++;
  if (f.buildingHeightM == null && !f.heightBracket) n++;
  if (f.durationWeeks == null || f.durationWeeks <= 0) n++;
  return n;
}

/** The four steps with a status and a short hint each. */
export function jobSteps(f: JobFacts): JobStepState[] {
  const read = enquiryRead(f);
  const missing = missingFacts(f);

  const enquiry: JobStepState = {
    key: "enquiry",
    label: "Enquiry",
    status: read ? "done" : f.readableCount > 0 ? "attention" : "todo",
    hint: read
      ? f.readCount > 0
        ? `${plural(f.readCount, "file")} read`
        : "Scope added"
      : f.attachmentCount > 0
        ? `${plural(f.readableCount, "file")}, not read`
        : "No files yet",
  };

  const facts: JobStepState = {
    key: "facts",
    label: "Site facts",
    status: missing === 0 ? "done" : "attention",
    hint:
      missing === 0
        ? [f.siteType ? siteTypeShort(f.siteType) : null, bracketShort(f.heightBracket)]
            .filter(Boolean)
            .join(", ") || "Confirmed"
        : `${missing} to confirm`,
  };

  const items: JobStepState = {
    key: "items",
    label: "Scaffold items",
    status:
      f.lineCount === 0
        ? "todo"
        : f.unpricedCount > 0 || f.perLiftMissingLifts > 0
          ? "attention"
          : "done",
    hint:
      f.lineCount === 0
        ? "None yet"
        : f.unpricedCount > 0
          ? `${plural(f.lineCount, "item")}, ${f.unpricedCount} unpriced`
          : plural(f.lineCount, "item"),
  };

  const open = issueChecks(f).filter((c) => !c.done).length;
  const quote: JobStepState = {
    key: "quote",
    label: "Quote",
    status: f.status !== "DRAFT" ? "done" : open === 0 && f.lineCount > 0 ? "done" : "todo",
    hint:
      f.status === "QUOTED"
        ? "Issued"
        : f.status === "CONFIRMED"
          ? "Confirmed"
          : f.lineCount === 0
            ? "Not ready"
            : open > 0
              ? `${open} to clear`
              : "Ready",
  };

  return [enquiry, facts, items, quote];
}

export interface IssueCheck {
  key: string;
  title: string;
  /** A few words of evidence. Never a sentence with a full stop. */
  detail: string;
  done: boolean;
  /** Where to go to clear it. */
  step: JobStep;
  action: string;
}

/** The pre-issue checklist (docs/19 §11), as a gate on the quote step. */
export function issueChecks(f: JobFacts): IssueCheck[] {
  const checks: IssueCheck[] = [
    {
      key: "items",
      title: "Items added",
      detail: f.lineCount > 0 ? plural(f.lineCount, "item") : "None yet",
      done: f.lineCount > 0,
      step: "items",
      action: "Add items",
    },
    {
      key: "rates",
      title: "Every item priced",
      detail:
        f.unpricedCount > 0 ? `${plural(f.unpricedCount, "item")} at £0` : "All have a rate",
      done: f.unpricedCount === 0,
      step: "items",
      action: "Set rates",
    },
    {
      key: "lifts",
      title: "Lifts set",
      detail:
        f.perLiftMissingLifts > 0
          ? `${plural(f.perLiftMissingLifts, "line")} without lifts`
          : "All per-lift lines",
      done: f.perLiftMissingLifts === 0,
      step: "items",
      action: "Set lifts",
    },
    {
      key: "hire",
      title: "Hire duration",
      detail:
        f.durationWeeks != null && f.durationWeeks > 0
          ? `${plural(f.durationWeeks, "week")} inclusive`
          : "Not set",
      done: f.durationWeeks != null && f.durationWeeks > 0,
      step: "facts",
      action: "Set duration",
    },
    {
      key: "height",
      title: "Height band",
      detail:
        f.buildingHeightM != null || f.heightBracket
          ? [f.buildingHeightM != null ? `${f.buildingHeightM} m` : null, bracketShort(f.heightBracket)]
              .filter(Boolean)
              .join(", ")
          : "Not set",
      done: f.buildingHeightM != null || f.heightBracket != null,
      step: "facts",
      action: "Set height",
    },
    {
      key: "measurements",
      title: "Measurements recorded",
      detail:
        f.measurementCount > 0 ? plural(f.measurementCount, "measurement") : "None recorded",
      done: f.measurementCount > 0,
      step: "items",
      action: "Add one",
    },
  ];

  // Foam is never priced automatically (docs/20). If the drawings counted access
  // points and no foam line exists, the estimator has to make that call.
  if (f.accessPointCount > 0) {
    checks.push({
      key: "foam",
      title: "Foam decision",
      detail: f.hasFoamLine
        ? "Foam priced"
        : `${plural(f.accessPointCount, "access point")}, no foam`,
      done: f.hasFoamLine,
      step: "facts",
      action: "Decide",
    });
  }

  return checks;
}

/** The one action the jobs list offers for a job. */
export function nextAction(f: JobFacts): { step: JobStep; label: string } {
  if (f.status === "QUOTED") return { step: "quote", label: "View quote" };
  if (f.status === "CONFIRMED") return { step: "quote", label: "Issue quote" };
  if (!enquiryRead(f) && f.readableCount > 0) return { step: "enquiry", label: "Read enquiry" };
  if (f.attachmentCount === 0 && f.lineCount === 0) return { step: "enquiry", label: "Add files" };
  if (f.lineCount === 0) return { step: "items", label: "Add items" };
  if (f.unpricedCount > 0) return { step: "items", label: "Set rates" };
  if (missingFacts(f) > 0) return { step: "facts", label: "Confirm site facts" };
  if (f.perLiftMissingLifts > 0) return { step: "items", label: "Set lifts" };
  return { step: "quote", label: "Ready to issue" };
}

/** Which step to land on when a job is opened without one named. */
export function defaultStep(f: JobFacts): JobStep {
  if (f.status !== "DRAFT") return "quote";
  if (f.lineCount > 0) return "items";
  if (!enquiryRead(f)) return "enquiry";
  return "items";
}

const SITE_SHORT: Record<string, string> = {
  SCHOOL: "School",
  PUBLIC_STREET: "Public street",
  CONSTRUCTION_SITE: "Site",
  COMMERCIAL: "Commercial",
  OTHER: "Other",
};
function siteTypeShort(s: string): string {
  return SITE_SHORT[s] ?? s;
}

const BRACKET_SHORT: Record<string, string> = {
  UP_TO_6M: "up to 6 m",
  H6_12M: "6 to 12 m",
  H12_18M: "12 to 18 m",
  H18_24M: "18 to 24 m",
  ANY: "any height",
};
function bracketShort(b: string | null): string {
  return b ? (BRACKET_SHORT[b] ?? b) : "";
}
