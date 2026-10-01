import type { CommitmentId, MemberId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { entryId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { isStorableText } from "../shared/storable-text.ts";
import type { Clock } from "../time/clock.port.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import {
  type EntryRecord,
  type EntryValueInput,
  exceedsNoteLimit,
  isStorableNote,
  MAX_CLIENT_REQUEST_ID_LENGTH,
  normalizeNote,
  requestFingerprint,
  type StoredEntry,
} from "./entry.ts";
import { type EntryValueError, validateEntryValue } from "./entry-value.ts";
import { checkEntryWindow, type EntryWindowError } from "./entry-window.ts";

export interface RecordEntryDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  readonly ids: IdGenerator;
}

export interface RecordEntryInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
  /** The opportunity's calendar date in the season's timezone; defaults to today. */
  readonly forDate?: LocalDate;
  readonly value: EntryValueInput;
  readonly note?: string | null;
  /** T1: client-supplied idempotency key, unique per (member, commitment), no TTL. */
  readonly clientRequestId: string;
}

export type RecordEntryError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "BeforeSeasonStart" }
  | { readonly kind: "NoteTooLong" }
  | { readonly kind: "InvalidNote" }
  | { readonly kind: "IdempotencyKeyReused" }
  | { readonly kind: "EntryDeleted" }
  | { readonly kind: "InvalidClientRequestId"; readonly reason: "empty" | "tooLong" | "malformed" }
  | EntryWindowError
  | EntryValueError;

export interface RecordEntryResult {
  readonly entry: EntryRecord;
  /** `true` when `clientRequestId` had already been recorded and the original entry is returned (T1). */
  readonly replayed: boolean;
  /** The actor's own member id, from the transaction that recorded or replayed (the viewer for presenting). */
  readonly memberId: MemberId;
}

/**
 * T1: a replay is only a replay when the payload is the ORIGINAL one (its
 * stored fingerprint, even if the entry was edited since): value, note and,
 * when given, the opportunity day. An omitted `forDate` means "today",
 * which can't be compared later, so it matches.
 */
function samePayload(
  original: StoredEntry,
  input: RecordEntryInput,
  measure: Measure,
  actualStart: LocalDate | null,
): boolean {
  const value = validateEntryValue(measure, input.value);
  if (!value.ok) {
    return false;
  }
  if (requestFingerprint(value.value, normalizeNote(input.note)) !== original.requestFingerprint) {
    return false;
  }
  if (input.forDate !== undefined && actualStart !== null) {
    const day = toSeasonDay(input.forDate, actualStart);
    return day.kind === "day" && day.day === original.day;
  }
  return true;
}

/**
 * Records `actor`'s Entry for one of their own commitments (ER-2..ER-9,
 * ER-16..ER-21). Only an active member may record (B9: a member who left
 * can't, their past entries stay), only on an active season, and only for
 * a day that is neither in the future nor before the season's actual start
 * (A10) nor past its grace deadline (A9, engine `graceDeadline`). Real time
 * becomes a `SeasonDay` only through the season's own timezone (ADR-0004,
 * ADR-0009). The app never fills gaps: no entry means no progress (A8).
 *
 * Idempotent (T1): a replayed `clientRequestId` returns the original entry
 * (or `EntryDeleted` if it was deleted since, it is never recreated)
 * and is resolved before the window/value checks, so an offline retry
 * still succeeds after its window closed. A concurrent duplicate loses on
 * the repository's unique key with `ConcurrencyConflict` (D5).
 */
export async function recordEntry(
  deps: RecordEntryDeps,
  actor: Actor,
  input: RecordEntryInput,
): Promise<Result<RecordEntryResult, RecordEntryError>> {
  const keyLength = [...input.clientRequestId].length;
  if (keyLength === 0) {
    return err({ kind: "InvalidClientRequestId", reason: "empty" });
  }
  if (keyLength > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return err({ kind: "InvalidClientRequestId", reason: "tooLong" });
  }
  // Postgres rejects NUL and postgres.js encodes a lone surrogate as U+FFFD, so two
  // distinct keys could collide on the unique key. Replay compares the raw string.
  if (!isStorableText(input.clientRequestId)) {
    return err({ kind: "InvalidClientRequestId", reason: "malformed" });
  }
  return deps.uow.transaction(
    async (repos): Promise<Result<RecordEntryResult, RecordEntryError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) {
        return err({ kind: "SeasonNotFound" });
      }

      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!member || !circle) {
        return err({ kind: "NotAMember" });
      }

      const commitment = season.commitments.find(
        (candidate) => candidate.id === input.commitmentId && candidate.memberId === member.id,
      );
      if (!commitment) {
        return err({ kind: "CommitmentNotOwned" });
      }

      const replay = await repos.entries.findByClientRequest(
        member.id,
        commitment.id,
        input.clientRequestId,
      );
      if (replay) {
        if (!samePayload(replay, input, commitment.measure, season.actualStart)) {
          return err({ kind: "IdempotencyKeyReused" });
        }
        // The entry was deleted: its key stays taken, it is never recreated.
        return replay.deleted
          ? err({ kind: "EntryDeleted" })
          : ok({ entry: replay, replayed: true, memberId: member.id });
      }

      // A NEW entry is only valid for the membership and season state read
      // above: if either changes before commit (a leave, B9, or any season
      // edit), this transaction must fail instead of committing (D5). A pure
      // replay writes nothing, so it is deliberately not guarded: unrelated
      // version bumps must not turn an idempotent retry into a conflict.
      await repos.circles.guardVersion(circle.id, circle.version);
      await repos.seasons.guardVersion(season.id, season.version);

      if (season.status !== "active" || season.actualStart === null) {
        return err({ kind: "SeasonNotActive" });
      }

      const now = deps.clock.now();
      const todayDate = deps.timeZone.localDateAt(now, season.timeZone);
      const forDate = input.forDate ?? todayDate;
      const day = toSeasonDay(forDate, season.actualStart);
      const today = toSeasonDay(todayDate, season.actualStart);
      if (day.kind === "beforeStart" || today.kind === "beforeStart") {
        return err({ kind: "BeforeSeasonStart" });
      }

      const closed = checkEntryWindow({
        schedule: commitment.measure.schedule,
        day: day.day,
        today: today.day,
        lengthWeeks: season.lengthWeeks,
        // B7: the real extension source arrives with change A2 (app-pause-workflow).
        pauseGraceExtensionDays: 0,
      });
      if (closed) {
        return err(closed);
      }

      const value = validateEntryValue(commitment.measure, input.value);
      if (!value.ok) {
        return value;
      }
      const note = normalizeNote(input.note);
      if (!isStorableNote(note)) {
        return err({ kind: "InvalidNote" });
      }
      if (exceedsNoteLimit(note)) {
        return err({ kind: "NoteTooLong" });
      }

      const entry: EntryRecord = {
        id: entryId(deps.ids.next()),
        seasonId: season.id,
        memberId: member.id,
        commitmentId: commitment.id,
        day: day.day,
        recordedOn: today.day,
        recordedAt: now,
        value: value.value,
        note,
        clientRequestId: input.clientRequestId,
        editedAt: null,
        version: 0,
        requestFingerprint: requestFingerprint(value.value, note),
        deleted: false,
      };
      await repos.entries.add(entry);
      return ok({ entry, replayed: false, memberId: member.id });
    },
  );
}
