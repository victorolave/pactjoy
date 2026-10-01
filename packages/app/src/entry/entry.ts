import type { CommitmentId, Fraction, MemberId, SeasonDay } from "@pactjoy/engine";
import type { EntryId, SeasonId } from "../shared/ids.ts";
import { isStorableText } from "../shared/storable-text.ts";
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

/** What every stored entry keeps, live or deleted: identity, idempotency key and audit metadata. */
export interface EntryCore {
  readonly id: EntryId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly commitmentId: CommitmentId;
  readonly day: SeasonDay;
  readonly recordedOn: SeasonDay;
  readonly recordedAt: Instant;
  readonly clientRequestId: string;
  readonly editedAt: Instant | null;
  /** Optimistic version (D5): 0 when recorded, +1 on every edit and on delete. */
  readonly version: number;
  /**
   * {@link requestFingerprint} of the ORIGINAL `recordEntry` request (T1):
   * a replayed key is compared against it, not against the current entry,
   * which an edit may have changed since. Never changes.
   */
  readonly requestFingerprint: string;
}

/**
 * One recorded, live Entry. `day` is the opportunity it counts toward;
 * `recordedOn` is the season day it was actually logged (they differ inside
 * the grace period). Entries are the source of truth: points are recomputed
 * from them and never stored. Scoring and reads only ever see this shape.
 */
export interface EntryRecord extends EntryCore {
  readonly value: EntryValue;
  readonly note: string | null;
  readonly deleted: false;
}

/**
 * What a delete leaves behind: the row stays so its idempotency key stays
 * taken, but the evidence is blanked. There is no value to fake, so it is
 * `null` (a separate type, not a nullable `value` on every entry, keeps
 * `EntryRecord.value` non-null for scoring). Only `remove` creates one.
 */
export interface EntryTombstone extends EntryCore {
  readonly value: null;
  readonly note: null;
  readonly deleted: true;
}

/** A row as stored: live or tombstone. Only the idempotency lookup and the owner's delete see tombstones. */
export type StoredEntry = EntryRecord | EntryTombstone;

/**
 * A canonical string for a value and note, so "the same request" is an
 * exact comparison: quantities are normalized fractions (2, 2.0 and 2.00
 * are the same), never floats.
 */
export function requestFingerprint(value: EntryValue, note: string | null): string {
  const quantity = value.kind === "quantity" ? `${value.value.num}/${value.value.den}` : null;
  return JSON.stringify([value.kind, quantity, normalizeNote(note)]);
}

/** Whether `note` is storable text (well-formed, no NUL); `null` is. */
export function isStorableNote(note: string | null): boolean {
  return note === null || isStorableText(note);
}

/** An empty note is no note: stored, fingerprinted and compared as `null`. Any other text is kept as typed. */
export function normalizeNote(note: string | null | undefined): string | null {
  return note === undefined || note === "" ? null : note;
}
