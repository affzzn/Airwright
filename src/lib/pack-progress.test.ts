import { describe, it, expect } from "vitest";
import { computePackProgress } from "./pack-progress";

const status = (steps: ReturnType<typeof computePackProgress>["steps"], key: string) =>
  steps.find((s) => s.key === key)!.status;

describe("computePackProgress", () => {
  it("is Unpacking while an upload is still PENDING", () => {
    const { steps, complete } = computePackProgress({
      uploads: [{ status: "PENDING" }],
      documents: [],
      extractions: [],
    });
    expect(status(steps, "unpacking")).toBe("active");
    expect(status(steps, "classifying")).toBe("pending");
    expect(complete).toBe(false);
  });

  it("is Classifying once unpacked but a document is unclassified", () => {
    const { steps } = computePackProgress({
      uploads: [{ status: "PROCESSED" }],
      documents: [{ classifiedAt: null, isReadable: true }],
      extractions: [],
    });
    expect(status(steps, "unpacking")).toBe("done");
    expect(status(steps, "classifying")).toBe("active");
  });

  it("is Reading while an extraction is in progress, with counts", () => {
    const { steps } = computePackProgress({
      uploads: [{ status: "PROCESSED" }],
      documents: [{ classifiedAt: new Date(), isReadable: true }],
      extractions: [
        { status: "COMPLETED" },
        { status: "PROCESSING" },
        { status: "PENDING" },
      ],
    });
    expect(status(steps, "classifying")).toBe("done");
    const reading = steps.find((s) => s.key === "reading")!;
    expect(reading.status).toBe("active");
    expect(reading.detail).toBe("1/3 house types");
  });

  it("is complete when everything is terminal", () => {
    const { steps, complete } = computePackProgress({
      uploads: [{ status: "PROCESSED" }],
      documents: [{ classifiedAt: new Date(), isReadable: true }],
      extractions: [{ status: "COMPLETED" }, { status: "FAILED" }],
    });
    expect(complete).toBe(true);
    expect(status(steps, "done")).toBe("done");
    expect(status(steps, "reading")).toBe("done");
  });

  it("ignores unreadable (flagged) documents for the classifying step", () => {
    const { complete } = computePackProgress({
      uploads: [{ status: "PROCESSED" }],
      documents: [{ classifiedAt: null, isReadable: false }],
      extractions: [],
    });
    // An unreadable doc is flagged, not pending classification → not blocking.
    expect(complete).toBe(true);
  });
});
