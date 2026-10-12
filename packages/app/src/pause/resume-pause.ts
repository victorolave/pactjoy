import { type CommitmentId, type PauseRequest, pauseBudget, seasonPauseCap } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Actor } from "../shared/actor.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { loadEffectivePauses } from "./effective-pauses.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { loadPauseRequestForWrite, todayOf } from "./pause-write.ts";

export interface ResumePauseDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface ResumePauseInput {
  readonly pauseRequestId: PauseRequestId;
  /** One Commitment of the request; omitted means every one still running ("Todos", PL-33). */
  readonly commitmentId?: CommitmentId;
}

export type ResumePauseError =
  | { readonly kind: "PauseRequestNotFound" }
  | { readonly kind: "NotPauseRequester" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "PauseNotPending" }
  | { readonly kind: "PauseNotActive" };

/**
 * The requester ends an APPROVED Pause early: the Commitment counts again from
 * today, today included, and the days already paused stay paused (PL-30).
 * `resumedOn = today` is written on the Commitment's own row and the request
 * stays `approved`, since a decision is final (ADR-0013, D6). It needs no
 * approval; the partial week prorates by active days as the engine already does.
 *
 * Q6: resuming an approved Pause that has not started yet writes the same
 * `resumedOn = today`, and the engine then yields no paused day at all, so it
 * acts as a cancel with no grace effect. A pending request is never resumed
 * (`PauseNotPending`; it is cancelled instead); a rejected or cancelled one, one
 * already resumed, one past its fixed end and an open one that reached the cap
 * are `PauseNotActive`.
 */
export async function resumePause(
  deps: ResumePauseDeps,
  actor: Actor,
  input: ResumePauseInput,
): Promise<Result<PauseRequestRecord, ResumePauseError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<PauseRequestRecord, ResumePauseError>> => {
      const loaded = await loadPauseRequestForWrite(deps, repos, actor, input.pauseRequestId);
      if (!loaded.ok) return loaded;
      const { record, season, member, context } = loaded.value;

      if (record.memberId !== member.id) return err({ kind: "NotPauseRequester" });
      if (record.status === "pending") return err({ kind: "PauseNotPending" });
      if (record.status !== "approved") return err({ kind: "PauseNotActive" });
      if (
        input.commitmentId !== undefined &&
        !record.commitments.some((item) => item.commitmentId === input.commitmentId)
      ) {
        return err({ kind: "CommitmentNotOwned" });
      }

      const today = todayOf(context);
      const effective = await loadEffectivePauses(repos, context);
      const actualStart = season.actualStart;
      if (actualStart === null) return err({ kind: "PauseNotActive" });
      const engineSeason = {
        lengthWeeks: season.lengthWeeks,
        startWeekday: startWeekdayOf(actualStart),
      };
      const cap = seasonPauseCap(engineSeason);

      /** Whether the Commitment's Pause still has a day to give back: upcoming, or covering today. */
      const isRunning = (item: PauseRequestRecord["commitments"][number]): boolean => {
        if (item.resumedOn !== null) return false;
        if (record.startDay > today) return true;
        if (record.end.kind === "fixed" && record.end.lastDay < today) return false;
        if (today === 0) return true;
        const history: readonly PauseRequest[] = effective.filter(
          (p) => p.memberId === record.memberId && p.commitmentId === item.commitmentId,
        );
        // An open Pause ends by itself once its days reach the cap (E15).
        return pauseBudget(engineSeason, history, (today - 1) as typeof today).usedDays < cap;
      };

      const targets = record.commitments.filter(
        (item) =>
          (input.commitmentId === undefined || item.commitmentId === input.commitmentId) &&
          isRunning(item),
      );
      if (targets.length === 0) return err({ kind: "PauseNotActive" });

      const resumed: PauseRequestRecord = {
        ...record,
        commitments: record.commitments.map((item) =>
          targets.includes(item) ? { ...item, resumedOn: today, resumedAt: context.now } : item,
        ),
        version: record.version + 1,
      };
      await repos.pauses.save(resumed, record.version);
      return ok(resumed);
    },
  );
}
