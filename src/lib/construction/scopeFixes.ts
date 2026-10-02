/**
 * Corrections to the scope reader's answer that Ben gave on the 9 Sep 2026 call,
 * applied by CODE after every scope read (fresh or cached) — PURE, unit-tested,
 * idempotent. The model maps rows; these rules make sure the known traps never
 * reach a quote:
 *
 *   1. Stair sets / up-and-over steps are TEMPORARY STAIRS, never a Haki stair tower
 *      ("That's not a Haki stairs. That's just a temporary stairs.").
 *   2. One row that asks for two items ("perimeter access scaffolding AND roof edge
 *      protection") becomes two lines, each with the row's measurement.
 *   3. Hours written in the wording ("Allow 1600hrs") are the quantity of an hourly item.
 *   4. A length with a "× 2" ("20 lin.m … LV pits x 2") is flagged: 20 m in total, or
 *      20 m each? Usually each — the first thing Ben checks. The number is not changed.
 */

import { elementRole, type ItemRole } from "./bindScope";
import type { ReconciledDraftLine } from "./scopeDraft";

export interface FixElement {
  id: string;
  name: string;
  aliases: string[];
  unit: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const words = (l: ReconciledDraftLine) => norm(`${l.clientText} ${l.location ?? ""}`);
const addFlag = (l: ReconciledDraftLine, f: string): ReconciledDraftLine => ({ ...l, flags: [...new Set([...(l.flags ?? []), f])] });

const TEMP_STAIRS = /stair sets?|up\s*(&|and)\s*over|transition(s)? between .*(level|slab)|temporary steps?/;
/** "x 2", "× 2", "2nr", "two" next to the wording. */
function multiplier(text: string): number | null {
  const m = /(?:^|[^\d.])[x×]\s*(\d{1,2})\b(?!\s*\.\d)(?!\s*m\b)/i.exec(text) ?? /\b(\d{1,2})\s*(?:nr|no\.?)(?![a-z])/i.exec(text);
  const n = m ? Number(m[1]) : /\btwo\b/i.test(text) ? 2 : null;
  return n != null && n >= 2 ? n : null;
}

export function applyScopeFixes(lines: ReconciledDraftLine[], elements: FixElement[]): ReconciledDraftLine[] {
  const byRole = (role: ItemRole) => elements.find((e) => elementRole(e.name) === role) ?? null;
  const roleOf = (id: string | null) => {
    const e = id ? elements.find((x) => x.id === id) : null;
    return e ? elementRole(e.name) : null;
  };
  const tempStairs = byRole("TEMP_STAIRS");
  const out: ReconciledDraftLine[] = [];

  for (const line of lines) {
    let l = line;
    const text = words(l);
    const role = roleOf(l.elementId);

    // 1 · Temporary stairs, never a Haki.
    if (TEMP_STAIRS.test(text) && (role === "HAKI" || role == null || role === "TOWER")) {
      if (tempStairs) {
        l = { ...l, elementId: tempStairs.id, confidence: "medium" };
        if (l.quantity == null && l.statedCount == null) {
          const n = multiplier(text);
          if (n != null) l = { ...l, statedCount: n, needsMeasurement: false };
        }
      }
      l = addFlag(l, tempStairs ? "Temporary steps with handrails — not a Haki stair tower." : "Temporary steps with handrails — not a Haki stair tower. Choose the temporary stair item.");
    }

    // 3 · Hours in the wording are the quantity of an hourly item.
    const hours = /(\d[\d,]*)\s*(?:hrs?|hours)\b/i.exec(l.clientText);
    if (hours && l.quantity == null && roleOf(l.elementId) === "DAYWORK") {
      const h = Number(hours[1].replace(/,/g, ""));
      if (h > 0) l = { ...l, quantity: h, needsMeasurement: false, quantityBasis: `${h} hours, from the wording` };
    }

    // 4 · A length "× 2": in total, or each?
    const el = l.elementId ? elements.find((e) => e.id === l.elementId) : null;
    const linear = el != null && (el.unit === "LM" || el.unit === "LM_PER_LIFT");
    const n = multiplier(text);
    if (linear && l.quantity != null && n != null)
      l = addFlag(
        l,
        `The row says ${l.quantity} m and × ${n}. Is that ${l.quantity} m in total, or ${l.quantity} m each (${Math.round(l.quantity * n * 1000) / 1000} m)? Usually each — check before pricing.`,
      );
    out.push(l);

    // 2 · One row, two items: a second picking-list item named after "and" — only for a
    // row the reader answered with ONE line, and the longest item name that matches wins.
    const after = /\band\b(.+)$/.exec(norm(l.clientText))?.[1] ?? "";
    const rowLines = lines.filter((x) => x.rowRef != null && x.rowRef === l.rowRef).length;
    if (after && l.elementId && l.rowRef && rowLines === 1) {
      let best: { e: FixElement; len: number } | null = null;
      for (const e of elements) {
        if (e.id === l.elementId) continue;
        const hit = [e.name, ...e.aliases]
          .map(norm)
          .filter((p) => p.split(" ").length >= 2 && p.length >= 8 && after.includes(p))
          .sort((a, b) => b.length - a.length)[0];
        if (hit && (!best || hit.length > best.len)) best = { e, len: hit.length };
      }
      if (best)
        out.push(
          addFlag(
            { ...l, elementId: best.e.id, confidence: "medium", invented: false, reason: `The row also asks for ${best.e.name.toLowerCase()}.` },
            `One row asks for two items — this ${best.e.name.toLowerCase()} line was split from it, with the row's measurement. Check.`,
          ),
        );
    }
  }
  return out;
}
