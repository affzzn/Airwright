import { describe, expect, it } from "vitest";
import {
  defaultStep,
  enquiryRead,
  issueChecks,
  jobSteps,
  missingFacts,
  nextAction,
  type JobFacts,
} from "./jobState";

const base: JobFacts = {
  status: "DRAFT",
  attachmentCount: 0,
  readableCount: 0,
  readCount: 0,
  hasEnquiryText: false,
  siteType: null,
  buildingHeightM: null,
  heightBracket: null,
  durationWeeks: null,
  lineCount: 0,
  unpricedCount: 0,
  perLiftMissingLifts: 0,
  measurementCount: 0,
  accessPointCount: 0,
  hasFoamLine: false,
  total: 0,
};
const f = (over: Partial<JobFacts> = {}): JobFacts => ({ ...base, ...over });

/** A job in the state the Wren Park example reaches after a full read. */
const wren = f({
  attachmentCount: 6,
  readableCount: 4,
  readCount: 4,
  siteType: "SCHOOL",
  buildingHeightM: 4.955,
  heightBracket: "UP_TO_6M",
  durationWeeks: 10,
  lineCount: 11,
  measurementCount: 6,
  accessPointCount: 8,
  total: 12885.83,
});

describe("enquiryRead", () => {
  it("is true once a file has been read", () => {
    expect(enquiryRead(f({ readCount: 1 }))).toBe(true);
  });

  it("is true when the scope was pasted in instead", () => {
    expect(enquiryRead(f({ hasEnquiryText: true }))).toBe(true);
  });

  it("is false on an untouched job", () => {
    expect(enquiryRead(base)).toBe(false);
  });
});

describe("missingFacts", () => {
  it("counts site type, height and duration", () => {
    expect(missingFacts(base)).toBe(3);
  });

  it("accepts a bracket in place of a measured height", () => {
    expect(missingFacts(f({ siteType: "SCHOOL", heightBracket: "UP_TO_6M", durationWeeks: 4 }))).toBe(0);
  });
});

describe("jobSteps", () => {
  it("flags an unread enquiry for attention", () => {
    const [enquiry] = jobSteps(f({ attachmentCount: 4, readableCount: 4 }));
    expect(enquiry.status).toBe("attention");
    expect(enquiry.hint).toBe("4 files, not read");
  });

  it("marks the enquiry done once read", () => {
    const [enquiry] = jobSteps(wren);
    expect(enquiry.status).toBe("done");
    expect(enquiry.hint).toBe("4 files read");
  });

  it("puts items in attention while a line is unpriced", () => {
    const steps = jobSteps(f({ ...wren, unpricedCount: 1 }));
    const items = steps.find((s) => s.key === "items");
    expect(items?.status).toBe("attention");
    expect(items?.hint).toBe("11 items, 1 unpriced");
  });

  it("singularises a one file, one item job", () => {
    const steps = jobSteps(f({ attachmentCount: 1, readableCount: 1, lineCount: 1 }));
    expect(steps[0].hint).toBe("1 file, not read");
    expect(steps[2].hint).toBe("1 item");
  });

  it("reports a confirmed job as issued or confirmed", () => {
    expect(jobSteps(f({ ...wren, status: "CONFIRMED" }))[3].hint).toBe("Confirmed");
    expect(jobSteps(f({ ...wren, status: "QUOTED" }))[3].hint).toBe("Issued");
  });

  it("is ready when everything is clear", () => {
    const quote = jobSteps(f({ ...wren, hasFoamLine: true }))[3];
    expect(quote.status).toBe("done");
    expect(quote.hint).toBe("Ready");
  });
});

describe("issueChecks", () => {
  it("passes every check on a complete job", () => {
    const open = issueChecks(f({ ...wren, hasFoamLine: true })).filter((c) => !c.done);
    expect(open).toHaveLength(0);
  });

  it("raises the foam decision only when access points were counted", () => {
    expect(issueChecks(wren).some((c) => c.key === "foam")).toBe(true);
    expect(issueChecks(f({ ...wren, accessPointCount: 0 })).some((c) => c.key === "foam")).toBe(false);
  });

  it("fails the rate check and points at the items step", () => {
    const rates = issueChecks(f({ ...wren, unpricedCount: 1 })).find((c) => c.key === "rates");
    expect(rates?.done).toBe(false);
    expect(rates?.step).toBe("items");
    expect(rates?.detail).toBe("1 item at £0");
  });
});

describe("nextAction", () => {
  it("asks for files on an empty job", () => {
    expect(nextAction(base)).toEqual({ step: "enquiry", label: "Add files" });
  });

  it("offers the read when files are waiting", () => {
    expect(nextAction(f({ attachmentCount: 4, readableCount: 4 }))).toEqual({
      step: "enquiry",
      label: "Read enquiry",
    });
  });

  it("prioritises unpriced lines over missing facts", () => {
    expect(nextAction(f({ ...wren, unpricedCount: 1, siteType: null }))).toEqual({
      step: "items",
      label: "Set rates",
    });
  });

  it("is ready to issue when nothing is outstanding", () => {
    expect(nextAction(wren)).toEqual({ step: "quote", label: "Ready to issue" });
  });

  it("sends a confirmed job to the quote", () => {
    expect(nextAction(f({ ...wren, status: "CONFIRMED" })).label).toBe("Issue quote");
  });
});

describe("defaultStep", () => {
  it("opens an unread job on the enquiry", () => {
    expect(defaultStep(f({ attachmentCount: 3, readableCount: 3 }))).toBe("enquiry");
  });

  it("opens a job with items on the items step", () => {
    expect(defaultStep(wren)).toBe("items");
  });

  it("opens a confirmed job on the quote", () => {
    expect(defaultStep(f({ ...wren, status: "CONFIRMED" }))).toBe("quote");
  });
});
