import type { CommitmentId, Fraction, MemberId, SeasonDay } from "@pactjoy/engine";
import type { EntryId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

/**
 * What a member logs for one opportunity (Registro), already validated and
 * parsed. Mirrors the engine's `Entry` kinds 1:1 (design, Engine mapping):
 * the app never synthesizes an entry, so absence stays absence (A8).
 */
export type EntryValue =
  | { readonly kind: "done" }
  | { readonly kind: "quantity"; readonly value: Fraction }
  | { readonly kind: "missed" };

/**
 * The raw, not-yet-validated value a client sends. Quantities are decimal
 * strings (D10: never a `float`); `validateEntryValue` turns them into a
 * {@link EntryValue}.
 */
export type EntryValueInput =
  | { readonly kind: "done" }
  | { readonly kind: "quantity"; readonly value: string }
  | { readonly kind: "missed" };

/** B6: the evidence note is at most this many characters. */
export const MAX_NOTE_LENGTH = 280;

/**
 * One recorded Entry. `day` is the opportunity it counts toward; `recordedOn`
 * is the season day it was actually logged (they differ inside the grace
 * period). Entries are the source of truth: points are recomputed from them
 * and never stored.
 */
export interface EntryRecord {
  readonly id: EntryId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly commitmentId: CommitmentId;
  readonly day: SeasonDay;
  readonly recordedOn: SeasonDay;
  readonly recordedAt: Instant;
  readonly value: EntryValue;
  readonly note: string | null;
  readonly clientRequestId: string;
  readonly editedAt: Instant | null;
}
