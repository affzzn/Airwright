import { describe, it, expect } from "vitest";
import { findAnswerKeyDoc, crossCheckHouseTypes } from "./answerKey";

describe("findAnswerKeyDoc", () => {
  const docs = [
    { id: "1", fileName: "372_BYRON_ISSUE_4.13.pdf", storagePath: "a" },
    { id: "2", fileName: "BLOOR OADBY PH2A TAKE OFFS.pdf", storagePath: "b" },
    { id: "3", fileName: "Plot Schedule.pdf", storagePath: "c" },
  ];
  it("finds a take-off / schedule / register sheet", () => {
    expect(findAnswerKeyDoc(docs)?.id).toBe("2");
    expect(findAnswerKeyDoc([{ id: "x", fileName: "Drawing Register Rev C.pdf", storagePath: "p" }])?.id).toBe("x");
  });
  it("returns null when none match", () => {
    expect(findAnswerKeyDoc([docs[0]])).toBeNull();
  });
});

describe("crossCheckHouseTypes", () => {
  it("splits matched / missing / extra", () => {
    const cc = crossCheckHouseTypes(["ASPEN", "BEECH"], ["Aspen", "Beech", "Chestnut"]);
    expect(cc.matched.sort()).toEqual(["Aspen", "Beech"]);
    expect(cc.missing).toEqual(["Chestnut"]);
    expect(cc.extra).toEqual([]);
  });
  it("matches names by containment (EMA21 Avonsford ↔ Avonsford)", () => {
    const cc = crossCheckHouseTypes(["EMA21 AVONSFORD"], ["Avonsford"]);
    expect(cc.matched).toEqual(["Avonsford"]);
    expect(cc.missing).toEqual([]);
    expect(cc.extra).toEqual([]);
  });
  it("flags a grouped type that isn't on the sheet as extra", () => {
    const cc = crossCheckHouseTypes(["FOO", "BAR"], ["Bar"]);
    expect(cc.missing).toEqual([]);
    expect(cc.extra).toEqual(["FOO"]);
  });
  it("does not match on a 1–2 char coincidence", () => {
    const cc = crossCheckHouseTypes(["AB"], ["Aardvark Block"]);
    expect(cc.extra).toEqual(["AB"]);
    expect(cc.missing).toEqual(["Aardvark Block"]);
  });
});
