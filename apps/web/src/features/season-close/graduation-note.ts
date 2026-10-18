export interface GraduationNoteInput {
  readonly habit: string;
  /** The viewer's name in the circle; `null` while the circle has not been read. */
  readonly viewerName: string | null;
  /** The other active members of the circle, in circle order. */
  readonly peers: readonly string[];
  /** A private commitment is announced as "un objetivo privado", never by name (ADR-0018). */
  readonly isPrivate: boolean;
}

/** "Andrea", "Andrea y Carla", "Andrea, Carla y Dani". */
const names = (list: readonly string[]): string =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;

/**
 * Screen 38b: what the circle will read in its activity about this graduation (ADR-0018). The
 * design names the other member ("Andrea verá “Victor graduó Leer”"); with several peers they are
 * all named, and without names it says "Tu círculo". A private habit is never named.
 */
export function graduationNote({
  habit,
  viewerName,
  peers,
  isPrivate,
}: GraduationNoteInput): string {
  if (isPrivate) return "Tu círculo verá que graduaste un objetivo privado.";
  const who =
    peers.length === 0
      ? "Tu círculo verá"
      : `${names(peers)} ${peers.length === 1 ? "verá" : "verán"}`;
  const what = viewerName === null ? `que graduaste ${habit}` : `“${viewerName} graduó ${habit}”`;
  return `${who} ${what} en la actividad del círculo.`;
}
