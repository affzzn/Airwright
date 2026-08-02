import type { PageClass } from "./classify";
import { buildRangeString } from "@/lib/pdf";

export interface HouseTypeGroup {
  code: string | null;
  name: string | null;
  pages: number[];
  pageRange: string;
}

/**
 * Group a document's relevant (take-off) pages into house types by their code
 * (falling back to name). One document can hold several house types (a combined
 * PDF) or just one (a per-type PDF). If no code/name is found on any page, all
 * relevant pages form a single group.
 */
export function segmentByHouseType(pages: PageClass[]): HouseTypeGroup[] {
  const relevant = pages.filter((p) => p.relevant);
  if (relevant.length === 0) return [];

  const groups = new Map<
    string,
    { code: string | null; name: string | null; pages: number[] }
  >();

  for (const p of relevant) {
    const key = p.houseTypeCode ?? p.houseTypeName ?? "__single__";
    const g = groups.get(key) ?? {
      code: p.houseTypeCode,
      name: p.houseTypeName,
      pages: [],
    };
    if (!g.code && p.houseTypeCode) g.code = p.houseTypeCode;
    if (!g.name && p.houseTypeName) g.name = p.houseTypeName;
    g.pages.push(p.page);
    groups.set(key, g);
  }

  return [...groups.values()].map((g) => {
    const sorted = [...g.pages].sort((a, b) => a - b);
    return {
      code: g.code,
      name: g.name,
      pages: sorted,
      pageRange: buildRangeString(sorted),
    };
  });
}
