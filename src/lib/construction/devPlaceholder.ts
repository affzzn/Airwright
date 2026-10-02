/**
 * The marker for the DEVELOPMENT picking list (docs/22 §4.0). Kept tiny and
 * separate from `library.ts` so client components can badge an item without
 * bundling the whole seed.
 */

/** Every dev item's rule note starts with this. */
export const DEV_PLACEHOLDER_NOTE = "DEV placeholder rate";

export function isDevPlaceholder(note: string | null | undefined): boolean {
  return Boolean(note && note.startsWith(DEV_PLACEHOLDER_NOTE));
}
