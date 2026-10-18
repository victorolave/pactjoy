import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryPhotoId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { entryPhotoFixture } from "./builders.ts";
import { createInMemoryEntryPhotoRepository } from "./in-memory-entry-photo-repository.ts";

const A = entryPhotoFixture({ id: entryPhotoId("a"), objectKey: "o/a.jpg" });
const B = entryPhotoFixture({ id: entryPhotoId("b"), objectKey: "o/b.jpg" });

describe("in-memory EntryPhotoRepository transactions", () => {
  it("a staged write is invisible outside the scope until it is applied", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    const scope = repo.beginTransaction();
    await scope.repository.add(A);
    expect(await scope.repository.get(A.id)).toEqual(A);
    expect(await repo.get(A.id)).toBeNull();
    scope.validate();
    scope.apply();
    expect(await repo.get(A.id)).toEqual(A);
  });

  it("two scopes adding the same object key: the second fails validation", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    const first = repo.beginTransaction();
    const second = repo.beginTransaction();
    await first.repository.add(A);
    await second.repository.add({ ...B, objectKey: A.objectKey });
    first.validate();
    first.apply();
    expect(() => second.validate()).toThrow(ConcurrencyConflict);
  });

  it("two scopes attaching the same pending photo: the second fails validation", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add(A);
    const first = repo.beginTransaction();
    const second = repo.beginTransaction();
    await first.repository.save({ ...A, status: "attached", version: 1 }, 0);
    await second.repository.save({ ...A, status: "attached", version: 1 }, 0);
    first.validate();
    first.apply();
    expect(() => second.validate()).toThrow(ConcurrencyConflict);
    expect((await repo.get(A.id))?.status).toBe("attached");
  });

  it("releasing and purging inside one scope leaves the row gone after apply", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add({ ...A, attachBy: instant(1) });
    const scope = repo.beginTransaction();
    const released = await scope.repository.releaseExpired(null, instant(2), 5);
    expect(released).toHaveLength(1);
    await scope.repository.purge([A.id]);
    expect(await scope.repository.get(A.id)).toBeNull();
    expect((await repo.get(A.id))?.status).toBe("pending");
    scope.validate();
    scope.apply();
    expect(await repo.get(A.id)).toBeNull();
  });

  it("a row created and purged in the same scope never reaches the live store", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    const scope = repo.beginTransaction();
    await scope.repository.add({ ...A, status: "released", version: 1 });
    await scope.repository.purge([A.id]);
    scope.validate();
    scope.apply();
    expect(await repo.get(A.id)).toBeNull();
  });

  it("releaseAllOfMembers inside a scope is seen by it, invisible outside, and applied on commit", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add({ ...A, status: "attached", version: 1 });
    const scope = repo.beginTransaction();
    const done = await scope.repository.releaseAllOfMembers([A.memberId]);
    expect(done).toEqual([{ ...A, status: "released", version: 2 }]);
    expect((await scope.repository.get(A.id))?.status).toBe("released");
    expect((await repo.get(A.id))?.status).toBe("attached");
    scope.validate();
    scope.apply();
    expect((await repo.get(A.id))?.version).toBe(2);
  });

  it("deleteBySeasons inside a scope hides the rows, drops them on commit and spares other seasons", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    const other = { ...B, seasonId: seasonId("other") };
    await repo.add(A);
    await repo.add(other);
    const scope = repo.beginTransaction();
    expect(await scope.repository.deleteBySeasons([A.seasonId])).toEqual([A]);
    expect(await scope.repository.get(A.id)).toBeNull();
    expect(await repo.get(A.id)).toEqual(A);
    scope.validate();
    scope.apply();
    expect(await repo.get(A.id)).toBeNull();
    expect(await repo.get(other.id)).toEqual(other);
  });

  it("deleteBySeasons fails validation when another scope moved the row on first", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add(A);
    const first = repo.beginTransaction();
    const second = repo.beginTransaction();
    await first.repository.save({ ...A, status: "attached", version: 1 }, 0);
    await second.repository.deleteBySeasons([A.seasonId]);
    first.validate();
    first.apply();
    expect(() => second.validate()).toThrow(ConcurrencyConflict);
  });

  it("an abandoned scope leaves no trace", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add(A);
    const scope = repo.beginTransaction();
    await scope.repository.save({ ...A, status: "attached", version: 1 }, 0);
    expect((await repo.get(A.id))?.status).toBe("pending");
  });
});
