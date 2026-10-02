/**
 * The STRUCTURE of a client's scaffold schedule (docs/23 §11.1) — PURE, unit-tested.
 *
 * A spreadsheet scope is a table: a header (often two rows — "Dimensions (m)" over
 * "w · l · h"), section headings (a row with only a name in the item column), item
 * rows and a total. Reading that structure is code's job, not the model's: the
 * sections (and the EMPTY ones — King Edward's "Birdcages"), each line's own hire
 * weeks and stated numbers, and the column layout the client wants back (the
 * client-template export) all come from here, deterministically. The model is
 * then given the table row by row and only maps each row to a picking-list item.
 *
 * Input is a plain grid (`GridSheet`) so this never touches ExcelJS; the loader
 * lives in `scopeText.ts`.
 */

export interface GridCell {
  col: number; // 1-based
  text: string;
  bold?: boolean;
}
export interface GridSheet {
  name: string;
  rows: { row: number; cells: GridCell[] }[];
}

export type ScopeColumnRole =
  | "ITEM"
  | "REF"
  | "LOCATION"
  | "LEVEL"
  | "W"
  | "L"
  | "H"
  | "DIMENSIONS"
  | "HEIGHT"
  | "LIFTS"
  | "QTY"
  | "UNIT"
  | "RATE"
  | "WEEKLY_RATE"
  | "HIRE_WEEKS"
  | "COST"
  | "COMMENT"
  | "LOADING"
  | "DATE"
  | "OTHER";

export interface ScopeColumn {
  col: number;
  letter: string;
  label: string;
  role: ScopeColumnRole;
}

export interface ScopeRowCell {
  col: number;
  role: ScopeColumnRole;
  label: string;
  text: string;
}

export interface ScopeRow {
  /** Stable reference given to the model and stored on the line: "R12" (first sheet) or "S2R12". */
  ref: string;
  sheet: string;
  row: number;
  kind: "SECTION" | "ITEM" | "TOTAL";
  text: string;
  section: string | null;
  /** The other filled cells on the row, labelled by their column. */
  cells: ScopeRowCell[];
}

export interface ScopeTable {
  sheet: string;
  sheetIndex: number;
  /** Text above the header (project name, document title). */
  title: string | null;
  headerRows: number[];
  itemCol: number;
  columns: ScopeColumn[];
  rows: ScopeRow[];
  sections: { name: string; row: number; itemCount: number }[];
}

