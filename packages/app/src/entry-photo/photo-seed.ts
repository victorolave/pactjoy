import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { EntryPhotoId } from "../shared/ids.ts";
import type { EntryPhoto } from "./entry-photo.ts";

type App = { readonly uow: UnitOfWork<Repositories> };

/** Test setup: stores ledger rows straight to the store, bypassing the use cases (GIVEN state). */
export async function seedPhotos(app: App, photos: readonly EntryPhoto[]): Promise<void> {
  await app.uow.transaction(async (repos) => {
    for (const photo of photos) await repos.entryPhotos.add(photo);
    return { ok: true as const, value: undefined };
  });
}

/** Test setup: moves a stored row to `released` as an earlier replace or remove would (its object stays). */
export async function releaseStoredPhoto(app: App, id: EntryPhotoId): Promise<void> {
  await app.uow.transaction(async ({ entryPhotos }) => {
    const row = await entryPhotos.get(id);
    if (!row) throw new Error("setup: the photo row does not exist");
    await entryPhotos.save({ ...row, status: "released", version: row.version + 1 }, row.version);
    return { ok: true as const, value: undefined };
  });
}

/** Test assertion: the persisted ledger row, or `null`. */
export function storedPhoto(app: App, id: EntryPhotoId): Promise<EntryPhoto | null> {
  return app.uow.read((repos) => repos.entryPhotos.get(id));
}
