import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { EntryPhotoRepository } from "../entry-photo/entry-photo.repository.ts";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryPhotoId } from "../shared/ids.ts";
import { entryPhotoFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { SEASON } from "./fixtures.ts";

/**
 * What the entry photo contract needs from an adapter. It drives the repository DIRECTLY, each call
 * on its own (a database adapter wraps every call in a unit of work), and `seedSeason` creates the
 * parents the foreign keys need. The in-memory adapter needs no seeding.
 */
export interface EntryPhotoContractSubject {
  readonly repository: EntryPhotoRepository;
  readonly seedSeason?: () => Promise<void>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ANDREA = memberId(uuid(0xa1));
const VICTOR = memberId(uuid(0xa2));
const COMMITMENT = commitmentId(uuid(0xc01));
const T0 = 1_791_987_120_000; // 2026-10-14T14:12:00Z
const NOW = instant(T0);

const keyOf = (n: number) => `o/${n.toString(16).padStart(32, "0")}.jpg`;

const photo = (n: number, extra: Partial<EntryPhoto> = {}): EntryPhoto =>
  entryPhotoFixture({
    id: entryPhotoId(uuid(0x700 + n)),
    seasonId: SEASON.id,
    memberId: ANDREA,
    commitmentId: COMMITMENT,
    objectKey: keyOf(n),
    byteSize: 1000 + n,
    createdAt: instant(T0 - 60_000 + n),
    attachBy: instant(T0 + 600_000),
    ...extra,
  });

const expired = (n: number, extra: Partial<EntryPhoto> = {}) =>
  photo(n, { attachBy: instant(T0 - 1_000), ...extra });
const released = (n: number, extra: Partial<EntryPhoto> = {}) =>
  photo(n, { status: "released", version: 1, ...extra });
const attached = (n: number, extra: Partial<EntryPhoto> = {}) =>
  photo(n, { status: "attached", version: 1, ...extra });

const ids = (photos: readonly EntryPhoto[]) => photos.map((p) => p.id).sort();

/** `EntryPhotoRepository` contract, adapter-neutral. The factory must return an EMPTY store. */
export function describeEntryPhotoRepositoryContract(
  name: string,
  factory: () => Promise<EntryPhotoContractSubject>,
): void {
  describe(`EntryPhotoRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("get is null for an unknown id and getMany ignores unknown ids", async () => {
      const repository = await setup();
      expect(await repository.get(entryPhotoId(uuid(0x7ff)))).toBeNull();
      expect(await repository.getMany([])).toEqual([]);
      await repository.add(photo(1));
      expect(
        ids(await repository.getMany([entryPhotoId(uuid(0x701)), entryPhotoId(uuid(0x7ff))])),
      ).toEqual([entryPhotoId(uuid(0x701))]);
    });

    it("add then get returns the same photo, every field", async () => {
      const repository = await setup();
      const one = photo(1);
      await repository.add(one);
      expect(await repository.get(one.id)).toEqual(one);
    });

    it("getMany returns each requested photo once", async () => {
      const repository = await setup();
      await repository.add(photo(1));
      await repository.add(photo(2));
      await repository.add(photo(3));
      const got = await repository.getMany([photo(1).id, photo(3).id, photo(1).id]);
      expect(ids(got)).toEqual([photo(1).id, photo(3).id].sort());
    });

    it("add conflicts on a taken id and on a taken object key, leaving the first intact", async () => {
      const repository = await setup();
      const first = photo(1);
      await repository.add(first);
      await expect(repository.add({ ...photo(2), id: first.id })).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      await expect(
        repository.add({ ...photo(3), objectKey: first.objectKey }),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.get(first.id)).toEqual(first);
      expect(await repository.get(photo(2).id)).toBeNull();
      expect(await repository.get(photo(3).id)).toBeNull();
    });

    it("save moves the status forward with the next version", async () => {
      const repository = await setup();
      const one = photo(1);
      await repository.add(one);
      const next = { ...one, status: "attached" as const, version: 1 };
      await repository.save(next, 0);
      expect(await repository.get(one.id)).toEqual(next);
    });

    it("save at a stale expected version, or for an unknown photo, conflicts and changes nothing", async () => {
      const repository = await setup();
      const one = photo(1);
      await repository.add(one);
      await expect(
        repository.save({ ...one, status: "attached", version: 6 }, 5),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      await expect(
        repository.save({ ...photo(9), status: "attached", version: 1 }, 0),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.get(one.id)).toEqual(one);
    });

    it("save rejects a next version other than expected + 1 and a changed key column as caller bugs", async () => {
      const repository = await setup();
      const one = photo(1);
      await repository.add(one);
      await expect(repository.save({ ...one, status: "attached", version: 5 }, 0)).rejects.toThrow(
        /version/,
      );
      await expect(
        repository.save({ ...one, status: "attached", version: 1, objectKey: keyOf(99) }, 0),
      ).rejects.toThrow(/objectKey/);
      expect(await repository.get(one.id)).toEqual(one);
    });

    it("countOpen counts only the member's pending photos that have not expired", async () => {
      const repository = await setup();
      await repository.add(photo(1));
      await repository.add(photo(2));
      await repository.add(expired(3));
      await repository.add(attached(4));
      await repository.add(released(5));
      await repository.add(photo(6, { memberId: VICTOR }));
      expect(await repository.countOpen(ANDREA, NOW)).toBe(2);
      expect(await repository.countOpen(VICTOR, NOW)).toBe(1);
      // attachBy itself is already expired
      expect(await repository.countOpen(ANDREA, instant(T0 + 600_000))).toBe(0);
    });

    it("releaseExpired releases the member's expired pending photos and returns them, bumped", async () => {
      const repository = await setup();
      await repository.add(expired(1));
      await repository.add(photo(2));
      await repository.add(attached(3, { attachBy: instant(T0 - 1_000) }));
      await repository.add(expired(4, { memberId: VICTOR }));
      const done = await repository.releaseExpired(ANDREA, NOW, 10);
      expect(done).toEqual([{ ...expired(1), status: "released", version: 1 }]);
      expect((await repository.get(expired(1).id))?.status).toBe("released");
      expect((await repository.get(photo(2).id))?.status).toBe("pending");
      expect((await repository.get(attached(3).id))?.status).toBe("attached");
      expect((await repository.get(expired(4).id))?.status).toBe("pending");
    });

    it("releaseExpired(null, ...) works across members and honours the limit, oldest first", async () => {
      const repository = await setup();
      await repository.add(expired(1));
      await repository.add(expired(2, { memberId: VICTOR }));
      await repository.add(expired(3));
      const first = await repository.releaseExpired(null, NOW, 2);
      expect(first.map((p) => p.id)).toEqual([expired(1).id, expired(2).id]);
      const rest = await repository.releaseExpired(null, NOW, 2);
      expect(rest.map((p) => p.id)).toEqual([expired(3).id]);
      expect(await repository.releaseExpired(null, NOW, 2)).toEqual([]);
    });

    it("listReleased returns only released photos, filtered by member, oldest first, bounded", async () => {
      const repository = await setup();
      await repository.add(released(1));
      await repository.add(released(2, { memberId: VICTOR }));
      await repository.add(released(3));
      await repository.add(photo(4));
      await repository.add(attached(5));
      expect((await repository.listReleased(null, 10)).map((p) => p.id)).toEqual([
        released(1).id,
        released(2).id,
        released(3).id,
      ]);
      expect((await repository.listReleased(ANDREA, 10)).map((p) => p.id)).toEqual([
        released(1).id,
        released(3).id,
      ]);
      expect((await repository.listReleased(null, 2)).map((p) => p.id)).toEqual([
        released(1).id,
        released(2).id,
      ]);
    });

    it("purge deletes only released photos; pending, attached and unknown ids are left alone", async () => {
      const repository = await setup();
      await repository.add(released(1));
      await repository.add(photo(2));
      await repository.add(attached(3));
      await repository.purge([
        released(1).id,
        photo(2).id,
        attached(3).id,
        entryPhotoId(uuid(0x7ff)),
      ]);
      expect(await repository.get(released(1).id)).toBeNull();
      expect((await repository.get(photo(2).id))?.status).toBe("pending");
      expect((await repository.get(attached(3).id))?.status).toBe("attached");
      await repository.purge([]);
    });
  });
}
