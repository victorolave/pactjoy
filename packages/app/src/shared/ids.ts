/**
 * Branded string ids, one per aggregate root (ADR-0008, D6). Same brand
 * pattern as the engine's `SeasonDay`/`CommitmentId`
 * (`packages/engine/src/calendar/season-calendar.ts`): a validating
 * constructor is the only way to produce a branded value.
 */

export type UserId = string & { readonly __brand: "UserId" };
export type CircleId = string & { readonly __brand: "CircleId" };
export type SeasonId = string & { readonly __brand: "SeasonId" };
export type HabitId = string & { readonly __brand: "HabitId" };
export type EntryId = string & { readonly __brand: "EntryId" };
export type EntryPhotoId = string & { readonly __brand: "EntryPhotoId" };
export type PauseRequestId = string & { readonly __brand: "PauseRequestId" };
export type ReviewId = string & { readonly __brand: "ReviewId" };
export type SeasonClosureId = string & { readonly __brand: "SeasonClosureId" };

function brand<Brand extends string>(
  kind: Brand,
  value: string,
): string & { readonly __brand: Brand } {
  if (value.length === 0) {
    throw new RangeError(`${kind}: value must be a non-empty string`);
  }
  return value as string & { readonly __brand: Brand };
}

/** @throws {RangeError} if `value` is empty. */
export function userId(value: string): UserId {
  return brand("UserId", value) as UserId;
}

/** @throws {RangeError} if `value` is empty. */
export function circleId(value: string): CircleId {
  return brand("CircleId", value) as CircleId;
}

/** @throws {RangeError} if `value` is empty. */
export function seasonId(value: string): SeasonId {
  return brand("SeasonId", value) as SeasonId;
}

/** @throws {RangeError} if `value` is empty. */
export function habitId(value: string): HabitId {
  return brand("HabitId", value) as HabitId;
}

/** @throws {RangeError} if `value` is empty. */
export function entryId(value: string): EntryId {
  return brand("EntryId", value) as EntryId;
}

/** @throws {RangeError} if `value` is empty. */
export function pauseRequestId(value: string): PauseRequestId {
  return brand("PauseRequestId", value) as PauseRequestId;
}

/** @throws {RangeError} if `value` is empty. */
export function reviewId(value: string): ReviewId {
  return brand("ReviewId", value) as ReviewId;
}

/** @throws {RangeError} if `value` is empty. */
export function seasonClosureId(value: string): SeasonClosureId {
  return brand("SeasonClosureId", value) as SeasonClosureId;
}

/** @throws {RangeError} if `value` is empty. */
export function entryPhotoId(value: string): EntryPhotoId {
  return brand("EntryPhotoId", value) as EntryPhotoId;
}
