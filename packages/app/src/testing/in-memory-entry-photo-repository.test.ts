import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryPhotoId } from "../shared/ids.ts";
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

  it("an abandoned scope leaves no trace", async () => {
    const repo = createInMemoryEntryPhotoRepository();
    await repo.add(A);
    const scope = repo.beginTransaction();
    await scope.repository.save({ ...A, status: "attached", version: 1 }, 0);
    expect((await repo.get(A.id))?.status).toBe("pending");
  });
});
