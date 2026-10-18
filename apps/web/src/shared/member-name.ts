/** How the app calls a member who left, or whose account was deleted (ADR-0019). */
export const LEFT_MEMBER_NAME = "Miembro que salió";

/** Whether there is no name to show: a deleted account (empty) or a member the feed sent without one. */
export function isLeftMember(displayName: string | null): boolean {
  return displayName === null || displayName.trim() === "";
}

/**
 * The name to show for a peer. A deleted account leaves its member with an empty displayName on the
 * wire (real names are never empty); the feed sends `null` for a member who left. Both read the same.
 */
export function memberName(displayName: string | null): string {
  return isLeftMember(displayName) ? LEFT_MEMBER_NAME : (displayName as string);
}

/** The letter an avatar shows: the name's first, or a question mark when there is no name. */
export function memberInitial(displayName: string | null): string {
  const trimmed = displayName?.trim() ?? "";
  return trimmed === "" ? "?" : trimmed.charAt(0).toUpperCase();
}
