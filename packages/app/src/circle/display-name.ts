import { isStorableText } from "../shared/storable-text.ts";

/** Longest display name, in Unicode code points (not UTF-16 units; same counting as entry notes). */
export const MAX_DISPLAY_NAME_LENGTH = 30;

/**
 * Validates a member's display name (DN-R2) and returns it trimmed, or `null`
 * when it is blank, not storable text, or longer than {@link MAX_DISPLAY_NAME_LENGTH}.
 * `isStorableText` runs before the code point count so the spread is well-formed.
 */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || !isStorableText(name)) {
    return null;
  }
  return [...name].length <= MAX_DISPLAY_NAME_LENGTH ? name : null;
}
