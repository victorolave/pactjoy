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
 * Erases the person's account (ADR-0019): their data in one transaction, then the identity, then
 * the best-effort photo clean-up, then a second transaction that runs the whole erasure again for
 * whatever the still-valid token wrote meanwhile (a circle, a membership, habits, devices). The confirmation is checked before
 * any I/O. If the identity cannot be deleted the data stays erased and the same call repeats only
 * that step: the tombstones rotate the user id, so a retry finds no membership and nothing else to do.
 */
export async function deleteAccount(
  deps: DeleteAccountDeps,
  actor: Actor,
  input: DeleteAccountInput,
): Promise<Result<void, DeleteAccountError>> {
  if (input.confirmation.trim() !== ACCOUNT_DELETION_CONFIRMATION) {
    return err({ kind: "ConfirmationMismatch" });
  }

  const erased = await eraseInTransaction(deps, actor);
  if (!erased.ok) return erased;

  // The identity goes right after the commit: until it is gone the access token still works and
  // could write personal rows again, so the photo clean-up (slow, best effort) must not delay it.
  let identityFailed = false;
  try {
    await deps.identity.deleteUser(actor.userId);
  } catch (error) {
    if (!(error instanceof IdentityAdminError)) throw error;
    identityFailed = true;
  }

  // Best effort, never inside the transaction: whatever is left is the sweep's (released rows)
  // or an unreachable opaque object (dropped rows, ADR-0019 E6). It runs even when the identity
  // call failed: a retry finds no membership, so these rows would not come back.
  await purgeErasedPhotos(deps, erased.value.released);
  await deleteObjects(deps, erased.value.dropped);

  if (identityFailed) return err({ kind: "IdentityUnavailable" });

  // Whatever the old token wrote between the commit and the identity deletion goes now, by the
  // ORIGINAL user id: the whole erasure again, because the token could also have created or joined
  // a circle once the first one left it without a membership. Idempotent: it finds nothing when the
  // token wrote nothing.
  const late = await eraseInTransaction(deps, actor);
  if (!late.ok) return late;
  await purgeErasedPhotos(deps, late.value.released);
  await deleteObjects(deps, late.value.dropped);
  return ok(undefined);
}

/** One whole erasure of the person in its own transaction, stamped with the current instant. */
function eraseInTransaction(deps: DeleteAccountDeps, actor: Actor) {
  const now = deps.clock.now();
  return deps.uow.transaction(async (repos) =>
    ok(
      await eraseAccount(repos, {
        userId: actor.userId,
        now,
        timeZone: deps.timeZone,
        ids: deps.ids,
      }),
    ),
  );
}
