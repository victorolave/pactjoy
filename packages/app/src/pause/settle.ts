import type { Repositories } from "../ports/repositories.ts";
import { loadEffectiveRequests, type PauseContext } from "./effective-pauses.ts";

/**
 * Persists every request of the season whose effective decision is no longer
 * pending (a due auto-approval, or everyone having answered), with the
 * decision's own `decidedAt`/`decidedOn` and a new version. Idempotent: a
 * decided request is never touched again, so a second run settles 0. Must run
 * inside a transaction; every pause write calls it first (settle-first), and
 * if that write fails the settlement rolls back harmlessly, because reads
 * derive the same decision anyway.
 * @returns how many requests were settled.
 */
export async function settleSeasonPauses(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
): Promise<number> {
  let settled = 0;
  for (const { record, decision } of await loadEffectiveRequests(repos, context)) {
    if (record.status !== "pending" || decision.status === "pending") continue;
    await repos.pauses.save(
      {
        ...record,
        status: decision.status,
        decidedAt: decision.decidedAt,
        decidedOn: decision.decidedOn,
        version: record.version + 1,
      },
      record.version,
    );
    settled += 1;
  }
  return settled;
}
