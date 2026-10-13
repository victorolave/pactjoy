import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import type { PauseRequestRecord } from "./pause-request.ts";

type App = { readonly uow: UnitOfWork<Repositories> };

/** Test setup: stores a pause request straight to the store, bypassing the use cases. */
export async function seedPause(app: App, record: PauseRequestRecord): Promise<void> {
  await app.uow.transaction(async (repos) => {
    await repos.pauses.save(record, null);
    return { ok: true as const, value: undefined };
  });
}

/** Test assertion helper: the PERSISTED request, as stored (never the effective decision). */
export function storedPause(app: App, id: PauseRequestId): Promise<PauseRequestRecord | null> {
  return app.uow.read((repos) => repos.pauses.get(id));
}
