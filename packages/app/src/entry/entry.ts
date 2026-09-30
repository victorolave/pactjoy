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

/** T1: a client idempotency key is 1..128 characters. */
export const MAX_CLIENT_REQUEST_ID_LENGTH = 128;

/** B6: the evidence note is at most this many characters. */
export const MAX_NOTE_LENGTH = 280;

/** Whether `note` is over {@link MAX_NOTE_LENGTH}, counted in characters (code points), not UTF-16 units. */
export function exceedsNoteLimit(note: string | null): boolean {
  return note !== null && [...note].length > MAX_NOTE_LENGTH;
}

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
  /** Optimistic version (D5): 0 when recorded, +1 on every edit. */
  readonly version: number;
  /**
   * {@link requestFingerprint} of the ORIGINAL `recordEntry` request (T1):
   * a replayed key is compared against it, not against the current entry,
   * which an edit may have changed since. Never changes.
   */
  readonly requestFingerprint: string;
  /**
   * Tombstone (delete): the row stays so its idempotency key stays taken, but
   * for scoring and reads the entry does not exist. Only `remove` sets it.
   */
  readonly deleted: boolean;
}

/**
 * A canonical string for a value and note, so "the same request" is an
 * exact comparison: quantities are normalized fractions (2, 2.0 and 2.00
 * are the same), never floats.
 */
export function requestFingerprint(value: EntryValue, note: string | null): string {
  const quantity = value.kind === "quantity" ? `${value.value.num}/${value.value.den}` : null;
  return JSON.stringify([value.kind, quantity, note]);
}
