import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { Encouragement, NudgeDismissal } from "./encouragement.ts";

type App = { readonly uow: UnitOfWork<Repositories> };

/** Test setup: stores an encouragement and a dismissal straight to the stores (GIVEN state). */
export async function seedEncouragement(
  app: App,
  rows: { readonly encouragement?: Encouragement; readonly dismissal?: NudgeDismissal },
): Promise<void> {
  await app.uow.transaction(async (repos) => {
    if (rows.encouragement) await repos.encouragements.add(rows.encouragement);
    if (rows.dismissal) await repos.nudgeDismissals.add(rows.dismissal);
    return { ok: true as const, value: undefined };
  });
}

/** Test assertion: what the member received and the nudges they dismissed in the season. */
export function storedSocial(app: App, seasonId: SeasonId, memberId: MemberId) {
  return app.uow.read(async (repos) => ({
    received: await repos.encouragements.listReceived(seasonId, memberId),
    sent: await repos.encouragements.listSent(seasonId, memberId),
    dismissed: await repos.nudgeDismissals.listMine(seasonId, memberId),
  }));
}
