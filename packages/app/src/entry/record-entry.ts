import type { CommitmentId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { entryId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { type EntryRecord, type EntryValueInput, MAX_NOTE_LENGTH } from "./entry.ts";
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
  | EntryWindowError
  | EntryValueError;

export interface RecordEntryResult {
  readonly entry: EntryRecord;
  /** `true` when `clientRequestId` had already been recorded and the original entry is returned (T1). */
  readonly replayed: boolean;
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
 * and is resolved before the window/value checks, so an offline retry
 * still succeeds after its window closed. A concurrent duplicate loses on
 * the repository's unique key with `ConcurrencyConflict` (D5).
 */
export async function recordEntry(
  deps: RecordEntryDeps,
  actor: Actor,
  input: RecordEntryInput,
): Promise<Result<RecordEntryResult, RecordEntryError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<RecordEntryResult, RecordEntryError>> => {
      const season = await repos.seasons.get(input.seasonId);
      if (!season) {
        return err({ kind: "SeasonNotFound" });
      }

      const circle = await repos.circles.get(season.circleId);
      const member = circle ? findActiveMember(circle, actor.userId) : undefined;
      if (!member) {
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
        return ok({ entry: replay, replayed: true });
      }

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
      const note = input.note ?? null;
      if (note !== null && note.length > MAX_NOTE_LENGTH) {
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
      };
      await repos.entries.add(entry);
      return ok({ entry, replayed: false });
    },
  );
}
