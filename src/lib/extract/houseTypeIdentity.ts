/**
 * A house type's display identity (name + code). Segmentation names a house type
 * from the FILE (the classifier only parses Miller-style title blocks), so most
 * packs end up with a file name like "19. B11 Burcot Bungalow_Combined Working
 * Drawings" and no code. The AI extraction reads the REAL name + code ("Burcot" /
 * "B11") — this resolves which to use, so the real identity becomes canonical.
 *
 * Pure + unit-tested. Used by persist.ts (on every extraction) and the backfill.
 * The DB uniqueness guard on `code` lives in the caller (it needs the project's
 * other house types); this only proposes the identity.
 */

/** Strip file-list noise from a fallback name: "12. Foo_Combined Working Drawings Rev A" → "Foo". */
export function cleanHouseTypeName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\.pdf$/i, "");
  s = s.replace(/^\s*\d+\s*[.)]\s*/, ""); // leading "19. " / "3) "
  s = s.replace(/_/g, " ");
  // Drop trailing document-kind / revision noise (repeatedly, in any order).
  const noise =
    /\s*[-–]?\s*(combined\s+)?working\s+drawings?|\s*[-–]?\s*rev(ision)?\s*[a-z0-9]+|\s*[-–]?\s*issue\s*[0-9.]+/gi;
  let prev: string;
  do {
    prev = s;
    s = s.replace(noise, "");
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim() || raw.trim();
}

/**
 * Normalise a house-type code to just the identifier, dropping the noise the AI
 * often folds in: the bed/person/area schedule ("- 1B / 2P / 531"), a leading
 * date ("250813 L356"), and pure-number "codes" (an area figure, e.g. "758").
 * The clean code is what the plot list matches against ("B11", "L363", "AL40").
 * Returns null when nothing identifier-like remains.
 */
export function cleanHouseTypeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^\d{6}\s+/, ""); // leading date like "250813 "
  s = s.replace(/\s*\d+\s*B\s*\/\s*\d+\s*P\b.*$/i, ""); // "… 1B / 2P / 531" onward
  s = s.replace(/^[\s\-/]+|[\s\-/]+$/g, "").replace(/\s+/g, " "); // trim separators
  if (!s) return null;
  if (/^\d+$/.test(s)) return null; // a pure number is an area, not a code
  return s;
}

/**
 * Decide the house type's name + code. Prefer the AI-read name when it was read
 * with real confidence; otherwise clean up the file-derived fallback. Code prefers
 * the (normalised) AI-read code, then whatever is stored (also normalised).
 */
export function resolveHouseTypeIdentity(input: {
  extractedName: string | null | undefined;
  extractedConfidence: string | null | undefined;
  extractedCode: string | null | undefined;
  currentName: string;
  currentCode: string | null;
}): { name: string; code: string | null; usedExtractedName: boolean } {
  const aiName = input.extractedName?.trim().replace(/\s+/g, " ") || "";
  const aiConfident = aiName.length > 0 && input.extractedConfidence !== "unknown";
  const name = aiConfident ? aiName : cleanHouseTypeName(input.currentName);

  const code = cleanHouseTypeCode(input.extractedCode) ?? cleanHouseTypeCode(input.currentCode);

  return { name, code, usedExtractedName: aiConfident };
}
