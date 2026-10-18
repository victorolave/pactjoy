import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { effectiveDecision } from "./effective-decision.ts";
import { approversOf, seasonDayAt } from "./effective-pauses.ts";
import { enqueuePauseDecided } from "./pause-notices.ts";
import type { PauseRequestRecord, PauseResponseChoice } from "./pause-request.ts";
import { loadPauseRequestForWrite, withDecision } from "./pause-write.ts";

export interface RespondToPauseDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface RespondToPauseInput {
  readonly pauseRequestId: PauseRequestId;
  readonly decision: PauseResponseChoice;
}

export type RespondToPauseError =
  | { readonly kind: "PauseRequestNotFound" }
  | { readonly kind: "CannotRespondToOwnPause" }
  | { readonly kind: "PauseAlreadyDecided" };

/**
 * Sets the actor's CURRENT answer to a pending request (PL-10, PL-11): it is
 * an idempotent "set my answer", so repeating the same answer writes nothing,
 * and an approver can flip it while the request is pending (Q3). The answer
 * carries no version (D2): a request's content never changes after creation,
 * so the only stale state that matters is "already decided", reported as
 * `PauseAlreadyDecided`; a concurrent write on the same request surfaces as
 * `ConcurrencyConflict` (the client retries once).
 *
 * The request is settled FIRST at the write clock, so an answer arriving at or
 * after `autoApproveAt` finds it decided (PL-S8). If this answer completes
 * the set of approvers the request is decided right here, at this instant
 * (D3, PL-12(a)); otherwise it stays pending.
 */
export async function respondToPause(
  deps: RespondToPauseDeps,
  actor: Actor,
  input: RespondToPauseInput,
): Promise<Result<PauseRequestRecord, RespondToPauseError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<PauseRequestRecord, RespondToPauseError>> => {
      const loaded = await loadPauseRequestForWrite(deps, repos, actor, input.pauseRequestId);
      if (!loaded.ok) return loaded;
      const { record, season, circle, member, context } = loaded.value;

      if (record.memberId === member.id) return err({ kind: "CannotRespondToOwnPause" });
      if (record.status !== "pending") return err({ kind: "PauseAlreadyDecided" });

      const current = record.responses.find((r) => r.memberId === member.id);
      if (current?.response === input.decision) return ok(record);

      const answered: PauseRequestRecord = {
        ...record,
        responses: [
          ...record.responses.filter((r) => r.memberId !== member.id),
          { memberId: member.id, response: input.decision, respondedAt: context.now },
        ],
        version: record.version + 1,
      };
      const decided = withDecision(
        answered,
        effectiveDecision(answered, {
          approverIds: approversOf(circle, record.memberId),
          now: context.now,
          dayOf: (at) => seasonDayAt(context, at),
        }),
      );
      await repos.pauses.save(decided, record.version);
      await enqueuePauseDecided(repos, season, circle, record, decided, context.now);
      return ok(decided);
    },
  );
}
