import type { CommitmentId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { SeasonId } from "../shared/ids.ts";
import type { CommitmentReminder } from "./commitment-reminder.ts";

type App = { readonly uow: UnitOfWork<Repositories> };

/** Test setup: stores a reminder setting straight to the store, bypassing the use cases (GIVEN state). */
export async function seedReminder(app: App, reminder: CommitmentReminder): Promise<void> {
  await app.uow.transaction(async (repos) => {
    await repos.reminders.save(reminder, null);
    return { ok: true as const, value: undefined };
  });
}

/** Test assertion: the persisted setting of the commitment, or `null`. */
export function storedReminder(
  app: App,
  seasonId: SeasonId,
  commitmentId: CommitmentId,
): Promise<CommitmentReminder | null> {
  return app.uow.read((repos) => repos.reminders.get(seasonId, commitmentId));
}
