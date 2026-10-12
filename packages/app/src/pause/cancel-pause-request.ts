import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { loadPauseRequestForWrite, todayOf } from "./pause-write.ts";

export interface CancelPauseRequestDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface CancelPauseRequestInput {
  readonly pauseRequestId: PauseRequestId;
}

export type CancelPauseRequestError =
  | { readonly kind: "PauseRequestNotFound" }
  | { readonly kind: "NotPauseRequester" }
  | { readonly kind: "PauseAlreadyDecided" };

/**
 * The requester withdraws a PENDING request, the whole group for "Todos"
 * (PL-20). It is stored as `cancelled`, decided at this instant and on this
 * day; for scoring and grace it behaves exactly like a rejection (Q2): the
 * opportunities count normally and their Entry window runs to the end of the
 * day after the cancel (PL-21). Settlement runs first, so a cancel arriving
 * at or after `autoApproveAt` finds the request approved and is refused
 * (PL-22); an approved Pause is resumed instead, never cancelled.
 */
export async function cancelPauseRequest(
  deps: CancelPauseRequestDeps,
  actor: Actor,
  input: CancelPauseRequestInput,
): Promise<Result<PauseRequestRecord, CancelPauseRequestError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<PauseRequestRecord, CancelPauseRequestError>> => {
      const loaded = await loadPauseRequestForWrite(deps, repos, actor, input.pauseRequestId);
      if (!loaded.ok) return loaded;
      const { record, member, context } = loaded.value;

      if (record.memberId !== member.id) return err({ kind: "NotPauseRequester" });
      if (record.status !== "pending") return err({ kind: "PauseAlreadyDecided" });

      const cancelled: PauseRequestRecord = {
        ...record,
        status: "cancelled",
        decidedAt: context.now,
        decidedOn: todayOf(context),
        version: record.version + 1,
      };
      await repos.pauses.save(cancelled, record.version);
      return ok(cancelled);
    },
  );
}
