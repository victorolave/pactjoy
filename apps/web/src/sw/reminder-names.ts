/**
 * The habit names a reminder push may show (ADR-0017 addendum, D2 owner decision). The push
 * payload carries ids only, so the app leaves on the device the names of the viewer's OWN VISIBLE
 * commitments, and the service worker names the habit from them ("Es hora de Leer"). A private
 * commitment's name is never written: its reminder keeps the generic copy on the lock screen.
 * Shared by the page (which writes) and the worker (which reads); both run this same code.
 */

/** The Cache Storage bucket and the request key the names live under (same origin as the app). */
export const REMINDER_NAMES_CACHE = "pactjoy-reminder-names-v1";
export const REMINDER_NAMES_KEY = "/__pactjoy/reminder-names.json";

/** A longer name is not shown (a notification title is short anyway). */
export const MAX_NAME_LENGTH = 60;

export interface NamedCommitment {
  readonly commitmentId: string;
  readonly habitName: string;
  readonly privacy: "visible" | "private";
}

/** The visible commitments' names, as stored. */
export function encodeReminderNames(commitments: readonly NamedCommitment[]): string {
  const names: Record<string, string> = {};
  for (const commitment of commitments) {
    if (commitment.privacy === "visible") names[commitment.commitmentId] = commitment.habitName;
  }
  return JSON.stringify({ v: 1, names });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored names; anything unexpected is no names (the worker then shows the generic copy). */
export function decodeReminderNames(text: string | null): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (text === null) return names;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return names;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.names)) return names;
  for (const [commitmentId, value] of Object.entries(parsed.names)) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name.length > 0 && name.length <= MAX_NAME_LENGTH) names.set(commitmentId, name);
  }
  return names;
}
