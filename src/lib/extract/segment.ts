import type { PageClass } from "./classify";
import { buildRangeString } from "@/lib/pdf";

export interface HouseTypeGroup {
  code: string | null;
  name: string | null;
  pages: number[];
  pageRange: string;
}

const norm = (s: string | null): string | null =>
  s ? s.toUpperCase().replace(/\s+/g, " ").trim() || null : null;

/** The most common non-null code among a set of pages (majority vote), or null. */
function majorityCode(pages: PageClass[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pages) if (p.houseTypeCode) counts.set(p.houseTypeCode, (counts.get(p.houseTypeCode) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of counts) if (n > bestN) [best, bestN] = [code, n];
  return best;
}

function toGroup(pages: PageClass[], code: string | null, name: string | null): HouseTypeGroup {
  const sorted = pages.map((p) => p.page).sort((a, b) => a - b);
  return { code, name, pages: sorted, pageRange: buildRangeString(sorted) };
}

/** Legacy code-based grouping — used only when NO page carries a house-type name. */
function groupByCode(relevant: PageClass[]): HouseTypeGroup[] {
  const groups = new Map<string, PageClass[]>();
  for (const p of relevant) {
    const key = p.houseTypeCode ?? "__single__";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  return [...groups.values()].map((ps) => toGroup(ps, majorityCode(ps), null));
}

/**
 * Group a document's relevant (take-off) pages into house types.
 *
 * Keyed on the house-type NAME, not the code, because a "Combined Working
 * Drawings" file is ONE house type and the code is fragile: the same house
 * mis-parses a transposed digit on some pages (Chesterwood 1377 vs 1337), and
 * section / floor-plan / elevation sheets often carry no portfolio code at all
 * (Hampton). Grouping by code split one file into phantom house types.
 *
 *   - 1 distinct name  → ONE group with ALL relevant pages (absorbs misread-code
 *                        and code-less pages); stored code = majority vote.
 *   - ≥2 distinct names → a genuinely multi-type file → group by name; code-less
 *                        pages attach to the group whose code they match, else a
 *                        leftover group.
 *   - 0 names          → fall back to legacy code grouping.
 */
export function segmentByHouseType(pages: PageClass[]): HouseTypeGroup[] {
  const relevant = pages.filter((p) => p.relevant);
  if (relevant.length === 0) return [];

  const distinctNames = new Set(
    relevant.map((p) => norm(p.houseTypeName)).filter((n): n is string => n !== null),
  );

  // No names anywhere → nothing reliable to group on; keep the old code behaviour.
  if (distinctNames.size === 0) return groupByCode(relevant);

  // One house type across the whole file → a single group with every relevant
  // page. This is the fix: a misread digit or a code-less page can no longer peel
  // pages off into a phantom house type.
  if (distinctNames.size === 1) {
    const name = relevant.find((p) => norm(p.houseTypeName))!.houseTypeName;
    return [toGroup(relevant, majorityCode(relevant), name)];
  }

  // Genuinely multiple named house types in one file → group by name.
  const byName = new Map<string, PageClass[]>();
  const orphans: PageClass[] = [];
  for (const p of relevant) {
    const n = norm(p.houseTypeName);
    if (n) (byName.get(n) ?? byName.set(n, []).get(n)!).push(p);
    else orphans.push(p);
  }
  // A code-less page joins the named group whose code it matches (same drawing set).
  const codeToName = new Map<string, string>();
  for (const [n, ps] of byName) for (const p of ps) if (p.houseTypeCode) codeToName.set(p.houseTypeCode, n);
  const leftover: PageClass[] = [];
  for (const o of orphans) {
    const n = o.houseTypeCode ? codeToName.get(o.houseTypeCode) : undefined;
    if (n) byName.get(n)!.push(o);
    else leftover.push(o);
  }

  const groups = [...byName.values()].map((ps) => {
    const name = ps.find((p) => p.houseTypeName)?.houseTypeName ?? null;
    return toGroup(ps, majorityCode(ps), name);
  });
  if (leftover.length) groups.push(toGroup(leftover, majorityCode(leftover), null));
  return groups;
}
