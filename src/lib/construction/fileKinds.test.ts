import { describe, expect, it } from "vitest";
import {
  isDraftableFile,
  isDrawingFile,
  isScopeTextFile,
  looksLikeOurOwnQuote,
} from "./fileKinds";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("isDrawingFile", () => {
  it("takes a PDF by type or by extension", () => {
    expect(isDrawingFile("application/pdf", "Wren - Scaffolding Measure.pdf")).toBe(true);
    expect(isDrawingFile("", "wren park roofing plan.PDF")).toBe(true);
  });

  it("is not a spreadsheet or an email", () => {
    expect(isDrawingFile(XLSX, "Wren - Scaffolding Schedule.xlsx")).toBe(false);
    expect(isDrawingFile("message/rfc822", "Re_ Scaffolding quote.eml")).toBe(false);
  });
});

describe("isScopeTextFile", () => {
  it("reads the client's schedule or scope spreadsheet", () => {
    expect(isScopeTextFile(XLSX, "Wren - Scaffolding Schedule.xlsx")).toBe(true);
    expect(isScopeTextFile("", "scope of works.xls")).toBe(true);
    expect(isScopeTextFile("", "take off.csv")).toBe(true);
  });

  it("reads the enquiry email", () => {
    expect(isScopeTextFile("message/rfc822", "Re_ Scaffolding quote - Wren Park.eml")).toBe(true);
    expect(isScopeTextFile("", "enquiry.eml")).toBe(true);
  });

  it("leaves drawings and photos to the other readers", () => {
    expect(isScopeTextFile("application/pdf", "elevation.pdf")).toBe(false);
    expect(isScopeTextFile("image/jpeg", "site.jpg")).toBe(false);
  });
});

describe("isDraftableFile", () => {
  it("covers everything the readers understand", () => {
    expect(isDraftableFile("application/pdf", "measure.pdf")).toBe(true);
    expect(isDraftableFile(XLSX, "Wren - Scaffolding Schedule.xlsx")).toBe(true);
    expect(isDraftableFile("message/rfc822", "enquiry.eml")).toBe(true);
  });

  it("excludes what they cannot read", () => {
    expect(isDraftableFile("image/png", "site photo.png")).toBe(false);
    expect(
      isDraftableFile(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "logistics.pptx",
      ),
    ).toBe(false);
  });
});

describe("looksLikeOurOwnQuote", () => {
  // User-confirmed 2026-09-24: a client's scaffolding SCHEDULE is an enquiry
  // document (the "scope of works (Excel)" shape), not our own answer. Only our
  // numbered quote output is held back.
  it("holds back our own numbered quote", () => {
    expect(looksLikeOurOwnQuote("Quote-1375-1-1.pdf")).toBe(true);
    expect(looksLikeOurOwnQuote("quote_1375.pdf")).toBe(true);
    expect(looksLikeOurOwnQuote(" Quote 2210.pdf")).toBe(true);
  });

  it("does NOT hold back the client's scaffolding schedule", () => {
    expect(looksLikeOurOwnQuote("Wren - Scaffolding Schedule.xlsx")).toBe(false);
    expect(looksLikeOurOwnQuote("schedule of works.xlsx")).toBe(false);
  });

  it("does not catch an enquiry email that mentions a quote", () => {
    expect(looksLikeOurOwnQuote("Re_ Scaffolding quote - Wren Park.eml")).toBe(false);
  });
});
