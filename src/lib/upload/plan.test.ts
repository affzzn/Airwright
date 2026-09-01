import { describe, it, expect } from "vitest";
import { isUploadableName, isArchiveName, normalizeRelativePath } from "./plan";

describe("upload plan helpers", () => {
  it("accepts PDFs and ZIPs only", () => {
    expect(isUploadableName("Front Elevation.pdf")).toBe(true);
    expect(isUploadableName("pack.ZIP")).toBe(true);
    expect(isUploadableName("notes.txt")).toBe(false);
    expect(isUploadableName("thumb.png")).toBe(false);
    expect(isUploadableName(".DS_Store")).toBe(false);
  });

  it("detects archives", () => {
    expect(isArchiveName("pack.zip")).toBe(true);
    expect(isArchiveName("drawing.pdf")).toBe(false);
  });

  it("normalises browser relative paths", () => {
    expect(normalizeRelativePath("/VISTRY/Scaffold/Aspen/x.pdf", "x.pdf")).toBe(
      "VISTRY/Scaffold/Aspen/x.pdf",
    );
    expect(normalizeRelativePath("./A//B/x.pdf", "x.pdf")).toBe("A/B/x.pdf");
    expect(normalizeRelativePath("A\\B\\x.pdf", "x.pdf")).toBe("A/B/x.pdf");
    expect(normalizeRelativePath("", "x.pdf")).toBe("x.pdf");
  });
});
