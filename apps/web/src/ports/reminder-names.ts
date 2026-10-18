import type { NamedCommitment } from "../sw/reminder-names.ts";

export type { NamedCommitment } from "../sw/reminder-names.ts";

/**
 * The habit names this device keeps for reminder pushes (ADR-0017 addendum, D2 owner decision):
 * only the signed-in member's VISIBLE commitments, so the service worker can say "Es hora de Leer"
 * while the push itself carries ids only. Neither method ever rejects: without the names, the
 * reminder keeps its generic copy.
 */
export interface ReminderNamesPort {
  /** Replaces the stored names with the visible ones among `commitments`. */
  save(commitments: readonly NamedCommitment[]): Promise<void>;
  /** Forgets every name (sign-out: the next person on this device must not see them). */
  clear(): Promise<void>;
}
