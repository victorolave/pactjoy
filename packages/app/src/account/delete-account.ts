import { deleteObjects, purgeErasedPhotos } from "../entry-photo/erase.ts";
import type { EvidenceStorage } from "../ports/evidence-storage.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import { type IdentityAdmin, IdentityAdminError } from "../ports/identity-admin.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { eraseAccount } from "./erase-account.ts";

/** The word the person types to confirm; the same rule for every driver (ADR-0019 E12). */
export const ACCOUNT_DELETION_CONFIRMATION = "ELIMINAR";

export interface DeleteAccountDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  /** Turns the leave instant into the season day a Pause request is decided on. */
  readonly timeZone: TimeZone;
  /** Mints the unlinked user ids the tombstones carry. */
  readonly ids: IdGenerator;
  readonly evidence: EvidenceStorage;
  readonly identity: IdentityAdmin;
}

export interface DeleteAccountInput {
  readonly confirmation: string;
}

export type DeleteAccountError =
  | { readonly kind: "ConfirmationMismatch" }
  | { readonly kind: "IdentityUnavailable" };

/**
 * Erases the person's account (ADR-0019): their data in one transaction, then the best-effort
 * photo clean-up, then the identity LAST. The confirmation is checked before any I/O. If the
 * identity cannot be deleted the data stays erased and the same call repeats only that step: the
 * tombstones rotate the user id, so a retry finds no membership and nothing else to do.
 */
export async function deleteAccount(
  deps: DeleteAccountDeps,
  actor: Actor,
  input: DeleteAccountInput,
): Promise<Result<void, DeleteAccountError>> {
  if (input.confirmation.trim() !== ACCOUNT_DELETION_CONFIRMATION) {
    return err({ kind: "ConfirmationMismatch" });
  }

  const now = deps.clock.now();
  const erased = await deps.uow.transaction(async (repos) =>
    ok(
      await eraseAccount(repos, {
        userId: actor.userId,
        now,
        timeZone: deps.timeZone,
        ids: deps.ids,
      }),
    ),
  );
  if (!erased.ok) return erased;

  // Best effort, never inside the transaction: whatever is left is the sweep's (released rows)
  // or an unreachable opaque object (dropped rows, ADR-0019 E6).
  await purgeErasedPhotos(deps, erased.value.released);
  await deleteObjects(deps, erased.value.dropped);

  try {
    await deps.identity.deleteUser(actor.userId);
  } catch (error) {
    if (error instanceof IdentityAdminError) return err({ kind: "IdentityUnavailable" });
    throw error;
  }
  return ok(undefined);
}
