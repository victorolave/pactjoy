import type { Circle } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { effectiveDecision } from "./effective-decision.ts";
import { approversOf, type PauseContext, seasonDayAt } from "./effective-pauses.ts";
import { settleSeasonPauses } from "./settle.ts";

export interface SettleOnLeaveInput {
  readonly season: Season;
  /** The circle as it was before the leave. */
  readonly before: Circle;
  /** The circle with the leaver already marked as left. */
  readonly after: Circle;
  readonly leaver: Circle["members"][number]["id"];
  readonly now: Instant;
  readonly timeZone: TimeZone;
}

/**
 * What a member leaving does to the season's pending Pause requests (D12):
 * a leaver can neither approve nor block, and can no longer ask.
 *
 * 1. Requests already due are settled first, against the circle as it WAS,
 *    so they keep their own deadline decision and day.
 * 2. The leaver's still-pending requests are cancelled on the leave day.
 * 3. Every other pending request is re-evaluated with the reduced approver
 *    set. If the leave completed it (everyone left to ask has answered, or
 *    nobody is left, PL-9), it is decided AT the leave instant, since that
 *    event is what decided it; otherwise it stays pending.
 *
 * Runs in the leave's own transaction, so it commits or rolls back with it.
 */
export async function settlePausesOnLeave(
  repos: Pick<Repositories, "pauses">,
  input: SettleOnLeaveInput,
): Promise<void> {
  const { season, before, after, leaver, now, timeZone } = input;
  await settleSeasonPauses(repos, { season, circle: before, now, timeZone });

  const context: PauseContext = { season, circle: after, now, timeZone };
  const today = seasonDayAt(context, now);
  for (const record of await repos.pauses.listBySeason(season.id)) {
    if (record.status !== "pending") continue;
    if (record.memberId === leaver) {
      await repos.pauses.save(
        {
          ...record,
          status: "cancelled",
          decidedAt: now,
          decidedOn: today,
          version: record.version + 1,
        },
        record.version,
      );
      continue;
    }
    const decision = effectiveDecision(record, {
      approverIds: approversOf(after, record.memberId),
      now,
      dayOf: (at) => seasonDayAt(context, at),
    });
    if (decision.status === "pending") continue;
    await repos.pauses.save(
      {
        ...record,
        status: decision.status,
        decidedAt: now,
        decidedOn: today,
        version: record.version + 1,
      },
      record.version,
    );
  }
}