export function colLetter(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const HEADER_WORD =
  /\b(item|description|location|floor|level|dimensions?|width|length|height|lifts?|qty|quantity|unit|rate|hire|duration|weeks?|cost|total|price|comments?|notes?|loading|date|ref)\b|^\(?[wlh]\)?$|^\((weeks|£|m)\)$/i;

/** The role a column plays, from its (joined) header label. */
export function columnRole(label: string): ScopeColumnRole {
  const l = label.toLowerCase().replace(/[:.]/g, " ").replace(/\s+/g, " ").trim();
  const last = l.split(" ").pop() ?? "";
  if (last === "w" || /\bwidth\b/.test(l)) return "W";
  if (last === "l" || /\blength\b/.test(l)) return "L";
  if (last === "h") return "H";
  if (/\bitem ref\b|^ref\b|^no$/.test(l)) return "REF";
  if (/weekly rate/.test(l)) return "WEEKLY_RATE";
  if (/\blifts?\b/.test(l)) return "LIFTS";
  if (/\bhire\b|\bduration\b|\(weeks\)|^weeks?$/.test(l)) return "HIRE_WEEKS";
  if (/\bheight\b/.test(l)) return "HEIGHT";
  if (/\bdimension/.test(l)) return "DIMENSIONS";
  if (/\bquantity\b|\bqty\b/.test(l)) return "QTY";
  if (/\bunit\b/.test(l)) return "UNIT";
  if (/\bcost\b|\btotal\b|\bprice\b/.test(l)) return "COST";
  if (/\brate\b/.test(l)) return "RATE";
  if (/\bcomments?\b|\bnotes?\b/.test(l)) return "COMMENT";
  if (/\blocation\b/.test(l)) return "LOCATION";
  if (/\bfloor\b|\blevel/.test(l)) return "LEVEL";
  if (/\bloading\b/.test(l)) return "LOADING";
  if (/\bdate\b/.test(l)) return "DATE";
  if (/\bitem\b|\bdescription\b/.test(l)) return "ITEM";
  return "OTHER";
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const headerScore = (cells: GridCell[]) => cells.filter((c) => HEADER_WORD.test(clean(c.text))).length;
const isNumberish = (s: string) => /^[£$]?\s*-?\d[\d,]*(\.\d+)?\s*(m|m2|m²|wks?|weeks?|nr|no)?$/i.test(s.trim());

/**
 * Parse one sheet into a schedule table, or null when it is not one (no header
 * row, or no item rows under it).
 */
export function parseScopeGrid(sheet: GridSheet, sheetIndex = 0): ScopeTable | null {
  const rows = sheet.rows
    .map((r) => ({ row: r.row, cells: r.cells.filter((c) => clean(c.text) !== "") }))
    .filter((r) => r.cells.length > 0)
    .sort((a, b) => a.row - b.row);
  if (rows.length < 2) return null;

  // Header: the first row (in the top 40) carrying at least two header words.
  const hIdx = rows.findIndex((r, i) => i < 40 && headerScore(r.cells) >= 2);
  if (hIdx < 0) return null;
  const headerRows = [rows[hIdx]];
  // A second header row of short labels ("w · l · h · Lifts · (weeks) · (£)").
  const next = rows[hIdx + 1];
  if (
    next &&
    next.row === rows[hIdx].row + 1 &&
    next.cells.every((c) => clean(c.text).length <= 15) &&
    (next.cells.some((c) => c.bold) || headerScore(next.cells) >= 2)
  )
    headerRows.push(next);

  const labels = new Map<number, string[]>();
  for (const hr of headerRows)
    for (const c of hr.cells) {
      const t = clean(c.text).replace(/:+$/, "").trim();
      const list = labels.get(c.col) ?? [];
      if (!list.includes(t)) list.push(t);
      labels.set(c.col, list);
    }

  const data = rows.slice(hIdx + headerRows.length);
  if (data.length === 0) return null;

  // The item column: the one holding the most non-numeric text in the data rows.
  const textCount = new Map<number, number>();
  for (const r of data)
    for (const c of r.cells) {
      const t = clean(c.text);
      if (t.length > 3 && !isNumberish(t)) textCount.set(c.col, (textCount.get(c.col) ?? 0) + 1);
    }
  const described = [...labels.entries()].find(([, l]) => /\bdescription\b/i.test(l.join(" ")))?.[0];
  const itemCol =
    described ?? [...textCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? headerRows[0].cells[0].col;

  const columns: ScopeColumn[] = [...labels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([col, l]) => {
      const label = l.join(" ");
      return { col, letter: colLetter(col), label, role: col === itemCol ? "ITEM" : columnRole(label) };
    });
  if (!columns.some((c) => c.col === itemCol)) columns.unshift({ col: itemCol, letter: colLetter(itemCol), label: "Item", role: "ITEM" });
  const colOf = new Map(columns.map((c) => [c.col, c]));

  const title =
    rows
      .slice(0, hIdx)
      .map((r) => r.cells.map((c) => clean(c.text)).join(" "))
      .filter((t) => t.length > 3)
      .join(" · ") || null;

  // Classify the data rows.
  type Raw = { row: number; text: string; others: ScopeRowCell[]; bold: boolean; total: boolean };
  const raws: Raw[] = [];
  for (const r of data) {
    const item = r.cells.find((c) => c.col === itemCol);
    const text = item ? clean(item.text) : "";
    const others = r.cells
      .filter((c) => c.col !== itemCol)
      .map((c) => {
        const col = colOf.get(c.col);
        return { col: c.col, role: col?.role ?? "OTHER", label: col?.label ?? colLetter(c.col), text: clean(c.text) };
      });
    const total = /^total\b/i.test(text) || (text === "" && others.some((o) => /^total\b/i.test(o.text)));
    if (!text && !total) continue;
    raws.push({ row: r.row, text, others, bold: Boolean(item?.bold), total });
  }
  const anyValued = raws.some((r) => !r.total && r.others.length > 0);
  // With mixed bold, the bold valueless rows are the headings and the rest items.
  const valueless = raws.filter((r) => !r.total && r.others.length === 0);
  const boldDecides = valueless.some((r) => r.bold) && valueless.some((r) => !r.bold);

  const prefix = sheetIndex === 0 ? "" : `S${sheetIndex + 1}`;
  const out: ScopeRow[] = [];
  const sections: ScopeTable["sections"] = [];
  let section: string | null = null;
  for (const r of raws) {
    let kind: ScopeRow["kind"];
    if (r.total) kind = "TOTAL";
    else if (r.others.length === 0 && anyValued && (!boldDecides || r.bold)) kind = "SECTION";
    else kind = "ITEM";
    if (kind === "SECTION") {
      section = r.text;
      sections.push({ name: r.text, row: r.row, itemCount: 0 });
    } else if (kind === "ITEM" && sections.length) sections[sections.length - 1].itemCount++;
    out.push({ ref: `${prefix}R${r.row}`, sheet: sheet.name, row: r.row, kind, text: r.text, section: kind === "ITEM" ? section : null, cells: r.others });
  }
  if (!out.some((r) => r.kind === "ITEM")) return null;
  return { sheet: sheet.name, sheetIndex, title, headerRows: headerRows.map((h) => h.row), itemCol, columns, rows: out, sections };
}

/**
 * Every schedule table in a workbook. Sheets that are not tables are skipped, and
 * so is a sheet holding the same rows as an earlier one (Stanmore's "In Order" is
 * a re-sorted copy of "Scaffolding") — otherwise every line would be read twice.
 */
export function parseScopeWorkbook(sheets: GridSheet[]): ScopeTable[] {
  const out: ScopeTable[] = [];
  const seen = new Set<string>();
  sheets.forEach((s, i) => {
    const t = parseScopeGrid(s, i);
    if (!t) return;
    const sig = t.rows
      .filter((r) => r.kind === "ITEM")
      .map((r) => [r.text, ...r.cells.map((c) => c.text)].join("|"))
      .sort()
      .join("\n");
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(t);
  });
  return out;
}

/** The first filled cell of a role on a row (e.g. the hire weeks). */
export function cellOf(row: ScopeRow, role: ScopeColumnRole): string | null {
  return row.cells.find((c) => c.role === role && c.text)?.text ?? null;
}

/**
 * The table as the scope reader sees it: one line per row, tagged with its ref, so
 * the model maps rows (not free text) and every answer can be tied back to a row.
 */
export function renderScopeTable(fileName: string, t: ScopeTable): string {
  const lines: string[] = [];
  lines.push(`SCHEDULE "${fileName}" · sheet "${t.sheet}"${t.title ? ` · ${t.title}` : ""}`);
  lines.push(`Columns: ${t.columns.filter((c) => c.role !== "ITEM").map((c) => c.label).join(" · ") || "(none)"}`);
  for (const r of t.rows) {
    if (r.kind === "SECTION") {
      const s = t.sections.find((x) => x.row === r.row);
      lines.push(`SECTION "${r.text}"${s && s.itemCount === 0 ? " — no items listed under it" : ""}`);
    } else if (r.kind === "ITEM") {
      const cells = r.cells.map((c) => `${c.label}: ${c.text}`).join(" | ");
      lines.push(`[${r.ref}] ${r.text}${cells ? ` | ${cells}` : ""}`);
    }
  }
  return lines.join("\n");
}
