import type { Repositories } from "../ports/repositories.ts";
import type { UserId } from "../shared/ids.ts";
import { userSubject } from "./join-attempts.ts";

/**
 * INSIDE the transaction (account erasure, ADR-0019 and ADR-0020): deletes the user's join-attempt
 * counters. The network counters are keyed hashes the erasure cannot tie to the account; they
 * expire within the hour.
 */
export async function eraseUserRateLimits(
  repos: Pick<Repositories, "rateLimits">,
  user: UserId,
): Promise<void> {
  await repos.rateLimits.deleteBySubjects([userSubject(user)]);
}
