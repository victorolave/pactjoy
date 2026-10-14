import type { MemberId } from "@pactjoy/engine";
import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { ok } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { purgeReleased } from "./photo-lifecycle.ts";

export interface SweepEntryPhotosDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly evidence: EvidenceStorage;
}

export interface SweepEntryPhotosInput {
  /** Only this member's rows; omit for a global sweep (job D will trigger that one). */
  readonly memberId?: MemberId;
  /** At most this many rows are released, and at most this many purged, per call. */
  readonly limit: number;
}

export interface SweepEntryPhotosResult {
  /** Expired reservations moved to `released` by this call. */
  readonly released: number;
  /** Released rows whose object was deleted and whose row was removed. */
  readonly purged: number;
}

/**
 * Cleans the upload ledger (REQ-U6): releases reservations past `attachBy`, deletes the object of
 * every released row (the ones this call released and the ones an earlier failed purge left), then
 * removes the rows whose object is gone. Each step is bounded by `limit`. A storage failure leaves
 * the row `released`, so the next call retries it. No trigger exists yet: `requestEntryPhotoUpload`
 * runs it for its own member, and a pg_cron job will run the global one (job D).
 */
export async function sweepEntryPhotos(
  deps: SweepEntryPhotosDeps,
  input: SweepEntryPhotosInput,
): Promise<SweepEntryPhotosResult> {
  const memberId = input.memberId ?? null;
  const now = deps.clock.now();
  const released = await deps.uow.transaction(async ({ entryPhotos }) =>
    ok(await entryPhotos.releaseExpired(memberId, now, input.limit)),
  );
  const pending = await deps.uow.read(({ entryPhotos }) =>
    entryPhotos.listReleased(memberId, input.limit),
  );
  const purged = await purgeReleased(deps, pending);
  return { released: released.ok ? released.value.length : 0, purged };
}
