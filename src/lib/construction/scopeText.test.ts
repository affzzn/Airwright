import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { plainToText, cellToText, xlsxToText, extractScopeText } from "./scopeText";

describe("plainToText", () => {
  it("decodes utf-8 and normalises CRLF", () => {
    const buf = Buffer.from("Line one\r\nLine two", "utf8");
    expect(plainToText(buf)).toBe("Line one\nLine two");
  });
});

describe("cellToText — ExcelJS cell shapes", () => {
  it("handles primitives", () => {
    expect(cellToText("hello")).toBe("hello");
    expect(cellToText(42)).toBe("42");
    expect(cellToText(null)).toBe("");
  });
  it("handles rich text / formula / hyperlink cells", () => {
    expect(cellToText({ richText: [{ text: "20 " }, { text: "LM" }] })).toBe("20 LM");
    expect(cellToText({ formula: "A1*2", result: 84 })).toBe("84");
    expect(cellToText({ text: "Lift 01", hyperlink: "http://x" })).toBe("Lift 01");
  });
});

describe("xlsxToText — flatten a real workbook (acceptance for the Wren-shape schedule)", () => {
  it("flattens rows to a tab table with the sheet name", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scaffolding Schedule");
    ws.addRow(["Item", "Nr of Lifts", "Unit", "Quantity"]);
    ws.addRow(["Haki Stair Tower", 3, "nr", 1]);
    ws.addRow(["Progressive External Perimetre", 3, "m", 42.199]);
    ws.addRow([]); // blank row — should be dropped
    ws.addRow(["Roof Edge Protection", "", "m", 77.357]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const text = await xlsxToText(buf);
    expect(text).toContain("# Scaffolding Schedule");
    expect(text).toContain("Haki Stair Tower");
    expect(text).toContain("42.199");
    expect(text).toContain("Roof Edge Protection");
    // tab-separated within a row
    expect(text).toContain("Haki Stair Tower\t3\tnr\t1");
    // blank row dropped → no double blank lines inside the sheet block
    expect(text).not.toMatch(/\n\n\n/);
  });
});

describe("extractScopeText — dispatch by type", () => {
  it("reads a .csv as plain text", async () => {
    const buf = Buffer.from("a,b,c\n1,2,3", "utf8");
    const out = await extractScopeText({ name: "scope.csv", mimeType: "text/csv", bytes: buf });
    expect(out).toContain("a,b,c");
  });
  it("reads an .xlsx via the flattener", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").addRow(["Lift Gate", 6]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await extractScopeText({
      name: "scope.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: buf,
    });
    expect(out).toContain("Lift Gate");
  });
  it("throws a friendly error for an unsupported type", async () => {
    await expect(
      extractScopeText({ name: "drawing.dwg", mimeType: "image/vnd.dwg", bytes: Buffer.from("x") }),
    ).rejects.toThrow(/Unsupported/i);
  });
});
