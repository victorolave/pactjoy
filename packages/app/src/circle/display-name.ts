import type { MemberId } from "@pactjoy/engine";
import { isStorableText } from "../shared/storable-text.ts";
import type { Circle } from "./circle.ts";

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

/**
 * Comparison key for uniqueness (DN-R3): NFC then `toLowerCase`, which is
 * locale-independent (`toLocaleLowerCase` varies with the server locale, e.g.
 * Turkish i). Only the key is normalized; the stored name is the trimmed input.
 */
function displayNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/**
 * Whether `name` (already validated) equals the display name of an ACTIVE
 * member of `circle`, ignoring case. Members who left free their name (DN-S4).
 * `except` skips one member, so a rename may change only the case of its own name.
 */
export function isDisplayNameTaken(circle: Circle, name: string, except?: MemberId): boolean {
  const key = displayNameKey(name);
  return circle.members.some(
    (member) =>
      member.status === "active" &&
      member.id !== except &&
      displayNameKey(member.displayName) === key,
  );
}
